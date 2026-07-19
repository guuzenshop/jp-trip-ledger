/* 多幣別 Phase 1 — jsdom E2E 驗證（純 ASCII 輸出，避免 CJK stdout 失真） */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM, VirtualConsole } = require('jsdom');

const APP = process.argv[2];
const html = fs.readFileSync(APP, 'utf8');
const md5 = crypto.createHash('md5').update(fs.readFileSync(APP)).digest('hex');

let pass = 0, fail = 0; const fails = [];
const ok = (c, name) => { if (c) { pass++; } else { fail++; fails.push(name); } };
const eq = (a, b, name) => ok(a === b, `${name} [got=${JSON.stringify(a)} want=${JSON.stringify(b)}]`);

function boot(seed) {
  const vc = new VirtualConsole();
  const logs = [];
  vc.on('log', (...a) => logs.push(a.join(' ')));
  vc.on('error', (...a) => logs.push('ERR ' + a.join(' ')));
  vc.on('jsdomError', e => logs.push('JSDOMERR ' + (e && e.message)));
  const dom = new JSDOM(html, {
    url: 'https://guuzenshop.github.io/jp-trip-ledger/?test=1',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      if (seed) { try { w.localStorage.setItem('jp_trip_ledger_v2', JSON.stringify(seed)); } catch (e) {} }
      w.alert = () => {}; w.confirm = () => true; w.prompt = () => null;
      w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
      w.scrollTo = () => {};
    }
  });
  return { dom, w: dom.window, logs };
}

function scenario(name, fn) {
  try { fn(); } catch (e) { fail++; fails.push(name + ' THREW: ' + (e && e.message)); console.log('!! ' + name + ' threw: ' + (e && e.stack || e)); }
}

/* ---------- S1: fresh install + built-in self-test ---------- */
scenario('S1', () => {
  const { w, logs } = boot(null);
  console.log('S1 all logs (' + logs.length + '):');
  logs.slice(0, 12).forEach(l => console.log('   | ' + String(l).slice(0, 300)));
  const selftest = logs.find(l => l.indexOf('PASS') >= 0 || l.indexOf('FAIL') >= 0) || '(no selftest log)';
  console.log('S1 selftest log: ' + selftest);
  ok(/FAIL 0$/.test(selftest.trim()), 'S1 builtin selftest all green: ' + selftest);
  const m = selftest.match(/PASS (\d+)/);
  console.log('S1 builtin case count: ' + (m ? m[1] : '?'));
  eq(w.eval('data.rates.JPY'), 4.98, 'S1 default rates.JPY');
  eq(w.eval('data.rate'), 4.98, 'S1 legacy mirror kept');
  eq(w.eval('typeof data.rates.TWD'), 'undefined', 'S1 no TWD key in rates');
  eq(w.eval("document.getElementById('rate-big').textContent"),
     '1 元台幣 ≒ ¥4.98　|　¥100 ≒ NT$20.1', 'S1 rate bar text identical to legacy format');
  const errs = logs.filter(l => l.startsWith('ERR') || l.startsWith('JSDOMERR'));
  ok(errs.length === 0, 'S1 no runtime errors: ' + errs.slice(0, 3).join(' | '));
  w.close();
});

