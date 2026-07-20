/* 舊版(HEAD) vs 新版(多幣別) 同資料輸出對比 — 證明既有日幣/台幣資料「數字一筆不差」
   用法: node compare-old-new.js <old.html> <new.html> [seed.json]
   seed.json 省略時用內建合成資料；可餵使用者真實匯出檔做 T9。 */
const fs = require('fs');
const crypto = require('crypto');
const { JSDOM, VirtualConsole } = require('jsdom');

const [, , OLD, NEW, SEED] = process.argv;

const builtinSeed = {
  ledgerName: 'JP2026', rate: 4.98, rateSource: '台灣銀行現金賣出', rateUpdatedAt: '2026-07-01 10:00',
  accounts: [
    { id: 'twd', name: 'TWcash', currency: 'TWD', kind: 'prepaid', initial: 3000, color: '#f59e0b' },
    { id: 'jpy', name: 'JPcash', currency: 'JPY', kind: 'prepaid', initial: 50000, color: '#34d399' },
    { id: 'icoca', name: 'ICOCA', currency: 'JPY', kind: 'prepaid', initial: 2000, color: '#60a5fa' },
    { id: 'card', name: 'Card', currency: 'JPY', kind: 'credit', initial: 0, color: '#a78bfa' },
  ],
  categories: { '飲食': ['晚餐', '早餐'], '交通': ['電鐵'], '購物': ['藥妝'], '手續費': ['信用卡手續費', 'ATM提領'] },
  txns: [
    { id: 'a1', type: 'expense', date: '2026-07-01', account: 'jpy', amount: 1234, cat: '飲食', subcat: '晚餐', item: 'izakaya' },
    { id: 'a2', type: 'expense', date: '2026-07-01', account: 'twd', amount: 777, cat: '交通', subcat: '電鐵', item: 'MRT' },
    { id: 'a3', type: 'expense', date: '2026-07-02', account: 'card', amount: 8888, cat: '購物', subcat: '藥妝', item: 'drug', gid: 'g1' },
    { id: 'a4', type: 'expense', date: '2026-07-02', account: 'card', amount: 275, cat: '飲食', subcat: '早餐', item: 'cafe', gid: 'g1' },
    { id: 'a5', type: 'expense', date: '2026-07-03', account: 'icoca', amount: 3333, cat: '交通', subcat: '電鐵', item: 'JR' },
    { id: 'a6', type: 'expense', date: '2026-07-03', account: 'jpy', amount: 1, cat: '飲食', item: 'edge1' },
    { id: 'a7', type: 'expense', date: '2026-07-03', account: 'jpy', amount: 2.49, cat: '飲食', item: 'edge-round' },
    { id: 'a8', type: 'expense', date: '2026-07-04', account: 'twd', amount: 105, cat: '手續費', subcat: 'ATM提領', item: 'fee' },
    { id: 'b1', type: 'topup', date: '2026-07-02', from: 'twd', to: 'jpy', amount: 1000, toAmount: 4980 },
    { id: 'b2', type: 'topup', date: '2026-07-03', from: 'jpy', to: 'icoca', amount: 3000 },
  ],
  members: [{ id: 'm1', name: 'A' }, { id: 'm2', name: 'B' }, { id: 'm3', name: 'C' }],
  splits: [
    { id: 's1', date: '2026-07-01', item: 'hotel', amount: 30000, currency: 'JPY', rate: 4.98, mode: 'equal', participants: ['m1', 'm2', 'm3'], payerId: 'm1', amounts: {}, shares: {} },
    { id: 's2', date: '2026-07-02', item: 'flight', amount: 16000, currency: 'TWD', rate: 4.98, mode: 'amount', amounts: { m1: 6000, m2: 5000, m3: 5000 }, payerId: 'm2', shares: {} },
    { id: 's3', date: '2026-07-03', item: 'taxi', amount: 777, currency: 'JPY', rate: 5.05, mode: 'shares', shares: { m1: 1, m2: 2 }, payerId: 'm3', amounts: {} },
  ],
  schemaVersion: 2
};
const seed = SEED ? JSON.parse(fs.readFileSync(SEED, 'utf8')) : builtinSeed;

function boot(file) {
  const vc = new VirtualConsole();
  const logs = [];
  vc.on('log', (...a) => logs.push(a.join(' ')));
  vc.on('error', (...a) => logs.push('ERR ' + a.join(' ')));
  vc.on('jsdomError', e => logs.push('JSDOMERR ' + (e && e.message)));
  const dom = new JSDOM(fs.readFileSync(file, 'utf8'), {
    url: 'https://guuzenshop.github.io/jp-trip-ledger/',
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.localStorage.setItem('jp_trip_ledger_v2', JSON.stringify(seed));
      w.alert = () => {}; w.confirm = () => true; w.prompt = () => null; w.scrollTo = () => {};
    }
  });
  return { w: dom.window, logs };
}

