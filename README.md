# 日本旅遊記帳 — 專案說明 / 交接

## 這是什麼
給日本旅遊用的單頁記帳網頁（單一 HTML、純前端、可離線）。
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
8. 單筆 複製 / 編輯 / 刪除（橫排小圖示鈕 📋 ✏️ 🗑️，每列高度精簡；複製 = 帶入表單改完存成新記錄）
9. 資料備份：匯出/匯入 JSON、匯出 CSV、清除全部
10. RWD 手機版面 + PWA meta（可加入主畫面）

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

## 下一步（新 session 接手）
- 目標：把本頁「上架成網址」給 Android 手機用（使用者已選定）。
- 不要用 Vercel MCP 的 deploy_to_vercel（它部署「目前工作目錄」，會誤部署到當前專案）。要建「獨立」部署：
  - 方案A：本資料夾用 vercel CLI 單獨部署（本機目前未安裝 vercel CLI，需先安裝/登入）。
  - 方案B：GitHub Pages（gh CLI 已登入 guuzenshop）→ 新建獨立 public repo（非 MathCrusher）→ 推送 → 開啟 Pages。
  - 注意：全域有 pre-push hook 會擋 push 到 main，新 repo 推送前需先處理授權旗標。
- 上架完成後給使用者 Android「加入主畫面」步驟（Chrome → 右上選單 → 加到主畫面）。

## 工作區
新 session 請以「F:\— AI\Claude code\日本旅遊記帳」為工作目錄，勿與 MathCrusher 混用。

建立日期：2026-06-14
