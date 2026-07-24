/* 2026-07-24 兩個新功能的 jsdom E2E（走真實 UI 路徑）：
   S 系列 = ☑️ 選取模式「全選 / 全不選」+ 批量刪除（問題1）
   C 系列 = 🧹 只清除明細（保留設定）+ ✨ 用目前設定開新帳本（問題2）
   直接讀正式 index.html 原始碼；confirm 一律回 true（雙重確認自動通過）。 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const APP = process.argv[2];
const html = fs.readFileSync(APP, 'utf8');

let pass = 0, fail = 0; const fails = [];
const ok = (c, n) => { if (c) pass++; else { fail++; fails.push(n); } };
const eq = (a, b, n) => ok(a === b, `${n} [got=${JSON.stringify(a)} want=${JSON.stringify(b)}]`);

const PLAN = {
  S1: 3, S2: 2, S3: 2, S4: 2, S5: 5, S6: 2,          // 選取/全選/批量刪除 小計 16
  C1: 7, C2: 3, C3: 8,                                // 只清除明細 / 開新帳本 小計 18
  R1: 3, R2: 2, R3: 2, R4: 2, R5: 3, R6: 2, R7: 2, R8: 3,   // 帳戶拖曳排序 小計 19
};
const RAN = {};
function scenario(name, fn) {
  const want = PLAN[name];
  const p0 = pass, f0 = fail;
  let threw = null;
  try { fn(); } catch (e) { threw = e; }
  const ran = (pass - p0) + (fail - f0);
  RAN[name] = ran;
  if (want == null) { fail++; fails.push(`${name} 未登錄於 PLAN`); return; }
  if (threw) {
    const missing = Math.max(0, want - ran);
    fail += Math.max(1, missing);
    fails.push(`${name} THREW: ${threw && threw.message}` + (missing ? `（${missing} 條未執行）` : ''));
    console.log('!! ' + name + ': ' + (threw && threw.stack || threw));
    return;
  }
  if (ran !== want) { fail++; fails.push(`${name} 斷言數 ${ran} ≠ PLAN 宣告 ${want}`); }
}

const seed = {
  ledgerName: '清除測試', rate: 5, rates: { JPY: 5 }, rateSource: '手動設定', rateUpdatedAt: null,
  accounts: [
    { id: 'jpy', name: '日幣現金', currency: 'JPY', kind: 'prepaid', initial: 10000, color: '#34d399' },
    { id: 'icoca', name: 'ICOCA', currency: 'JPY', kind: 'prepaid', initial: 5000, color: '#60a5fa' },
    { id: 'twd', name: '台幣現金', currency: 'TWD', kind: 'prepaid', initial: 3000, color: '#f59e0b' }
  ],
  categories: { '飲食': ['拉麵', '咖啡'], '交通': ['電鐵'], '購物': ['衣服'] },
  members: [{ id: 'm1', name: '我' }, { id: 'm2', name: '朋友' }],
  txns: [
    { id: 'e1', type: 'expense', date: '2026-07-17', account: 'jpy', amount: 1000, cat: '飲食', subcat: '拉麵', item: '拉麵' },
    { id: 'e2', type: 'expense', date: '2026-07-17', account: 'icoca', amount: 500, cat: '交通', subcat: '電鐵', item: '電鐵' },
    { id: 'e3', type: 'expense', date: '2026-07-18', account: 'twd', amount: 300, cat: '飲食', subcat: '咖啡', item: '咖啡' },
    { id: 't1', type: 'topup', date: '2026-07-17', from: 'twd', to: 'jpy', amount: 3000, toAmount: 15000 },
    { id: 't2', type: 'topup', date: '2026-07-18', from: 'twd', to: 'icoca', amount: 1000, toAmount: 5000 }
  ],
  splits: [], schemaVersion: 2
};

function boot() {
  const vc = new VirtualConsole();
  const logs = [];
  vc.on('log', (...a) => logs.push(a.join(' ')));
  vc.on('error', (...a) => logs.push('ERR ' + a.join(' ')));
  vc.on('jsdomError', e => logs.push('JSDOMERR ' + (e && e.message)));
  const dom = new JSDOM(html, {
    url: 'https://guuzenshop.github.io/jp-trip-ledger/?test=1',
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      try { w.localStorage.setItem('jp_trip_ledger_v2', JSON.stringify(seed)); } catch (e) {}
      w.alert = () => {}; w.confirm = () => true; w.prompt = () => null; w.scrollTo = () => {};
    }
  });
  return { w: dom.window, logs };
}
const noErr = (logs, n) => ok(logs.filter(l => l.startsWith('ERR') || l.startsWith('JSDOMERR')).length === 0,
  n + ' 無執行期錯誤: ' + logs.filter(l => l.startsWith('ERR') || l.startsWith('JSDOMERR')).slice(0, 2).join(' | '));
const gateOK = (logs, n) => ok(logs.some(l => l.indexOf('自測 PASS') >= 0) && !logs.some(l => l.indexOf('自測 FAIL') >= 0),
  n + ' ?test=1 硬 gate 通過');

/* S1: 全選 = 選取目前看得到的每一筆（無篩選 → 5 筆），batch bar 出現「刪除」 */
scenario('S1', () => {
  const { w, logs } = boot();
  eq(w.eval('data.txns.length'), 5, 'S1 seed 載入 5 筆');
  w.eval('toggleSelectMode(); selectAllVisible();');
  eq(w.eval('selectedIds.size'), 5, 'S1 全選 → 5 筆全中');
  ok(w.eval("document.getElementById('batch-bar').innerHTML").indexOf('刪除') >= 0, 'S1 已選 → 出現刪除鈕');
  w.close();
});

