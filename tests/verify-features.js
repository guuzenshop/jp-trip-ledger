/* 2026-07-20 兩個新功能的 jsdom E2E（走真實 UI 路徑，不是只測純函式）：
   F 系列 = 🏷️ 拆分組大標題（gtitle）：輸入→送出→顯示→整組編輯→退化→單筆編輯→CSV→匯入
   A 系列 = 📊 完整分析六維自由篩選：更多篩選展開／晶片切換／跨維度 AND／總額與鑽取同步／換帳本清空 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const APP = process.argv[2];
const html = fs.readFileSync(APP, 'utf8');

let pass = 0, fail = 0; const fails = [];
const ok = (c, n) => { if (c) pass++; else { fail++; fails.push(n); } };
const eq = (a, b, n) => ok(a === b, `${n} [got=${JSON.stringify(a)} want=${JSON.stringify(b)}]`);
function scenario(name, fn) {
  try { fn(); } catch (e) { fail++; fails.push(name + ' THREW: ' + (e && e.message)); console.log('!! ' + name + ': ' + (e && e.stack || e)); }
}

// 兩個帳戶不同幣別、三個大項 → 足以驗證「幣別 × 支付 × 大項」的交集
const seed = {
  ledgerName: '功能驗證', rate: 5, rateSource: '手動設定', rateUpdatedAt: null,
  accounts: [
    { id: 'icoca', name: 'icoca', currency: 'JPY', kind: 'prepaid', initial: 20000, color: '#34d399' },
    { id: 'paypay', name: 'paypay', currency: 'JPY', kind: 'prepaid', initial: 20000, color: '#60a5fa' },
    { id: 'twd', name: '台幣現金', currency: 'TWD', kind: 'prepaid', initial: 5000, color: '#f59e0b' }
  ],
  categories: { '飲食': ['拉麵', '咖啡'], '交通': ['電鐵'], '購物': ['衣服'] },
  txns: [
    { id: 'e1', type: 'expense', date: '2026-07-17', account: 'icoca', amount: 1000, cat: '飲食', subcat: '拉麵', item: '拉麵' },
    { id: 'e2', type: 'expense', date: '2026-07-17', account: 'paypay', amount: 500, cat: '飲食', subcat: '咖啡', item: '咖啡' },
    { id: 'e3', type: 'expense', date: '2026-07-18', account: 'twd', amount: 300, cat: '飲食', subcat: '咖啡', item: '台灣咖啡' },
    { id: 'e4', type: 'expense', date: '2026-07-17', account: 'icoca', amount: 200, cat: '交通', subcat: '電鐵', item: '近鐵' },
    { id: 'e5', type: 'expense', date: '2026-07-18', account: 'paypay', amount: 2000, cat: '購物', subcat: '衣服', item: '外套' }
  ],
  members: [], splits: [], schemaVersion: 2
};

function boot(storage) {
  const vc = new VirtualConsole();
  const logs = [];
  vc.on('log', (...a) => logs.push(a.join(' ')));
  vc.on('error', (...a) => logs.push('ERR ' + a.join(' ')));
  vc.on('jsdomError', e => logs.push('JSDOMERR ' + (e && e.message)));
  const dom = new JSDOM(html, {
    url: 'https://guuzenshop.github.io/jp-trip-ledger/?test=1',
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      for (const k of Object.keys(storage || {})) { try { w.localStorage.setItem(k, storage[k]); } catch (e) {} }
      w.alert = () => {}; w.confirm = () => true; w.prompt = () => null; w.scrollTo = () => {};
    }
  });
  return { w: dom.window, logs };
}
const bootSeed = () => boot({ jp_trip_ledger_v2: JSON.stringify(seed) });
const noErr = (logs, n) => ok(logs.filter(l => l.startsWith('ERR') || l.startsWith('JSDOMERR')).length === 0,
  n + ' 無執行期錯誤: ' + logs.filter(l => l.startsWith('ERR') || l.startsWith('JSDOMERR')).slice(0, 2).join(' | '));

// 走真實表單路徑新增一組拆分（含大標題）
const SUBMIT_SPLIT = (title, rows, account, date) => `
  document.getElementById('f-split-on').checked = true; onSplitToggle();
  document.getElementById('f-split-title').value = ${JSON.stringify(title)}; onSplitTitleInput();
  splitRows = ${JSON.stringify(rows)};
  renderSplitRows(); updateSplitSum();
  document.getElementById('f-date').value = ${JSON.stringify(date || '2026-07-19')};
  document.getElementById('f-account').value = ${JSON.stringify(account || 'icoca')};
  document.getElementById('f-note').value = '';
  submitForm(null);
`;
const TWO_ROWS = [{ cat: '購物', subcat: '衣服', item: '衣服', amount: '1000' },
                  { cat: '購物', subcat: '衣服', item: '褲子', amount: '2000' }];

/* F1: 送出拆分 → 整組每一筆都掛同一個 gtitle（含修剪），item 保持原值 */
scenario('F1', () => {
  const { w, logs } = bootSeed();
  w.eval(SUBMIT_SPLIT('  UNIQLO  ', TWO_ROWS));
  const g = w.eval("JSON.stringify(data.txns.filter(t=>t.gtitle).map(t=>[t.item,t.gtitle,!!t.gid]))");
  eq(g, JSON.stringify([['衣服', 'UNIQLO', true], ['褲子', 'UNIQLO', true]]), 'F1 兩筆都掛 UNIQLO，item 仍是原值');
  eq(w.eval("(new Set(data.txns.filter(t=>t.gid).map(t=>t.gid))).size"), 1, 'F1 同一個 gid');
  eq(w.eval("itemText(data.txns.find(t=>t.item==='衣服'))"), 'UNIQLO：衣服', 'F1 顯示層加前綴');
  eq(w.eval("data.txns.find(t=>t.item==='衣服').item"), '衣服', 'F1 item 沒有被烤進前綴');
  eq(w.eval("document.getElementById('f-split-title').value"), '', 'F1 送出後大標題欄清空（不繼承到下一筆）');
  noErr(logs, 'F1');
  w.close();
});

