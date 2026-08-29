-- =============================================================
--  Travel — Supabase 資料表與 RPC
--  用法：Supabase 專案 → 左側 SQL Editor → New query → 全部貼上 → Run
--  可重複執行，不會刪除既有資料。
--
--  設計重點：**伺服器端看不到任何行程內容**。
--  景點名稱、地址、介紹、預定事項全部在瀏覽器裡用 AES-GCM 加密後才上傳，
--  這裡只存密文（payload）。金鑰由「旅程密碼」以 PBKDF2 導出，伺服器沒有。
--
--  刻意留在明文的欄位，以及為什麼：
--    day_index  哪一天（null = 候選口袋）  ─┐ 兩個人同時改不同卡片時，
--    order_key  同一天內的排序鍵            ─┤ 伺服器要能各自更新而不必解密，
--    updated_by 最後修改者暱稱              ─┘ 否則每次拖曳都得整包重寫。
--  這些欄位洩漏的只有「這趟有幾天、某天有幾個點、是誰在改」，不含任何地點。
--
--  資料表放在不對外開放的 travel schema，client 打不到；
--  所有存取都得走下面 public.travel_* 這幾支 SECURITY DEFINER 函式，
--  每一支都要帶對 code + auth_hash 才會回東西。
-- =============================================================

create extension if not exists pgcrypto;

create schema if not exists travel;

-- travel schema 永遠不加進 PostgREST 的 exposed schemas，
-- 這行只是再上一道鎖：就算不小心開放了，anon 也沒有權限。
revoke all on schema travel from anon, authenticated;