/* S2: 全選只作用於「類型篩選」下看得到的筆（消費 = 3 筆） */
scenario('S2', () => {
  const { w } = boot();
  w.eval("toggleSelectMode(); filter='expense'; renderTxns(); selectAllVisible();");
  eq(w.eval('selectedIds.size'), 3, 'S2 消費篩選下全選 → 3 筆');
  ok(w.eval('selectedTxns().every(t=>t.type===\"expense\")'), 'S2 選中的全是消費');
  w.close();
});

/* S3: 全選只作用於「日期篩選」下看得到的筆（07-17 = e1,e2,t1 = 3 筆） */
scenario('S3', () => {
  const { w } = boot();
  w.eval("toggleSelectMode(); dateFilter='2026-07-17'; renderTxns(); selectAllVisible();");
  eq(w.eval('selectedIds.size'), 3, 'S3 07-17 篩選下全選 → 3 筆');
  ok(w.eval("selectedTxns().every(t=>t.date==='2026-07-17')"), 'S3 選中的全在 07-17');
  w.close();
});

/* S4: 全選 → 批量刪除 → 該範圍全清（走真實 batchDelete + confirmBatchModal） */
scenario('S4', () => {
  const { w, logs } = boot();
  w.eval('toggleSelectMode(); selectAllVisible(); batchDelete(); confirmBatchModal();');
  eq(w.eval('data.txns.length'), 0, 'S4 全選後批量刪除 → 明細清空');
  gateOK(logs, 'S4');
  w.close();
});

/* S5: batch bar 狀態機 —— 選取模式即使 0 筆也顯示「全選」、不顯示「刪除」；選到 1 筆才有「刪除」 */
scenario('S5', () => {
  const { w } = boot();
  w.eval('toggleSelectMode();');
  const bar0 = w.eval("document.getElementById('batch-bar').innerHTML");
  ok(bar0.indexOf('全選') >= 0, 'S5 0 筆時仍顯示全選');
  ok(bar0.indexOf('刪除') < 0, 'S5 0 筆時不顯示刪除');
  ok(w.eval("document.getElementById('batch-bar').className").indexOf('show') >= 0, 'S5 選取模式 bar 可見');
  w.eval("onRowSelect('e1', true);");
  const bar1 = w.eval("document.getElementById('batch-bar').innerHTML");
  ok(bar1.indexOf('刪除') >= 0, 'S5 選 1 筆 → 出現刪除');
  ok(bar1.indexOf('已選 1 筆') >= 0, 'S5 顯示已選筆數');
  w.close();
});