/* ---------- S2: legacy (single-rate) data migration, numbers must not move ---------- */
const legacy = {
  ledgerName: 'JP2026',
  rate: 4.98,
  rateSource: '台灣銀行現金賣出',
  rateUpdatedAt: '2026-07-01 10:00',
  accounts: [
    { id: 'twd', name: 'TWcash', currency: 'TWD', kind: 'prepaid', initial: 3000, color: '#f59e0b' },
    { id: 'jpy', name: 'JPcash', currency: 'JPY', kind: 'prepaid', initial: 50000, color: '#34d399' },
    { id: 'card', name: 'Card', currency: 'JPY', kind: 'credit', initial: 0, color: '#a78bfa' },
  ],
  categories: { '飲食': ['晚餐'], '交通': ['電鐵'] },
  txns: [
    { id: 'a1', type: 'expense', date: '2026-07-01', account: 'jpy', amount: 1234, cat: '飲食', subcat: '晚餐', item: 'x' },
    { id: 'a2', type: 'expense', date: '2026-07-01', account: 'twd', amount: 777, cat: '交通', item: 'y' },
    { id: 'a3', type: 'expense', date: '2026-07-02', account: 'card', amount: 8888, cat: '飲食', item: 'z' },
    { id: 'a4', type: 'topup', date: '2026-07-02', from: 'twd', to: 'jpy', amount: 1000, toAmount: 4980 },
  ],
  members: [{ id: 'm1', name: 'A' }, { id: 'm2', name: 'B' }],
  splits: [{ id: 's1', date: '2026-07-01', item: 'hotel', amount: 30000, currency: 'JPY', rate: 4.98, mode: 'equal', participants: ['m1', 'm2'], payerId: 'm1', amounts: {}, shares: {} }],
  schemaVersion: 2
};
// expected numbers computed with the OLD formulas (amt / 4.98)
const EXP = {
  jpySum: 1234 + 8888,
  twdSum: 777,
  totalTWD: 777 + (1234 + 8888) / 4.98,
  jpyBalance: 50000 + 4980 - 1234,
  twdBalance: 3000 - 777 - 1000,
  cardSpent: 8888,
};
scenario('S2', () => {
  const { w, logs } = boot(legacy);
  const selftest = logs.find(l => l.indexOf('PASS') >= 0) || '';
  ok(/FAIL 0$/.test(selftest.trim()), 'S2 builtin selftest still green with real-ish data');
  eq(w.eval('data.rates.JPY'), 4.98, 'S2 migrated rates.JPY == old rate (value moved verbatim)');
  eq(w.eval('data.rate'), 4.98, 'S2 legacy mirror preserved for old-version compatibility');
  const t = w.eval('JSON.stringify(computeTotals())');
  const T = JSON.parse(t);
  eq(T.byCur.JPY, EXP.jpySum, 'S2 JPY bucket');
  eq(T.byCur.TWD, EXP.twdSum, 'S2 TWD bucket');
  eq(T.totalTWD, EXP.totalTWD, 'S2 totalTWD bit-identical to old formula');
  eq(T.jpy, EXP.jpySum, 'S2 legacy alias jpy');
  eq(T.twd, EXP.twdSum, 'S2 legacy alias twd');
  // 777 + 10122/4.98 = 2809.5301... -> NT$2,810
  eq(w.eval("document.getElementById('total-twd').textContent"), 'NT$2,810', 'S2 header total text');
  eq(w.eval("JSON.stringify(acctStats('jpy'))"),
     JSON.stringify({ storedIn: 50000 + 4980, spent: 1234, out: 0, balance: EXP.jpyBalance }), 'S2 jpy account stats');
  eq(w.eval("JSON.stringify(acctStats('twd'))"),
     JSON.stringify({ storedIn: 3000, spent: 777, out: 1000, balance: EXP.twdBalance }), 'S2 twd account stats');
  eq(w.eval("acctStats('card').spent"), EXP.cardSpent, 'S2 credit card spent');
  // settlement unchanged (TWD domain default)
  eq(w.eval('JSON.stringify(computeSettlement(data.members, data.splits, "TWD").netInt)'),
     JSON.stringify({ m1: Math.round(30000 / 4.98) - Math.round(15000 / 4.98), m2: -(Math.round(30000 / 4.98) - Math.round(15000 / 4.98)) }),
     'S2 settlement TWD domain unchanged');
  // export -> import round trip keeps every number
  const exported = w.eval('JSON.stringify(data)');
  const round = w.eval(`JSON.stringify(sanitizeImport(JSON.parse(${JSON.stringify(exported)})))`);
  const R = JSON.parse(round);
  eq(R.rates.JPY, 4.98, 'S2 export/import round trip keeps rates');
  eq(R.txns.length, 4, 'S2 round trip keeps all txns');
  eq(R.accounts.map(a => a.currency).join(','), 'TWD,JPY,JPY', 'S2 round trip keeps currencies');
  const errs = logs.filter(l => l.startsWith('ERR') || l.startsWith('JSDOMERR'));
  ok(errs.length === 0, 'S2 no runtime errors: ' + errs.slice(0, 3).join(' | '));
  w.close();
});

