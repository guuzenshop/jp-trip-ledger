/* Phase 2 多帳本 jsdom E2E：遷移／切換隔離／新增(空白·複製)／改名·封存·刪除／匯入兩模式／
   跨 session 持久化／舊版鏡射相容＋離線舊版救援 */
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

const legacy = {
  ledgerName: '奈良獨旅', rate: 4.9261, rateSource: '台灣銀行現金賣出', rateUpdatedAt: '2026-07-01 10:00',
  accounts: [
    { id: 'jpy', name: '日幣現金', currency: 'JPY', kind: 'prepaid', initial: 20000, color: '#34d399' },
    { id: 'twd', name: '台幣現金', currency: 'TWD', kind: 'prepaid', initial: 5000, color: '#f59e0b' },
  ],
  categories: { '飲食': ['晚餐'], '交通': ['電鐵'] },
  txns: [
    { id: 'a1', type: 'expense', date: '2026-07-01', account: 'jpy', amount: 1234, cat: '飲食', item: 'x' },
    { id: 'a2', type: 'expense', date: '2026-07-02', account: 'twd', amount: 500, cat: '交通', item: 'y' },
  ],
  members: [{ id: 'm1', name: 'A' }], splits: [], schemaVersion: 2
};

// storage 可跨實例傳遞：{key: value} 形式注入
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
const dump = w => ({ v3: w.localStorage.getItem('jp_trip_ledger_v3'), v2: w.localStorage.getItem('jp_trip_ledger_v2') });
const noErr = (logs, n) => ok(logs.filter(l => l.startsWith('ERR') || l.startsWith('JSDOMERR')).length === 0,
  n + ' 無執行期錯誤: ' + logs.filter(l => l.startsWith('ERR') || l.startsWith('JSDOMERR')).slice(0, 2).join(' | '));

/* L1: 舊單一帳本 → 自動包成第一本，數字與名稱不變 */
scenario('L1', () => {
  const { w, logs } = boot({ jp_trip_ledger_v2: JSON.stringify(legacy) });
  eq(w.eval('store.ledgers.length'), 1, 'L1 舊資料包成 1 本');
  eq(w.eval('data.ledgerName'), '奈良獨旅', 'L1 帳本名保留');
  eq(w.eval('data.id === store.activeLedgerId'), true, 'L1 data 指向 active 帳本');
  ok(/^[a-z0-9]+$/.test(w.eval('data.id')), 'L1 自動配發帳本 id');
  eq(w.eval('data.txns.length'), 2, 'L1 明細筆數不變');
  eq(w.eval('computeTotals().totalTWD'), 500 + 1234 / 4.9261, 'L1 總額與舊版算式相同');
  eq(w.eval("document.getElementById('app-title-text').textContent"), '✈️ 奈良獨旅', 'L1 標題顯示帳本名');
  eq(w.eval('data.rates.JPY'), 4.9261, 'L1 多幣別遷移仍生效');
  noErr(logs, 'L1');
  w.close();
});

/* L2: 新增空白帳本 → 切換 → 兩本資料完全隔離 */
scenario('L2', () => {
  const { w, logs } = boot({ jp_trip_ledger_v2: JSON.stringify(legacy) });
  const firstId = w.eval('data.id');
  w.eval("openLedgerModal(); toggleLedgerAdd(true); document.getElementById('lg-new-name').value='東京2027'; createLedgerFromForm();");
  eq(w.eval('store.ledgers.length'), 2, 'L2 新增後 2 本');
  eq(w.eval('data.ledgerName'), '東京2027', 'L2 自動切換到新帳本');
  eq(w.eval('data.txns.length'), 0, 'L2 新帳本沒有明細');
  eq(w.eval('data.accounts.length'), 5, 'L2 新帳本用預設帳戶');
  eq(w.eval('data.rates.JPY'), 4.9261, 'L2 新帳本沿用匯率表');
  // 在新帳本記一筆 → 舊帳本不受影響
  w.eval("data.txns.push({id:'n1',type:'expense',date:'2026-07-05',account:data.accounts[1].id,amount:999,cat:'飲食',item:'新帳本消費'}); save(); render();");
  eq(w.eval(`store.ledgers.find(l=>l.id==='${firstId}').txns.length`), 2, 'L2 原帳本明細不受影響');
  eq(w.eval('data.txns.length'), 1, 'L2 新帳本記到自己身上');
  // 切回去
  w.eval(`switchLedger('${firstId}')`);
  eq(w.eval('data.ledgerName'), '奈良獨旅', 'L2 切回原帳本');
  eq(w.eval('data.txns.length'), 2, 'L2 切回後明細正確');
  eq(w.eval("document.getElementById('app-title-text').textContent"), '✈️ 奈良獨旅', 'L2 標題跟著切換');
  eq(w.eval('computeTotals().totalTWD'), 500 + 1234 / 4.9261, 'L2 切回後總額不變');
  noErr(logs, 'L2');
  w.close();
});