/* F2: 沒填大標題 → 完全不長出 gtitle 欄位（零回歸：舊行為原樣） */
scenario('F2', () => {
  const { w, logs } = bootSeed();
  w.eval(SUBMIT_SPLIT('', TWO_ROWS));
  eq(w.eval("data.txns.some(t=>'gtitle' in t)"), false, 'F2 未填標題→不寫入 gtitle 欄位');
  eq(w.eval("itemText(data.txns.find(t=>t.item==='衣服'))"), '衣服', 'F2 顯示層不加前綴');
  eq(w.eval("data.txns.filter(t=>t.gid).length"), 2, 'F2 拆分本身照常成組');
  noErr(logs, 'F2');
  w.close();
});

/* F3: 只有一列有效 → 退化成單筆，gid 與 gtitle 都不落地 */
scenario('F3', () => {
  const { w, logs } = bootSeed();
  w.eval(SUBMIT_SPLIT('UNIQLO', [{ cat: '購物', subcat: '', item: '衣服', amount: '1000' }]));
  eq(w.eval("data.txns.some(t=>'gtitle' in t)"), false, 'F3 退化成單筆→不寫大標題');
  eq(w.eval("data.txns.some(t=>'gid' in t)"), false, 'F3 退化成單筆→不成組');
  eq(w.eval("data.txns.filter(t=>t.item==='衣服').length"), 1, 'F3 該筆仍正常寫入');
  noErr(logs, 'F3');
  w.close();
});

/* F4: 外加稅的稅費列也掛同一個大標題（稅是這筆總帳的一部分） */
scenario('F4', () => {
  const { w, logs } = bootSeed();
  w.eval(`splitTax = { mode:'add', rate:10 };` + SUBMIT_SPLIT('UNIQLO', TWO_ROWS));
  const titled = w.eval("data.txns.filter(t=>t.gtitle==='UNIQLO').length");
  eq(titled, 3, 'F4 兩個品項 + 一筆稅費列都掛大標題');
  ok(w.eval("data.txns.some(t=>t.gtitle==='UNIQLO' && /消費稅/.test(t.item))"), 'F4 稅費列確實在組內且有標題');
  noErr(logs, 'F4');
  w.close();
});

