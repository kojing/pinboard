// Pinterest → リファレンスボード 書き出し(GitHub Actions で実行)
//
// Pinterest の公開ボードを、Webサイト自身が使っている読み取り用のAPIで全部読み、
// リファレンスボードの「インポート」にそのまま読み込める JSON を data/pinterest/<ユーザー>.json に書く。
// ログインはしないので、非公開ボード・秘密のボードは含まれない。
//
//   node tools/pinterest-export.mjs [ユーザー名] [ボード名,ボード名…]   (既定: pinkojing の ft)
//   ボードはボード名かURLの最後の部分(/pinkojing/ft/ なら ft)で指定。大文字小文字は区別しない。* で全部。
//
// 出力 { app, source, user, exportedAt, boards, tags, items }
//   tags  … ボード名(セクションのピンは「ボード名/セクション名」も付く)
//   src   … 元画像(originals)  thumb … 一覧用(474x)  page … ピンのURL  memo … 説明と出典URL
//   動画ピンは mp4 が取れれば動画、取れなければ画像。複数のボードにある同じピンは1件にまとめる。
import { mkdir, writeFile, readFile } from 'node:fs/promises';

const USER = process.argv[2] || process.env.PINTEREST_USER || 'pinkojing';
const BOARDS = (process.argv[3] || process.env.PINTEREST_BOARDS || 'ft').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const OUT = `data/pinterest/${USER}.json`;
const MEMO_MAX = 140;          // ボードの保存領域(約480KB)に収めるためメモは短くする
const CAPACITY = 16 * 30000;
const ORIGIN = 'https://www.pinterest.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Pinterest への接続(最初にトップを開いて cookie を受け取る) ----------
const jar = new Map();
function keepCookies(res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const c of list) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
}
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
async function warmUp() {
  const res = await fetch(`${ORIGIN}/${USER}/`, { headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'ja,en;q=0.8' }, redirect: 'follow' });
  keepCookies(res);
  if (!res.ok) throw new Error(`プロフィールページが HTTP ${res.status} を返しました(ユーザー名 ${USER} を確認してください)`);
}
async function resource(name, options, sourceUrl) {
  const url = `${ORIGIN}/resource/${name}/get/?source_url=&data=${encodeURIComponent(JSON.stringify({ options }))}`;
  for (let t = 0; t < 5; t++) {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA, Accept: 'application/json, text/javascript, */*; q=0.01', 'Accept-Language': 'ja,en;q=0.8',
        'X-Requested-With': 'XMLHttpRequest', 'X-Pinterest-AppState': 'active', Origin: ORIGIN,
        'X-Pinterest-PWS-Handler': 'www/[username]/[slug].js', 'X-Pinterest-Source-Url': sourceUrl,
        'X-CSRFToken': jar.get('csrftoken') || '', Referer: ORIGIN + sourceUrl, Cookie: cookieHeader()
      }
    });
    keepCookies(res);
    if (res.status === 429 || res.status >= 500) { console.log(`  ${name}: HTTP ${res.status}、待って再試行`); await sleep(4000 * (t + 1)); continue; }
    if (!res.ok) throw new Error(`${name} が HTTP ${res.status} を返しました: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    const rr = j.resource_response || {};
    if (rr.error) throw new Error(`${name}: ${rr.error.message || rr.error.code || 'エラー'}`);
    if (process.env.PINTEREST_DEBUG) console.log(`  [debug] ${name} keys=${Object.keys(j).join(',')} rr=${Object.keys(rr).join(',')} rr.bookmark=${String(rr.bookmark).slice(0, 24)} opt.bm=${String(j.resource?.options?.bookmarks?.[0]).slice(0, 24)} n=${Array.isArray(rr.data) ? rr.data.length : typeof rr.data}`);
    return { data: rr.data, bookmark: rr.bookmark || j.resource?.options?.bookmarks?.[0] || null };
  }
  throw new Error(`${name} が混み合っていて読めませんでした`);
}
// ボードのページ本体に埋め込まれた初期データ(__PWS_INITIAL_PROPS__ など)からボードの情報を探す
async function boardFromPage(slug) {
  const res = await fetch(`${ORIGIN}/${USER}/${slug}/`, { headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'ja,en;q=0.8', Cookie: cookieHeader() } });
  keepCookies(res);
  if (!res.ok) throw new Error(`ボードのページが HTTP ${res.status}`);
  const html = await res.text();
  const want = `/${USER}/${slug}/`.toLowerCase();
  let found = null;
  for (const m of html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)) {
    let j; try { j = JSON.parse(m[1]); } catch { continue; }
    const stack = [j];
    while (stack.length && !found) {
      const o = stack.pop();
      if (!o || typeof o !== 'object') continue;
      if (o.type === 'board' && o.id && typeof o.url === 'string' && o.url.toLowerCase() === want) { found = o; break; }
      for (const v of Object.values(o)) if (v && typeof v === 'object') stack.push(v);
    }
    if (found) break;
  }
  return found;
}
async function paged(name, options, sourceUrl) {
  let bm = null; const all = [], seen = new Set();
  for (let n = 0; n < 500; n++) {
    const res = await resource(name, bm ? { ...options, bookmarks: [bm] } : options, sourceUrl);
    const list = Array.isArray(res.data) ? res.data : Array.isArray(res.data?.results) ? res.data.results : [];
    all.push(...list);
    if (!res.bookmark || res.bookmark === '-end-' || seen.has(res.bookmark) || !list.length) break;
    seen.add(res.bookmark); bm = res.bookmark;
    await sleep(400);
  }
  return all;
}

// ---------- ピン → リファレンスボードの項目 ----------
const iso = (s) => { const d = new Date(s); return isNaN(d) ? new Date().toISOString() : d.toISOString(); };
function pickMp4(list) {
  if (!list) return null;
  for (const k of ['V_720P', 'V_EXP7', 'V_EXP6', 'V_EXP5', 'V_EXP4', 'V_EXP3']) if (/\.mp4(\?|$)/.test(list[k]?.url || '')) return list[k];
  return Object.values(list).find((v) => /\.mp4(\?|$)/.test(v?.url || '')) || null;
}
function storyMedia(p) {
  for (const page of p.story_pin_data?.pages || []) for (const b of page.blocks || []) {
    if (b.image?.images) return { images: b.image.images };
    if (b.video?.video_list) return { video: b.video.video_list };
  }
  return null;
}
export function toItem(p, tags) {
  if (!p || typeof p !== 'object' || !p.id || (p.type && p.type !== 'pin')) return null;
  let im = p.images || null, vlist = p.videos?.video_list || null;
  const st = !im?.orig ? storyMedia(p) : null;
  if (st?.images) im = st.images;
  if (st?.video && !vlist) vlist = st.video;
  im = im || {};
  const orig = im.orig || im.originals || im['1200x'] || im['736x'] || im['474x'];
  const mp4 = pickMp4(vlist);
  if (!orig && !mp4) return null;
  const thumb = im['474x'] || im['564x'] || im['736x'] || orig;
  const it = { id: 'p' + p.id, kind: mp4 ? 'video' : 'image', src: mp4 ? mp4.url : orig.url };
  if (thumb?.url && thumb.url !== it.src) it.thumb = thumb.url;
  const w = mp4 ? mp4.width : orig.width, h = mp4 ? mp4.height : orig.height;
  if (w > 0 && h > 0) { it.w = w; it.h = h; }
  if (/^#[0-9a-f]{6}$/i.test(p.dominant_color || '')) it.c = p.dominant_color;
  it.title = String(p.title || p.grid_title || '').trim().slice(0, 120);
  let memo = String(p.description || p.closeup_unified_description || '').replace(/\s+/g, ' ').trim();
  if (memo === it.title) memo = '';
  if (memo.length > MEMO_MAX) memo = memo.slice(0, MEMO_MAX - 1) + '…';
  const link = p.link && !/pinterest\./.test(p.link) ? String(p.link).slice(0, 300) : '';
  it.memo = memo + (link ? (memo ? '\n' : '') + '出典: ' + link : '');
  it.page = `${ORIGIN}/pin/${p.id}/`;
  it.tags = [...tags];
  it.createdAt = iso(p.created_at);
  return it;
}

async function main() {
  console.log(`Pinterest ${USER} を読み込みます`);
  await warmUp();
  // まず指定のボードを直接読む(ボード名がURLと同じ場合)。見つからなければ公開ボードの一覧から探す
  const boards = [];
  if (!BOARDS.includes('*')) {
    for (const slug of BOARDS) {
      try {
        const b = await boardFromPage(slug);
        if (b) boards.push(b); else console.log(`  ${slug} のページにボードの情報が見つかりませんでした`);
      } catch (e) { console.log(`  ${slug} を直接は読めませんでした(${e.message})`); }
    }
  }
  if (BOARDS.includes('*') || boards.length < BOARDS.length) {
    const all = (await paged('BoardsResource', { username: USER, page_size: 25, include_archived: true }, `/${USER}/`))
      .filter((b) => b?.id && b.url && (!b.type || b.type === 'board'));
    console.log(`公開ボード ${all.length} 件: ${all.map((b) => `${b.name}(${b.url})`).join(', ')}`);
    const slug = (b) => String(b.url).replace(/\/$/, '').split('/').pop().toLowerCase();
    for (const b of all) {
      if (boards.some((x) => x.id === b.id)) continue;
      if (BOARDS.includes('*') || BOARDS.includes(String(b.name || '').trim().toLowerCase()) || BOARDS.includes(slug(b))) boards.push(b);
    }
  }
  if (!boards.length) throw new Error(`ボード(${BOARDS.join(', ')})が見つかりませんでした`);
  console.log(`対象: ${boards.map((b) => `${b.name}(${b.pin_count ?? '?'})`).join(', ')}`);

  const byId = new Map(); let skipped = 0;
  const add = (p, tags) => {
    const it = toItem(p, tags);
    if (!it) { skipped++; return; }
    const cur = byId.get(it.id);
    if (!cur) byId.set(it.id, it); else for (const t of tags) if (!cur.tags.includes(t)) cur.tags.push(t);
  };
  const summary = [];
  for (const [i, b] of boards.entries()) {
    const name = String(b.name || b.url).trim();
    const pins = await paged('BoardFeedResource', {
      board_id: b.id, page_size: 25
    }, b.url);
    pins.forEach((p) => add(p, [name]));
    let secCount = 0;
    if (b.section_count > 0) {
      const secs = await paged('BoardSectionsResource', { board_id: b.id }, b.url);
      for (const sec of secs) {
        if (!sec?.id) continue;
        const label = `${name}/${sec.title || sec.slug}`;
        const sp = await paged('BoardSectionPinsResource', { section_id: sec.id, page_size: 25 }, `${b.url}${sec.slug || ''}/`);
        sp.forEach((p) => add(p, [name, label])); secCount += sp.length;
      }
    }
    console.log(`[${i + 1}/${boards.length}] ${name}: ${pins.length} ピン${secCount ? `(セクション ${secCount})` : ''}(Pinterest上 ${b.pin_count ?? '?'})`);
    summary.push({ name, url: ORIGIN + b.url, pins: b.pin_count ?? pins.length });
    await sleep(500);
  }

  const items = [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const tags = [];
  for (const b of summary) if (!tags.includes(b.name)) tags.push(b.name);
  for (const it of items) for (const t of it.tags) if (!tags.includes(t)) tags.push(t);
  const bytes = Buffer.byteLength(JSON.stringify(items));

  // 前回と中身が同じなら書き換えない(日付だけのコミットを作らない)
  let prev = null; try { prev = JSON.parse(await readFile(OUT, 'utf8')); } catch {}
  if (prev && JSON.stringify(prev.items) === JSON.stringify(items) && JSON.stringify(prev.tags) === JSON.stringify(tags)) {
    console.log(`変化なし(${items.length} 件)`); return;
  }
  const out = { app: 'reference-board', source: 'pinterest', user: USER, exportedAt: new Date().toISOString(), boards: summary, tags, items };
  await mkdir('data/pinterest', { recursive: true });
  await writeFile(OUT, JSON.stringify(out, null, 1) + '\n');
  const video = items.filter((x) => x.kind === 'video').length;
  console.log(`\n${OUT} に ${items.length} 件(画像 ${items.length - video}・動画 ${video})${skipped ? `、読めなかったピン ${skipped} 件` : ''}`);
  console.log(`ボードの保存領域の目安: ${Math.round(bytes / 1024)}KB / ${Math.round(CAPACITY / 1024)}KB(${Math.round(bytes / CAPACITY * 100)}%)`);
  if (bytes > CAPACITY * 0.9) console.log('※ 1つのボードには入りきりません。ボードを分けて読み込んでください');
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error('止まりました: ' + e.message); process.exit(1); });
