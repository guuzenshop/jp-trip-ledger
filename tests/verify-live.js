/* 線上內容雙軌驗證：抓 GitHub Pages 實際內容，比對本地檔 md5 + 新功能特徵字串 */
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');
const LOCAL = process.argv[2];
const OUT = process.argv[3];
const url = 'https://guuzenshop.github.io/jp-trip-ledger/index.html?cb=' + process.argv[4];

https.get(url, { headers: { 'Cache-Control': 'no-cache' } }, res => {
  console.log('HTTP ' + res.statusCode);
  const bufs = [];
  res.on('data', d => bufs.push(d));
  res.on('end', () => {
    const buf = Buffer.concat(bufs);
    const t = buf.toString('utf8');
    fs.writeFileSync(OUT + '/live.html', buf);
    const liveMd5 = crypto.createHash('md5').update(buf).digest('hex');
    const local = fs.readFileSync(LOCAL);
    const localMd5 = crypto.createHash('md5').update(local).digest('hex');
    console.log('live  bytes=' + buf.length + ' md5=' + liveMd5);
    console.log('local bytes=' + local.length + ' md5=' + localMd5);
    console.log('BYTE-IDENTICAL = ' + (liveMd5 === localMd5));
    const marks = ['CUR_META', 'migrateRates', 'function rateOf', 'function toCur', 'rate-editor',
                   'parseBotCsv', 'rateSane', 'splitCurOptions', 'totalsBreakdownText', 'settle-cur-sel',
                   'runCurrencySelfTest'];
    let allNew = true;
    marks.forEach(m => { const has = t.indexOf(m) >= 0; if (!has) allNew = false; console.log('  has ' + m + ' : ' + has); });
    const goneOld = [['const SPLIT_CUR', t.indexOf('const SPLIT_CUR') < 0],
                     ['id="s-rate"', t.indexOf('id="s-rate"') < 0],
                     ['name="settlecur"', t.indexOf('name="settlecur"') < 0]];
    goneOld.forEach(([m, gone]) => { if (!gone) allNew = false; console.log('  old removed ' + m + ' : ' + gone); });
    console.log('RESULT: ' + (res.statusCode === 200 && liveMd5 === localMd5 && allNew ? 'LIVE OK' : 'LIVE MISMATCH'));
    process.exit(res.statusCode === 200 && liveMd5 === localMd5 && allNew ? 0 : 1);
  });
}).on('error', e => { console.log('FETCH ERR ' + e.message); process.exit(1); });