-- ---------- 旅程 ----------
-- salt/verifier/auth_hash 外洩也解不開內容（沒有旅程密碼），
-- 但 auth_hash 可被重放，所以這張表絕不能讓 client 直接讀。
create table if not exists travel.trips (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,          -- 旅程代碼，8 碼、去掉易混淆字元
  salt        text not null,                 -- PBKDF2 的鹽（16 bytes, base64）
  iters       int  not null default 250000,
  verifier    text not null,                 -- 用旅程密碼加密一段已知字串，用來確認密碼打對
  auth_hash   text not null,                 -- SHA-256(code:密碼:salt) 的 base64，寫入權限用
  meta        text not null,                 -- 密文：標題、起訖日、時區、類別、每日出發時間
  meta_rev    int  not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists trips_code on travel.trips (code);

-- ---------- 行程卡 ----------
create table if not exists travel.cards (
  id          uuid primary key,              -- 由 client 產生，離線先建卡再同步
  trip_id     uuid not null references travel.trips(id) on delete cascade,
  day_index   int,                           -- 第幾天（0 起算）；null = 候選口袋
  order_key   text not null,                 -- 分數索引字串，插隊不必重排整天
  payload     text not null,                 -- 密文：名稱、類別、地址、介紹、預定、圖片…
  rev         int  not null default 1,
  deleted     boolean not null default false, -- 墓碑，不真刪，否則離線裝置會把它復活
  updated_by  text not null default '',
  updated_at  timestamptz not null default now()
);

create index if not exists cards_trip_updated on travel.cards (trip_id, updated_at desc);
create index if not exists cards_trip_day     on travel.cards (trip_id, day_index, order_key);

-- RLS 全開但不給任何 policy＝除了 SECURITY DEFINER 函式，誰都讀不到。
alter table travel.trips enable row level security;
alter table travel.cards enable row level security;

-- =============================================================
--  內部：驗證 code + auth_hash，回傳 trip_id
-- =============================================================
create or replace function travel.auth_trip(p_code text, p_auth_hash text)
returns uuid
language plpgsql security definer set search_path = travel, pg_temp as $$
declare v_id uuid;
begin
  select id into v_id from travel.trips
   where code = upper(trim(p_code)) and auth_hash = p_auth_hash;
  if v_id is null then
    raise exception 'AUTH_FAILED' using errcode = '28000';
  end if;
  return v_id;
end $$;

-- =============================================================
--  對外 RPC（放在 public 才會被 PostgREST 匯出）
-- =============================================================

-- 取得某個旅程代碼的鹽：要先有鹽才能導出金鑰算 auth_hash，所以這支不需驗證。
-- 鹽本身不是秘密；代碼是 8 碼隨機，猜中的機率低到不值得防。
create or replace function public.travel_salt(p_code text)
returns table (salt text, iters int)
language sql security definer set search_path = travel, pg_temp as $$
  select t.salt, t.iters from travel.trips t where t.code = upper(trim(p_code));
$$;

-- 建立旅程。代碼撞號時丟 CODE_TAKEN，由 client 換一組重試。
create or replace function public.travel_create(
  p_code text, p_salt text, p_iters int, p_verifier text, p_auth_hash text, p_meta text)
returns table (trip_id uuid, updated_at timestamptz)
language plpgsql security definer set search_path = travel, pg_temp as $$
declare v_id uuid;
begin
  if length(trim(p_code)) < 6 then
    raise exception 'CODE_TOO_SHORT' using errcode = '22023';
  end if;
  begin
    insert into travel.trips (code, salt, iters, verifier, auth_hash, meta)
    values (upper(trim(p_code)), p_salt, coalesce(p_iters, 250000), p_verifier, p_auth_hash, p_meta)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'CODE_TAKEN' using errcode = '23505';
  end;
  return query select v_id, now();
end $$;

-- 進房：驗證後回傳 verifier 與 meta。
create or replace function public.travel_open(p_code text, p_auth_hash text)
returns table (trip_id uuid, verifier text, meta text, meta_rev int, updated_at timestamptz)
language plpgsql security definer set search_path = travel, pg_temp as $$
declare v_id uuid;
begin
  v_id := travel.auth_trip(p_code, p_auth_hash);
  return query
    select t.id, t.verifier, t.meta, t.meta_rev, t.updated_at
      from travel.trips t where t.id = v_id;
end $$;

-- 更新旅程設定（標題、日期、類別…）。rev 對不上就回衝突，讓 client 自己合併。
create or replace function public.travel_push_meta(
  p_code text, p_auth_hash text, p_meta text, p_base_rev int)
returns table (ok boolean, meta text, meta_rev int)
language plpgsql security definer set search_path = travel, pg_temp as $$
declare v_id uuid; v_rev int;
begin
  v_id := travel.auth_trip(p_code, p_auth_hash);
  select t.meta_rev into v_rev from travel.trips t where t.id = v_id for update;
  if v_rev <> p_base_rev then
    return query select false, t.meta, t.meta_rev from travel.trips t where t.id = v_id;
    return;
  end if;
  update travel.trips
     set meta = p_meta, meta_rev = trips.meta_rev + 1, updated_at = now()
   where trips.id = v_id;
  return query select true, t.meta, t.meta_rev from travel.trips t where t.id = v_id;
end $$;

-- 拉取：只回 p_since 之後變動過的卡，離線回來時不必整包重下。
-- p_since 傳 null 代表第一次進來，全拉。
create or replace function public.travel_cards_pull(
  p_code text, p_auth_hash text, p_since timestamptz)
returns table (id uuid, day_index int, order_key text, payload text,
               rev int, deleted boolean, updated_by text, updated_at timestamptz)
language plpgsql security definer set search_path = travel, pg_temp as $$
declare v_id uuid;
begin
  v_id := travel.auth_trip(p_code, p_auth_hash);
  return query
    select c.id, c.day_index, c.order_key, c.payload,
           c.rev, c.deleted, c.updated_by, c.updated_at
      from travel.cards c
     where c.trip_id = v_id
       and (p_since is null or c.updated_at > p_since)
     order by c.updated_at;
end $$;

-- 推送一張卡。p_base_rev 為 0 代表新建。
-- rev 對不上就整列回傳現況，由 client 顯示「這張剛被誰改過」讓使用者決定。
create or replace function public.travel_card_push(
  p_code text, p_auth_hash text, p_id uuid, p_day_index int, p_order_key text,
  p_payload text, p_deleted boolean, p_base_rev int, p_updated_by text)
returns table (ok boolean, id uuid, day_index int, order_key text, payload text,
               rev int, deleted boolean, updated_by text, updated_at timestamptz)
language plpgsql security definer set search_path = travel, pg_temp as $$
declare v_id uuid; v_rev int;
begin
  v_id := travel.auth_trip(p_code, p_auth_hash);
  select c.rev into v_rev from travel.cards c where c.id = p_id and c.trip_id = v_id for update;

  if v_rev is null then
    insert into travel.cards (id, trip_id, day_index, order_key, payload, rev, deleted, updated_by)
    values (p_id, v_id, p_day_index, p_order_key, p_payload, 1, coalesce(p_deleted,false),
            coalesce(p_updated_by,''));
    return query select true, c.id, c.day_index, c.order_key, c.payload,
                        c.rev, c.deleted, c.updated_by, c.updated_at
                   from travel.cards c where c.id = p_id;
    return;
  end if;

  if v_rev <> p_base_rev then
    return query select false, c.id, c.day_index, c.order_key, c.payload,
                        c.rev, c.deleted, c.updated_by, c.updated_at
                   from travel.cards c where c.id = p_id;
    return;
  end if;

  update travel.cards
     set day_index = p_day_index, order_key = p_order_key, payload = p_payload,
         deleted = coalesce(p_deleted,false), rev = cards.rev + 1,
         updated_by = coalesce(p_updated_by,''), updated_at = now()
   where cards.id = p_id;

  return query select true, c.id, c.day_index, c.order_key, c.payload,
                      c.rev, c.deleted, c.updated_by, c.updated_at
                 from travel.cards c where c.id = p_id;
end $$;

-- 只搬位置（拖曳排序）：payload 不動，衝突機率遠低於整卡推送。
create or replace function public.travel_card_move(
  p_code text, p_auth_hash text, p_id uuid, p_day_index int, p_order_key text, p_updated_by text)
returns table (ok boolean, rev int, updated_at timestamptz)
language plpgsql security definer set search_path = travel, pg_temp as $$
declare v_id uuid;
begin
  v_id := travel.auth_trip(p_code, p_auth_hash);
  update travel.cards
     set day_index = p_day_index, order_key = p_order_key, rev = cards.rev + 1,
         updated_by = coalesce(p_updated_by,''), updated_at = now()
   where cards.id = p_id and cards.trip_id = v_id;
  if not found then
    raise exception 'CARD_NOT_FOUND' using errcode = 'P0002';
  end if;
  return query select true, c.rev, c.updated_at from travel.cards c where c.id = p_id;
end $$;

-- =============================================================
--  權限：anon 只能呼叫這幾支函式，其他一律不給
-- =============================================================
revoke all on function public.travel_salt(text)                                  from public;
revoke all on function public.travel_create(text,text,int,text,text,text)        from public;
revoke all on function public.travel_open(text,text)                             from public;
revoke all on function public.travel_push_meta(text,text,text,int)               from public;
revoke all on function public.travel_cards_pull(text,text,timestamptz)           from public;
revoke all on function public.travel_card_push(text,text,uuid,int,text,text,boolean,int,text) from public;
revoke all on function public.travel_card_move(text,text,uuid,int,text,text)     from public;

grant execute on function public.travel_salt(text)                                  to anon, authenticated;
grant execute on function public.travel_create(text,text,int,text,text,text)        to anon, authenticated;
grant execute on function public.travel_open(text,text)                             to anon, authenticated;
grant execute on function public.travel_push_meta(text,text,text,int)               to anon, authenticated;
grant execute on function public.travel_cards_pull(text,text,timestamptz)           to anon, authenticated;
grant execute on function public.travel_card_push(text,text,uuid,int,text,text,boolean,int,text) to anon, authenticated;
grant execute on function public.travel_card_move(text,text,uuid,int,text,text)     to anon, authenticated;
