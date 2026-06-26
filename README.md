# 旅行記帳（原日本旅遊記帳）— 專案說明 / 交接

## 這是什麼
給旅行用的單頁記帳網頁（單一 HTML、純前端、可離線；支援日本／海外旅行，也支援台灣國內旅行——可在設定隱藏匯率欄位）。
與 1-6-math-practice-web-app（MathCrusher）完全無關，為獨立專案。

## 檔案
- index.html — 主程式（HTML+CSS+JS 全內含，約 44 KB）。雙擊即可用，也可上架成網址。

## 已完成功能
1. 多支付方式記帳：台幣現金 / 日幣現金 / ICOCA / PayPay / 信用卡（設定中可自由增減帳戶）
2. 帳戶間儲值/轉帳：日幣現金→ICOCA 等；跨幣別（台幣→日幣）自動換算且可手動修正；轉帳不計入消費
3. 每帳戶顯示「額度 / 已花 / 餘額」；信用卡顯示「累計已刷」
4. 消費分類：大項→小項→品項（分類可在設定編輯）
5. 明細依日期分組、每日小計；總消費（台幣換算）
6. 消費分析圓餅圖：分類佔比 / 支付方式佔比（純 SVG、零外掛）；可按「🔗 新分頁」另開分頁看完整分析快照
6b. 明細日期篩選列：可左右滑動／拖曳的日期膠囊（全部＋各日期，附當日筆數），點選只看單日
6c. 明細排序膠囊列（可左右滑動／點選，取代下拉）：📅最新優先／📅最舊優先（依日期分組，同日內依新增先後）、💰金額高→低／💰金額低→高（平鋪、跨日以台幣換算值比較，每筆顯示日期）、✋自訂順序（平鋪、每筆左側 ▲上移／⠿拖曳／▼下移 三擇一排序，順序存入 data.txns 並存檔；篩選狀態下只重排顯示中的項目，隱藏項位置保留）
7. 即時匯率：「更新最新匯率」抓台灣銀行現金賣出；備援用 er-api 中價；皆有 try-catch + timeout
8. 單筆 複製 / 編輯 / 刪除（桌機橫排小圖示鈕 📋 ✏️ 🗑️；手機版收合成一顆「⋯」點開選單，避免擠掉品名；複製 = 帶入表單改完存成新記錄）
9. 資料備份：匯出/匯入 JSON、匯出 CSV、清除全部
10. RWD 手機版面 + PWA meta（可加入主畫面）
11. 畫面收合：總消費下方的「各帳戶餘額」卡片區與「消費分析」圖表，皆可點標題列一鍵收合／展開；**預設收合**，初次進入畫面只留總消費摘要（圖2）；收合狀態各自記憶於 localStorage（jp_acct_collapsed / jp_chart_collapsed），下次造訪維持選擇
12. 台灣模式（隱藏匯率）：設定可勾選「隱藏匯率欄位（在台灣旅行用不到）」，隱藏匯率列／設定匯率欄／新增換算預覽／各筆與帳戶的「≒NT$」台幣換算／換算明細與標籤（「總消費（台幣換算）」→「總消費」）；適合純台幣的國內旅行，預設關閉、隨時可逆（localStorage：jp_hide_rate）。註：「不計入消費」等狀態行不受影響

## 技術決策
- 純單一 HTML，資料存瀏覽器 localStorage（key：jp_trip_ledger_v2，會嘗試讀舊版 v1）
- 資料模型：accounts[] + categories{} + txns[]（type = expense / topup）
- 匯率抓取：台銀 CSV 經 CORS proxy（api.allorigins.win/raw?url=...rate.bot.com.tw/xrt/flcsv/0/day），
  JPY 行第 12 欄(0-indexed)=現金賣出(台幣/日圓)；rate = 1 / 現金賣出（= 1 元台幣可換多少日圓）。
  備援：open.er-api.com/v6/latest/TWD 的 rates.JPY。
- 已用 node 驗證：JS 語法、帳戶計算、台銀解析皆通過。

## 資料注意（重要）
- localStorage 綁定「開啟此檔的網址/路徑」。換路徑、換裝置、換網域，資料不會自動跟著走。
- 若桌面舊檔曾輸入真實資料：先開桌面舊檔 → 設定 → 匯出備份 → 在新檔匯入。
- 桌面舊檔（C:\Users\COSH\Desktop\日本旅遊記帳.html）目前保留，確認移轉後可自行刪除。

## 現況（已上線）
- 已部署 GitHub Pages：https://guuzenshop.github.io/jp-trip-ledger/ （repo: guuzenshop/jp-trip-ledger，main 分支根目錄）
- Android「加入主畫面」：Chrome → 右上選單 → 加到主畫面。
- 部署方式：本資料夾 `git push origin main` → GitHub Pages 自動重建（約 1–2 分鐘）。sw.js 對 HTML 為網路優先，連線重整即更新，HTML-only 變更無需升 CACHE 版本號。
- ⚠️ 環境注意：全域有 pre-push hook 會擋 push 到 main；本機 Bash 的 rtk hook 會干擾 git 讀指令，git 操作一律改用 PowerShell。

## 待優化（backlog，非阻塞）
- a11y 鍵盤可及性：收合標題列（`.accounts-head` / `.t.toggle`）目前為 `onclick` 的 div/span，無 `tabindex`/`role="button"`/`aria-expanded`/keydown，鍵盤與螢幕報讀器無法操作。日後可連同既有 `⋯` 選單等 onclick 元件一併加 `role/tabindex/keydown` 統一優化。（2026-06-15 兩輪審查 Cowork+OpenCode 10/10 結案時列為 Low，非回歸）

## 工作區
新 session 請以「F:\— AI\Claude code\日本旅遊記帳」為工作目錄，勿與 MathCrusher 混用。

建立日期：2026-06-14
更新：2026-06-15 — 畫面收合功能（帳戶卡片＋消費分析，預設收合）上線；Cowork + OpenCode 雙審 10/10 結案
更新：2026-06-27 — App 更名「日本旅遊記帳」→「旅行記帳」（emoji 🇯🇵→✈️，技術識別字 repo/cache 前綴/localStorage key 保留不動，加舊預設名遷移）；新增台灣模式（可隱藏匯率欄位）；因含 manifest 變更，CACHE 升 jp-ledger-v10；待 Cowork + OpenCode 複審