/* F5: 整組編輯 → 載入現有標題、改標題整組同步、清空標題整組剝除 */
scenario('F5', () => {
  const { w, logs } = bootSeed();
  w.eval(SUBMIT_SPLIT('UNIQLO', TWO_ROWS));
  const gid = w.eval("data.txns.find(t=>t.gtitle).gid");
  w.eval(`openGroupEdit('${gid}')`);
  eq(w.eval("document.getElementById('f-split-title').value"), 'UNIQLO', 'F5 整組編輯載入既有大標題');
  w.eval("document.getElementById('f-split-title').value='無印良品'; submitForm(null);");
  eq(w.eval("JSON.stringify([...new Set(data.txns.filter(t=>t.gid).map(t=>t.gtitle))])"), JSON.stringify(['無印良品']), 'F5 改標題→整組一致');
  eq(w.eval("document.getElementById('f-split-title').value"), '', 'F5 存檔後表單標題欄清空');
  // 再開一次，清空標題
  const gid2 = w.eval("data.txns.find(t=>t.gtitle).gid");
  w.eval(`openGroupEdit('${gid2}'); document.getElementById('f-split-title').value='   '; submitForm(null);`);
  eq(w.eval("data.txns.some(t=>'gtitle' in t)"), false, 'F5 清空標題→整組剝除（{...t} 殘留已堵）');
  noErr(logs, 'F5');
  w.close();
});

/* F6: 整組編輯刪到剩一列 → 組解散，存活筆的 gid/gtitle 一起消失 */
scenario('F6', () => {
  const { w, logs } = bootSeed();
  w.eval(SUBMIT_SPLIT('UNIQLO', TWO_ROWS));
  const gid = w.eval("data.txns.find(t=>t.gtitle).gid");
  w.eval(`openGroupEdit('${gid}'); splitRows = splitRows.slice(0,1); submitForm(null);`);
  eq(w.eval("data.txns.some(t=>'gid' in t)"), false, 'F6 剩一列→組解散');
  eq(w.eval("data.txns.some(t=>'gtitle' in t)"), false, 'F6 組解散→大標題一併剝除（不留孤兒）');
  noErr(logs, 'F6');
  w.close();
});

/* F7: 組員單筆編輯（整筆替換）後不能掉標題 —— preserveGid 的實戰路徑 */
scenario('F7', () => {
  const { w, logs } = bootSeed();
  w.eval(SUBMIT_SPLIT('UNIQLO', TWO_ROWS));
  const id = w.eval("data.txns.find(t=>t.item==='衣服').id");
  w.eval(`startEdit('${id}');
    document.getElementById('f-item').value='襯衫';
    document.getElementById('f-amount').value='1500';
    submitForm(null);`);
  const t = w.eval(`JSON.stringify((()=>{const x=data.txns.find(t=>t.id==='${id}');return [x.item,x.amount,x.gtitle,!!x.gid];})())`);
  eq(t, JSON.stringify(['襯衫', 1500, 'UNIQLO', true]), 'F7 單筆編輯後仍保留 gid 與大標題');
  eq(w.eval("[...new Set(data.txns.filter(t=>t.gid).map(t=>t.gtitle))].length"), 1, 'F7 組內標題仍然一致');
  noErr(logs, 'F7');
  w.close();
});

/* F8: 事後拆分（單筆升級成組）→ 可補大標題，原筆 id 保留 */
scenario('F8', () => {
  const { w, logs } = bootSeed();
  w.eval(`startSplitExisting('e5');`);
  eq(w.eval("document.getElementById('f-split-title').value"), '', 'F8 事後拆分的標題欄從空白開始');
  w.eval(`document.getElementById('f-split-title').value='UNIQLO';
    splitRows[1] = { cat:'購物', subcat:'', item:'褲子', amount:'500' };
    submitForm(null);`);
  eq(w.eval("data.txns.filter(t=>t.gtitle==='UNIQLO').length"), 2, 'F8 升級後兩筆都有大標題');
  eq(w.eval("data.txns.find(t=>t.id==='e5').gtitle"), 'UNIQLO', 'F8 原筆保留 id 並取得大標題');
  noErr(logs, 'F8');
  w.close();
});

