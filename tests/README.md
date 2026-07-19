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
| `node verify-mc.js ../index.html` | 多幣別 E2E：全新安裝／舊資料遷移／三幣別／缺匯率保護；同時印出內建 `?test=1` 的案數 | 42 PASS / 0 FAIL（內建 214/0）|
| `node verify-ledger.js ../index.html` | 多帳本 E2E：遷移／資料隔離／複製設定／暫態清空／改名封存刪除／匯入兩模式／跨 session 持久化／舊格式鏡射相容／離線舊版救援／多分頁併發／同本衝突備份與還原／暫態修剪 | 91 PASS / 0 FAIL |
| `node verify-rate.js ../index.html` | 匯率取得降級鏈（stub fetch）：台銀可用／限流改走備援／部分幣別無報價／離譜值擋下／全失敗不動資料／無追蹤幣別不發請求 | 22 PASS / 0 FAIL |
| `node compare-old-new.js <old.html> ../index.html [seed.json]` | **新舊版同資料逐欄比對**：totals／各帳戶 acctStats／chartRows(cat,sub,pay)／每筆 txnTWDValue／computeSettlement(台幣域＋日幣域)／computeTripSummary／DOM 文字 | 數字 0 差異（唯一差異為刻意文案）|
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
  `verify-bot-live.js` 更是把上線中的 `parseBotCsv` 原封抽出來餵即時資料。
- 失敗時 exit code 非 0，可直接接 CI。
- 這些腳本**不會**被 App 載入（`index.html` 完全不引用 `tests/`），純屬開發資產。
