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
| `node verify-mc.js ../index.html` | 多幣別 E2E：全新安裝／舊資料遷移／三幣別／缺匯率保護；同時印出內建 `?test=1` 的案數 | 42 PASS / 0 FAIL（內建 260/0）|
| `node verify-ledger.js ../index.html` | 多帳本 E2E：遷移／資料隔離／複製設定／暫態清空／改名封存刪除／匯入兩模式／跨 session 持久化／舊格式鏡射相容／離線舊版救援／多分頁併發／同本衝突備份與還原／暫態修剪 | 92 PASS / 0 FAIL |
| `node verify-features.js ../index.html` | **2026-07-20 四個新功能 E2E**：F1–F11 🏷️ 拆分組大標題（送出寫入／未填零回歸／退化剝除／稅費列同組／整組編輯改與清空／組解散／組員單筆編輯不掉標題／事後拆分／四處顯示層／CSV 獨立欄／竄改備份不進 DOM）；A1–A8 📊 六維自由篩選（收合預設與記憶／日幣+icoca+飲食／飲食+paypay／晶片切換與 dim 白名單／圖表與鑽取同步／摘要逸出／單幣別不顯示幣別列）；**D1–D9 📅 日期分組預設收合**（預設 0 筆／單日展開收合與持久化／全部展開收合／新增後該日自動展開且可正常收回／選取模式與日期篩選強制展開且不給收合鈕／金額與自訂排序不受影響／換帳本修剪／竄改 localStorage 白名單）；**K1–K6 ⌨️ 拆分鍵盤動線**（新列沿用大項小項／品項 Enter 跳金額／末列 Enter 自動加列／中間列不加列／Enter 不誤送出表單／非 Enter 不干預） | 145 PASS / 0 FAIL |
| `node verify-rate.js ../index.html` | 匯率取得降級鏈（stub fetch）：台銀可用／限流改走備援／部分幣別無報價／離譜值擋下／全失敗不動資料／無追蹤幣別不發請求 | 22 PASS / 0 FAIL |
| `node verify-regress.js ../index.html` | **歷輪外部審查確認缺陷的回歸守護**（見檔頭 R1–R13）：R1–R10 為第四輪（WIP 中斷後鏡射修復／設定快照跨帳本污染／已落盤匯率被還原／dp=2 稅金／建議入帳／載入路徑 XSS／撞號 remap／危險成員 id／fetch 逾時涵蓋 body／fmt 取整）；**R11–R13 為第五輪，守護「上一輪修復本身引入」的新洞**：Object.assign 對惡意 `__proto__` 鍵的原型污染／accounts 含 null 補成幽靈帳戶／WIP 反覆修復擠掉真實併發衝突備份 | 65 PASS / 0 FAIL |
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
- **回歸測試要有效，必須在「修好之前」會失敗**。`verify-regress.js`（65 案）對第四輪修復前的
  `36b7b90` 實測 **PASS 23 / FAIL 42**（41 條真實失敗 ＋ 1 筆案數不變式；實際執行 64 案），
  對第五輪修復前的 `56f54e3` 實測 **PASS 57 / FAIL 8**
  （8 個失敗精準對應 R11×3／R12×3／R13×2，不多不少），對現版則 65/0；
  可自行複現：`git show <sha>:index.html > /tmp/pre.html && node verify-regress.js /tmp/pre.html`。
  `verify-features.js`（145 案）的雙基準實測：
  對 `1b450f9`（F/A 兩功能之前）**PASS 25 / FAIL 50**（僅 74 案得以執行，其餘因新函式/新欄位不存在而中止；
  49 條真實失敗涵蓋 F11／A13／D14／K11 四系列 ＋ 1 筆案數不變式）；
  對 `869a073`（D/K 兩功能之前）**PASS 101 / FAIL 26**——失敗全部落在 D/K 系列
  （D14／K11 ＋ 1 筆案數不變式），**F/A 系列 80 案零失敗**，證明新功能沒有破壞上一輪的守護。
  ⚠️ **2026-07-20 數字校正**：本段前一版寫的「regress 對 `36b7b90` 24/41」與「features 對 `1b450f9`
  4/25（28 案）」兩個數字，用**現行已提交的腳本複現不出來**。根因：後者是用 `869a073` 當時
  只有 80 案的 `verify-features.js` 測的（拿舊版腳本重跑，正好得到「實際執行 28 案，預期 80 案」）；
  前者則任何已提交版本都測不出來（`verify-regress.js` 自 `1b450f9` 起未再改動），應為開發中途
  未提交的工作副本所測。上列數字已全部改為以現行已提交腳本重新實測、且三次重跑一致的值。
  （教訓：基準數字必須在「腳本定版之後」重新量一次，不能沿用開發途中的舊值。）
  同理 `verify-ledger.js` 對 `1b450f9` **精準**只掛在新加的兩條六維斷言
  （`L4 清分析篩選（六維全清）` 與 `ANALYSIS_DIMS is not defined`），其餘 L1–L13 全過。
  ⚠️ 誠實標註：K5（Enter 不誤送出表單）在舊版也會通過——jsdom 不實作表單的隱式送出，
  這條是「防未來回歸」的保險，不是能區分新舊版的行為守護。
- 案數不變式：`verify-regress.js` 檔尾 `pass + fail !== 65`、`verify-features.js` 檔尾 `!== 145` 會額外標記一筆失敗，
  防止某案「抽取/前置失敗就靜默 return」讓總案數悄悄縮水卻仍顯示全綠（這正是第五輪審查抓到的既有缺陷 R9 methodology bug）。
- ⚠️ 2026-07-20 修掉 `compare-old-new.js` 的一個**同類既有缺陷**：`out.csv` 原本寫成
  `(typeof buildCSVRows === 'function') ? 'n/a' : 'n/a'`，兩個分支同值 ⇒ 這個 probe 從來沒有比對過任何東西。
  現改為真的攔截 `exportCSV()` 輸出，抓不到時明確回 `UNAVAILABLE:*`（不得假裝比對過）。
- 這些腳本**不會**被 App 載入（`index.html` 完全不引用 `tests/`），純屬開發資產。