/* F9: 顯示層全覆蓋 —— 主明細／鑽取／總結卡／組頭 都看得到前綴 */
scenario('F9', () => {
  const { w, logs } = bootSeed();
  w.eval(SUBMIT_SPLIT('UNIQLO', TWO_ROWS));
  const gid9 = w.eval("data.txns.find(t=>t.gtitle).gid");
  w.eval('render();');
  // 拆分組預設收合 → 此時使用者看到的就是組頭那一行，大標題必須在
  ok(/UNIQLO/.test(w.eval("document.getElementById('txn-list').innerHTML.match(/gid-head[\\s\\S]{0,400}/)[0]")), 'F9 收合狀態下組頭顯示大標題');
  ok(!/UNIQLO：衣服/.test(w.eval("document.getElementById('txn-list').innerHTML")), 'F9 收合時組員不在 DOM（沿用既有行為）');
  w.eval(`toggleGidExpanded('${gid9}'); render();`);
  ok(/UNIQLO：衣服/.test(w.eval("document.getElementById('txn-list').innerHTML")), 'F9 展開後主明細顯示前綴');
  w.eval("openAnalysisPanel(); renderDrilldown('cat','購物');");
  ok(/UNIQLO：衣服/.test(w.eval("document.getElementById('analysis-body').innerHTML")), 'F9 鑽取明細顯示前綴');
  w.eval("closeAnalysis(); openSummary(); toggleSummarySection('items'); renderSummary();");
  ok(/UNIQLO：衣服/.test(w.eval("document.getElementById('summary-card').innerHTML")), 'F9 旅程總結卡顯示前綴');
  noErr(logs, 'F9');
  w.close();
});

/* F10: 匯出 CSV 有獨立「大標題」欄，且品項欄仍是乾淨原值 */
scenario('F10', () => {
  const { w, logs } = bootSeed();
  w.eval(SUBMIT_SPLIT('UNIQLO', TWO_ROWS));
  let csv = '';
  w.eval("window.__csv=null; const _d=download; download=(n,c)=>{window.__csv=c;}; exportCSV(); download=_d;");
  csv = w.eval('window.__csv') || '';
  ok(/"大標題"/.test(csv), 'F10 CSV 有大標題欄位');
  ok(/"衣服",[^\n]*"UNIQLO"/.test(csv), 'F10 該列品項為原值、大標題獨立成欄');
  ok(!/"UNIQLO：衣服"/.test(csv), 'F10 品項欄沒有被烤進前綴');
  const cols = csv.split('\n').map(l => (l.match(/","/g) || []).length);
  eq(new Set(cols).size, 1, 'F10 每列欄數一致（儲值列也補了大標題空欄）');
  noErr(logs, 'F10');
  w.close();
});

/* F11: 竄改的備份還原（load 路徑，非匯入）→ 顯示層仍安全、孤兒標題不顯示 */
scenario('F11', () => {
  const evil = JSON.parse(JSON.stringify(seed));
  evil.txns.push({ id: 'x1', type: 'expense', date: '2026-07-17', account: 'icoca', amount: 1, cat: '飲食', item: 'x', gtitle: '<img src=x onerror=alert(1)>' });
  evil.txns.push({ id: 'x2', type: 'expense', date: '2026-07-17', account: 'icoca', amount: 1, cat: '飲食', item: 'y', gid: 'gz', gtitle: { evil: 1 } });
  const { w, logs } = boot({ jp_trip_ledger_v2: JSON.stringify(evil) });
  eq(w.eval("itemText(data.txns.find(t=>t.id==='x1'))"), 'x', 'F11 沒有 gid 的孤兒標題不顯示');
  eq(w.eval("itemText(data.txns.find(t=>t.id==='x2'))"), 'y', 'F11 非字串標題不顯示（normGTitle 擋下）');
  ok(!/onerror=alert/.test(w.eval("document.getElementById('txn-list').innerHTML")), 'F11 惡意標題不會進 DOM');
  noErr(logs, 'F11');
  w.close();
});