/* L3: 「複製目前這本的設定」→ 帳戶/分類/成員複製、餘額歸零、明細不複製 */
scenario('L3', () => {
  const { w, logs } = boot({ jp_trip_ledger_v2: JSON.stringify(legacy) });
  w.eval("openLedgerModal(); toggleLedgerAdd(true); document.getElementById('lg-new-name').value='大阪2028';" +
         "document.querySelector('input[name=\"lgnew\"][value=\"copy\"]').checked=true; createLedgerFromForm();");
  eq(w.eval('data.ledgerName'), '大阪2028', 'L3 建立並切換');
  eq(w.eval('data.accounts.map(a=>a.name).join(",")'), '日幣現金,台幣現金', 'L3 帳戶複製');
  eq(w.eval('data.accounts.every(a=>a.initial===0)'), true, 'L3 帳戶初始金額歸零');
  // 註：load 會自動補上「手續費」大項（既有遷移），複製後同樣帶著
  eq(w.eval('Object.keys(data.categories).join(",")'), '飲食,交通,手續費', 'L3 分類複製');
  eq(w.eval('data.members.length'), 1, 'L3 成員複製');
  eq(w.eval('data.txns.length'), 0, 'L3 明細不複製');
  noErr(logs, 'L3');
  w.close();
});

/* L4: 切換帳本清暫態 */
scenario('L4', () => {
  const { w, logs } = boot({ jp_trip_ledger_v2: JSON.stringify(legacy) });
  const firstId = w.eval('data.id');
  // 六維篩選（星期/日期/大項/小項/支付/幣別）：帳戶 id 與分類名都綁上一本，換帳本必須全清
  w.eval("selectedIds.add('a1'); analysisFilter={weekdays:[5],dates:['2026-07-01'],cats:['飲食'],subs:['飲食\\u0000拉麵'],accounts:['a1'],currencies:['JPY']}; dateFilter='2026-07-01'; sortMode='amt_desc'; settleCur='JPY'; editingId='a1';");
  w.eval("openLedgerModal(); toggleLedgerAdd(true); document.getElementById('lg-new-name').value='暫態測試'; createLedgerFromForm();");
  eq(w.eval('selectedIds.size'), 0, 'L4 清 selectedIds');
  eq(w.eval('JSON.stringify(analysisFilter)'), '{"weekdays":[],"dates":[],"cats":[],"subs":[],"accounts":[],"currencies":[]}', 'L4 清分析篩選（六維全清）');
  eq(w.eval('ANALYSIS_DIMS.every(k=>Array.isArray(analysisFilter[k])&&analysisFilter[k].length===0)'), true, 'L4 分析篩選每個維度都是空陣列');
  eq(w.eval('dateFilter'), 'all', 'L4 清日期篩選');
  eq(w.eval('sortMode'), 'date_desc', 'L4 排序回預設');
  eq(w.eval('settleCur'), 'TWD', 'L4 結算幣別回台幣');
  eq(w.eval('editingId'), null, 'L4 清編輯中狀態');
  eq(w.eval('selectMode'), false, 'L4 退出選取模式');
  w.eval(`switchLedger('${firstId}')`);
  noErr(logs, 'L4');
  w.close();
});

