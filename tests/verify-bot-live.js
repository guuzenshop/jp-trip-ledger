/* H1 實證：把 index.html 裡「正在上線的」parseBotCsv 原封抽出，餵即時台銀 CSV，端到端驗證 */
const fs = require('fs');
const APP = process.argv[2];
const src = fs.readFileSync(APP, 'utf8');

// 從正式檔抽出函式本體（不是複製一份，確保測的就是上線的那份）
function extract(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('找不到 ' + name);
  let depth = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') { depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error('解析失敗 ' + name);
}
const parseBotCsvSrc = extract('parseBotCsv');
const normRateSrc = extract('normRate');
const rateSaneSrc = extract('rateSane');
const RATE_BOUNDS = /const RATE_MIN = ([\d.e+-]+), RATE_MAX = ([\d.e+-]+);/.exec(src);
const mod = { exports: {} };
new Function('module', `${parseBotCsvSrc}\n${normRateSrc}\nconst RATE_MIN=${RATE_BOUNDS[1]},RATE_MAX=${RATE_BOUNDS[2]};\n${rateSaneSrc}\nmodule.exports={parseBotCsv,normRate,rateSane};`)(mod);
const { parseBotCsv, normRate, rateSane } = mod.exports;

(async () => {
  const url = 'https://r.jina.ai/https://rate.bot.com.tw/xrt/flcsv/0/day';
  const res = await fetch(url);
  const text = await res.text();
  console.log('HTTP ' + res.status + '  bytes=' + text.length);

  // 原始證據：印出真實的 JPY / USD 兩行（審查者要求的「2-3 行即時 flcsv」）
  const lines = text.split('\n');
  const raw = c => (lines.find(l => l.trim().toUpperCase().startsWith(c + ',')) || '(not found)').trim();
  console.log('--- 即時原始列 ---');
  console.log('JPY: ' + raw('JPY'));
  console.log('USD: ' + raw('USD'));
  console.log('ZAR: ' + raw('ZAR'));

  // 標記位置與其後兩欄的語義（證明「Selling 後第一欄＝現金、第二欄＝即期」）
  const jp = raw('JPY').split(',');
  const si = jp.findIndex(p => /^(selling|本行賣出)$/i.test(String(p || '').trim()));
  console.log('--- 標記定位 ---');
  console.log('JPY 列共 ' + jp.length + ' 欄；Selling 標記在 index=' + si);
  console.log('  parts[si+1] (現金賣出) = ' + jp[si + 1]);
  console.log('  parts[si+2] (即期賣出) = ' + jp[si + 2]);
  console.log('  舊版寫死的 parts[12]   = ' + jp[12] + (si + 1 === 12 ? '   ← 與標記定位結果相同' : '   ← 與標記定位不同！'));

  // 端到端：跑上線中的 parseBotCsv
  const map = parseBotCsv(text);
  const codes = Object.keys(map);
  console.log('--- parseBotCsv（上線版）端到端 ---');
  console.log('解析出 ' + codes.length + ' 種幣別: ' + codes.join(' '));
  console.log('JPY=' + map.JPY + '  USD=' + map.USD + '  EUR=' + map.EUR + '  KRW=' + map.KRW);
  console.log('ZAR（台銀無現金報價）=' + (map.ZAR === undefined ? 'undefined（正確跳過）' : map.ZAR));

  // 轉成 App 慣例（1 台幣 = X 該幣）並過合理性閘
  console.log('--- 轉換後（1 台幣 = X 該幣）＋ rateSane ---');
  let bad = 0;
  for (const c of ['JPY', 'USD', 'EUR', 'KRW', 'GBP', 'VND', 'THB']) {
    if (!(map[c] > 0)) { console.log('  ' + c + ': 無現金報價'); continue; }
    const v = normRate(1 / map[c]);
    const sane = rateSane(v, null);
    if (!sane) bad++;
    console.log('  ' + c + ': 1 TWD = ' + v + '   rateSane=' + sane);
  }

  // 判定
  const okJPY = map.JPY > 0.15 && map.JPY < 0.30;      // 1 JPY 約 0.2 台幣
  const okUSD = map.USD > 25 && map.USD < 40;          // 1 USD 約 32 台幣
  const okCount = codes.length >= 15;
  const okMarker = si >= 0 && Number(jp[si + 1]) > 0;
  console.log('--- 判定 ---');
  console.log('即時列含 Selling 標記且其後為正數 : ' + okMarker);
  console.log('JPY 落在合理區間                  : ' + okJPY + ' (' + map.JPY + ')');
  console.log('USD 落在合理區間                  : ' + okUSD + ' (' + map.USD + ')');
  console.log('解析幣別數 >= 15                  : ' + okCount + ' (' + codes.length + ')');
  console.log('rateSane 誤擋數                   : ' + bad);
  const pass = okMarker && okJPY && okUSD && okCount && bad === 0;
  console.log(pass ? 'RESULT: LIVE-CSV OK（H1 以即時資料實證通過）' : 'RESULT: LIVE-CSV FAIL');
  process.exit(pass ? 0 : 1);
})().catch(e => { console.log('FETCH/RUN ERR ' + e.message); process.exit(1); });
