// Pinterest の取り方を調べる一時スクリプト(結果は data/pinterest/probe.log)
const USER = 'pinkojing', SLUG = 'ft', O = 'https://www.pinterest.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const jar = new Map();
const keep = (r) => { for (const c of r.headers.getSetCookie?.() || []) { const kv = c.split(';')[0]; const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); } };
const ck = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
async function get(url, h = {}) { const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja,en;q=0.8', Cookie: ck(), ...h } }); keep(r); return { s: r.status, t: await r.text() }; }
const page = await get(`${O}/${USER}/${SLUG}/`, { Accept: 'text/html' });
console.log('board page', page.s, page.t.length);
for (const k of ['__PWS_INITIAL_PROPS__', '__PWS_DATA__', 'initialReduxState', 'i.pinimg.com/originals', 'i.pinimg.com/736x', '"board_id"', 'appVersion']) console.log(' ', k, (page.t.split(k).length - 1));
const ids = new Set([...page.t.matchAll(/"\/pin\/(\d+)\/"|\/pin\/(\d+)\//g)].map((m) => m[1] || m[2])); console.log('  pin ids', ids.size);
const av = (page.t.match(/"appVersion":"([^"]+)"/) || [])[1]; console.log('  appVersion', av);
const bid = (page.t.match(/"board_id":"(\d+)"/) || page.t.match(/"id":"(\d+)","type":"board"/) || [])[1]; console.log('  board id', bid);
const rss = await get(`${O}/${USER}/${SLUG}.rss`, { Accept: 'application/rss+xml' }); console.log('rss', rss.s, (rss.t.match(/<item>/g) || []).length, 'items');
const opts = { board_id: bid, page_size: 25 };
for (const [label, extra] of [
  ['plain', {}],
  ['pws', { 'X-Pinterest-PWS-Handler': `www/[username]/[slug].js` }],
  ['pws+app', { 'X-Pinterest-PWS-Handler': `www/[username]/[slug].js`, 'X-APP-VERSION': av || '' }],
  ['pws+app+src', { 'X-Pinterest-PWS-Handler': `www/[username]/[slug].js`, 'X-APP-VERSION': av || '', 'X-Pinterest-Source-Url': `/${USER}/${SLUG}/` }],
]) {
  for (const src of ['', `/${USER}/${SLUG}/`]) {
    const r = await get(`${O}/resource/BoardFeedResource/get/?source_url=${encodeURIComponent(src)}&data=${encodeURIComponent(JSON.stringify({ options: opts, context: {} }))}`,
      { Accept: 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest', 'X-Pinterest-AppState': 'active', 'X-CSRFToken': jar.get('csrftoken') || '', Referer: `${O}/${USER}/${SLUG}/`, ...extra });
    let n = '-'; try { const j = JSON.parse(r.t); n = (j.resource_response?.data || []).length + ' bm=' + String(j.resource_response?.bookmark || '').slice(0, 12); } catch {}
    console.log('feed', label, src || '(empty)', r.s, n, r.s !== 200 ? r.t.slice(0, 80) : '');
  }
}
console.log('cookies', [...jar.keys()].join(','));
