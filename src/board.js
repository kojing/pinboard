/*!
 * リファレンスボード for Confluence (Server / Data Center) — v1.1.1
 *
 * Pinterest のように画像・動画のリファレンスを集めて眺めるボード。
 *
 * 使い方: このファイルをConfluenceのページに添付し、reference-board.embed.html の内容を
 *         ボードを置くページの HTML マクロに貼る。設定は埋め込みHTML側に書くので、このファイルは編集不要。
 *
 * 保存先
 *   メタ情報 … ページの Content Property(リンク集 v3 と同じ分割の仕組み。既定64分割 ≒ 1.9MB)
 *     ref-board-data        … 索引(タグ一覧)
 *     ref-board-data-00〜63 … 各リファレンスの情報(1個30,000バイトまで。SHARDS で変更)
 *   画像本体 … ドラッグ&ドロップ・貼り付け・「コピーして保存」したものは、ボードのページの添付ファイル
 *     rb-<ID>.<拡張子>  元画像
 *     rb-<ID>-t.webp     一覧用の縮小画像(大きい画像のときだけ)
 *   URLで保存したもの(ブックマークレット・URL指定)は外部の画像URLをそのまま表示する。
 *
 * 追加の方法(本人のみ)
 *   - 画像ファイルをボードにドラッグ&ドロップ / Ctrl+V で貼り付け / 「追加」→「ファイルを選ぶ」
 *   - 他のタブの画像をボードにドラッグ、または「追加」→「URLで追加」(YouTube・Vimeo・mp4 も可)
 *   - ブックマークレット: 見ているページの画像・動画を選んで追加(?rb_add=1 で開く追加画面)
 *
 * 権限: /rest/api/user/current のユーザー名が OWNER_USERNAME と一致するときだけ編集UIを表示する。
 *       これは表示の制御で、Confluence のページ編集権限の代わりにはならない。
 */