// 取出所有「可比對的輸出」
const PROBE = `(function(){
  const out = {};
  out.totals = computeTotals();
  out.acctStats = data.accounts.map(a => ({ id: a.id, cur: a.currency, s: acctStats(a.id), fmtBal: fmt(acctStats(a.id).balance, a.currency), twd: toTWD(acctStats(a.id).balance, a.currency) }));
  out.chartCat = chartRows('cat');
  out.chartSub = chartRows('sub');
  out.chartPay = chartRows('pay');
  out.txnTWD = data.txns.map(t => ({ id: t.id, v: txnTWDValue(t) }));
  out.settleTWD = computeSettlement(data.members, data.splits, 'TWD');
  out.settleJPY = computeSettlement(data.members, data.splits, 'JPY');
  const s = computeTripSummary();
  out.summary = { days: s.days, count: s.count, avgTWD: s.avgTWD, totalTWD: s.totals.totalTWD, catRows: s.catRows, accts: s.accts };
  out.dom = {
    total: document.getElementById('total-twd').textContent,
    breakdown: document.getElementById('total-breakdown').textContent,
    rateBig: document.getElementById('rate-big').textContent,
    accounts: document.getElementById('accounts').textContent.replace(/\\s+/g,' ').trim(),
    txnlist: (document.getElementById('txn-list')||document.body).textContent.replace(/\\s+/g,' ').trim().slice(0, 4000),
    splitList: (document.getElementById('split-list')||{textContent:''}).textContent.replace(/\\s+/g,' ').trim(),
    settleBox: (document.getElementById('settle-box')||{textContent:''}).textContent.replace(/\\s+/g,' ').trim(),
  };
  // ⚠️ 2026-07-20 修：原本寫成 (typeof buildCSVRows==='function') ? 'n/a' : 'n/a'
  //    ——兩個分支同值，等於這個 probe 從來沒有比對過任何東西（與第五輪 M-3「靜默掉案」同類缺陷）。
  //    改成真的攔截 exportCSV 的輸出；抓不到時明確標記 UNAVAILABLE，不得假裝比對過。
  out.csv = (function(){
    if (typeof exportCSV !== 'function' || typeof download !== 'function') return 'UNAVAILABLE:no-exportCSV';
    let cap = null;
    const orig = download;
    try {
      download = function(n, c){ cap = c; };
      exportCSV();
    } catch (e) { return 'UNAVAILABLE:threw:' + (e && e.message); }
    finally { download = orig; }
    return cap == null ? 'UNAVAILABLE:not-captured' : cap;
  })();
  return JSON.stringify(out);
})()`;

const A = boot(OLD), B = boot(NEW);
const oldOut = JSON.parse(A.w.eval(PROBE));
const newOut = JSON.parse(B.w.eval(PROBE));

// 多幣別之前的舊版沒有 byCur → 僅比對共同欄位。
// 但基準若是「已有多幣別的版本」（例如拿上一個 release 比對本次修改），byCur 兩邊都在，
// 就必須真的比對它，否則會少驗一整欄；無條件刪除還會誤報成 "object vs undefined"。
if (!oldOut.totals || oldOut.totals.byCur === undefined) delete newOut.totals.byCur;

let diffs = [];
function walk(a, b, p) {
  if (typeof a !== typeof b) { diffs.push(`${p}: type ${typeof a} vs ${typeof b}`); return; }
  if (a === null || b === null || typeof a !== 'object') {
    if (a !== b) diffs.push(`${p}: OLD=${JSON.stringify(a)} NEW=${JSON.stringify(b)}`);
    return;
  }
  const keys = new Set(Object.keys(a).concat(Object.keys(b)));
  for (const k of keys) walk(a[k], b[k], p ? p + '.' + k : k);
}
walk(oldOut, newOut, '');

const md5 = f => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');
console.log('OLD : ' + OLD + '  md5=' + md5(OLD));
console.log('NEW : ' + NEW + '  md5=' + md5(NEW));
console.log('SEED: ' + (SEED || '(builtin synthetic)') + '  txns=' + (seed.txns || []).length + ' accounts=' + (seed.accounts || []).length + ' splits=' + (seed.splits || []).length);
console.log('probe keys compared: ' + Object.keys(oldOut).join(', '));
const oldErr = A.logs.filter(l => l.startsWith('ERR') || l.startsWith('JSDOMERR'));
const newErr = B.logs.filter(l => l.startsWith('ERR') || l.startsWith('JSDOMERR'));
console.log('old runtime errors: ' + (oldErr.length ? oldErr.slice(0, 3).join(' | ') : 'none'));
console.log('new runtime errors: ' + (newErr.length ? newErr.slice(0, 3).join(' | ') : 'none'));
console.log('---');
if (!diffs.length) console.log('RESULT: IDENTICAL - 0 differences');
else { console.log('RESULT: ' + diffs.length + ' DIFFERENCES'); diffs.slice(0, 40).forEach(d => console.log(' * ' + d)); }
process.exit(diffs.length || newErr.length ? 1 : 0);
