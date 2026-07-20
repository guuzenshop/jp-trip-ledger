# 驗證腳本（可複現）

App 本體是單檔 `index.html`，**內建 `?test=1` 只涵蓋純函式**（不依賴 DOM）。
持久化（多帳本 store／v2 鏡射／多分頁調解）、匯率外部依賴、UI 行為需要 DOM，
因此另有這批 jsdom 腳本。外部審查者可用它們獨立複現本專案宣稱的每一項驗證。

## 環境

```bash
cd tests
npm install          # 只裝 jsdom（devDependency）
```

Node 20+ 即可（開發時用 24.14.0、jsdom 29.1.1）。

## 指令

| 指令 | 涵蓋 | 目前結果 |
|---|---|---|
| `node verify-mc.js ../index.html` | 多幣別 E2E：全新安裝／舊資料遷移／三幣別／缺匯率保護；同時印出內建 `?test=1` 的案數 | 42 PASS / 0 FAIL（內建 263/0）|
| `node verify-ledger.js ../index.html` | 多帳本 E2E：遷移／資料隔離／複製設定／暫態清空／改名封存刪除／匯入兩模式／跨 session 持久化／舊格式鏡射相容／離線舊版救援／多分頁併發／同本衝突備份與還原／暫態修剪 | 92 PASS / 0 FAIL |
| `node verify-features.js ../index.html` | **2026-07-20 四個新功能 E2E**：F1–F11 🏷️ 拆分組大標題（送出寫入／未填零回歸／退化剝除／稅費列同組／整組編輯改與清空／組解散／組員單筆編輯不掉標題／事後拆分／四處顯示層／CSV 獨立欄／竄改備份不進 DOM）；A1–A8 📊 六維自由篩選（收合預設與記憶／日幣+icoca+飲食／飲食+paypay／晶片切換與 dim 白名單／圖表與鑽取同步／摘要逸出／單幣別不顯示幣別列）；**D1–D9 📅 日期分組預設收合**（預設 0 筆／單日展開收合與持久化／全部展開收合／新增後該日自動展開且可正常收回／選取模式與日期篩選強制展開且不給收合鈕／金額與自訂排序不受影響／換帳本修剪／竄改 localStorage 白名單）；**K1–K6 ⌨️ 拆分鍵盤動線**（新列沿用大項小項／品項 Enter 跳金額／末列 Enter 自動加列／中間列不加列／Enter 不誤送出表單／非 Enter 不干預） | 145 PASS / 0 FAIL |
| `node verify-rate.js ../index.html` | 匯率取得降級鏈（stub fetch）：台銀可用／限流改走備援／部分幣別無報價／離譜值擋下／全失敗不動資料／無追蹤幣別不發請求 | 22 PASS / 0 FAIL |
| `node verify-regress.js ../index.html` | **歷輪外部審查確認缺陷的回歸守護**（見檔頭 R1–R13）：R1–R10 為第四輪（WIP 中斷後鏡射修復／設定快照跨帳本污染／已落盤匯率被還原／dp=2 稅金／建議入帳／載入路徑 XSS／撞號 remap／危險成員 id／fetch 逾時涵蓋 body／fmt 取整）；**R11–R13 為第五輪，守護「上一輪修復本身引入」的新洞**：Object.assign 對惡意 `__proto__` 鍵的原型污染／accounts 含 null 補成幽靈帳戶／WIP 反覆修復擠掉真實併發衝突備份；**R14–R22 為第六輪**：txn.date 未淨化→「全部展開」鈕 onclick 儲存型 XSS（R14／R15 涵蓋 load、刪除備份還原、衝突備份還原三條路徑）／txn.id 未淨化→`moveTxn` 等 5 處 onclick 注入（R16，本輪自查追加，兩位審查者皆未提）／退化組 CSV 與顯示層口徑不一致（R17）／同 gid 不同 gtitle（R18）／金額排序下新增交易該日未展開（R19）／換帳本未清大標題欄與展開集合（R20）／拆分模式 Enter 觸發隱式送出＋IME 組字被當動線指令（R21）／getExpandedGids 缺元素白名單（R22） | 95 PASS / 0 FAIL |
| `node compare-old-new.js <old.html> ../index.html [seed.json]` | **新舊版同資料逐欄比對**：totals／各帳戶 acctStats／chartRows(cat,sub,pay)／每筆 txnTWDValue／computeSettlement(台幣域＋日幣域)／computeTripSummary／DOM 文字／**匯出 CSV 全文** | 數字 0 差異（對 `1b450f9` 唯一差異為 CSV 新增「大標題」欄，形狀已機械驗證）|
| `node verify-bot-live.js ../index.html` | **抓即時台銀 CSV**，用上線中的 `parseBotCsv` 端到端驗證欄位定位 | LIVE-CSV OK |
| `node verify-live.js ../index.html . <cachebuster>` | 抓 GitHub Pages 線上檔，比對與本地 md5 是否 byte-identical、特徵字串是否齊備 | LIVE OK |

取得舊版供比對：

```bash
node -e "const{execFileSync}=require('child_process');require('fs').writeFileSync('old.html',execFileSync('git',['-C','..','show','b18f06b:index.html'],{maxBuffer:1<<28}))"
node compare-old-new.js old.html ../index.html
```

`compare-old-new.js` 可吃 `seed.json`（App「匯出備份」的檔）→ 用**你自己的真實資料**比對新舊版數字。
⚠️ 真實帳務資料請勿 commit（`.gitignore` 為白名單制，預設就不會進版控）。

## 設計說明

- 每個腳本都直接讀 `index.html` 原始碼跑，不複製函式，避免「測到的不是上線那份」。
  `verify-bot-live.js` 更是把上線中的 `parseBotCsv` 原封抽出來餵即時資料；
  `verify-regress.js` 的 R9 同樣抽出上線中的 `fetchTextWithTimeout`，打一台「送完 headers 就不送 body」的本機伺服器。