/* L5: 改名 / 封存 / 刪除（兩段式確認、最後一本不可刪、封存目前這本自動換） */
scenario('L5', () => {
  const { w, logs } = boot({ jp_trip_ledger_v2: JSON.stringify(legacy) });
  const firstId = w.eval('data.id');
  // 唯一一本不可刪
  w.eval('openLedgerModal(); askDeleteLedger(data.id);');
  eq(w.eval('_lgPendingDel'), null, 'L5 唯一帳本不進入刪除確認');
  eq(w.eval('store.ledgers.length'), 1, 'L5 唯一帳本仍在');
  // 新增第二本
  w.eval("toggleLedgerAdd(true); document.getElementById('lg-new-name').value='第二本'; createLedgerFromForm();");
  const secondId = w.eval('data.id');
  // 改名
  w.eval(`renameLedger('${firstId}','奈良改名')`);
  eq(w.eval(`store.ledgers.find(l=>l.id==='${firstId}').ledgerName`), '奈良改名', 'L5 改名生效');
  // 封存目前這本 → 自動切到另一本
  w.eval(`toggleLedgerArchive('${secondId}')`);
  eq(w.eval(`store.ledgers.find(l=>l.id==='${secondId}').archived`), true, 'L5 封存標記');
  eq(w.eval('data.id'), firstId, 'L5 封存目前這本→自動切到未封存的那本');
  // 取消封存
  w.eval(`toggleLedgerArchive('${secondId}')`);
  eq(w.eval(`store.ledgers.find(l=>l.id==='${secondId}').archived`), false, 'L5 取消封存');
  // 刪除：兩段式
  w.eval(`askDeleteLedger('${secondId}')`);
  eq(w.eval('_lgPendingDel'), secondId, 'L5 進入刪除待確認');
  ok(w.eval("document.getElementById('ledger-list').textContent").indexOf('確定刪除') >= 0, 'L5 顯示 inline 確認（不用原生 confirm）');
  w.eval('cancelDeleteLedger()');
  eq(w.eval('store.ledgers.length'), 2, 'L5 取消後不刪');
  w.eval(`askDeleteLedger('${secondId}'); confirmDeleteLedger('${secondId}');`);
  eq(w.eval('store.ledgers.length'), 1, 'L5 確認後刪除');
  eq(w.eval('data.id'), firstId, 'L5 刪除後 active 正確');
  ok(!!w.localStorage.getItem('jp_trip_ledger_deleted_bak'), 'L5 刪除前留一份救援備份');
  noErr(logs, 'L5');
  w.close();
});

/* L6: 匯入 — 新增成一本 / 覆蓋這本 */
scenario('L6', () => {
  const incoming = JSON.parse(JSON.stringify(legacy));
  incoming.ledgerName = '沖繩2026';
  incoming.txns = [{ id: 'z1', type: 'expense', date: '2026-08-01', account: 'jpy', amount: 3000, cat: '飲食', item: 'oki' }];
  // 模式 A：新增成一本
  {
    const { w, logs } = boot({ jp_trip_ledger_v2: JSON.stringify(legacy) });
    const firstId = w.eval('data.id');
    w.eval(`(function(){
      const d = ${JSON.stringify(incoming)};
      const nl = normalizeLedger(sanitizeImport(d)); nl.id = genId(); nl.createdAt = today(); nl.archived = false;
      store.ledgers.push(nl); switchLedger(nl.id, true); save();
    })()`);
    eq(w.eval('store.ledgers.length'), 2, 'L6a 匯入成新帳本');
    eq(w.eval('data.ledgerName'), '沖繩2026', 'L6a 切到新帳本');
    eq(w.eval(`store.ledgers.find(l=>l.id==='${firstId}').txns.length`), 2, 'L6a 原帳本未被動到');
    ok(w.eval('data.id') !== firstId, 'L6a 新帳本 id 不同');
    noErr(logs, 'L6a');
    w.close();
  }
  // 模式 B：覆蓋目前這本（帳本 id 不變，store 內參照同步替換）
  {
    const { w, logs } = boot({ jp_trip_ledger_v2: JSON.stringify(legacy) });
    const firstId = w.eval('data.id');
    w.eval(`replaceActiveLedger(sanitizeImport(${JSON.stringify(incoming)})); save();`);
    eq(w.eval('store.ledgers.length'), 1, 'L6b 覆蓋不新增帳本');
    eq(w.eval('data.id'), firstId, 'L6b 帳本 id 維持');
    eq(w.eval('data.ledgerName'), '沖繩2026', 'L6b 內容已換');
    eq(w.eval('store.ledgers[0] === data'), true, 'L6b store 內參照同步（不會存到舊物件）');
    eq(w.eval('store.ledgers[0].txns.length'), 1, 'L6b 儲存的是新內容');
    noErr(logs, 'L6b');
    w.close();
  }
});

/* L7: 跨 session 持久化 — 關掉再開，兩本都在、active 正確 */
scenario('L7', () => {
  const { w } = boot({ jp_trip_ledger_v2: JSON.stringify(legacy) });
  w.eval("openLedgerModal(); toggleLedgerAdd(true); document.getElementById('lg-new-name').value='第二趟'; createLedgerFromForm();");
  w.eval("data.txns.push({id:'p1',type:'expense',date:'2026-09-01',account:data.accounts[0].id,amount:777,cat:'飲食',item:'persist'}); save();");
  const st = dump(w); w.close();

  const { w: w2, logs } = boot({ jp_trip_ledger_v3: st.v3, jp_trip_ledger_v2: st.v2 });
  eq(w2.eval('store.ledgers.length'), 2, 'L7 重開後兩本都在');
  eq(w2.eval('data.ledgerName'), '第二趟', 'L7 active 帳本正確');
  eq(w2.eval('data.txns.length'), 1, 'L7 新帳本明細留存');
  eq(w2.eval("store.ledgers.find(l=>l.ledgerName==='奈良獨旅').txns.length"), 2, 'L7 另一本明細留存');
  eq(w2.eval("document.getElementById('app-title-text').textContent"), '✈️ 第二趟', 'L7 標題正確');
  noErr(logs, 'L7');
  w2.close();
});

