# Travel

行程編排 PWA。每個景點只要填「停留多久」，抵達時刻由前後站的實際路程自己算出來；
拖一下順序，整天的時刻立刻重排。多人用「旅程代碼＋密碼」進同一份行程共同編輯。

上線網址：<https://jeremyl861225.github.io/travel/>（iPhone 用 Safari 開 → 分享 → 加入主畫面）

## 這支 app 在做什麼

- **一天是一片分頁色板**，行程頁浮在板上。右緣的分頁鐵一天一個顏色，高度依當天行程長度。
- **時刻是算出來的**：每天設一個出發時間，之後每一站＝前一站的離開時間＋兩站之間的路程。
- **釘選**：預約制的餐廳或寺院可以釘死時間，前後自動遵守；推不到就標紅，並把落後量一路帶下去。
- **貼 Google 地圖網址就長出資料**：名稱、地址、電話、座標、營業時間、評分。
- **到達時對不對得上營業時間**會自動比對，沒開門就出勘誤條。
- **離線可用**：資料以本機為主，回到連線再同步。國外沒網路照樣編。
- **共編不互相蓋掉**：每張卡片各自同步，兩個人改不同卡片不會打架；改到同一張會出「撞車」讓你選。

## 隱私

行程內容在你的手機上用 AES-GCM 加密後才上傳，金鑰由旅程密碼經 PBKDF2 導出。
伺服器只存密文，**密碼遺失就救不回來**，我們沒有備份。

刻意留在明文的只有：這趟有幾天、某天有幾張卡、卡片的排序鍵、最後修改者的暱稱。
不含任何地點、名稱或內容。

## 檔案

| 檔案 | 是什麼 |
|---|---|
| `index.html` | 整支 app（HTML＋CSS＋JS 都在裡面，沒有建置步驟） |
| `sw.js` | Service worker，stale-while-revalidate |
| `schema.sql` | Supabase 資料表與 RPC，可重複執行 |
| `supabase/functions/gmap/index.ts` | Google Maps 代理，API key 只活在這一層 |
| `check.mjs` | 交付前的語法檢查，**每次改完都要跑** |
| `tools/make-icons.mjs` | 產生 PWA 圖示 |
| `docs/GOOGLE-MAPS-SETUP.md` | 申請 API key 的逐步指引 |

## 開發

沒有建置步驟。改完 `index.html` 之後：

```bash
node check.mjs index.html
```

會檢查每個 `<script>` 的語法、括號從哪一行開始沒收、`$('#id')` 指到的元素是否存在、
以及呼叫了但沒定義的函式。**這一步不能跳過**——沒有建置步驟就代表語法錯誤只會在
瀏覽器變成一片空白。

本機預覽：

```bash
python3 -m http.server 8083 --directory .
```

## 後端

Supabase 專案 `dawcpdgonxmhojwonkut`（與 todo-app 共用專案，但資料表全部在獨立的
`travel` schema，互不相干）。`travel` schema 不對外開放，所有存取都得走
`public.travel_*` 那幾支 SECURITY DEFINER 函式，每一支都要帶對 code 與 auth_hash。

Edge Function `gmap` 的 `verify_jwt` 是關的——這支 app 沒有帳號系統，
驗證改由旅程代碼與密碼負責。