/* A1: 更多篩選預設收合，展開狀態記進 localStorage */
scenario('A1', () => {
  const { w, logs } = bootSeed();
  w.eval('openAnalysisPanel();');
  eq(w.eval("isMoreFilterOpen()"), false, 'A1 預設收合');
  ok(/更多篩選/.test(w.eval("document.getElementById('analysis-filter').innerHTML")), 'A1 展開鈕存在');
  ok(!/af-label">大項/.test(w.eval("document.getElementById('analysis-filter').innerHTML")), 'A1 收合時不渲染四維晶片');
  w.eval('toggleMoreFilter();');
  eq(w.localStorage.getItem('jp_analysis_morefilter'), '1', 'A1 展開狀態寫入 localStorage');
  const h = w.eval("document.getElementById('analysis-filter').innerHTML");
  ok(/大項/.test(h) && /小項/.test(h) && /支付/.test(h) && /幣別/.test(h), 'A1 展開後四個維度都在');
  noErr(logs, 'A1');
  w.close();
});

/* A2: 使用者需求① —— 日幣 + icoca 的「飲食」大項 */
scenario('A2', () => {
  const { w, logs } = bootSeed();
  w.eval("openAnalysisPanel(); analysisFilter.currencies=['JPY']; analysisFilter.accounts=['icoca']; analysisFilter.cats=['飲食']; refreshAnalysis();");
  eq(w.eval('analysisScope().length'), 1, 'A2 三維交集只剩拉麵那筆');
  eq(w.eval('Math.round(computeTotals(analysisScope()).totalTWD)'), 200, 'A2 總額＝1000 日幣 ÷ 5 ＝ NT$200');
  ok(/NT\$200/.test(w.eval("document.getElementById('analysis-total').innerHTML")), 'A2 面板總額同步');
  noErr(logs, 'A2');
  w.close();
});

/* A3: 使用者需求② —— 飲食大項中用 paypay 付款的金額 */
scenario('A3', () => {
  const { w, logs } = bootSeed();
  w.eval("openAnalysisPanel(); analysisFilter.cats=['飲食']; analysisFilter.accounts=['paypay']; refreshAnalysis();");
  eq(w.eval('analysisScope().length'), 1, 'A3 飲食＋paypay→1 筆');
  eq(w.eval('Math.round(computeTotals(analysisScope()).totalTWD)'), 100, 'A3 總額＝500 日幣 ÷ 5 ＝ NT$100');
  // 同維度多選＝OR
  w.eval("analysisFilter.accounts=['paypay','icoca']; refreshAnalysis();");
  eq(w.eval('analysisScope().length'), 2, 'A3 支付多選＝OR（飲食的 icoca + paypay）');
  noErr(logs, 'A3');
  w.close();
});

/* A4: 晶片點擊真的能切換（走 toggleAnalysisPick，含 NUL 複合鍵與白名單） */
scenario('A4', () => {
  const { w, logs } = bootSeed();
  w.eval('openAnalysisPanel(); toggleMoreFilter();');
  w.eval("toggleAnalysisPick('cats', encodeURIComponent('飲食'));");
  eq(w.eval("JSON.stringify(analysisFilter.cats)"), JSON.stringify(['飲食']), 'A4 點大項晶片→加入');
  w.eval("toggleAnalysisPick('cats', encodeURIComponent('飲食'));");
  eq(w.eval("analysisFilter.cats.length"), 0, 'A4 再點一次→移除');
  const subKey = w.eval("encodeURIComponent(subKeyOf({cat:'飲食',subcat:'咖啡'}))");
  w.eval(`toggleAnalysisPick('subs', '${subKey}');`);
  eq(w.eval('analysisScope().length'), 2, 'A4 小項複合鍵（含 NUL 分隔符）經 encode/decode 仍正確');
  w.eval("toggleAnalysisPick('__proto__', encodeURIComponent('x')); toggleAnalysisPick('weekdays', encodeURIComponent('5'));");
  eq(w.eval("JSON.stringify(analysisFilter.weekdays)"), '[]', 'A4 白名單擋下非四維的 dim 參數');
  noErr(logs, 'A4');
  w.close();
});

/* A5: 篩選同步到圖表與鑽取；清除篩選一鍵全清 */
scenario('A5', () => {
  const { w, logs } = bootSeed();
  w.eval("openAnalysisPanel(); analysisFilter.accounts=['icoca']; refreshAnalysis();");
  eq(w.eval("JSON.stringify(chartRows('cat', analysisScope()).map(r=>r.key))"), JSON.stringify(['飲食', '交通']), 'A5 圖表列只剩 icoca 的大項');
  w.eval("renderDrilldown('cat','飲食');");
  ok(/拉麵/.test(w.eval("document.getElementById('analysis-body').innerHTML")), 'A5 鑽取套用篩選後仍有拉麵');
  ok(!/台灣咖啡/.test(w.eval("document.getElementById('analysis-body').innerHTML")), 'A5 鑽取排除了非 icoca 的飲食');
  w.eval("analysisFilter.cats=['飲食']; analysisFilter.weekdays=[5]; clearAnalysisFilter();");
  eq(w.eval('ANALYSIS_DIMS.every(k=>analysisFilter[k].length===0)'), true, 'A5 清除篩選→六維全清');
  eq(w.eval('analysisScope().length'), 5, 'A5 清除後回到全部 5 筆');
  noErr(logs, 'A5');
  w.close();
});

/* A6: 摘要列列出所有生效維度；分類名有引號也不破版（escapeHtml） */
scenario('A6', () => {
  const s2 = JSON.parse(JSON.stringify(seed));
  s2.categories['"><b>x'] = [];
  s2.txns.push({ id: 'q1', type: 'expense', date: '2026-07-17', account: 'icoca', amount: 10, cat: '"><b>x', item: 'q' });
  const { w, logs } = boot({ jp_trip_ledger_v2: JSON.stringify(s2) });
  w.eval("openAnalysisPanel(); toggleMoreFilter(); analysisFilter.cats=['\"><b>x']; analysisFilter.currencies=['JPY']; refreshAnalysis();");
  const h = w.eval("document.getElementById('analysis-filter').innerHTML");
  ok(/篩選中/.test(h) && /幣別：日圓/.test(h), 'A6 摘要列出大項與幣別');
  ok(!/<b>x/.test(h), 'A6 惡意分類名被逸出（沒有真的變成標籤）');
  eq(w.eval('analysisScope().length'), 1, 'A6 帶引號的分類名仍能正確篩選');
  noErr(logs, 'A6');
  w.close();
});

/* A7: 幣別維度只有一種幣別時不顯示（避免無意義的單選列） */
scenario('A7', () => {
  const s3 = JSON.parse(JSON.stringify(seed));
  s3.txns = s3.txns.filter(t => t.account !== 'twd');
  const { w, logs } = boot({ jp_trip_ledger_v2: JSON.stringify(s3) });
  w.eval('openAnalysisPanel(); toggleMoreFilter();');
  const h = w.eval("document.getElementById('analysis-filter').innerHTML");
  ok(!/af-label">幣別/.test(h), 'A7 只有日幣消費→不顯示幣別列');
  ok(/af-label">大項/.test(h), 'A7 其餘維度照常顯示');
  noErr(logs, 'A7');
  w.close();
});

/* A8: 內建自測在本 fixture 下仍全綠 */
scenario('A8', () => {
  const { w, logs } = bootSeed();
  const st = logs.find(l => l.indexOf('PASS') >= 0) || '';
  ok(/FAIL 0$/.test(st.trim()), 'A8 內建自測全綠: ' + st);
  w.close();
});

// 總案數不變式（防「前置條件抽取失敗就靜默 return」導致案數縮水卻全綠）
const executedTotal = pass + fail;
if (executedTotal !== 80) {
  fail++; fails.push(`案數不完整（防靜默掉案）：實際執行 ${executedTotal} 案，預期 80 案`);
}
console.log('FEATURES-E2E: PASS ' + pass + ' / FAIL ' + fail);
if (fail) { fails.forEach(f => console.log(' - ' + f)); }
process.exit(fail ? 1 : 0);