/* L8: 舊版相容 — v2 鏡射永遠是「目前這本」的單一帳本格式 */
scenario('L8', () => {
  const { w } = boot({ jp_trip_ledger_v2: JSON.stringify(legacy) });
  w.eval("openLedgerModal(); toggleLedgerAdd(true); document.getElementById('lg-new-name').value='鏡射測試'; createLedgerFromForm();");
  const st = dump(w);
  const mirror = JSON.parse(st.v2);
  eq(mirror.ledgerName, '鏡射測試', 'L8 鏡射＝目前這本');
  ok(Array.isArray(mirror.accounts) && Array.isArray(mirror.txns), 'L8 鏡射為舊版看得懂的單一帳本格式');
  ok(mirror.rate > 0, 'L8 鏡射含 legacy rate 欄位');
  ok(!Array.isArray(mirror.ledgers), 'L8 鏡射不是多帳本結構');
  w.close();
});

/* L9: 離線舊版救援 — 舊版 App 改了 v2 鏡射，新版載入時以鏡射為準 */
scenario('L9', () => {
  const { w } = boot({ jp_trip_ledger_v2: JSON.stringify(legacy) });
  w.eval("openLedgerModal(); toggleLedgerAdd(true); document.getElementById('lg-new-name').value='離線本'; createLedgerFromForm();");
  const st = dump(w); w.close();
  // 模擬「舊版 App 離線時在鏡射上多記一筆」（舊版不會動 v3）
  const mirror = JSON.parse(st.v2);
  mirror.txns.push({ id: 'off1', type: 'expense', date: '2026-10-01', account: mirror.accounts[0].id, amount: 1500, cat: '飲食', item: '離線記帳' });
  const { w: w2, logs } = boot({ jp_trip_ledger_v3: st.v3, jp_trip_ledger_v2: JSON.stringify(mirror) });
  eq(w2.eval('data.ledgerName'), '離線本', 'L9 仍是同一本');
  eq(w2.eval('data.txns.length'), 1, 'L9 救回離線新增的那筆');
  eq(w2.eval("data.txns[0].item"), '離線記帳', 'L9 內容正確');
  eq(w2.eval('store.ledgers.length'), 2, 'L9 其他帳本沒有被覆蓋');
  noErr(logs, 'L9');
  w2.close();
});

/* L11: 多分頁併發 — 別的分頁改過「其他本」不會被覆蓋 */
scenario('L11', () => {
  // 分頁1：建立第二本 B，存檔
  const { w: w1 } = boot({ jp_trip_ledger_v2: JSON.stringify(legacy) });
  const aId = w1.eval('data.id');
  w1.eval("openLedgerModal(); toggleLedgerAdd(true); document.getElementById('lg-new-name').value='B本'; createLedgerFromForm();");
  const bId = w1.eval('data.id');
  const st1 = dump(w1);

  // 分頁2：載入同一份，在 B 本記一筆後存檔（磁碟出現較新的 B′）
  const { w: w2 } = boot({ jp_trip_ledger_v3: st1.v3, jp_trip_ledger_v2: st1.v2 });
  eq(w2.eval('data.id'), bId, 'L11 分頁2 開在 B 本');
  w2.eval("data.txns.push({id:'tab2a',type:'expense',date:'2026-08-01',account:data.accounts[1].id,amount:250,cat:'飲食',item:'分頁2記的'}); save();");
  const st2 = dump(w2); w2.close();

  // 分頁1（記憶體仍是舊的）：磁碟被分頁2 更新 → 切到 A 本記一筆並存檔
  w1.localStorage.setItem('jp_trig_placeholder', '1');
  w1.localStorage.setItem('jp_trip_ledger_v3', st2.v3);
  w1.localStorage.setItem('jp_trip_ledger_v2', st2.v2);
  w1.eval(`switchLedger('${aId}', true);`);
  w1.eval("data.txns.push({id:'tab1a',type:'expense',date:'2026-08-02',account:data.accounts[0].id,amount:100,cat:'飲食',item:'分頁1記的'}); save();");

  const finalStore = JSON.parse(w1.localStorage.getItem('jp_trip_ledger_v3'));
  const B = finalStore.ledgers.find(l => l.id === bId);
  const A = finalStore.ledgers.find(l => l.id === aId);
  eq(finalStore.ledgers.length, 2, 'L11 仍是 2 本（沒有重複或遺失）');
  ok(!!B && B.txns.some(t => t.id === 'tab2a'), 'L11 分頁2 在 B 本記的那筆沒有被覆蓋掉');
  ok(!!A && A.txns.some(t => t.id === 'tab1a'), 'L11 分頁1 在 A 本記的那筆有存到');
  eq(A.txns.length, 3, 'L11 A 本＝原 2 筆＋分頁1 新增 1 筆');
  w1.close();
});

