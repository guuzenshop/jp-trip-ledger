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

/* 逐案斷言數宣告（取代「總數魔數 145」）——理由同 verify-regress.js：
   總數魔數只要改大就過（橡皮圖章），且「A 案少 3 條、B 案多 3 條」會互相抵銷完全看不出來。
   DUMP_PLAN=1 可印出實際逐案斷言數，用來機械產生／校正本表。 */
const PLAN = {
  F1: 6, F2: 4, F3: 4, F4: 3, F5: 5, F6: 3, F7: 3, F8: 4, F9: 6, F10: 5, F11: 4,   // 🏷️ 大標題 小計 47
  A1: 6, A2: 4, A3: 4, A4: 5, A5: 6, A6: 4, A7: 3, A8: 1,                          // 📊 六維篩選 小計 33
  D1: 7, D2: 5, D3: 4, D4: 5, D5: 5, D6: 4, D7: 5, D8: 3, D9: 4,                   // 📅 日期收合 小計 42
  K1: 4, K2: 4, K3: 5, K4: 4, K5: 4, K6: 2,                                        // ⌨️ 鍵盤動線 小計 23
};
const RAN = {};
function scenario(name, fn) {
  const want = PLAN[name];
  const p0 = pass, f0 = fail;
  let threw = null;
  try { fn(); } catch (e) { threw = e; }
  const ran = (pass - p0) + (fail - f0);
  RAN[name] = ran;
  if (want == null) { fail++; fails.push(`${name} 未登錄於 PLAN（新增案子必須同時宣告斷言數）`); return; }
  if (threw) {
    const missing = Math.max(0, want - ran);
    fail += Math.max(1, missing);   // 未執行的斷言整批記 fail，避免案數靜默縮水卻仍看似只多 1 個 FAIL
    fails.push(`${name} THREW: ${threw && threw.message}` + (missing ? `（${missing} 條未執行，已整批記 fail）` : ''));
    console.log('!! ' + name + ': ' + (threw && threw.stack || threw));
    return;
  }
  if (ran !== want) { fail++; fails.push(`${name} 斷言數 ${ran} ≠ PLAN 宣告 ${want}（PLAN 未同步，或有靜默略過路徑）`); }
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

/* ===== D 系列：📅 日期分組預設收合 ===== */

// 目前 txn-list 裡真正渲染出來的交易列數（收合的日期不會有 .txn）
const ROWCOUNT = "document.querySelectorAll('#txn-list .txn').length";
const HEADCOUNT = "document.querySelectorAll('#txn-list .day-head').length";

/* D1: 預設全收合 —— 只看得到日期列，一筆明細都不渲染 */
scenario('D1', () => {
  const { w, logs } = bootSeed();
  eq(w.eval(HEADCOUNT), 2, 'D1 兩個日期各一列組頭（07-17／07-18）');
  eq(w.eval(ROWCOUNT), 0, 'D1 預設全收合→沒有任何明細列被渲染');
  ok(/day-group collapsed|collapsed/.test(w.eval("document.getElementById('txn-list').innerHTML")), 'D1 組帶 collapsed class');
  ok(/dh-count/.test(w.eval("document.getElementById('txn-list').innerHTML")), 'D1 組頭顯示筆數');
  ok(/當日消費/.test(w.eval("document.getElementById('txn-list').innerHTML")), 'D1 組頭仍顯示當日消費合計');
  ok(/全部展開/.test(w.eval("document.getElementById('txn-list').innerHTML")), 'D1 有「全部展開」鈕');
  noErr(logs, 'D1');
  w.close();
});

/* D2: 點日期列展開／再點收合，狀態寫進 localStorage */
scenario('D2', () => {
  const { w, logs } = bootSeed();
  w.eval("toggleDayExpanded('2026-07-17');");
  eq(w.eval(ROWCOUNT), 3, 'D2 展開 07-17→該日 3 筆出現');
  eq(w.localStorage.getItem('jp_expanded_days'), '["2026-07-17"]', 'D2 展開狀態寫入 localStorage');
  w.eval("toggleDayExpanded('2026-07-17');");
  eq(w.eval(ROWCOUNT), 0, 'D2 再點一次→收回');
  eq(w.localStorage.getItem('jp_expanded_days'), '[]', 'D2 收合後從集合移除');
  noErr(logs, 'D2');
  w.close();
});

/* D3: 全部展開／全部收合 */
scenario('D3', () => {
  const { w, logs } = bootSeed();
  w.eval("setAllDaysExpanded(['2026-07-17','2026-07-18'], true);");
  eq(w.eval(ROWCOUNT), 5, 'D3 全部展開→5 筆全出現');
  ok(/全部收合/.test(w.eval("document.getElementById('txn-list').innerHTML")), 'D3 鈕文字翻成「全部收合」');
  w.eval("setAllDaysExpanded(['2026-07-17','2026-07-18'], false);");
  eq(w.eval(ROWCOUNT), 0, 'D3 全部收合→回到 0 筆');
  noErr(logs, 'D3');
  w.close();
});

/* D4: 剛新增的那筆，所在日期自動展開（而且是寫進集合，不是暫時強制） */
scenario('D4', () => {
  const { w, logs } = bootSeed();
  eq(w.eval(ROWCOUNT), 0, 'D4 前提：一開始全收合');
  w.eval(`document.getElementById('f-date').value='2026-07-19';
    document.getElementById('f-account').value='icoca';
    document.getElementById('f-amount').value='123';
    document.getElementById('f-item').value='新買的東西';
    document.getElementById('f-cat').value='飲食';
    submitForm(null);`);
  ok(/新買的東西/.test(w.eval("document.getElementById('txn-list').innerHTML")), 'D4 新增後看得到剛記的那筆');
  ok(w.eval("getExpandedDays().indexOf('2026-07-19') >= 0"), 'D4 該日寫進展開集合（非暫時強制）');
  // 關鍵：因為是寫進集合，按收合鈕才會真的收合（不會「越點越展開」）
  w.eval("toggleDayExpanded('2026-07-19');");
  ok(!/新買的東西/.test(w.eval("document.getElementById('txn-list').innerHTML")), 'D4 按收合真的收得起來（無反直覺 toggle）');
  noErr(logs, 'D4');
  w.close();
});

/* D5: 選取模式強制展開，且不給收合鈕（收合了沒東西可勾） */
scenario('D5', () => {
  const { w, logs } = bootSeed();
  w.eval('toggleSelectMode();');
  eq(w.eval(ROWCOUNT), 5, 'D5 選取模式強制全展開');
  ok(!/day-toggle/.test(w.eval("document.getElementById('txn-list').innerHTML")), 'D5 選取模式不顯示收合鈕');
  ok(!/全部展開|全部收合/.test(w.eval("document.getElementById('txn-list').innerHTML")), 'D5 選取模式不顯示全部展開列');
  w.eval('toggleSelectMode();');
  eq(w.eval(ROWCOUNT), 0, 'D5 離開選取模式→回到收合');
  noErr(logs, 'D5');
  w.close();
});

/* D6: 點某一天的日期篩選 → 那天強制展開 */
scenario('D6', () => {
  const { w, logs } = bootSeed();
  w.eval("setDateFilter('2026-07-17');");
  eq(w.eval(ROWCOUNT), 3, 'D6 日期篩選時該日強制展開');
  ok(!/day-toggle/.test(w.eval("document.getElementById('txn-list').innerHTML")), 'D6 篩選單日時不給收合鈕');
  w.eval("setDateFilter('all');");
  eq(w.eval(ROWCOUNT), 0, 'D6 取消篩選→回到收合');
  noErr(logs, 'D6');
  w.close();
});

/* D7: 金額排序／自訂順序是跨日平鋪，不受收合影響（零回歸） */
scenario('D7', () => {
  const { w, logs } = bootSeed();
  w.eval("setSort('amt_desc');");
  eq(w.eval(ROWCOUNT), 5, 'D7 金額排序仍平鋪顯示全部');
  eq(w.eval(HEADCOUNT), 0, 'D7 金額排序沒有日期組頭');
  w.eval("setSort('manual');");
  eq(w.eval(ROWCOUNT), 5, 'D7 自訂順序仍平鋪顯示全部');
  w.eval("setSort('date_desc');");
  eq(w.eval(ROWCOUNT), 0, 'D7 切回日期排序→恢復收合');
  noErr(logs, 'D7');
  w.close();
});

/* D8: 換帳本修剪 jp_expanded_days（不同帳本日期會撞，不修剪會誤展開新帳本的同日） */
scenario('D8', () => {
  const { w, logs } = boot({ jp_trip_ledger_v2: JSON.stringify(seed), jp_expanded_days: JSON.stringify(['2026-07-17', '1999-01-01']) });
  eq(w.eval(ROWCOUNT), 3, 'D8 既有展開狀態生效');
  w.eval("openLedgerModal(); toggleLedgerAdd(true); document.getElementById('lg-new-name').value='另一本'; createLedgerFromForm();");
  eq(w.localStorage.getItem('jp_expanded_days'), '[]', 'D8 換帳本→新帳本沒有這些日期，全部修剪');
  noErr(logs, 'D8');
  w.close();
});

/* D9: 竄改的 localStorage 不會炸（格式白名單） */
scenario('D9', () => {
  const { w, logs } = boot({ jp_trip_ledger_v2: JSON.stringify(seed), jp_expanded_days: '{"evil":1}' });
  eq(w.eval('JSON.stringify(getExpandedDays())'), '[]', 'D9 非陣列→回空陣列');
  const { w: w2 } = boot({ jp_trip_ledger_v2: JSON.stringify(seed), jp_expanded_days: JSON.stringify(['2026-07-17', 'not-a-date', 42, null]) });
  eq(w2.eval('JSON.stringify(getExpandedDays())'), JSON.stringify(['2026-07-17']), 'D9 非日期格式元素剝除');
  eq(w2.eval("(function(){setDayExpanded('<img src=x>', true); return getExpandedDays().length;})()"), 1, 'D9 setDayExpanded 拒絕非法日期');
  noErr(logs, 'D9');
  w.close(); w2.close();
});

/* ===== K 系列：⌨️ 拆分逐格輸入的鍵盤動線 ===== */

// 在拆分模式下按某一列某一欄的 Enter；回傳事件是否被 preventDefault
const PRESS_ENTER = (i, fld) => `(function(){
  const el = document.querySelector('#split-rows .split-row[data-i="${i}"] input[data-fld="${fld}"]');
  if (!el) return 'NO-ELEMENT';
  const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev.defaultPrevented;
})()`;
const OPEN_SPLIT = `document.getElementById('f-split-on').checked = true; onSplitToggle();`;

/* K1: ＋加一項沿用上一列的大項／小項（一張收據通常同一分類） */
scenario('K1', () => {
  const { w, logs } = bootSeed();
  w.eval(OPEN_SPLIT);
  w.eval("splitRows = [{cat:'飲食',subcat:'甜點',item:'大福',amount:'350'}]; renderSplitRows(); addSplitRow();");
  eq(w.eval("JSON.stringify(splitRows[1])"), JSON.stringify({ cat: '飲食', subcat: '甜點', item: '', amount: '' }), 'K1 新列沿用大項／小項，品項與金額留空');
  eq(w.eval("document.activeElement.getAttribute('data-fld')"), 'item', 'K1 游標落在新列的品項欄');
  eq(w.eval("document.activeElement.closest('.split-row').dataset.i"), '1', 'K1 落在「新增的那一列」而非原列');
  noErr(logs, 'K1');
  w.close();
});

/* K2: 品項 Enter → 同一列的金額欄 */
scenario('K2', () => {
  const { w, logs } = bootSeed();
  w.eval(OPEN_SPLIT);
  eq(w.eval(PRESS_ENTER(0, 'item')), true, 'K2 Enter 被 preventDefault（拆分列在 form 內，不擋會直接送出）');
  eq(w.eval("document.activeElement.getAttribute('data-fld')"), 'amount', 'K2 游標跳到金額欄');
  eq(w.eval("document.activeElement.closest('.split-row').dataset.i"), '0', 'K2 停在同一列');
  noErr(logs, 'K2');
  w.close();
});

/* K3: 最後一列的金額 Enter → 自動加一列並跳過去 */
scenario('K3', () => {
  const { w, logs } = bootSeed();
  w.eval(OPEN_SPLIT);
  w.eval("splitRows = [{cat:'飲食',subcat:'甜點',item:'大福',amount:'350'}]; renderSplitRows();");
  eq(w.eval(PRESS_ENTER(0, 'amount')), true, 'K3 Enter 被 preventDefault');
  eq(w.eval('splitRows.length'), 2, 'K3 最後一列按 Enter→自動加一列');
  eq(w.eval("splitRows[1].cat"), '飲食', 'K3 新列沿用大項');
  eq(w.eval("document.activeElement.closest('.split-row').dataset.i"), '1', 'K3 游標跳到新列');
  noErr(logs, 'K3');
  w.close();
});

/* K4: 非最後一列的金額 Enter → 跳下一列，不加列 */
scenario('K4', () => {
  const { w, logs } = bootSeed();
  w.eval(OPEN_SPLIT);
  w.eval("splitRows = [{cat:'飲食',subcat:'',item:'a',amount:'1'},{cat:'飲食',subcat:'',item:'b',amount:'2'}]; renderSplitRows();");
  w.eval(PRESS_ENTER(0, 'amount'));
  eq(w.eval('splitRows.length'), 2, 'K4 中間列按 Enter 不會多加列');
  eq(w.eval("document.activeElement.closest('.split-row').dataset.i"), '1', 'K4 游標跳到下一列');
  eq(w.eval("document.activeElement.getAttribute('data-fld')"), 'item', 'K4 落在下一列的品項欄');
  noErr(logs, 'K4');
  w.close();
});

/* K5: Enter 不會誤送出表單（拆分列在 <form> 內），也不會弄丟已輸入內容 */
scenario('K5', () => {
  const { w, logs } = bootSeed();
  const before = w.eval('data.txns.length');
  w.eval(OPEN_SPLIT);
  w.eval("splitRows = [{cat:'飲食',subcat:'',item:'a',amount:'1'}]; renderSplitRows();");
  w.eval(PRESS_ENTER(0, 'amount'));
  eq(w.eval('data.txns.length'), before, 'K5 按 Enter 沒有把表單送出去');
  eq(w.eval("splitRows[0].item"), 'a', 'K5 已輸入的品項沒被清掉');
  eq(w.eval("splitRows[0].amount"), '1', 'K5 已輸入的金額沒被清掉');
  noErr(logs, 'K5');
  w.close();
});

/* K6: 非 Enter 鍵完全不干預（不搶輸入） */
scenario('K6', () => {
  const { w, logs } = bootSeed();
  w.eval(OPEN_SPLIT);
  const r = w.eval(`(function(){
    const el = document.querySelector('#split-rows .split-row[data-i="0"] input[data-fld="item"]');
    const ev = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return [ev.defaultPrevented, splitRows.length];
  })()`);
  eq(JSON.stringify(r), JSON.stringify([false, 2]), 'K6 一般按鍵不 preventDefault、不加列');
  noErr(logs, 'K6');
  w.close();
});

/* A8: 內建自測在本 fixture 下仍全綠 */
scenario('A8', () => {
  const { w, logs } = bootSeed();
  const st = logs.find(l => l.indexOf('PASS') >= 0) || '';
  ok(/FAIL 0$/.test(st.trim()), 'A8 內建自測全綠: ' + st);
  w.close();
});

// 總案數不變式：期望總數由 PLAN 自動加總（不再有第二個需人工同步的魔數）。
// 只在「縮水」時額外記一筆；膨脹一定已被逐案的「斷言數 ≠ PLAN」指名抓到，不重複報。
const PLAN_TOTAL = Object.values(PLAN).reduce((a, b) => a + b, 0);
const executedTotal = pass + fail;
if (process.env.DUMP_PLAN === '1') console.log('PLAN dump:', JSON.stringify(RAN));
if (executedTotal < PLAN_TOTAL) {
  fail++; fails.push(`案數不完整（防靜默掉案）：實際執行 ${executedTotal} 案，PLAN 宣告 ${PLAN_TOTAL} 案`);
}
console.log('FEATURES-E2E: PASS ' + pass + ' / FAIL ' + fail);
if (fail) { fails.forEach(f => console.log(' - ' + f)); }
process.exit(fail ? 1 : 0);
