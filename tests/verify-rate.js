/* updateRate() 驗證：台銀現金賣出唯一來源 + 雙路徑 failover + 合理性閘 + 無報價/離線行為 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const APP = process.argv[2];
const html = fs.readFileSync(APP, 'utf8');

let pass = 0, fail = 0; const fails = [];
const ok = (c, n) => { if (c) pass++; else { fail++; fails.push(n); } };
const eq = (a, b, n) => ok(a === b, `${n} [got=${JSON.stringify(a)} want=${JSON.stringify(b)}]`);

const seed = {
  ledgerName: 'T', rate: 4.98, rates: { JPY: 4.98, USD: 0.0317 },
  accounts: [
    { id: 'jpy', name: 'JP', currency: 'JPY', kind: 'prepaid', initial: 0, color: '#34d399' },
    { id: 'usd', name: 'US', currency: 'USD', kind: 'prepaid', initial: 0, color: '#60a5fa' },
  ],
  categories: { '飲食': ['晚餐'] }, txns: [], members: [], splits: [], schemaVersion: 2
};

// 真實台銀 flcsv 片段（2026-07-19 實抓；含 r.jina.ai 會前置的說明行）
const BOT_CSV = [
  'Title: ', '', 'URL Source: https://rate.bot.com.tw/xrt/flcsv/0/day', '', 'Markdown Content:',
  'Currency,Rate,Cash,Spot,F10,F30,F60,F90,F120,F150,F180,Rate,Cash,Spot,F10,F30,F60,F90,F120,F150,F180,x',
  'USD,Buying,32.03000,32.26500,32.2,32.2,32.2,32.2,32.2,32.2,32.2,Selling,32.56000,32.36500,32.3,32.3,32.3,32.3,32.3,32.3,32.3,',
  'JPY,Buying,0.18970,0.19650,0.197,0.197,0.197,0.197,0.197,0.197,0.197,Selling,0.20250,0.20150,0.201,0.201,0.201,0.201,0.201,0.201,0.201,',
  'ZAR,Buying,0.00000,1.85400,0,0,0,0,0,0,0,Selling,0.00000,2.00400,0,0,0,0,0,0,0,',
].join('\n');

function boot(fetchImpl) {
  const vc = new VirtualConsole();
  const logs = [];
  vc.on('log', (...a) => logs.push(a.join(' ')));
  vc.on('error', (...a) => logs.push('ERR ' + a.join(' ')));
  vc.on('jsdomError', e => logs.push('JSDOMERR ' + (e && e.message)));
  const dom = new JSDOM(html, {
    url: 'https://guuzenshop.github.io/jp-trip-ledger/',
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.localStorage.setItem('jp_trip_ledger_v2', JSON.stringify(seed));
      w.alert = () => {}; w.confirm = () => true; w.scrollTo = () => {};
      w.fetch = fetchImpl;
    }
  });
  return { w: dom.window, logs };
}
const resText = t => Promise.resolve({ text: () => Promise.resolve(t) });

(async () => {
  // A) 主路徑 r.jina.ai 可用 → 用現金賣出；不再打第二條路徑、也不打任何中價 API
  {
    const hits = [];
    const { w, logs } = boot(u => { hits.push(String(u)); return resText(BOT_CSV); });
    await w.eval('updateRate()');
    eq(w.eval('data.rates.JPY'), 4.9383, 'A JPY = 1/0.2025 -> 4.9383（現金賣出）');
    eq(w.eval('data.rates.USD'), 0.0307125, 'A USD = 1/32.56 -> 6 位有效數字');
    eq(w.eval('data.rateSource'), '台銀現金賣出', 'A 來源標示台銀現金賣出');
    eq(hits.length, 1, 'A 首條路徑成功即停止');
    ok(hits[0].indexOf('r.jina.ai') >= 0, 'A 首選 r.jina.ai');
    ok(hits.every(h => h.indexOf('er-api') < 0), 'A 不再呼叫中價 API');
    eq(w.eval('data.rate'), 4.9383, 'A legacy 鏡射同步');
    ok(logs.filter(l => l.startsWith('ERR')).length === 0, 'A 無執行期錯誤');
    w.close();
  }
  // B) 主路徑限流/被擋 → 自動改走 allorigins
  {
    const hits = [];
    const { w } = boot(u => {
      hits.push(String(u));
      if (String(u).indexOf('r.jina.ai') >= 0) return resText('Rate limit exceeded');
      return resText(BOT_CSV);
    });
    await w.eval('updateRate()');
    eq(hits.length, 2, 'B 第一條失敗後改走第二條');
    ok(hits[1].indexOf('allorigins') >= 0, 'B 第二條為 allorigins');
    eq(w.eval('data.rates.JPY'), 4.9383, 'B 備援路徑仍取得現金賣出');
    eq(w.eval('data.rateSource'), '台銀現金賣出', 'B 來源仍為台銀現金賣出');
    w.close();
  }
  // C) 台銀無現金報價的幣別（ZAR 現金=0）不寫入，其它照常
  {
    const s2 = JSON.parse(JSON.stringify(seed));
    s2.rates = { JPY: 4.98, ZAR: 0.5 };
    s2.accounts = [{ id: 'jpy', name: 'JP', currency: 'JPY', kind: 'prepaid', initial: 0, color: '#34d399' }];
    const vc = new VirtualConsole();
    const dom = new JSDOM(html, {
      url: 'https://x.test/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
      beforeParse(w) { w.localStorage.setItem('jp_trip_ledger_v2', JSON.stringify(s2)); w.alert = () => {}; w.confirm = () => true; w.scrollTo = () => {}; w.fetch = () => resText(BOT_CSV); }
    });
    const w = dom.window;
    await w.eval('updateRate()');
    eq(w.eval('data.rates.JPY'), 4.9383, 'C 有現金報價者更新');
    eq(w.eval('data.rates.ZAR'), 0.5, 'C 無現金報價者保持原值（不被中價污染）');
    w.close();
  }
  // D) 取得值離譜（>50%）→ 合理性閘擋下
  {
    const weird = BOT_CSV.replace('Selling,0.20250', 'Selling,0.02025');   // JPY 現金賣出被誤讀成 1/10
    const { w } = boot(() => resText(weird));
    await w.eval('updateRate()');
    eq(w.eval('data.rates.JPY'), 4.98, 'D 離譜的 JPY 被擋下（保留原值）');
    eq(w.eval('data.rates.USD'), 0.0307125, 'D 合理的 USD 仍更新');
    w.close();
  }
  // E) 兩條路徑都掛 → 完全不動資料
  {
    const { w, logs } = boot(() => Promise.reject(new Error('offline')));
    await w.eval('updateRate()');
    eq(w.eval('data.rates.JPY'), 4.98, 'E 離線時 JPY 不變');
    eq(w.eval('data.rates.USD'), 0.0317, 'E 離線時 USD 不變');
    eq(w.eval('data.rateSource'), '手動設定', 'E rateSource 不被覆寫（沿用 load 後原值）');
    ok(w.eval("document.getElementById('rate-btn').disabled") === false, 'E 按鈕還原可按（finally）');
    ok(logs.filter(l => l.startsWith('ERR')).length === 0, 'E 無未捕捉錯誤');
    w.close();
  }
  // F) 無追蹤幣別 → 不發網路請求
  {
    let called = false;
    const { w } = boot(() => { called = true; return Promise.reject(new Error('x')); });
    w.eval("data.accounts.forEach(a => a.currency = 'TWD'); data.rates = {};");
    await w.eval('updateRate()');
    ok(!called, 'F 完全無追蹤幣別時不發網路請求');
    w.close();
  }

  console.log('RATE-CHAIN: PASS ' + pass + ' / FAIL ' + fail);
  if (fail) { fails.forEach(f => console.log(' - ' + f)); }
  process.exit(fail ? 1 : 0);
})();
