/* 把 tohoku-2026 的 guide_data.js 轉成 Travel 的旅程匯入檔。
   兩份資料模型有三個對不上的地方，這支腳本就是在處理它們：
     1. tohoku 的 leg 掛在「終點」那張卡（開到這張卡的那一段），
        Travel 的 leg 掛在「起點」那張卡（從這張卡到下一張）。差一格。
     2. tohoku 的 time 是抵達時刻，Travel 的抵達時刻是算出來的。
        所以每天第一張卡的 time 拿來當那天的出發時間，其餘不釘選，讓程式自己推。
     3. tohoku 的 type 有 13 種，Travel 預設只有 6 類，要對映＋補兩個新類別。 */
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = '/Users/jeremy/Desktop/Claude code/tohoku-2026/src/guide_data.js';
const src = readFileSync(SRC, 'utf8');
const { SPOTS, DAYS } = new Function(src + '; return { SPOTS, DAYS };')();

const CATS = [
  { id:'nature',   name:'自然', mark:'nature' },
  { id:'heritage', name:'古蹟', mark:'heritage' },
  { id:'shop',     name:'購物', mark:'shop' },
  { id:'play',     name:'互動', mark:'play' },
  { id:'food',     name:'飲食', mark:'food' },
  { id:'stay',     name:'住宿', mark:'stay' },
  { id:'transit',  name:'交通', mark:'transit' },
  { id:'view',     name:'展望', mark:'view' },
];
const TYPE2CAT = {
  '餐飲':'food', '古蹟':'heritage', '城跡':'heritage', '城跡・庭園':'heritage',
  '展望':'view', '高山':'nature', '溪流・森林':'nature', '湖泊':'nature',
  '湖泊・森林':'nature', '溫泉':'nature', '溫泉・住宿':'stay',
  '交通':'transit', '町並':'shop',
};

const mins = s => { const m = /(\d+)/.exec(String(s || '')); return m ? +m[1] : null; };
const hm2min = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  return m ? (+m[1]) * 60 + (+m[2]) : null; };

/* 分數索引：跟 app 裡那支同一套，插隊時不用重寫整天 */
const A62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function keyBetween(a, b) {
  a = a || ''; b = b || '';
  let out = '';
  for (let i = 0;; i++) {
    const ca = i < a.length ? A62.indexOf(a[i]) : -1;
    const cb = i < b.length ? A62.indexOf(b[i]) : A62.length;
    if (cb - ca > 1) return out + A62[Math.floor((ca + cb) / 2)];
    out += i < a.length ? a[i] : A62[0];
  }
}

const byDay = new Map();
for (const s of SPOTS) { if (!byDay.has(s.day)) byDay.set(s.day, []); byDay.get(s.day).push(s); }

const cards = [];
const dayStarts = {};
const noStay = [];
const pinned = [];

for (const [day, list] of [...byDay.entries()].sort((a,b) => a[0]-b[0])) {
  const di = day - 1;
  dayStarts[di] = list[0].time || '09:00';
  let key = '';
  /* 原始行程的抵達時刻裡，有些空檔不是「停留」也不是「路程」——
     午餐、買東西、單純的緩衝。照 stay+leg 推會把整天壓縮掉。
     所以邊轉邊模擬一次：推算值比原始時刻早 15 分以上的，就把原始時刻釘上去，
     保住作者的意圖，其餘仍然交給程式推。 */
  let clock = hm2min(list[0].time) ?? 540;
  list.forEach((s, i) => {
    key = keyBetween(key, '');
    const next = list[i + 1];
    /* leg 差一格：這張卡到下一張的路程，寫在 tohoku 的「下一張」身上 */
    let leg = null;
    if (next && next.leg) {
      const t = mins(next.leg.t);
      const km = /(\d+(?:\.\d+)?)\s*km/.exec(next.leg.d || '');
      const walk = next.leg.src === 'walk' || /步行/.test(next.leg.t || '');
      leg = { mode: walk ? 'walk' : (next.leg.src === 'same' ? 'walk' : 'drive'),
              min: t, meters: km ? Math.round(parseFloat(km[1]) * 1000) : null,
              sig: 'tohoku' };
    }
    const stay = mins(s.stay);
    if (stay == null) noStay.push(s.id + '（stay: ' + s.stay + '）');
    const stayMin = stay == null ? 60 : stay;

    const stated = hm2min(s.time);
    let pin = '';
    if (i > 0 && stated != null && stated - clock >= 15) {
      pin = s.time;
      pinned.push('D' + day + ' ' + s.name + '（推算 ' +
        String(Math.floor(clock/60)).padStart(2,'0') + ':' + String(clock%60).padStart(2,'0') +
        ' → 釘 ' + s.time + '）');
      clock = stated;
    }
    clock += stayMin + (leg && leg.min != null ? leg.min : 0);

    const note = [
      s.desc || '',
      ...(s.fields || []).map(([k, v]) => k + '：' + v),
      s.tip ? '提醒：' + s.tip : '',
      s.photo ? '拍照：' + s.photo : '',
    ].filter(Boolean).join('\n\n');

    cards.push({
      dayIndex: di, orderKey: key,
      data: {
        name: s.name,
        catId: TYPE2CAT[s.type] || '',
        stayMin,
        pinTime: pin,
        note,
        links: [], todos: [], images: [],
        leg,
        place: {
          placeId: null,
          /* gq 是 tohoku 實測過會解析到正確 POI 的查詢字串，比 name 可靠。
             沒有 gq 的就只留座標——Google 查不到地名會退回搜尋使用者附近的同類地點。 */
          name: s.gq || s.jp || s.name,
          address: null, phone: null,
          lat: s.lat, lng: s.lng,
          rating: null, ratingCount: null,
          hoursText: null, hoursPeriods: null,
          website: null, mapsUri: null,
          type: s.type,
        },
      },
    });
  });
}

const out = {
  format: 'travel-trip@1',
  exportedAt: '2026-08-29',
  source: 'tohoku-2026/src/guide_data.js',
  trip: {
    name: '南東北自駕六日',
    startDate: '2026-09-22',
    days: byDay.size,
    defaultStart: '09:00',
    dayStarts,
    defaultMode: 'drive',
    autoRoute: false,          // 車程是 tohoku 實測過的，別讓程式拿 Google 覆蓋掉
    cats: CATS,
  },
  cards,
};
/* 行程內容不進版控——它只該存在 Supabase 與這台機器的暫存區。
   輸出到 repo 外面，再用 App 的「旅程設定 → 匯出／匯入」把檔案讀進去。 */
const DEST = '/Users/jeremy/Desktop/Claude code/workspace/work/travel-imports/tohoku-2026.travel.json';
writeFileSync(DEST, JSON.stringify(out, null, 1));
console.log('寫到 ' + DEST);

console.log('轉出 ' + cards.length + ' 張卡，' + byDay.size + ' 天');
console.log('每日出發：' + Object.entries(dayStarts).map(([d,t]) => 'D' + (+d+1) + ' ' + t).join('　'));
const legs = cards.filter(c => c.data.leg && c.data.leg.min != null).length;
console.log('有路程的段：' + legs + ' / ' + (cards.length - byDay.size));
if (noStay.length) console.log('停留時間不是數字、已預設 60 分：\n  ' + noStay.join('\n  '));
if (pinned.length) console.log('原始時刻有無法用停留＋路程解釋的空檔，已釘選 ' +
  pinned.length + ' 張：\n  ' + pinned.join('\n  '));
const noCat = cards.filter(c => !c.data.catId);
if (noCat.length) console.log('沒對到類別：' + noCat.map(c => c.data.name).join('、'));