- 失敗時 exit code 非 0，可直接接 CI。
- **回歸測試要有效，必須在「修好之前」會失敗**。以下數字全部以現行已提交腳本實測，
  可自行複現：`git show <sha>:index.html > /tmp/pre.html && node verify-regress.js /tmp/pre.html`。
  ⚠️ Windows PowerShell 的 `>` 會把 LF 轉成 CRLF（檔案膨脹約一個行數的位元組），
  請改用 `cmd /c "git … > x.html"` 或 node `execFileSync` 取 Buffer 寫檔，否則基準檔不是原版。

  | 腳本 | 基準版 | 實測 | 說明 |
  |---|---|---|---|
  | `verify-regress.js`（95 案）| `8351c5e` 第六輪修復前 | **72 / 23** | 失敗**全部**落在 R14–R22（R14×3、R15×4、R16×3、R17×2、R18×1、R19×2、R20×2、R21×5、R22×1），**R1–R13 對該版仍全過** |
  | | `56f54e3` 第五輪修復前 | **66 / 29** | |
  | | `36b7b90` 第四輪修復前 | **32 / 63** | |
  | | 現版 | **95 / 0** | |
  | `verify-features.js`（145 案）| `1b450f9` F/A 兩功能之前 | **25 / 120** | |
  | | `869a073` D/K 兩功能之前 | **101 / 44** | 失敗全落 D/K，**F/A 系列 80 案零失敗** |
  | | `8351c5e` | **145 / 0** | 本輪修的項目由 `verify-regress.js` R14–R22 守護，features 不重複 |
  | `verify-ledger.js` | `1b450f9` | **84 / 2** | 精準只掛新加的兩條六維斷言 |

  ⚠️ **2026-07-20 數字校正紀錄**：更早版本的本段寫過「regress 對 `36b7b90` 24/41」與
  「features 對 `1b450f9` 4/25（28 案）」，用現行已提交腳本**複現不出來**——後者是用 `869a073`
  當時只有 80 案的腳本測的，前者則任何已提交版本都測不出。教訓：**基準數字必須在「腳本定版之後」
  重新量一次**，不能沿用開發途中的舊值。本表已全部重測。
  `verify-ledger.js` 對 `1b450f9` 精準只掛在新加的兩條六維斷言
  （`L4 清分析篩選（六維全清）` 與 `ANALYSIS_DIMS is not defined`），其餘 L1–L13 全過。
  ⚠️ **K5 的誠實標註（2026-07-20 更新）**：K5「Enter 不誤送出表單」在舊版也會通過——jsdom 不實作
  表單隱式送出，**真實瀏覽器自動化也測不到**（外部審查做過控制實驗：最陽春的標準表單在自動化
  Enter 下同樣不送出，即測試工具本身假陰性）。所以 K5 只是文件性斷言，不具區分新舊版的能力。
  **本輪已補上真正的守護**：`verify-regress.js` R21 改測「Enter keydown 是否被 `preventDefault`」
  ——那才是阻擋隱式送出的實際機制，且對修復前的 `8351c5e` 精準失敗（R21×5）。
  剩下的殘餘風險（手機數字鍵盤有無 Enter 鍵、iOS/Android/macOS 各家 IME 行為）只能實機驗，
  已列入發版前人工 checklist，不冒充成自動化守護。
- **逐案斷言數宣告（PLAN）取代總數魔數**：`verify-regress.js` 與 `verify-features.js` 檔頭各有一份
  `PLAN = { 案名: 斷言數 }`，期望總數由它自動加總。原本檔尾寫死 `!== 65` / `!== 145` 的總數魔數有兩個問題：
  加案子的人只要把總數改大就過（橡皮圖章），而且「A 案少 3 條、B 案多 3 條」會互相抵銷完全看不出來。
  改成逐案宣告後：① 新增案子必須在 PLAN 登錄，改的是有語意的一行；② 任一案斷言數與宣告不符會被
  **指名道姓**抓出來；③ 某案 throw 時，未執行的斷言會**整批**記成 fail（不是只記 1 筆），
  所以三個基準版跑出來的 `PASS + FAIL` 恆等於 95 / 145，案數再也不會靜默縮水。
  `DUMP_PLAN=1 node verify-regress.js ../index.html` 可印出實際逐案斷言數，用來機械產生／校正 PLAN
  （本表的數字就是這樣產生的，不是人工數的；舊的 65 與 145 兩個魔數也由它交叉驗證過完全吻合）。
- ⚠️ 2026-07-20 修掉 `compare-old-new.js` 的一個**同類既有缺陷**：`out.csv` 原本寫成
  `(typeof buildCSVRows === 'function') ? 'n/a' : 'n/a'`，兩個分支同值 ⇒ 這個 probe 從來沒有比對過任何東西。
  現改為真的攔截 `exportCSV()` 輸出，抓不到時明確回 `UNAVAILABLE:*`（不得假裝比對過）。
- ⚠️ 2026-07-20（第六輪）再修 `compare-old-new.js`：取樣前先對兩邊都跑 `setAllDaysExpanded(全部, true)`。
  新版明細預設收合，不對齊展開狀態的話 `dom.txnlist` 會**恆常**回報差異、這支工具永遠 exit 1，
  「哪 2 個差異是預期的」變成只能靠人腦記——真正的回歸就是這樣被淹沒的。對齊後對 `8351c5e`
  實測 `IDENTICAL - 0 differences`（11 個 probe 全同），等於機械證明本輪修復對正常資料零輸出改變。
- 這些腳本**不會**被 App 載入（`index.html` 完全不引用 `tests/`），純屬開發資產。
