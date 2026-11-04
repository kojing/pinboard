// 一時: ボードのピン一覧が1ページ目で途切れる原因を調べる
const USER = 'pinkojing', SLUG = 'ft', O = 'https://www.pinterest.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function session() {
  const jar = new Map();
  const keep = (r) => { for (const c of r.headers.getSetCookie?.() || []) { const kv = c.split(';')[0]; const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); } };
  const r = await fetch(`${O}/${USER}/${SLUG}/`, { headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'ja,en;q=0.8' } }); keep(r);
  const html = await r.text();
  return { jar, keep, html };
}
function scripts(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)) { try { out.push(JSON.parse(m[1])); } catch {} }
  return out;
}
function walk(root, fn) {
  const st = [[root, '']];
  while (st.length) {
    const [o, path] = st.pop();
    if (!o || typeof o !== 'object') continue;
    if (fn(o, path)) return o;
    for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object') st.push([v, path + '.' + k]);
  }
  return null;
}
const s0 = await session();
const js = scripts(s0.html);
let board = null;
for (const j of js) { board = walk(j, (o) => o.type === 'board' && o.id && String(o.url).toLowerCase() === `/${USER}/${SLUG}/`); if (board) break; }
console.log('board', board?.id, 'pin_count', board?.pin_count, 'section_count', board?.section_count);
// HTML の初期データの中にある bookmark とピンの数
for (const j of js) walk(j, (o, path) => {
  if (Array.isArray(o.bookmarks) || typeof o.bookmark === 'string') console.log('  html bookmark at', path.slice(0, 120), JSON.stringify(o.bookmarks || o.bookmark).slice(0, 60));
  return false;
});
let pinsInHtml = 0; for (const j of js) walk(j, (o) => { if (o.type === 'pin' && o.id) pinsInHtml++; return false; });
console.log('  pins in html', pinsInHtml);

async function feed(s, opts) {
  const url = `${O}/resource/BoardFeedResource/get/?source_url=${encodeURIComponent(`/${USER}/${SLUG}/`)}&data=${encodeURIComponent(JSON.stringify({ options: opts, context: {} }))}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json, text/javascript, */*; q=0.01', 'Accept-Language': 'ja,en;q=0.8',
    'X-Requested-With': 'XMLHttpRequest', 'X-Pinterest-AppState': 'active', Origin: O, 'X-Pinterest-PWS-Handler': 'www/[username]/[slug].js',
    'X-Pinterest-Source-Url': `/${USER}/${SLUG}/`, 'X-CSRFToken': s.jar.get('csrftoken') || '', Referer: `${O}/${USER}/${SLUG}/`,
    Cookie: [...s.jar].map(([k, v]) => `${k}=${v}`).join('; ') } });
  s.keep(r);
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {}
  const rr = j.resource_response || {};
  return { status: r.status, n: Array.isArray(rr.data) ? rr.data.length : -1, bm: rr.bookmark || null, optbm: j.resource?.options?.bookmarks?.[0] || null, err: rr.error?.message || (r.status !== 200 ? t.slice(0, 80) : '') };
}
const base = { board_id: board.id };
const full = { board_id: board.id, board_url: `/${USER}/${SLUG}/`, currentFilter: -1, field_set_key: 'react_grid_pin', filter_section_pins: true, sort: 'default', layout: 'default', redux_normalize_feed: true };
const variants = {
  'A 最小 25': { ...base, page_size: 25 },
  'B 全部 25': { ...full, page_size: 25 },
  'C 全部 50': { ...full, page_size: 50 },
  'D 全部 section含む 25': { ...full, filter_section_pins: false, page_size: 25 },
};
for (const [name, o] of Object.entries(variants)) {
  for (let k = 0; k < 3; k++) {
    const s = k === 0 ? s0 : await session();
    const p1 = await feed(s, o);
    let p2 = null; if (p1.bm && p1.bm !== '-end-') p2 = await feed(s, { ...o, bookmarks: [p1.bm] });
    console.log(`${name} #${k + 1}: p1 ${p1.status} n=${p1.n} bm=${String(p1.bm).slice(0, 16)} optbm=${String(p1.optbm).slice(0, 16)} ${p1.err}` + (p2 ? ` | p2 ${p2.status} n=${p2.n} bm=${String(p2.bm).slice(0, 16)}` : ''));
    await sleep(1500);
  }
}