/* ---------- S3: multi-currency (add USD) ---------- */
scenario('S3', () => {
  const seed = JSON.parse(JSON.stringify(legacy));
  seed.rates = { JPY: 4.98, USD: 0.03125 };            // eslint-disable-line
          // 1 TWD = 0.03125 USD  => 1 USD = 32 TWD
  seed.accounts.push({ id: 'usd', name: 'USDcash', currency: 'USD', kind: 'prepaid', initial: 100, color: '#60a5fa' });
  seed.txns.push({ id: 'u1', type: 'expense', date: '2026-07-03', account: 'usd', amount: 20, cat: '飲食', item: 'usd meal' });
  const { w, logs } = boot(seed);
  console.log('S3 logs: ' + logs.slice(0, 5).map(l => String(l).slice(0, 200)).join(' || '));
  const T = JSON.parse(w.eval('JSON.stringify(computeTotals())'));
  eq(T.byCur.USD, 20, 'S3 USD bucket');
  eq(T.totalTWD, EXP.totalTWD + 640, 'S3 total adds USD 20 -> NT$640');
  eq(w.eval("fmt(20,'USD')"), '$20.00', 'S3 USD formatting 2dp');
  eq(w.eval("document.getElementById('total-twd').textContent"), 'NT$3,450', 'S3 header total with 3 currencies');
  eq(w.eval("document.getElementById('total-breakdown').textContent"),
     '日圓 ¥10,122（≒NT$2,033）　＋　美金 $20.00（≒NT$640）　＋　台幣 NT$777',
     'S3 breakdown lists every currency');
  ok(w.eval("document.getElementById('rate-big').innerHTML").indexOf('$0.03125') >= 0, 'S3 rate bar shows USD line');
  ok(w.eval("document.getElementById('accounts').textContent").indexOf('$80.00') >= 0, 'S3 USD account balance card (100-20)');
  // settings: rate editor rows + two-way sync + save
  w.eval('openSettings()');
  eq(w.eval("document.querySelectorAll('#rate-editor .rate-fwd').length"), 2, 'S3 rate editor has one row per foreign currency');
  eq(w.eval("document.querySelector('.rate-inv[data-cur=\"USD\"]').value"), '32', 'S3 inverse column shows 1 USD = 32 TWD');
  w.eval("document.querySelector('.rate-fwd[data-cur=\"JPY\"]').value='5'; syncRateRow('JPY','fwd');");
  eq(w.eval("document.querySelector('.rate-inv[data-cur=\"JPY\"]').value"), '0.2', 'S3 two-way sync updates inverse');
  w.eval('saveSettings()');
  eq(w.eval('data.rates.JPY'), 5, 'S3 saveSettings writes new rate');
  eq(w.eval('data.rate'), 5, 'S3 legacy mirror follows');
  eq(w.eval('data.rateSource'), '手動設定', 'S3 rateSource marked manual on change');
  // split currency select should now offer TWD/JPY/USD
  eq(w.eval("splitCurOptions().join(',')"), 'TWD,JPY,USD', 'S3 split currency options follow accounts');
  eq(w.eval("Array.from(document.getElementById('settle-cur').options).map(o=>o.value).join(',')"), 'TWD,JPY,USD', 'S3 settle currency dropdown');
  const errs = logs.filter(l => l.startsWith('ERR') || l.startsWith('JSDOMERR'));
  ok(errs.length === 0, 'S3 no runtime errors: ' + errs.slice(0, 3).join(' | '));
  w.close();
});

/* ---------- S4: account switched to a currency with no rate -> placeholder + warning ---------- */
scenario('S4', () => {
  const seed = JSON.parse(JSON.stringify(legacy));
  const { w, logs } = boot(seed);
  w.eval("data.accounts[1].currency='EUR'; openSettings(); saveSettings();");
  eq(w.eval('data.rates.EUR'), 1, 'S4 missing rate filled with placeholder 1');
  ok(w.eval("foreignCursInUse().join(',')").indexOf('EUR') >= 0, 'S4 EUR now tracked');
  const errs = logs.filter(l => l.startsWith('ERR') || l.startsWith('JSDOMERR'));
  ok(errs.length === 0, 'S4 no runtime errors: ' + errs.slice(0, 3).join(' | '));
  w.close();
});

console.log('---');
console.log('FILE : ' + path.basename(APP));
console.log('MD5  : ' + md5);
console.log('E2E  : PASS ' + pass + ' / FAIL ' + fail);
if (fail) { console.log('FAILURES:'); fails.forEach(f => console.log(' - ' + f)); }
process.exit(fail ? 1 : 0);
