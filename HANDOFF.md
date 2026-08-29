# 進度交接 — 2026-08-29

## 現在的狀態：可以跑，但視覺還在調

App 本身功能完整、後端已上線、同步實測過。剩下的是視覺方向的最後幾個決定，
使用者正在挑，挑完套進去就收工。

---

## 已經完成

### 後端（已上線，不用再動）
- Supabase 專案 **`dawcpdgonxmhojwonkut`**（就是 todo-app 那個，因為免費方案每人只能
  有 2 個 active 專案，第三個建不起來）。資料表全部在獨立的 **`travel` schema**，
  跟 todo-app 的 public 表互不相干。
- Migration 已套用兩次：`travel_schema_init`、`travel_fix_ambiguous_columns`。
  第二次修的是 42702：`RETURNS TABLE` 的欄位名跟資料表欄位同名，
  `SET rev = rev + 1` 兩邊都說得通 → 每次推送都失敗。改成 `rev = cards.rev + 1`。
- Edge Function **`gmap`** 已部署（`verify_jwt: false`，驗證改由旅程代碼＋密碼負責）。
- **`GOOGLE_MAPS_API_KEY` 這個 secret 還沒設**，所以自動抓景點與自動算路程目前是停的，
  會回 `NO_API_KEY`，前端已經有降級處理（改手動填，不會整頁失效）。
  申請步驟寫在 `docs/GOOGLE-MAPS-SETUP.md`，要使用者自己去綁信用卡。

### 前端
- 單檔 `index.html`，2023 行，7 個 script 區塊，`node check.mjs index.html` 通過。
- 已驗證可用：建立旅程、解鎖、加卡、時刻推算（含釘選與等待／落後）、
  營業時間比對、候選口袋、移動卡片、上路模式（下一站）、雲端同步（推送與拉取都實測過）。
- **還沒實機驗過的**：拖曳排序（程式寫好了但沒真的用手指拖過）、
  撞車（conflict）的兩顆按鈕、類別新增與刪除、匯入 Google 網址（缺 key）。

### 設計
- 視覺世界是 impeccable 方向輪選出來的「手冊分頁板」（catalog `rw-manual-acetate-tab-board`，
  seed 20291719）。設計契約寫在 `index.html` body 開頭的 HTML 註解裡。
- 使用者陸續給的修正都已經套用：加圓角、拿掉活頁紙打孔點、分頁改成順時針直排的
  `Day 1` ＋日期、卡片壓低（69px）、字級縮一階、路線鍵不反白、**取消暗色主題**、
  「上路」改名成「下一站」、口袋分頁那個看起來像缺字的「口」換成張數。

---

## 回來要接的三件事

### 1. 色票（等使用者挑）
- 使用者要求：**從 colormind.io 抓，不要自行過濾顏色，也不要按色階排列**。
- 12 組原始色票已經抓好，做成 `_palettes.html`（這支不進版控），已經送給使用者看。
  代號 A–L，每組是某個 model 直接回傳的五色與原始順序。
- 挑完之後：把 `index.html` 裡的 `HUES` 陣列換成那五色即可。
  注意 `hueOf()` 是取模循環，五色跑七天會重複，這是可接受的。

### 2. 底色改成暖象牙白（已指定，還沒套）
- 使用者傳了一張純色圖說「底色請用此顏色」，我讀到的是 **#FBF6EA**（暖象牙白），
  已在回覆中告知我的判讀，**尚未得到確認**。
- 這是個架構性的改動：現在的作法是「板色＝當日色，整面飽和」，
  改成暖象牙白之後會變成「底色是紙，當日色只出現在分頁鐵、類別方磚、主要按鈕」——
  這其實更貼近參考圖 hero 的作法。
- `applyBoard()` 要改：`board` 不再是 hue，改成 cream；
  另外要留一個 `--accent` 給當日色。`inkOn()` 與 `solveLeaf()` 都還能用，
  但 leaf 的目標亮度要重算（底色變亮了，頁不能再往上疊）。
- **注意**：`solveLeaf` 目前假設頁比板亮。底色若是 #FBF6EA（亮度 0.90），
  頁要再更亮就不可能了，必須改成「頁＝純白＋細邊框＋淺影」來分層，
  或讓頁比底色略暗一點。這段程式要一起改，不然卡片會整個消失在底色裡。

### 3. 字體（等 agent 報告 ＋ 使用者挑）
- 使用者說「字體太醜了」，並要求「派一個 agent 掃描參考圖有哪些設計元素，
  並讓我挑選我喜歡的，包括底色、色票、字體」。
- 該 agent 已派出（掃兩張參考圖，產出底色／色票／字體／元件／版面／圖示的可選清單），
  **暫停時還沒回報**。回來後要先看它的報告，再把字體選項擺給使用者挑。
- 限制：不下載字型檔，只能用 macOS/iOS 內建（Helvetica Neue、SF Pro、PingFang TC、
  Songti TC、Hiragino Mincho、SF Mono、Menlo、Georgia…），中英文都要顧。

---

## 還沒做的收尾工作

- [x] 建 GitHub repo 與 GitHub Pages 部署（已完成：github.com/jeremyl861225/travel）
- [ ] 拖曳排序的實機驗證
- [ ] impeccable 的 finish review（`impeccable-finish-reviewer`）與 DESIGN.md（`impeccable-documenter`）
- [ ] 清掉測試資料：Supabase 上有一筆代號 `LKUD6TAH`、密碼 `travel2026` 的
      「京都五日」測試旅程（假資料）。**暫停期間刻意留著**，讓使用者可以在 iPhone 上
      開 https://jeremyl861225.github.io/travel/ 直接輸入這組來試用。定案後要刪。
- [ ] `sw.js` 的 `CACHE_VERSION` 目前是 `travel-v1`，每次改版要記得跳號

---

## 踩過的坑（別再踩一次）

1. **Supabase 免費方案每人 2 個 active 專案**，第三個建不起來，錯誤訊息會明講。
2. **`RETURNS TABLE` 的欄位名會跟資料表欄位撞**（42702）。凡是 `SET x = x + 1`
   都要寫成 `SET x = 資料表名.x + 1`。
3. **Google Maps 的 key 不能設 HTTP referrer 限制**——呼叫是從 Supabase 的伺服器
   發出去的，不是瀏覽器，設了會全部被擋。安全靠的是 key 從不進前端。
4. **Places API 的欄位分三級計費**：`rating`／`regularOpeningHours`／
   `internationalPhoneNumber`／`websiteUri` 會把整個請求推到 Enterprise SKU
   （每月只有 1,000 次免費）。個人用綽綽有餘，但別在迴圈裡打。
5. **`check.mjs` 一開始自己有 bug**：不認得正規表達式字面值，把 `/[&<>"']/g` 裡的
   引號當成字串開頭。已修（加了 `strip()`）。
6. **Browser pane 的 `computer` 點擊在面板被隱藏時會 timeout**，
   驗證互動時改用 `javascript_tool` 直接呼叫。
7. **`writing-mode:vertical-rl` 配 `flex-direction:column`** 才會讓子元素變成
   並排的兩欄（Day 1 一欄、日期一欄）；用 `row` 會變成同一欄接續排下去。
