/* 回歸守護：第四輪外部審查（Cowork + OpenCode，標的 36b7b90）確認的 10 項缺陷。
   每一案都對應一個「修好之前會失敗」的具體情境，全部直接讀正式 index.html 原始碼。

   R1 WIP 中斷後鏡射未修復 → 第二次載入資料永久消失（Critical）
   R2 設定 modal 快照跨帳本污染（High）
   R3 已落盤的匯率更新被設定快照還原（High）
   R4 消費稅在 dp=2 幣別被整數化（High，寫入路徑）
   R5 跨幣別轉帳「建議入帳」預填被整數化（Medium）
   R6 載入/還原路徑不淨化 account.currency → 儲存型 XSS（Medium）
   R7 成員撞號 remap 把金錢歸屬翻給第二位（Medium）
   R8 合法但危險的成員 id（constructor）分攤份數被丟棄（Low）
   R9 fetch 逾時不涵蓋 response body → 降級鏈失效、按鈕永久卡住（High）
   R10 fmt() 寫死 /100（Low，防未來 dp=3 幣別）
*/
const fs = require('fs');
const http = require('http');
const { JSDOM, VirtualConsole } = require('jsdom');
const APP = process.argv[2];
const html = fs.readFileSync(APP, 'utf8');

let pass = 0, fail = 0; const fails = [];
const ok = (c, n) => { if (c) pass++; else { fail++; fails.push(n); } };
const eq = (a, b, n) => ok(a === b, `${n} [got=${JSON.stringify(a)} want=${JSON.stringify(b)}]`);
function scenario(name, fn) {
  try { return fn(); }
  catch (e) { fail++; fails.push(name + ' THREW: ' + (e && e.message)); console.log('!! ' + name + ': ' + (e && e.stack || e)); }
}

function mk(extra) {
  return Object.assign({
    ledgerName: '回歸測試', rate: 4.9261, rateSource: '手動設定', rateUpdatedAt: null,
    rates: { JPY: 4.9261, USD: 0.03125 },
    accounts: [
      { id: 'jpy', name: '日幣現金', currency: 'JPY', kind: 'prepaid', initial: 20000, color: '#34d399' },
      { id: 'usd', name: '美金現金', currency: 'USD', kind: 'prepaid', initial: 500, color: '#60a5fa' },
      { id: 'twd', name: '台幣現金', currency: 'TWD', kind: 'prepaid', initial: 5000, color: '#f59e0b' },
    ],
    categories: { '飲食': ['晚餐'], '交通': ['電鐵'] },
    txns: [{ id: 'a1', type: 'expense', date: '2026-07-01', account: 'jpy', amount: 1234, cat: '飲食', item: 'x' }],
    members: [], splits: [], schemaVersion: 2,
  }, extra || {});
}
function boot(storage, fetchImpl) {
  const vc = new VirtualConsole();
  const logs = [];
  vc.on('log', (...a) => logs.push(a.join(' ')));
  vc.on('error', (...a) => logs.push('ERR ' + a.join(' ')));
  vc.on('jsdomError', e => logs.push('JSDOMERR ' + (e && e.message)));
  const dom = new JSDOM(html, {
    url: 'https://guuzenshop.github.io/jp-trip-ledger/',
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      for (const k of Object.keys(storage || {})) { try { w.localStorage.setItem(k, storage[k]); } catch (e) {} }
      w.alert = () => {}; w.confirm = () => true; w.prompt = () => null; w.scrollTo = () => {};
      if (fetchImpl) w.fetch = fetchImpl;
    }
  });
  return { w: dom.window, logs };
}
const KEYS = ['jp_trip_ledger_v3', 'jp_trip_ledger_v2', 'jp_trip_ledger_wip', 'jp_trip_ledger_conflict_bak'];
const dumpAll = w => {
  const o = {};
  for (const k of KEYS) { const v = w.localStorage.getItem(k); if (v !== null) o[k] = v; }
  return o;
};