/* L12: 多分頁同一本衝突 — 保留目前版本，對方版本存成衝突備份 */
scenario('L12', () => {
  const { w: w1 } = boot({ jp_trip_ledger_v2: JSON.stringify(legacy) });
  w1.eval('save();');                       // 先落盤，讓兩個分頁共用同一個帳本 id
  const st1 = dump(w1);
  const { w: w2 } = boot({ jp_trip_ledger_v3: st1.v3, jp_trip_ledger_v2: st1.v2 });
  w2.eval("data.txns.push({id:'other',type:'expense',date:'2026-08-03',account:data.accounts[0].id,amount:88,cat:'飲食',item:'對方版本'}); save();");
  const st2 = dump(w2); w2.close();

  w1.localStorage.setItem('jp_trip_ledger_v3', st2.v3);
  w1.eval("data.txns.push({id:'mine',type:'expense',date:'2026-08-04',account:data.accounts[0].id,amount:99,cat:'飲食',item:'我的版本'}); save();");
  const finalStore = JSON.parse(w1.localStorage.getItem('jp_trip_ledger_v3'));
  eq(finalStore.ledgers.length, 1, 'L12 仍是 1 本');
  ok(finalStore.ledgers[0].txns.some(t => t.id === 'mine'), 'L12 保留目前分頁的版本');
  const bak = w1.localStorage.getItem('jp_trip_ledger_conflict_bak');
  const arr = bak ? JSON.parse(bak) : null;
  ok(Array.isArray(arr) && arr.length === 1, 'L12 衝突備份為陣列（可累積多份，不互相覆蓋）');
  ok(!!arr && arr[arr.length - 1].txns.some(t => t.id === 'other'), 'L12 對方版本存成衝突備份（可救回）');
  // 還原入口：可把衝突版本救成新帳本
  w1.eval('openLedgerModal(); restoreConflictBak();');
  eq(w1.eval('store.ledgers.length'), 2, 'L12 衝突備份可還原成新帳本');
  ok(w1.eval('data.ledgerName').indexOf('衝突備份') >= 0, 'L12 還原後帳本名標示衝突備份');
  ok(w1.eval("data.txns.some(t => t.id === 'other')"), 'L12 還原內容正確');
  w1.close();
});

/* L13: 切帳本清 _inlineEditId 與修剪 jp_expanded_gids */
scenario('L13', () => {
  const seed = JSON.parse(JSON.stringify(legacy));
  seed.txns[0].gid = 'g1'; seed.txns[1].gid = 'g1';
  const { w, logs } = boot({ jp_trip_ledger_v2: JSON.stringify(seed), jp_expanded_gids: JSON.stringify(['g1', 'ghost']) });
  w.eval("_inlineEditId = 'a1';");
  w.eval("openLedgerModal(); toggleLedgerAdd(true); document.getElementById('lg-new-name').value='另一本'; createLedgerFromForm();");
  eq(w.eval('_inlineEditId'), null, 'L13 切帳本清行內編輯狀態');
  eq(w.localStorage.getItem('jp_expanded_gids'), '[]', 'L13 新帳本沒有這些 gid → 全部修剪');
  noErr(logs, 'L13');
  w.close();
});

/* L10: 內建自測在多帳本環境仍全綠 */
scenario('L10', () => {
  const { w, logs } = boot({ jp_trip_ledger_v2: JSON.stringify(legacy) });
  const st = logs.find(l => l.indexOf('PASS') >= 0) || '';
  ok(/FAIL 0$/.test(st.trim()), 'L10 內建自測全綠: ' + st);
  w.close();
});

console.log('LEDGER-E2E: PASS ' + pass + ' / FAIL ' + fail);
if (fail) { fails.forEach(f => console.log(' - ' + f)); }
process.exit(fail ? 1 : 0);