(function () {
  'use strict';

  var VERSION = '1.1.1';
  var CONFIG = {
    OWNER_USERNAME: '',                 // 自分のConfluenceユーザー名(一致する人だけ編集UIを表示)
    TARGET_PAGE_ID: '',                 // 保存先ページのID。空なら今開いているページ(追加専用ページから使うときに指定)
    PROPERTY_KEY: 'ref-board-data',     // 索引のキー。本体は <KEY>-00〜 に分割保存(通常は変更しない)
    SHARDS: 64,                         // 分割数(1個30,000バイト)。64で約1.9MB・Pinterestの画像で約4,500件。最大99。増やすのはよいが減らさない
    QUICK_ADD_PAGE_URL: '',             // 追加用ポップアップページのURL(空ならボードのページで追加画面を開く)
    DEFAULT_TAGS: ['UI', 'モーション', '質感・マテリアル', 'タイポグラフィ', '配色', 'エフェクト', 'キャラクター', '背景・美術', '写真'],
    DELETE_ATTACHMENTS: true,           // リファレンスを削除したとき、ページの添付画像もゴミ箱へ移す
    COLUMN_WIDTH: 236,                  // 一覧の1列の目安の幅(px)
    DISABLED_SPACES: [],                // このスペースキーでは閲覧のみ
    DISABLED_DOMAINS: [],
    DISABLED_URLS: [],
    ROOT_ID: 'ref-board-root'
  };
  var USER_CONFIG = window.REF_BOARD_CONFIG || {};
  Object.keys(CONFIG).forEach(function (k) { if (USER_CONFIG[k] !== undefined) CONFIG[k] = USER_CONFIG[k]; });
  window.ReferenceBoard = { version: VERSION };

  var CTX = '';
  try { if (window.AJS && typeof AJS.contextPath === 'function') CTX = AJS.contextPath() || ''; } catch (_) {}
  // Content Property 用。Confluence が /confluence などの下にあっても動くように前にパスを付ける
  function cfFetch(url, init) { return window.fetch(CTX + url, init); }

/*@@LCSTORE@@*/

  // ==================================================================
  // 小物
  // ==================================================================
  var TAG_PALETTE = ['#5B5BD6', '#D97757', '#2F9E6E', '#C4478A', '#3B82C4', '#B58900', '#6B7280', '#8E5BD6', '#2A9DA8'];
  function tagColor(tag, all) { var i = all.indexOf(tag); return TAG_PALETTE[(i < 0 ? 0 : i) % TAG_PALETTE.length]; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function uid() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function domainOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return ''; } }
  function isHttp(u) { return /^https?:\/\//i.test(String(u || '')); }
  function splitTags(s) {
    var out = [];
    String(s || '').split(/[,、，]/).map(function (t) { return t.trim().slice(0, 60); }).forEach(function (t) { if (t && out.indexOf(t) < 0) out.push(t); });
    return out.slice(0, 20);
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) {} }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function fmtDate(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate(); }
  function fmtBytes(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

  // 動画の判定
  function youtubeId(u) {
    var m = String(u || '').match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }
  function isShorts(u) { return /youtube\.com\/shorts\//.test(String(u || '')); }
  function vimeoId(u) { var m = String(u || '').match(/vimeo\.com\/(?:video\/)?(\d{6,})/); return m ? m[1] : null; }
  function isVideoFile(u) { return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(String(u || '')); }
  function isImageUrl(u) { return /\.(jpe?g|png|gif|webp|avif|svg|bmp)(\?|#|$)/i.test(String(u || '')) || /(pbs\.twimg\.com\/media|i\.pinimg\.com|images\.unsplash\.com|cdn\.dribbble\.com|cdna\.artstation\.com|cdnb\.artstation\.com)/.test(String(u || '')); }
  function videoProvider(u) { return youtubeId(u) ? 'YouTube' : vimeoId(u) ? 'Vimeo' : isVideoFile(u) ? '動画' : ''; }
  // 期限付きで消えやすい画像URL(コピー保存をすすめる)
  function isFragileUrl(u) { return /(cdninstagram|fbcdn\.net|discordapp|media\.discord|X-Amz-Signature|[?&]Expires=|[?&]oe=[0-9a-f]{8})/i.test(String(u || '')); }

  // ==================================================================
  // ページ・ユーザー
  // ==================================================================
  function getPageId() {
    try { if (window.AJS && AJS.Meta && AJS.Meta.get('page-id')) return AJS.Meta.get('page-id'); } catch (_) {}
    var m = location.href.match(/[?&]pageId=(\d+)/); if (m) return m[1];
    m = location.pathname.match(/\/pages\/(\d+)/); return m ? m[1] : null;
  }
  function getSpaceKey() {
    try { if (window.AJS && AJS.Meta && AJS.Meta.get('space-key')) return AJS.Meta.get('space-key'); } catch (_) {}
    var m = location.pathname.match(/\/display\/([^\/]+)\//); return m ? m[1] : null;
  }
  function isEditDisabledHere() {
    var s = getSpaceKey();
    if (s && CONFIG.DISABLED_SPACES.indexOf(s) !== -1) return true;
    if (CONFIG.DISABLED_DOMAINS.some(function (d) { return location.hostname.indexOf(d) !== -1; })) return true;
    if (CONFIG.DISABLED_URLS.some(function (u) { return location.href.indexOf(u) !== -1; })) return true;
    return false;
  }
  function apiCurrentUser() {
    return cfFetch('/rest/api/user/current', { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('user ' + r.status); return r.json(); });
  }
  function apiPageInfo(id) {
    return cfFetch('/rest/api/content/' + encodeURIComponent(id) + '?expand=space', { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('page ' + r.status); return r.json(); });
  }

  // ==================================================================
  // 添付ファイル
  // ==================================================================
  // 表示用URL。テスト用ページでは window.__RB_ATT_HREF で差し替える
  function attHref(pageId, name) {
    if (window.__RB_ATT_HREF) return window.__RB_ATT_HREF(pageId, name);
    return CTX + '/download/attachments/' + encodeURIComponent(pageId) + '/' + encodeURIComponent(name) + '?api=v2';
  }
  async function uploadAttachment(pageId, blob, name, comment) {
    var fd = new FormData();
    fd.append('file', blob, name);
    fd.append('minorEdit', 'true'); // ウォッチしている人に通知を出さない
    if (comment) fd.append('comment', comment.slice(0, 250));
    var res = await cfFetch('/rest/api/content/' + encodeURIComponent(pageId) + '/child/attachment', {
      method: 'POST', credentials: 'same-origin', headers: { 'X-Atlassian-Token': 'nocheck', Accept: 'application/json' }, body: fd
    });
    if (!res.ok) {
      var t = ''; try { t = await res.text(); } catch (_) {}
      var e = new Error(res.status === 413 ? 'ファイルが大きすぎます(添付の上限を超えています)' : '添付に失敗しました HTTP ' + res.status + (t ? ': ' + t.slice(0, 120) : ''));
      e.status = res.status; throw e;
    }
    var d = await res.json();
    var r = d && d.results ? d.results[0] : d;
    return { id: String(r.id), name: r.title || name };
  }
  async function deleteAttachment(id) {
    var res = await cfFetch('/rest/api/content/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'same-origin', headers: { 'X-Atlassian-Token': 'nocheck' } });
    if (!res.ok && res.status !== 404) throw new Error('添付の削除に失敗しました HTTP ' + res.status);
  }

  // 画像ファイルから 大きさ・代表色・一覧用の縮小画像 を作る
  var THUMB_W = 480;
  function loadImageEl(src) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.decoding = 'async';
      im.onload = function () { resolve(im); };
      im.onerror = function () { reject(new Error('画像として読み込めませんでした')); };
      im.src = src;
    });
  }
  function canvasBlob(cv, type, q) { return new Promise(function (r) { cv.toBlob(function (b) { r(b); }, type, q); }); }
  var WEBP_OK = (function () { try { var c = document.createElement('canvas'); c.width = c.height = 1; return c.toDataURL('image/webp').indexOf('data:image/webp') === 0; } catch (_) { return false; } })();
  async function prepareImage(blob) {
    var url = URL.createObjectURL(blob);
    try {
      var im = await loadImageEl(url);
      var w = im.naturalWidth || 0, h = im.naturalHeight || 0;
      var isSvg = /svg/.test(blob.type), isGif = /gif/.test(blob.type);
      var color = null, thumb = null;
      try {
        var c1 = document.createElement('canvas'); c1.width = c1.height = 1;
        var x1 = c1.getContext('2d'); x1.drawImage(im, 0, 0, 1, 1);
        var p = x1.getImageData(0, 0, 1, 1).data;
        color = '#' + [p[0], p[1], p[2]].map(function (n) { return (n < 16 ? '0' : '') + n.toString(16); }).join('');
      } catch (_) {}
      // 縮小画像は「幅が大きい」か「ファイルが重い」ときだけ。GIFは4MBを超えるときだけ(静止画になる)
      var needThumb = !isSvg && w > 0 && (isGif ? blob.size > 4 * 1048576 : (w > THUMB_W * 1.4 || blob.size > 450 * 1024));
      if (needThumb) {
        var tw = Math.min(THUMB_W, w), th = Math.max(1, Math.round(h * tw / w));
        var cv = document.createElement('canvas'); cv.width = tw; cv.height = th;
        var cx = cv.getContext('2d');
        cx.fillStyle = color || '#f2f2f2'; cx.fillRect(0, 0, tw, th);
        cx.imageSmoothingQuality = 'high';
        cx.drawImage(im, 0, 0, tw, th);
        thumb = await canvasBlob(cv, WEBP_OK ? 'image/webp' : 'image/jpeg', 0.84);
      }
      return { w: w, h: h, color: color, thumb: thumb, thumbExt: WEBP_OK ? 'webp' : 'jpg' };
    } finally { URL.revokeObjectURL(url); }
  }
  function extFor(blob, name) {
    var m = String(name || '').match(/\.(jpe?g|png|gif|webp|avif|svg|bmp)$/i);
    if (m) return m[1].toLowerCase();
    var t = String(blob.type || '').split('/')[1] || 'png';
    return t === 'jpeg' ? 'jpg' : t.replace(/\+xml$/, '');
  }
  // 画像1枚を添付して、リファレンスの項目を返す
  // 種類が分からないファイル(サーバーが octet-stream で返す等)は先頭のバイト列で判定する
  async function sniffImageType(blob) {
    var b = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    function at(i, s) { for (var k = 0; k < s.length; k++) if (b[i + k] !== s.charCodeAt(k)) return false; return true; }
    if (b[0] === 0xFF && b[1] === 0xD8) return 'image/jpeg';
    if (b[0] === 0x89 && at(1, 'PNG')) return 'image/png';
    if (at(0, 'GIF8')) return 'image/gif';
    if (at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp';
    if (at(4, 'ftypavif')) return 'image/avif';
    if (at(0, 'BM')) return 'image/bmp';
    return '';
  }
  async function attachImage(pageId, blob, fileName, base) {
    if (!/^image\//.test(blob.type || '')) {
      var t = await sniffImageType(blob);
      if (!t && /\.svg$/i.test(fileName || '')) t = 'image/svg+xml';
      if (!t) throw new Error('画像ファイルではありません');
      blob = new Blob([blob], { type: t });
      if (!/\.(jpe?g|png|gif|webp|avif|svg|bmp)$/i.test(fileName || '')) fileName = '';
    }
    var info = await prepareImage(blob);
    var id = base.id || uid();
    var name = 'rb-' + id + '.' + extFor(blob, fileName);
    var a = await uploadAttachment(pageId, blob, name, 'リファレンスボード: ' + (base.title || fileName || ''));
    var att = { id: a.id, n: a.name };
    if (info.thumb) {
      try { var t = await uploadAttachment(pageId, info.thumb, 'rb-' + id + '-t.' + info.thumbExt, 'リファレンスボード 縮小画像'); att.tid = t.id; att.t = t.name; } catch (_) {}
    }
    return Object.assign({}, base, { id: id, kind: 'image', att: att, w: info.w || undefined, h: info.h || undefined, c: info.color || undefined, gif: /gif/.test(blob.type) || undefined });
  }

  // ==================================================================
  // 項目の形と表示用の値
  //  { id, kind:'image'|'video', src?:外部URL, att?:{id,n,tid?,t?}, thumb?, w?, h?, c?, gif?,
  //    title, page?:見つけたページ, tags:[], memo, createdAt }
  // ==================================================================
  function normalizeItem(x) {
    if (!x || typeof x !== 'object') return null;
    var it = {
      id: typeof x.id === 'string' && x.id ? x.id.slice(0, 40) : uid(),
      kind: x.kind === 'video' ? 'video' : 'image',
      title: String(x.title || '').slice(0, 300),
      tags: Array.isArray(x.tags) ? x.tags.filter(function (t) { return typeof t === 'string' && t; }).map(function (t) { return t.slice(0, 60); }).slice(0, 20) : splitTags(x.tags),
      memo: String(x.memo || x.description || '').slice(0, 2000),
      createdAt: x.createdAt && !isNaN(Date.parse(x.createdAt)) ? x.createdAt : new Date().toISOString()
    };
    var src = x.src || x.imageUrl || x.image || (x.url && (isImageUrl(x.url) || videoProvider(x.url)) ? x.url : '');
    if (src && isHttp(src)) it.src = String(src).slice(0, 2000);
    if (x.att && x.att.n) {
      it.att = { id: String(x.att.id || ''), n: String(x.att.n) };
      if (x.att.t) { it.att.t = String(x.att.t); it.att.tid = String(x.att.tid || ''); }
    }
    if (!it.src && !it.att) return null;
    if (it.src && x.kind !== 'image' && videoProvider(it.src)) it.kind = 'video';
    var page = x.page || x.sourceUrl || (x.url && x.url !== it.src ? x.url : '');
    if (page && isHttp(page)) it.page = String(page).slice(0, 2000);
    if (x.thumb && isHttp(x.thumb)) it.thumb = String(x.thumb).slice(0, 2000);
    if (+x.w > 0 && +x.h > 0) { it.w = Math.round(+x.w); it.h = Math.round(+x.h); }
    if (/^#[0-9a-f]{6}$/i.test(x.c || '')) it.c = x.c;
    if (x.gif) it.gif = true;
    return it;
  }
  function thumbOf(it, pageId) {
    if (it.att) return attHref(pageId, it.att.t || it.att.n);
    if (it.thumb) return it.thumb;
    // Pinterest の元画像は、一覧では 474px 幅の版を使う(URLの originals を 474x に置き換えるだけで得られる)
    if (it.kind === 'image' && /^https:\/\/i\.pinimg\.com\/originals\//.test(it.src || '')) return it.src.replace('/originals/', '/474x/');
    var y = youtubeId(it.src); if (y) return 'https://i.ytimg.com/vi/' + y + '/hqdefault.jpg';
    if (it.kind === 'image') return it.src;
    return null;
  }
  function fullOf(it, pageId) { return it.att ? attHref(pageId, it.att.n) : it.src; }
  function ratioOf(it) {
    if (it.kind === 'video' && !it.w) return isShorts(it.src) ? 16 / 9 : 9 / 16;
    var r = it.w && it.h ? it.h / it.w : 1.25;
    return Math.max(0.42, Math.min(2.4, r));
  }
  function searchText(it) {
    return [it.title, it.memo, (it.tags || []).join(' '), domainOf(it.page || ''), domainOf(it.src || ''), it.att ? it.att.n : ''].join(' ').toLowerCase();
  }
  function keyOf(it) { return it.src ? it.src.replace(/^https?:/, '') : (it.att ? 'att:' + it.att.n : it.id); }

  var ICON = {
    search: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 10.5 14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    plus: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    bookmark: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4.5 2.5h7v11L8 11l-3.5 2.5z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    importI: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 2.5v7.5M5 7l3 3 3-3M3 12.5h10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    exportI: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 10V2.5M5 5.5l3-3 3 3M3 12.5h10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    edit: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10.5 3 13 5.5 6 12.5H3.5V10z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    trash: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    out: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M9 3h4v4M13 3 7.5 8.5M11 9.5V13H3V5h3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    play: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M5 3.2v9.6L12.6 8z" fill="currentColor"/></svg>',
    file: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M3.5 2.5h6l3 3v8h-9z M9.5 2.5v3h3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    link: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-.7.7M9.2 6.8a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l.7-.7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    close: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    left: '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    right: '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    check: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  // BIZ UDPゴシック。Shadow DOM内の@font-faceは効かないため、ページ側の<head>に読み込む(リンク集と共通のID)
  if (!document.getElementById('lc-font-biz-udp')) {
    var fl = document.createElement('link'); fl.id = 'lc-font-biz-udp'; fl.rel = 'stylesheet';
    fl.href = 'https://fonts.googleapis.com/css2?family=BIZ+UDPGothic:wght@400;700&display=swap';
    document.head.appendChild(fl);
  }

  var hostEl = document.getElementById(CONFIG.ROOT_ID);
  if (!hostEl) { if (window.console) console.warn('[reference-board] #' + CONFIG.ROOT_ID + ' が見つかりません'); return; }
  if (hostEl.shadowRoot) return; // 二重読み込み防止
  var root = hostEl.attachShadow({ mode: 'open' });
  // ---------- Confluence のキーボードショートカットとの共存 ----------
  // Confluence はページ全体で e(編集)・/(検索)・c(作成)・s(共有)・[(サイドバー) などの1文字キーに反応する。
  // ボードは Shadow DOM の中にあるため、ボードの入力欄で打ったキーはページ側からは「ボードの枠で押された」ように見え、
  // Confluence が入力中だと気づけずにショートカットが動いてしまう。そこで
  //   ・ボードの入力欄で打っているとき
  //   ・詳細やモーダル(追加画面を含む)を開いているとき
  // はキーをページ側に渡さない。それ以外(一覧を見ているだけのとき)は Confluence のショートカットがそのまま使える。
  var KEYS = { active: function () { return false; }, handle: function () {} };
  function isTyping(e) {
    var t = e.composedPath ? e.composedPath()[0] : e.target;
    return !!(t && t.nodeType === 1 && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable));
  }
  ['keydown', 'keypress', 'keyup'].forEach(function (type) {
    // ボードの中で押されたキー: ボード側で処理してから、ページ側へは渡さない
    hostEl.addEventListener(type, function (e) {
      var active = KEYS.active();
      if (active && type === 'keydown') KEYS.handle(e);
      if (active || isTyping(e)) e.stopPropagation();
    });
    // ボードの外(ページ本体)にフォーカスがあるまま詳細などを開いているとき: 先に受け取って止める
    window.addEventListener(type, function (e) {
      if (!KEYS.active() || (e.composedPath && e.composedPath().indexOf(hostEl) >= 0)) return;
      if (type === 'keydown') KEYS.handle(e);
      e.stopPropagation();
    }, true);
  });

  var styleEl = document.createElement('style');
  styleEl.textContent = CSS();
  root.appendChild(styleEl);

  var PARAMS = new URLSearchParams(location.search);
  var QUICK = PARAMS.get('rb_add') === '1';
  var PAGE_ID = CONFIG.TARGET_PAGE_ID ? String(CONFIG.TARGET_PAGE_ID) : getPageId();

/*@@BOARD@@*/

/*@@QUICK@@*/

/*@@CSS@@*/

  if (QUICK) initQuickAdd(); else initBoard();
})();