/* S6: 「完成」= 真正退出選取模式（selectMode=false、bar 收起） */
scenario('S6', () => {
  const { w } = boot();
  w.eval('toggleSelectMode();');
  ok(w.eval('selectMode') === true, 'S6 進入選取模式');
  w.eval('exitSelectMode();');
  ok(w.eval('selectMode') === false && w.eval("document.getElementById('batch-bar').className").indexOf('show') < 0,
    'S6 完成 → 退出選取模式且 bar 收起');
  w.close();
});

/* C1: 只清除明細 → txns/splits 清空、帳戶/分類/成員/帳本名全保留 */
scenario('C1', () => {
  const { w, logs } = boot();
  w.eval("data.splits = [{ id:'s1', date:'2026-07-17', payerId:'m1', participants:['m1','m2'], currency:'JPY' }];");
  const catKeysBefore = w.eval('JSON.stringify(Object.keys(data.categories).sort())');
  const acctIdsBefore = w.eval('JSON.stringify(data.accounts.map(a=>a.id))');
  w.eval('clearEntriesOnly();');
  eq(w.eval('data.txns.length'), 0, 'C1 明細清空');
  eq(w.eval('data.splits.length'), 0, 'C1 分帳費用清空');
  eq(w.eval('JSON.stringify(data.accounts.map(a=>a.id))'), acctIdsBefore, 'C1 帳戶原封保留');
  eq(w.eval('JSON.stringify(Object.keys(data.categories).sort())'), catKeysBefore, 'C1 消費分類原封保留');
  eq(w.eval('data.members.length'), 2, 'C1 同行成員保留');
  eq(w.eval('data.ledgerName'), '清除測試', 'C1 帳本名保留');
  gateOK(logs, 'C1');
  w.close();
});

/* C2: 只清除明細只動目前這本 —— 另一本的明細不受影響 */
scenario('C2', () => {
  const { w } = boot();
  const id1 = w.eval('data.id');
  // 建第二本（空白），加一筆到它裡面
  w.eval("document.getElementById('lg-new-name').value='第二本'; toggleLedgerAdd(true); " +
    "document.querySelector('input[name=\"lgnew\"][value=\"blank\"]').checked=true; createLedgerFromForm();");
  const id2 = w.eval('data.id');
  ok(id2 !== id1, 'C2 已切換到新建的第二本');
  w.eval("data.txns.push({id:'z1', type:'expense', date:'2026-07-20', account:'twd', amount:99, cat:'飲食', subcat:'', item:'測試'}); save();");
  // 切回第一本清明細
  w.eval("switchLedger('" + id1 + "'); clearEntriesOnly();");
  eq(w.eval('data.txns.length'), 0, 'C2 第一本已清空');
  w.eval("switchLedger('" + id2 + "');");
  eq(w.eval('data.txns.length'), 1, 'C2 第二本明細不受影響');
  w.close();
});