(async () => {

/* ===== R1：寫入中斷 → 鏡射必須被修復，且「只看不改」再開資料仍在 ===== */
scenario('R1', () => {
  const b1 = boot({ jp_trip_ledger_v2: JSON.stringify(mk()) });
  b1.w.eval('save()');
  const S0 = dumpAll(b1.w);
  b1.w.eval("data.txns.push({id:'NEWROW',type:'expense',date:'2026-07-20',account:'jpy',amount:777,cat:'飲食',item:'最後一筆'}); save();");
  const S1 = dumpAll(b1.w);
  b1.w.close();

  // 中斷態：v3 是新的、v2 鏡射停在舊的、WIP 旗標殘留
  const b2 = boot({
    jp_trip_ledger_v3: S1['jp_trip_ledger_v3'],
    jp_trip_ledger_v2: S0['jp_trip_ledger_v2'],
    jp_trip_ledger_wip: '1',
  });
  ok(b2.w.eval("data.txns.some(t=>t.id==='NEWROW')"), 'R1-a 第一次載入：不採信過期鏡射，最後一筆還在');
  eq(b2.w.eval("localStorage.getItem('jp_trip_ledger_wip')"), null, 'R1-b 修復完成後旗標才清除');
  ok(b2.w.eval("(localStorage.getItem('jp_trip_ledger_v2')||'').indexOf('NEWROW') >= 0"),
     'R1-c ★ 鏡射已被修回與主檔一致（沒有這一步，下次載入就會被舊鏡射覆蓋）');
  const bak = JSON.parse(b2.w.localStorage.getItem('jp_trip_ledger_conflict_bak') || '[]');
  ok(Array.isArray(bak) && bak.length === 1, 'R1-d 被棄用的過期鏡射存成衝突備份（可還原，不是直接丟掉）');
  ok(bak.length === 1 && !JSON.stringify(bak[0]).includes('NEWROW'), 'R1-e 備份內容確實是中斷前的舊版');
  const S2 = dumpAll(b2.w);
  b2.w.close();

  // 使用者「只看不改」關掉再開（全程沒有任何 save()）
  const b3 = boot(S2);
  ok(b3.w.eval("data.txns.some(t=>t.id==='NEWROW')"), 'R1-f ★★ 第二次載入資料仍在（原本會永久消失）');
  eq(b3.w.eval('data.txns.length'), 2, 'R1-g 筆數正確');
  b3.w.close();
});

/* ===== R2：設定 modal 開著時切帳本，不得把上一本的設定寫進新帳本 ===== */
scenario('R2', () => {
  const { w } = boot({ jp_trip_ledger_v2: JSON.stringify(mk()) });
  w.eval('save()');
  w.eval("openLedgerModal(); toggleLedgerAdd(true); document.getElementById('lg-new-name').value='LEDGER-B'; createLedgerFromForm();");
  const idB = w.eval('data.id');
  w.eval("data.accounts.push({id:'bacct',name:'B專用',currency:'USD',kind:'prepaid',initial:100,color:'#60a5fa'});" +
         "data.txns.push({id:'bt1',type:'expense',date:'2026-07-20',account:'bacct',amount:99,cat:Object.keys(data.categories)[0],item:'B的消費'}); save();");
  const idA = w.eval(`store.ledgers.find(l=>l.id!=='${idB}').id`);

  w.eval(`switchLedger('${idA}', true)`);
  w.eval('openSettings()');
  ok(w.eval('_settingsSnap !== null'), 'R2-a 前置：設定快照已建立（內容為 A）');
  // 開帳本 modal 應先收掉設定（比照 openSummary），不留疊框
  w.eval('openLedgerModal()');
  eq(w.eval("document.getElementById('settings-modal').classList.contains('show')"), false,
     'R2-b ★ 開帳本 modal 會先收掉設定 modal（不再疊框）');
  eq(w.eval('_settingsSnap'), null, 'R2-c ★ 快照已釋放');
  w.eval(`switchLedger('${idB}')`);
  w.eval('closeSettings()');   // 即使再被呼叫也不該有任何還原動作
  eq(w.eval('data.ledgerName'), 'LEDGER-B', 'R2-d ★★ B 的帳本名沒有被 A 覆蓋');
  ok(w.eval("data.accounts.some(a=>a.id==='bacct')"), 'R2-e ★★ B 的帳戶還在');
  eq(w.eval("data.txns.filter(t=>t.account && !data.accounts.some(a=>a.id===t.account)).length"), 0,
     'R2-f ★★ 沒有產生孤兒交易');

  // 縱深防禦：即使 _settingsSnap 因其他路徑仍在，切帳本也必須清掉
  w.eval(`switchLedger('${idA}', true); openSettings();`);
  w.eval(`store.activeLedgerId='${idB}'; data = store.ledgers.find(l=>l.id==='${idB}'); resetTransientState();`);
  eq(w.eval('_settingsSnap'), null, 'R2-g ★ resetTransientState 直接清掉 _settingsSnap（縱深防禦）');
  w.close();
});

/* ===== R3：更新中開設定 → 更新成功落盤 → 取消關閉不得把新匯率倒回去 ===== */
await scenario('R3', async () => {
  const CSV = [
    'Currency,Rate,Cash,Spot,F10,F30,F60,F90,F120,F150,F180,Rate,Cash,Spot,F10,F30,F60,F90,F120,F150,F180,x',
    'JPY,Buying,0.18970,0.19650,0,0,0,0,0,0,0,Selling,0.20250,0.20150,0,0,0,0,0,0,0,',
  ].join('\n');
  let release;
  const gate = new Promise(r => { release = r; });
  const { w } = boot({ jp_trip_ledger_v2: JSON.stringify(mk()) }, async () => { await gate; return { text: async () => CSV }; });
  w.eval('save()');
  const before = w.eval('data.rates.JPY');
  const p = w.eval('updateRate()');     // 使用者先按「🔄 更新最新匯率」
  w.eval('openSettings()');             // 更新仍在飛行中時開設定（快照＝舊匯率）
  release();
  await p;
  const updated = w.eval('data.rates.JPY');
  ok(updated !== before, `R3-a 前置：匯率已更新並落盤 ${before} → ${updated}`);
  w.eval('closeSettings()');            // 沒按儲存就關閉
  eq(w.eval('data.rates.JPY'), updated, 'R3-b ★★ 已提交且已落盤的匯率不被還原');
  eq(w.eval('data.rateSource'), '台銀現金賣出', 'R3-c 來源標記與數值一致');
  ok(w.eval('data.rateUpdatedAt') !== null, 'R3-d 更新時間與數值一致（不再脫節）');
  w.eval('save()');
  ok(w.localStorage.getItem('jp_trip_ledger_v3').indexOf(String(updated)) >= 0, 'R3-e 落盤的是新匯率');

  // 對照：手動改匯率後取消關閉，仍必須還原（原設計目的不可被破壞）
  w.eval('openSettings()');
  w.eval("data.rates.JPY = 9.99; data.rateSource='手動設定';");
  w.eval('closeSettings()');
  eq(w.eval('data.rates.JPY'), updated, 'R3-f ★ 未提交的手動修改仍會被還原（原設計目的保住）');
  eq(w.eval('data.rateSource'), '台銀現金賣出', 'R3-g rateSource 一併還原');
  w.close();
});

/* ===== R4：消費稅必須在該幣最小單位上取整（dp=0 不得改變） ===== */
scenario('R4', () => {
  const { w } = boot({ jp_trip_ledger_v2: JSON.stringify(mk()) });
  const addU = JSON.parse(w.eval("JSON.stringify(computeSplitTax([{amount:10.40, rate:8}],'add','USD'))"));
  eq(addU.tax, 0.83, 'R4-a ★ USD $10.40 外加 8% → 稅 $0.83（原本被整數化成 $1）');
  eq(addU.gross, 11.23, 'R4-b ★ 合計 $11.23');
  eq(JSON.parse(w.eval("JSON.stringify(computeSplitTax([{amount:0.40, rate:8}],'add','USD'))")).tax, 0.03,
     'R4-c ★ USD $0.40 的稅不再整筆蒸發');
  eq(JSON.parse(w.eval("JSON.stringify(computeSplitTax([{amount:10.80, rate:8}],'incl','USD'))")).embedded, 0.8,
     'R4-d ★ 內含稅 $0.80');
  // dp=0 幣別必須與舊版位元級相同
  eq(JSON.parse(w.eval("JSON.stringify(computeSplitTax([{amount:108, rate:8}],'add','JPY'))")).tax, 9, 'R4-e dp=0 ¥108→¥9 不變');
  eq(JSON.parse(w.eval("JSON.stringify(computeSplitTax([{amount:108, rate:8}],'add'))")).tax, 9, 'R4-f 省略幣別時退化為 dp=0（舊行為）');
  // 寫入路徑（送出表單）
  w.eval("singleTax = { mode:'add', rate:8 };");
  w.eval("document.getElementById('f-account').value='usd';" +
         "document.getElementById('f-amount').value='10.50';" +
         "document.getElementById('f-item').value='咖啡';" +
         "document.getElementById('f-cat').value='飲食';");
  w.eval('submitForm()');
  const last = JSON.parse(w.eval('JSON.stringify(data.txns[data.txns.length-1])'));
  eq(last.amount, 11.34, 'R4-g ★★ 寫入路徑：USD $10.50 外加 8% 存成 $11.34（原本存成 $11.5）');
  w.close();
});

/* ===== R5：跨幣別轉帳建議入帳保留小數 ===== */
scenario('R5', () => {
  const { w } = boot({ jp_trip_ledger_v2: JSON.stringify(mk()) });
  w.eval("const r=document.querySelector('input[name=\"ttype\"][value=\"topup\"]'); r.checked=true; r.dispatchEvent(new window.Event('change',{bubbles:true}));");
  w.eval('refreshSelects()');
  w.eval("document.getElementById('f-from').value='twd';" +
         "document.getElementById('f-to').value='usd';" +
         "document.getElementById('f-amount').value='985'; toamtTouched=false;");
  w.eval('updatePreview()');
  eq(w.eval("document.getElementById('f-toamount').value"), '30.78', 'R5-a ★★ 預填 $30.78（原本填成 31）');
  ok(String(w.eval("document.getElementById('amt-preview').textContent")).indexOf('30.78') >= 0,
     'R5-b 預填值與同畫面提示一致，不再自相矛盾');
  // dp=0 目標幣別維持整數
  w.eval("document.getElementById('f-to').value='jpy'; toamtTouched=false; updatePreview();");
  ok(String(w.eval("document.getElementById('f-toamount').value")).indexOf('.') < 0, 'R5-c dp=0 幣別仍為整數（零回歸）');
  w.close();
});

/* ===== R6：惡意 account.currency 在載入路徑就要被白名單擋掉 ===== */
scenario('R6', () => {
  const evil = '<img class="PWN" src=x onerror="window.__pwn=1">';
  const mal = mk({
    accounts: [
      { id: 'twd', name: '台幣', currency: 'TWD', kind: 'prepaid', initial: 5000, color: '#f59e0b' },
      { id: 'bad', name: '壞帳戶', currency: evil, kind: 'prepaid', initial: 1000, color: '#888' },
    ],
    txns: [{ id: 't1', type: 'expense', date: '2026-07-20', account: 'bad', amount: 500, cat: '飲食', subcat: '晚餐', item: '拉麵' }],
  });
  // 路徑一：v2 鏡射救援
  const { w } = boot({ jp_trip_ledger_v2: JSON.stringify(mal) });
  w.eval('render()');
  ok(w.eval("data.accounts.every(a=>['TWD','JPY','USD','EUR','KRW','GBP','HKD','CNY','MOP','THB','SGD','MYR','VND','PHP','IDR','AUD','NZD','CAD','CHF','SEK','ZAR'].indexOf(a.currency)>=0"
     + ")"), 'R6-a ★ 載入後所有帳戶幣別都在白名單內');
  eq(w.eval("document.querySelectorAll('img.PWN').length"), 0, 'R6-b ★★ render 後零注入節點（原本 7 個）');
  w.eval('openSummary()');
  eq(w.eval("document.querySelectorAll('img.PWN').length"), 0, 'R6-c ★★ 開總結卡後仍零注入（原本 11 個）');
  w.close();

  // 路徑二：deleted_bak 還原
  const { w: w2 } = boot({
    jp_trip_ledger_v2: JSON.stringify(mk()),
    jp_trip_ledger_deleted_bak: JSON.stringify(Object.assign({ id: 'zz1' }, mal)),
  });
  w2.eval('openLedgerModal(); restoreDeletedLedger(); render();');
  eq(w2.eval("document.querySelectorAll('img.PWN').length"), 0, 'R6-d ★ 刪除備份還原路徑同樣被淨化');
  w2.close();
});

/* ===== R7：成員撞號回到 first-wins；懸空 id 的救援不受影響 ===== */
scenario('R7', () => {
  const d = mk({
    members: [{ id: 'abc', name: '阿明' }, { id: 'abc', name: '小華' }, { id: 'bad id', name: '懸空' }],
    splits: [
      { id: 's1', date: '2026-07-20', item: '燒肉', payerId: 'abc', amount: 3000, currency: 'JPY',
        rate: 4.9261, mode: 'amount', participants: [], amounts: { abc: 3000 }, shares: {} },
      { id: 's2', date: '2026-07-20', item: '拉麵', payerId: 'bad id', amount: 1000, currency: 'JPY',
        rate: 4.9261, mode: 'amount', participants: [], amounts: { 'bad id': 1000 }, shares: {} },
    ],
  });
  const { w } = boot({ jp_trip_ledger_v2: JSON.stringify(d) });
  const ms = JSON.parse(w.eval('JSON.stringify(data.members)'));
  const sp = JSON.parse(w.eval('JSON.stringify(data.splits)'));
  eq(ms[0].id, 'abc', 'R7-a 第一位保留原 id');
  ok(ms[1].id !== 'abc', 'R7-b 撞號的第二位重發 id');
  eq(sp[0].payerId, 'abc', 'R7-c ★★ 付款人仍是第一位「阿明」（原本被翻給小華）');
  eq(Object.keys(sp[0].amounts)[0], 'abc', 'R7-d ★★ 分攤金額也留在第一位');
  eq(sp[1].payerId, ms[2].id, 'R7-e ★ 懸空 id（非法字元被重發）仍正確 remap 到新 id — 本次修復的原始目的沒被破壞');
  eq(Object.keys(sp[1].amounts)[0], ms[2].id, 'R7-f ★ 懸空 id 的物件鍵一併 remap');
  w.close();
});

/* ===== R8：constructor / prototype 是合法成員 id，份數不得被丟棄 ===== */
scenario('R8', () => {
  const d = mk({
    members: [{ id: 'constructor', name: '阿建' }, { id: 'bob', name: '小明' }],
    splits: [{ id: 's1', date: '2026-07-20', item: '燒肉', payerId: 'bob', amount: 3000, currency: 'JPY',
               rate: 4.9261, mode: 'shares', participants: ['constructor', 'bob'],
               amounts: {}, shares: { constructor: 2, bob: 3 } }],
  });
  const { w } = boot({ jp_trip_ledger_v2: JSON.stringify(d) });
  const s = JSON.parse(w.eval('JSON.stringify(data.splits[0])'));
  ok(Object.prototype.hasOwnProperty.call(s.shares || {}, 'constructor'),
     'R8-a ★★ id=constructor 的份數保留（原本被靜默丟棄、結算歸零）');
  eq(s.shares.constructor, 2, 'R8-b 份數值正確');
  eq(s.shares.bob, 3, 'R8-c 另一位不受影響');
  // 原型污染必須仍然擋住
  const d2 = mk({
    members: [{ id: 'bob', name: '小明' }],
    splits: [{ id: 's1', date: '2026-07-20', item: 'x', payerId: 'bob', amount: 100, currency: 'JPY',
               rate: 4.9261, mode: 'amount', participants: [],
               amounts: JSON.parse('{"__proto__":{"polluted":1},"bob":100}'), shares: {} }],
  });
  const { w: w2 } = boot({ jp_trip_ledger_v2: JSON.stringify(d2) });
  eq(w2.eval("String(({}).polluted)"), 'undefined', 'R8-d ★ __proto__ 鍵仍被擋，無原型污染');
  w2.close();
  w.close();
});

/* ===== R9：fetch 逾時必須涵蓋 response body ===== */
await scenario('R9', async () => {
  const m = html.match(/async function fetchTextWithTimeout\(url, ms\) \{[\s\S]*?\n\}/);
  ok(!!m, 'R9-a 抽得到出貨版 fetchTextWithTimeout 原始碼');
  if (!m) return;
  const fn = eval('(' + m[0].replace('async function fetchTextWithTimeout', 'async function') + ')');
  const server = http.createServer((req, res) => {
    if (req.url === '/stall-body') { res.writeHead(200, { 'Content-Type': 'text/csv' }); res.write('JPY,Buying,0.1897'); }
    else { res.writeHead(200, { 'Content-Type': 'text/csv' }); res.end('JPY,Buying,0.1897\n'); }
  });
  await new Promise(r => server.listen(0, r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const t0 = Date.now();
  let aborted = false;
  try { await fn(base + '/stall-body', 700); } catch (e) { aborted = /Abort/i.test(String(e && e.name || e)); }
  const ms = Date.now() - t0;
  ok(aborted, 'R9-b ★★ body 卡住時會 abort（原本永久 pending，降級鏈失效、按鈕卡在「更新中…」）');
  ok(ms < 3000, `R9-c ★ 在逾時附近就放棄（實測 ${ms}ms）`);
  const good = await fn(base + '/ok', 3000);
  ok(String(good).indexOf('JPY') >= 0, 'R9-d 正常回應仍可取得完整內容（零回歸）');
  server.close();
});

/* ===== R10：fmt 改用 curScale 後，dp=0/2 行為完全不變 ===== */
scenario('R10', () => {
  const { w } = boot({ jp_trip_ledger_v2: JSON.stringify(mk()) });
  eq(w.eval("fmt(1234.567,'TWD')"), 'NT$1,235', 'R10-a dp=0 四捨五入不變');
  eq(w.eval("fmt(1234.567,'JPY')"), '¥1,235', 'R10-b dp=0 日圓不變');
  eq(w.eval("fmt(12.345,'USD')"), '$12.35', 'R10-c dp=2 兩位小數不變');
  eq(w.eval("fmt(-12.344,'USD')"), '-$12.34', 'R10-d 負值不變');
  eq(w.eval("fmt(0,'USD')"), '$0.00', 'R10-e 零值不變');
  w.close();
});

console.log(`REGRESS: PASS ${pass} / FAIL ${fail}`);
if (fails.length) { console.log('FAILS:\n - ' + fails.join('\n - ')); process.exit(1); }
})();
