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

   ---- 第五輪外部審查（Claude Code，標的 56f54e3）指出「上一輪修復本身引入」的新缺陷 ----
   R11 normalizeLedgerFields 用 Object.assign 合併不受信任物件 → JSON.parse 產生的自有
       __proto__ 鍵觸發原型替換（High，該帳戶物件本地污染，非全域）
   R12 accounts 陣列含 null／缺 id 元素 → 補成「幽靈帳戶」流入下拉選單（Medium）
   R13 WIP 修復重複開機時，conflict_bak 無去重地把真實併發衝突備份擠出（Medium）
*/
const fs = require('fs');
const http = require('http');
const { JSDOM, VirtualConsole } = require('jsdom');
const APP = process.argv[2];
const html = fs.readFileSync(APP, 'utf8');

let pass = 0, fail = 0; const fails = [];
const ok = (c, n) => { if (c) pass++; else { fail++; fails.push(n); } };
const eq = (a, b, n) => ok(a === b, `${n} [got=${JSON.stringify(a)} want=${JSON.stringify(b)}]`);

/* 逐案斷言數宣告（取代「總數魔數」）：
   總數魔數的問題是——加案子的人只要把總數改大就過了，等於橡皮圖章，
   而且「某一案少跑 3 條、另一案多跑 3 條」會互相抵銷、完全看不出來。
   改成逐案宣告後：① 新增案子必須在這裡登錄，改的是有語意的一行；
   ② 任何一案的斷言數與宣告不符（含 throw 導致中途中止）都會被指名道姓抓出來；
   ③ 期望總數由本表自動加總，不再有第二個需要人工同步的數字。
   DUMP_PLAN=1 可印出實際逐案斷言數，用來機械產生／校正本表。 */