/* C3: 用目前設定開新帳本 → 預選「複製設定」、建立後新本沿用帳戶(歸零)/分類、明細空白，舊本原封 */
scenario('C3', () => {
  const { w, logs } = boot();
  const id1 = w.eval('data.id');
  const srcCatKeys = w.eval('JSON.stringify(Object.keys(data.categories).sort())');
  const srcAcctNames = w.eval('JSON.stringify(data.accounts.map(a=>a.name))');
  w.eval('newLedgerFromCurrentSettings();');
  ok(w.eval("document.querySelector('input[name=\"lgnew\"][value=\"copy\"]').checked") === true, 'C3 預選複製設定');
  ok(w.eval("document.getElementById('ledger-modal').classList.contains('show')") === true, 'C3 帳本 modal 已開');
  ok(w.eval("document.getElementById('ledger-add').style.display") !== 'none', 'C3 新增表單已展開');
  w.eval("document.getElementById('lg-new-name').value='新旅程'; createLedgerFromForm();");
  eq(w.eval('data.txns.length'), 0, 'C3 新帳本明細空白');
  eq(w.eval('JSON.stringify(data.accounts.map(a=>a.name))'), srcAcctNames, 'C3 新帳本沿用帳戶名');
  ok(w.eval('data.accounts.every(a=>a.initial===0)'), 'C3 新帳本帳戶餘額歸零');
  eq(w.eval('JSON.stringify(Object.keys(data.categories).sort())'), srcCatKeys, 'C3 新帳本沿用分類');
  eq(w.eval("store.ledgers.find(l=>l.id==='" + id1 + "').txns.length"), 5, 'C3 舊帳本明細原封保留');
  w.close();
});

/* ── R 系列：帳戶管理拖曳排序（jsdom 無法模擬真實 pointer 手勢，改測 commit 核心 + DOM 結構）── */

/* R1: renderAcctEditor 每列有 data-id 與拖曳把手 ⠿ */
scenario('R1', () => {
  const { w } = boot();
  w.eval('renderAcctEditor();');
  eq(w.eval("document.querySelectorAll('#acct-editor .acct-edit').length"), 3, 'R1 三列帳戶');
  ok(w.eval("[...document.querySelectorAll('#acct-editor .acct-edit')].every(r=>r.dataset.id)"), 'R1 每列有 data-id');
  ok(w.eval("[...document.querySelectorAll('#acct-editor .acct-edit')].every(r=>r.querySelector('.drag-handle'))"), 'R1 每列有拖曳把手 ⠿');
  w.close();
});

/* R2: commitAcctOrder 依 DOM id 順序重排 data.accounts */
scenario('R2', () => {
  const { w } = boot();
  const rev = JSON.parse(w.eval('JSON.stringify(data.accounts.map(a=>a.id))')).reverse();
  w.eval('commitAcctOrder(' + JSON.stringify(rev) + ');');
  eq(w.eval('JSON.stringify(data.accounts.map(a=>a.id))'), JSON.stringify(rev), 'R2 依 id 順序重排');
  eq(w.eval('data.accounts.length'), 3, 'R2 帳戶數不變');
  w.close();
});

/* R3: 拖曳前「未存的編輯」先被 flush 保存到正確帳戶，再套用新順序 */
scenario('R3', () => {
  const { w } = boot();
  w.eval('renderAcctEditor();');
  const id0 = w.eval('data.accounts[0].id');
  w.eval("document.querySelector('#acct-editor input[data-k=\"name\"]').value = '改名測試';");
  const rev = JSON.parse(w.eval('JSON.stringify(data.accounts.map(a=>a.id))')).reverse();
  w.eval('commitAcctOrder(' + JSON.stringify(rev) + ');');
  eq(w.eval("data.accounts.find(a=>a.id==='" + id0 + "').name"), '改名測試', 'R3 未存改名保存到正確帳戶');
  eq(w.eval('data.accounts[data.accounts.length-1].id'), id0, 'R3 該帳戶移到最後一列');
  w.close();
});

/* R4: ▲▼ moveAccount 仍可用（零回歸） */
scenario('R4', () => {
  const { w } = boot();
  w.eval('renderAcctEditor();');
  const ids = JSON.parse(w.eval('JSON.stringify(data.accounts.map(a=>a.id))'));
  w.eval('moveAccount(0,1);');
  eq(w.eval('data.accounts[0].id'), ids[1], 'R4 下移：0↔1 對調（前）');
  eq(w.eval('data.accounts[1].id'), ids[0], 'R4 下移：0↔1 對調（後）');
  w.close();
});

