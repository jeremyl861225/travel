# 申請 Google Maps API key（一次做完，之後不用再碰）

Travel 沒有 key 也能用——只是「貼上 Google 地圖網址自動帶出名稱、地址、營業時間」
和「自動算路程」這兩件事會停擺，改成手動填。要開這兩件事就得申請。

**key 不會進到手機裡。** 它存在 Supabase 的 Edge Function secret，
App 打的是我們自己的 `gmap` 函式，函式在伺服器端才帶著 key 去問 Google。
所以就算有人把網頁原始碼整份存下來，也拿不到你的 key。

---

## 一、要花錢嗎

有免費額度，而且個人排行程遠遠用不完。2025 年 3 月起 Google 改成「每個 SKU
每月給一批免費次數」，用超過才計費：

| 這支 app 會用到的 | 免費／月 | 超過之後 |
|---|---|---|
| Place Details Enterprise（抓名稱＋地址＋電話＋營業時間＋評分） | 1,000 次 | US$20 / 1,000 次 |
| Text Search Enterprise（只打名字搜尋時走這條） | 1,000 次 | US$35 / 1,000 次 |
| Compute Routes Essentials（算路程） | 10,000 次 | US$5 / 1,000 次 |

實際用量：**每加一個景點 = 1 次 Places**（抓過就存起來，不會重複抓）；
**每一段路程 = 1 次 Routes**（順序沒動就不重算）。
一趟十天的行程大概 60 個景點、60 段路程，離免費額度還很遠。

**但是要綁信用卡。** Google 一定要有帳單帳戶才給 key。所以務必照第四步設上限。

---

## 二、建立專案與金鑰

1. 開 <https://console.cloud.google.com/> ，用你的 Google 帳號登入。
2. 左上角專案選單 →「新增專案」，名稱打 `travel`，建立。
3. 確認右上角已經切到 `travel` 這個專案。
4. 搜尋列打「Billing」→ 進入帳單 → 連結一個帳單帳戶（要填信用卡）。
5. 搜尋列打「Google Maps Platform」→ 進入 →「Keys & Credentials」
   →「Create credentials」→「API key」。
6. 複製出現的那串 `AIza…`，**先貼在記事本，等一下要用**。

---

## 三、只開需要的 API

在 Google Maps Platform →「APIs」清單裡，把這兩個按「Enable」：

- **Places API (New)** ← 注意要選有 (New) 的那個，舊版的欄位對不上
- **Routes API**

其他一律不要開。開越少，被亂用的面越小。

---

## 四、設上限（這一步不能跳過）

金鑰外流會被拿去刷，所以先把天花板壓低：

1. **限制金鑰用途**：Keys & Credentials → 點你剛建的 key →
   「API restrictions」選「Restrict key」→ 只勾 Places API (New) 與 Routes API → 儲存。
   - 「Application restrictions」保持 **None**。因為呼叫是從 Supabase 的伺服器發出去的，
     不是從瀏覽器，設 HTTP referrer 反而會全部被擋掉。key 的安全靠的是它從不進前端。
2. **設每日配額**：Google Maps Platform →「Quotas」→ 各挑一個 API →
   把「Requests per day」改成你能接受的數字（建議 200）。超過就停，不會繼續計費。
3. **設預算警報**：Billing →「Budgets & alerts」→ Create budget →
   金額填 US$1 → 勾 50% / 90% / 100% 都寄信給你。
   這不會自動停用，但會在第一塊錢就通知你。

---

## 五、把 key 交給 Supabase

1. 開 <https://supabase.com/dashboard/project/dawcpdgonxmhojwonkut/settings/functions>
2. 找到「Edge Function Secrets」→ Add new secret
3. Name 打 `GOOGLE_MAPS_API_KEY`，Value 貼剛剛那串 `AIza…` → Save
4. 存完就生效，App 不用重新部署，也不用重灌。

---

## 六、驗收

1. 在 iPhone 的 Google 地圖 App 找一個景點 → 分享 → 複製連結
   （會是 `https://maps.app.goo.gl/…` 這種短網址）
2. 回 Travel →「＋ 新增」→ 貼上 → 抓取並新增
3. 卡片應該長出名稱、地址、電話、評分與一週營業時間

沒設好會看到的訊息與意思：

| 畫面訊息 | 意思 | 怎麼修 |
|---|---|---|
| 還沒設定 Google API key | Supabase 那邊的 secret 沒存到 | 回第五步 |
| Google 找不到這個地點 | 網址解析出的名稱查不到 | 改用景點全名搜尋，或手動建卡 |
| 抓取失敗：HTTP_403 | API 沒開，或金鑰限制擋掉了 | 回第三、四步 |
| 抓取失敗：HTTP_429 | 撞到你自己設的每日配額 | 明天再試，或把配額調高 |

---

## 七、之後想關掉

把 Supabase 的 `GOOGLE_MAPS_API_KEY` 這個 secret 刪掉就好。
App 會自動退回手動模式，已經抓過的資料都還在，不會消失。