const PLAN = {
  // 第四／五輪（合計 65，與本表取代的舊魔數相同）
  R1: 7, R2: 7, R3: 7, R4: 9, R5: 3, R6: 4, R7: 6, R8: 4, R9: 4, R10: 5,
  R11: 4, R12: 3, R13: 2,
  // 第六輪（合計 30）
  R14: 4, R15: 4, R16: 4, R17: 4, R18: 2, R19: 2, R20: 3, R21: 6, R22: 1,
};
const RAN = {};
function _reconcile(name, want, p0, f0, threw) {
  const ran = (pass - p0) + (fail - f0);
  RAN[name] = ran;
  if (want == null) { fail++; fails.push(`${name} 未登錄於 PLAN（新增案子必須同時宣告斷言數）`); return; }
  if (threw) {
    const missing = Math.max(0, want - ran);
    fail += Math.max(1, missing);          // 未執行的斷言整批記 fail，不是只記 1（否則案數會靜默縮水）
    fails.push(`${name} THREW: ${threw && threw.message}` + (missing ? `（${missing} 條未執行，已整批記 fail）` : ''));
    console.log('!! ' + name + ': ' + (threw && threw.stack || threw));
    return;
  }
  if (ran !== want) { fail++; fails.push(`${name} 斷言數 ${ran} ≠ PLAN 宣告 ${want}（PLAN 未同步，或有靜默略過路徑）`); }
}
function scenario(name, fn) {
  const want = PLAN[name];
  const p0 = pass, f0 = fail;
  let ret;
  try { ret = fn(); }
  catch (e) { _reconcile(name, want, p0, f0, e); return; }
  if (ret && typeof ret.then === 'function') {          // R3／R9 是 async，必須等它跑完才結算
    return ret.then(v => { _reconcile(name, want, p0, f0, null); return v; },
                    e => { _reconcile(name, want, p0, f0, e); });
  }
  _reconcile(name, want, p0, f0, null);
  return ret;
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
  // 「才」清除＝鏡射修復與旗標清除必須同時成立（合取），單獨查旗標=null 分不出順序
  // （修復前的舊碼是「立刻」清旗標、鏡射根本沒修，同樣會得到 wip===null，測不出差異）
  const mirrorFixed = b2.w.eval("(localStorage.getItem('jp_trip_ledger_v2')||'').indexOf('NEWROW') >= 0");
  const flagCleared = b2.w.eval("localStorage.getItem('jp_trip_ledger_wip')") === null;
  ok(mirrorFixed && flagCleared, 'R1-b ★ 鏡射已修回「且」旗標已清（合取；不是各自為政）');
  ok(mirrorFixed, 'R1-c ★ 鏡射已被修回與主檔一致（沒有這一步，下次載入就會被舊鏡射覆蓋）');
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
  const updatedAt = w.eval('data.rateUpdatedAt');
  eq(w.eval('data.rates.JPY'), updated, 'R3-b ★★ 已提交且已落盤的匯率不被還原');
  // 真正的「脫節」是「數值已更新，但中繼資料還停在舊的」——單獨查字串/非 null 測不出這種脫節
  // （症狀版本 rateSource 一樣會是「台銀現金賣出」，只是 rates.JPY 被還原成舊值）。
  // 交叉比對：rates.JPY===updated 的當下，rateSource/rateUpdatedAt 必須「同時」是更新後的狀態。
  ok(w.eval('data.rates.JPY') === updated && w.eval('data.rateSource') === '台銀現金賣出',
     'R3-c ★ 數值與來源同時處於「已更新」狀態（交叉比對，非各自為政）');
  ok(w.eval('data.rates.JPY') === updated && w.eval('data.rateUpdatedAt') === updatedAt,
     'R3-d ★ 數值與更新時間同時處於「已更新」狀態，時間戳未被單獨還原（不再脫節）');
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

  // 拆分表單是「第 5 個呼叫端」（index.html:4748），走的是完全不同的送出函式 submitSplitForm，
  // 前面的 R4-g 只覆蓋了單筆消費的送出路徑，兩者不共用程式碼，缺一不可各自守護
  const before = w.eval('data.txns.length');
  w.eval("splitRows = [{cat:Object.keys(data.categories)[0]||'', subcat:'', item:'咖啡', amount:10.50}];" +
         "splitTax = { mode:'add', rate:8 };");
  w.eval("submitSplitForm(today(), '')");
  const added = w.eval('data.txns.length') - before;
  const taxTxn = JSON.parse(w.eval("JSON.stringify(data.txns.find(t=>String(t.subcat||'').indexOf('消費稅')>=0))"));
  ok(added >= 1, 'R4-h 前置：拆分表單送出有新增交易');
  eq(taxTxn && taxTxn.amount, 0.84, 'R4-i ★★ 拆分寫入路徑（submitSplitForm）：USD $10.50 外加 8% 稅費列存成 $0.84（此路徑不經 R4-g 測到的程式碼）');
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
  const inputVal = w.eval("document.getElementById('f-toamount').value");
  const previewText = String(w.eval("document.getElementById('amt-preview').textContent"));
  eq(inputVal, '30.78', 'R5-a ★★ 預填 $30.78（原本填成 31）');
  // 交叉比對：從提示文字抽出的數字必須等於輸入框的值，不能只各自查對——
  // 提示原本就是對的（bug 只出在輸入框），單獨查「提示含 30.78」測不出「兩者不一致」這件事本身。
  const previewNum = (previewText.match(/[\d.]+/) || [])[0];
  eq(previewNum, inputVal, 'R5-b ★ 預填值與同畫面提示的數字逐字相同（交叉比對，不是各自查對）');
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
  // 抽取失敗不能只 return——那會讓 R9-b/c/d 靜默不執行，總案數跟著縮水卻仍可能全綠
  // （外部審查已指出：對缺這個函式的舊版跑本檔，只會拿到 1 個 FAIL，另外 3 個斷言直接消失）。
  // 明確記成失敗，逼分數反映「這個高風險情境沒有守護」的事實。
  if (!m) { fail += 3; fails.push('R9-b/c/d 未執行（抽不到 fetchTextWithTimeout 原始碼）'); return; }
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

/* ===== R11：normalizeLedgerFields 不得因合併不受信任物件而發生原型替換 ===== */
scenario('R11', () => {
  // JSON.parse 對 __proto__ 是一般的「自有」資料鍵（非字面量語法的特殊處理），
  // Object.assign({}, a, {...}) 對它做 [[Set]] 會觸發 Object.prototype 的 __proto__ setter，
  // 把合併後物件的原型整個換掉（該物件本地污染，非全域 Object.prototype 污染）。
  const evilJson = '{"ledgerName":"X","rate":4.9261,"rates":{"JPY":4.9261},' +
    '"accounts":[{"__proto__":{"kind":"credit","archived":true},"id":"jpy","name":"日幣","currency":"JPY","initial":1000,"color":"#888"}],' +
    '"categories":{"飲食":["晚餐"]},"txns":[],"members":[],"splits":[],"schemaVersion":2}';
  const { w } = boot({ jp_trip_ledger_v2: evilJson });
  ok(w.eval('Object.getPrototypeOf(data.accounts[0]) === Object.prototype'),
     'R11-a ★★ 帳戶物件原型未被惡意 __proto__ 鍵替換');
  eq(w.eval('data.accounts[0].kind'), undefined, 'R11-b ★ 攻擊者控制的 kind 欄位沒有滲透進帳戶物件');
  eq(w.eval('data.accounts[0].archived'), undefined, 'R11-c ★ 攻擊者控制的 archived 欄位沒有滲透進帳戶物件');
  ok(w.eval("({}).polluted === undefined && Object.prototype.kind === undefined"),
     'R11-d 對照：全域 Object.prototype 本就未受影響（確認測的是正確的攻擊面）');
  w.close();
});

/* ===== R12：accounts 陣列的 null／缺 id 元素必須被過濾，不得補成幽靈帳戶 ===== */
scenario('R12', () => {
  const d = mk({ accounts: [
    { id: 'twd', name: '台幣', currency: 'TWD', initial: 5000, color: '#888' },
    null,
    { currency: 'USD', initial: 100, color: '#888' },   // 缺 id
  ] });
  const { w } = boot({ jp_trip_ledger_v2: JSON.stringify(d) });
  eq(w.eval('data.accounts.length'), 1, 'R12-a ★★ null／缺 id 的元素被過濾，只留下合法帳戶');
  w.eval('refreshSelects()');
  const values = JSON.parse(w.eval("JSON.stringify(Array.from(document.querySelectorAll('#f-account option')).map(o=>o.value))"));
  ok(values.indexOf('undefined') < 0, 'R12-b ★★ 帳戶下拉選單不含 value="undefined" 的幽靈項');
  eq(values.length, 1, 'R12-c 下拉選項數與合法帳戶數一致');
  w.close();
});

/* ===== R13：WIP 修復重複觸發時，conflict_bak 不得無去重地把真實併發衝突備份擠出 ===== */
scenario('R13', () => {
  const b0 = boot({ jp_trip_ledger_v2: JSON.stringify(mk({ ledgerName: '過期鏡射' })) });
  b0.w.eval('save()');
  const v2Stale = b0.w.localStorage.getItem('jp_trip_ledger_v2');
  b0.w.close();

  const b1 = boot({ jp_trip_ledger_v2: v2Stale });
  b1.w.eval("data.ledgerName = '主檔（較新）'; save();");
  const v3Newer = b1.w.localStorage.getItem('jp_trip_ledger_v3');
  b1.w.close();

  const b2 = boot({ jp_trip_ledger_v2: JSON.stringify(mk({ ledgerName: 'PRECIOUS-CONFLICT' })) });
  b2.w.eval('save()');
  const precious = JSON.parse(b2.w.eval('JSON.stringify(data)'));
  b2.w.close();

  const storage = {
    jp_trip_ledger_v3: v3Newer, jp_trip_ledger_v2: v2Stale, jp_trip_ledger_wip: '1',
    jp_trip_ledger_conflict_bak: JSON.stringify([precious]),
  };
  for (let i = 0; i < 6; i++) {
    const b = boot(storage);
    storage.jp_trip_ledger_wip = '1';   // 模擬反覆中斷
    storage.jp_trip_ledger_conflict_bak = b.w.localStorage.getItem('jp_trip_ledger_conflict_bak');
    b.w.close();
  }
  const bak = JSON.parse(storage.jp_trip_ledger_conflict_bak || '[]');
  ok(bak.some(l => l.ledgerName === 'PRECIOUS-CONFLICT'),
     'R13-a ★★ 真實的併發衝突備份沒有被反覆中斷產生的重複鏡射擠出');
  // 6 次重開機、鏡射內容從未變過 → 應該只在第一次推入一筆，之後全被去重擋下；
  // 陣列最終應停在「預先塞的 1 筆 + 第一次推入的 1 筆」= 2，而非灌到上限 5。
  eq(bak.length, 2, 'R13-b ★ 連續相同內容的過期鏡射只推入一次，之後被去重擋下（不會逐次灌入陣列）');
});

/* ===== 第六輪外部審查（Cowork + Claude Code，標的 8351c5e）確認的缺陷 =====
   R14 txn.date 未淨化 → 內插進「全部展開」鈕的 onclick → 儲存型 XSS（High）
   R15 同上，經刪除備份還原／衝突備份還原兩條路徑（High）
   R16 txn.id 未淨化 → 內插進 startInlineEdit/moveTxn 的 onclick 單引號字串（High，本輪自查追加）
   R17 CSV 對退化組仍輸出大標題／拆分組，與顯示層口徑不一致（Medium）
   R18 同一 gid 掛不同 gtitle（載入路徑）→ 同組三種標籤（Medium）
   R19 金額／自訂排序下新增交易，該日未寫入展開集合 → 切回日期排序找不到剛記那筆（Medium）
   R20 換帳本未清大標題欄／展開集合 → 標題被寫進另一本、上一本展開狀態外洩（Medium）
   R21 拆分模式 Enter 觸發表單隱式送出（整組被提前記帳）＋ IME 組字被當動線指令（High）
   R22 getExpandedGids 缺元素白名單（Low，與 getExpandedDays 不對稱） */

const EVIL_DATE = '2026-07-18&quot;]);window.__PWNED=1;//';
const EVIL_ID = "x');window.__PWNED2=1;//";
const mkDays = (txns) => mk({ txns });
const TWO_DAYS = [
  { id: 'd1', type: 'expense', date: EVIL_DATE, account: 'jpy', amount: 100, cat: '飲食', item: '惡意' },
  { id: 'd2', type: 'expense', date: '2026-07-17', account: 'jpy', amount: 200, cat: '飲食', item: '正常' },
];
// 「全部展開」鈕：日期若被內插進 onclick，這裡就會看到 payload；點下去會執行它
function allDaysProbe(w) {
  const btn = w.document.querySelector('.day-allbtns button');
  if (!btn) return { found: false, html: '', pwned: false };
  const outer = btn.outerHTML;
  try { btn.click(); } catch (e) {}
  return { found: true, html: outer, pwned: w.__PWNED === 1 };
}

scenario('R14', () => {
  const { w } = boot({ jp_trip_ledger_v2: JSON.stringify(mkDays(TWO_DAYS)) });
  const dates = w.eval('JSON.stringify(data.txns.map(t=>t.date))');
  ok(dates.indexOf('__PWNED') < 0, 'R14-a ★★ 載入路徑把非法 date 正規化（不再原封留在資料裡）');
  const p = allDaysProbe(w);
  ok(p.found, 'R14-b 「全部展開」鈕有渲染出來（否則後面兩條等於沒測到）');
  ok(p.html.indexOf('__PWNED') < 0, 'R14-c ★★ 鈕的 outerHTML 不含未逸出的 payload');
  ok(!p.pwned, 'R14-d ★★ 點下去不會執行注入的 JS');
});

scenario('R15', () => {
  const evil = mkDays(TWO_DAYS); evil.ledgerName = '惡意本';
  // ① 刪除備份還原
  const b1 = boot({ jp_trip_ledger_v2: JSON.stringify(mk()), jp_trip_ledger_deleted_bak: JSON.stringify(evil) });
  b1.w.eval('restoreDeletedLedger()');
  const p1 = allDaysProbe(b1.w);
  ok(b1.w.eval('JSON.stringify(data.txns.map(t=>t.date))').indexOf('__PWNED') < 0, 'R15-a ★★ 刪除備份還原：date 已正規化');
  ok(!p1.pwned, 'R15-b ★★ 刪除備份還原：點「全部展開」不會執行注入的 JS');
  // ② 衝突備份還原（陣列元素本身就是帳本物件）
  const b2 = boot({ jp_trip_ledger_v2: JSON.stringify(mk()), jp_trip_ledger_conflict_bak: JSON.stringify([evil]) });
  b2.w.eval('restoreConflictBak()');
  const p2 = allDaysProbe(b2.w);
  ok(b2.w.eval('JSON.stringify(data.txns.map(t=>t.date))').indexOf('__PWNED') < 0, 'R15-c ★★ 衝突備份還原：date 已正規化');
  ok(!p2.pwned, 'R15-d ★★ 衝突備份還原：點「全部展開」不會執行注入的 JS');
});

scenario('R16', () => {
  const { w } = boot({ jp_trip_ledger_v2: JSON.stringify(mkDays([
    { id: EVIL_ID, type: 'expense', date: '2026-07-18', account: 'jpy', amount: 100, cat: '飲食', item: '惡意' },
    { id: 'ok1', type: 'expense', date: '2026-07-17', account: 'jpy', amount: 200, cat: '飲食', item: '正常' },
  ])) });
  ok(w.eval('JSON.stringify(data.txns.map(t=>t.id))').indexOf('__PWNED2') < 0, 'R16-a ★★ 載入路徑重發非法 txn id');
  w.eval("sortMode='manual'; render();");
  const btn = w.document.querySelector('.move-btn');
  ok(!!btn, 'R16-b 自訂排序的移動鈕有渲染（否則後兩條沒測到）');
  ok(!btn || btn.outerHTML.indexOf('__PWNED2') < 0, 'R16-c ★★ moveTxn 的 onclick 不含注入 payload');
  if (btn) { try { btn.click(); } catch (e) {} }
  ok(w.__PWNED2 !== 1, 'R16-d ★★ 點移動鈕不會執行注入的 JS');
});

scenario('R17', () => {
  const g = [
    { id: 'q1', type: 'expense', date: '2026-07-18', account: 'jpy', amount: 100, cat: '購物', item: '衣服', gid: 'gg1', gtitle: 'UNIQLO' },
    { id: 'q2', type: 'expense', date: '2026-07-18', account: 'jpy', amount: 200, cat: '購物', item: '褲子', gid: 'gg1', gtitle: 'UNIQLO' },
  ];
  const { w } = boot({ jp_trip_ledger_v2: JSON.stringify(mkDays(g)) });
  const csvOf = () => w.eval(`(function(){var cap=null;var orig=download;download=function(n,c){cap=c;};try{exportCSV();}finally{download=orig;}return cap;})()`);
  const before = csvOf();
  ok((before.split('\n').find(l => l.indexOf('褲子') >= 0) || '').indexOf('UNIQLO') >= 0,
    'R17-a 正控：仍成組時 CSV 確實有大標題（否則後面那條會因為「本來就沒有」而假過）');
  w.eval("del('q1')");
  ok(w.eval("isGrouped(data.txns.find(t=>t.id==='q2'))") === false, 'R17-b 刪成單筆後顯示層已退化');
  const after = csvOf().split('\n').find(l => l.indexOf('褲子') >= 0) || '';
  ok(after.indexOf('UNIQLO') < 0, 'R17-c ★★ 退化組的 CSV 不再輸出大標題（與顯示層同口徑）');
  ok(after.indexOf('gg1') < 0, 'R17-d ★★ 退化組的 CSV 不再輸出拆分組 gid');
});

scenario('R18', () => {
  const { w } = boot({ jp_trip_ledger_v2: JSON.stringify(mkDays([
    { id: 'u1', type: 'expense', date: '2026-07-18', account: 'jpy', amount: 100, cat: '購物', item: '甲', gid: 'gu1', gtitle: '標題A' },
    { id: 'u2', type: 'expense', date: '2026-07-18', account: 'jpy', amount: 200, cat: '購物', item: '乙', gid: 'gu1', gtitle: '標題B' },
    { id: 'u3', type: 'expense', date: '2026-07-18', account: 'jpy', amount: 300, cat: '購物', item: '丙', gid: 'gu1' },
  ])) });
  const titles = JSON.parse(w.eval("JSON.stringify(data.txns.filter(t=>t.gid==='gu1').map(t=>t.gtitle||null))"));
  eq(new Set(titles).size, 1, 'R18-a ★★ 載入路徑把同一 gid 的大標題統一（不會同組三種標籤）');
  eq(titles[0], '標題A', 'R18-b 統一成組內第一個合法標題');
});

scenario('R19', () => {
  const { w } = boot({ jp_trip_ledger_v2: JSON.stringify(mkDays(TWO_DAYS.map((t, i) => ({ ...t, date: i ? '2026-07-17' : '2026-07-18' })))) });
  w.eval("localStorage.setItem('jp_expanded_days','[]'); sortMode='amt_desc'; render();");
  w.eval(`
    document.getElementById('f-date').value = '2026-07-16';
    document.getElementById('f-account').value = 'jpy';
    document.getElementById('f-item').value = '新買的';
    document.getElementById('f-amount').value = '999';
    document.getElementById('f-cat').value = '飲食';
    submitForm(null);
  `);
  ok(w.eval("isDayExpanded('2026-07-16')"), 'R19-a ★★ 金額排序下新增交易，該日仍寫進展開集合');
  w.eval("sortMode='date_desc'; render();");
  ok(w.eval(`[...document.querySelectorAll('.day-group')].some(g=>g.textContent.indexOf('新買的')>=0)`),
    'R19-b ★★ 切回日期排序看得到剛新增的那筆（不是被收合藏起來）');
});

scenario('R20', () => {
  const { w } = boot({ jp_trip_ledger_v2: JSON.stringify(mkDays(TWO_DAYS.map((t, i) => ({ ...t, date: i ? '2026-07-17' : '2026-07-18' })))) });
  w.eval(`(function(){
    var nl = normalizeLedger(JSON.parse(JSON.stringify(data)));
    nl.id='LB'; nl.ledgerName='第二本'; nl.archived=false; store.ledgers.push(nl); save();
  })()`);
  w.eval("setDayExpanded('2026-07-17', true);");
  w.eval(`document.getElementById('f-split-on').checked = true; onSplitToggle();
          document.getElementById('f-split-title').value='甲本的UNIQLO'; onSplitTitleInput();`);
  w.eval("switchLedger('LB', true)");
  eq(w.eval("document.getElementById('f-split-title').value"), '', 'R20-a ★★ 換帳本清空大標題欄（否則會被寫進另一本的資料）');
  eq(w.localStorage.getItem('jp_expanded_days'), '[]', 'R20-b ★ 換帳本清空日期展開集合（共用日期不外洩）');
  eq(w.localStorage.getItem('jp_expanded_gids'), '[]', 'R20-c ★ 換帳本清空拆分組展開集合');
});

scenario('R21', () => {
  const { w } = boot({ jp_trip_ledger_v2: JSON.stringify(mk()) });
  w.eval(`
    document.getElementById('f-split-on').checked = true; onSplitToggle();
    splitRows = [{cat:'飲食',subcat:'晚餐',item:'衣服',amount:'1000'}];
    renderSplitRows(); updateSplitSum();
  `);
  const fire = (sel, composing) => w.eval(`(function(){
    var el = ${sel}; if (!el) return null;
    el.focus();
    var ev = new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});
    ${composing ? "Object.defineProperty(ev,'isComposing',{get:function(){return true}});" : ''}
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  })()`);
  ok(fire("document.getElementById('f-split-title')") === true,
    'R21-a ★★ 拆分模式：大標題欄的 Enter 被擋（不會觸發表單隱式送出）');
  ok(fire(`document.querySelector('#split-rows .split-row[data-i="0"] input[list]')`) === true,
    'R21-b ★★ 拆分模式：小項欄的 Enter 被擋');
  ok(fire("document.getElementById('f-note')") === true,
    'R21-c ★ 拆分模式：備註欄等其他 input 的 Enter 也被擋（表單層統一收，不逐欄補）');
  ok(fire(`document.querySelector('#split-rows .split-row[data-i="0"] input[data-fld="item"]')`, true) === false,
    'R21-d ★★ IME 組字中的 Enter 原樣放行（中/日文輸入確認候選字不被當動線指令）');
  const focusAfterIME = w.eval("document.activeElement.getAttribute('data-fld')");
  eq(focusAfterIME, 'item', 'R21-e ★★ IME 組字中的 Enter 不搬游標');
  w.eval("document.getElementById('f-split-on').checked = false; onSplitToggle();");
  ok(fire("document.getElementById('f-item')") === false,
    'R21-f ★ 單筆模式維持原行為（Enter 仍可快速送出，不改既有習慣）');
});

scenario('R22', () => {
  const { w } = boot({
    jp_trip_ledger_v2: JSON.stringify(mk()),
    jp_expanded_gids: JSON.stringify(['ok1', { a: 1 }, null, 123, '<img src=x>']),
  });
  eq(w.eval('JSON.stringify(getExpandedGids())'), JSON.stringify(['ok1']),
    'R22-a ★ getExpandedGids 有元素白名單（與 getExpandedDays 對稱，註解本來就這樣宣稱）');
});

// 總數不變式：期望總數由 PLAN 自動加總（不再有第二個需人工同步的魔數）。
// 只在「縮水」時額外記一筆：膨脹一定已經被逐案的「斷言數 ≠ PLAN」抓到，不重複報。
const PLAN_TOTAL = Object.values(PLAN).reduce((a, b) => a + b, 0);
const executedTotal = pass + fail;
if (process.env.DUMP_PLAN === '1') console.log('PLAN dump:', JSON.stringify(RAN));
if (executedTotal < PLAN_TOTAL) {
  fail++; fails.push(`案數不完整（防靜默掉案）：實際執行 ${executedTotal} 案，PLAN 宣告 ${PLAN_TOTAL} 案`);
}
console.log(`REGRESS: PASS ${pass} / FAIL ${fail}`);
if (fails.length) { console.log('FAILS:\n - ' + fails.join('\n - ')); process.exit(1); }
})();