/* R5: commitAcctOrder 對缺漏 id 穩健（絕不遺失帳戶、不重複） */
scenario('R5', () => {
  const { w } = boot();
  const ids = JSON.parse(w.eval('JSON.stringify(data.accounts.map(a=>a.id))'));
  w.eval("commitAcctOrder(['" + ids[2] + "']);");
  eq(w.eval('data.accounts.length'), 3, 'R5 缺 id 仍不遺失帳戶');
  eq(w.eval('(new Set(data.accounts.map(a=>a.id))).size'), 3, 'R5 無重複');
  eq(w.eval('data.accounts[0].id'), ids[2], 'R5 給定 id 排最前、其餘保原序補回');
  w.close();
});

/* R6: 重排後 save → 舊格式鏡射（jp_trip_ledger_v2）保留新順序（持久化） */
scenario('R6', () => {
  const { w } = boot();
  const rev = JSON.parse(w.eval('JSON.stringify(data.accounts.map(a=>a.id))')).reverse();
  w.eval('commitAcctOrder(' + JSON.stringify(rev) + '); save();');
  const mirror = JSON.parse(w.eval("localStorage.getItem('jp_trip_ledger_v2')"));
  eq(JSON.stringify(mirror.accounts.map(a => a.id)), JSON.stringify(rev), 'R6 儲存後鏡射保留新順序');
  eq(mirror.accounts.length, 3, 'R6 鏡射帳戶數正確');
  w.close();
});

/* R7: enableAcctReorder 只綁一次（#acct-editor 常駐元素）—— 多次重繪不累積 handler，commit 仍正常 */
scenario('R7', () => {
  const { w } = boot();
  w.eval('renderAcctEditor(); renderAcctEditor(); renderAcctEditor();');
  ok(w.eval("document.getElementById('acct-editor')._acctReorderBound === true"), 'R7 只綁一次守衛');
  const rev = JSON.parse(w.eval('JSON.stringify(data.accounts.map(a=>a.id))')).reverse();
  w.eval('commitAcctOrder(' + JSON.stringify(rev) + ');');
  eq(w.eval('JSON.stringify(data.accounts.map(a=>a.id))'), JSON.stringify(rev), 'R7 多次重繪後 commit 仍正常');
  w.close();
});

/* R8: commitAcctOrder 對「重複 id」穩健（去重：集合不變、不重複、首個 dup 生效後續略過）
       —— 補 Claude Code 2026-07-24 審查點名的覆蓋缺口（程式碼本已正確，此處加專測釘死） */
scenario('R8', () => {
  const { w } = boot();
  const ids = JSON.parse(w.eval('JSON.stringify(data.accounts.map(a=>a.id))')); // [jpy, icoca, twd]
  // 含重複 + 重排：[twd, twd, jpy, icoca] → 去重後 [twd, jpy, icoca]
  w.eval("commitAcctOrder(['" + ids[2] + "','" + ids[2] + "','" + ids[0] + "','" + ids[1] + "']);");
  eq(w.eval('data.accounts.length'), 3, 'R8 重複 id 不增生帳戶');
  eq(w.eval('(new Set(data.accounts.map(a=>a.id))).size'), 3, 'R8 無重複帳戶');
  eq(w.eval('JSON.stringify(data.accounts.map(a=>a.id))'), JSON.stringify([ids[2], ids[0], ids[1]]), 'R8 去重後順序正確（首個 dup 生效、後續略過）');
  w.close();
});

console.log('\n=== verify-clear-select ===');
console.log(`PASS ${pass} / FAIL ${fail}`);
console.log('逐案斷言數:', JSON.stringify(RAN));
if (fails.length) { console.log('\nFAILS:'); fails.forEach(f => console.log(' - ' + f)); }
process.exit(fail ? 1 : 0);
