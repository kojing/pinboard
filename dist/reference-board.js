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

  // BEGIN LC STORE (link-collector.html と link-collector-quick-add.html で同じ内容)
  // リンク本体を複数のContent Property(<KEY>-00〜、既定16個・最大99個)に分けて保存する。<KEY>本体はタグと取込状況だけの小さな索引。
  // 1個あたりは公式ドキュメントの32KBより少し小さい30,000バイト(UTF-8)までに抑える。
  var LCStore = (function () {
    var DEFAULT_SHARDS = 16, LIMIT = 30000;
    function size(v) { return new TextEncoder().encode(JSON.stringify(v)).length; }
    // shards: 分割数。増やすのは後からでもよいが、減らすと後ろの領域の項目が読めなくなるので減らさない
    function create(pageId, metaKey, fetchImpl, shards) {
      var SHARDS = Math.max(1, Math.min(99, Math.floor(+shards) || DEFAULT_SHARDS));
      var f = fetchImpl || window.fetch.bind(window);
      var base = '/rest/api/content/' + encodeURIComponent(pageId) + '/property';
      var st = { meta: {}, shardBytes: [], shardOf: new Map(), snap: new Map(), tagsSnap: null, legacy: null };
      function key(i) { return metaKey + '-' + (i < 10 ? '0' : '') + i; }

      async function req(method, path, body) {
        var res = await f(base + path, {
          method: method, credentials: 'same-origin', cache: 'no-store',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined
        });
        if (res.status === 404 && method === 'GET') return null;
        if (!res.ok) {
          var t = ''; try { t = await res.text(); } catch (_) {}
          var e = new Error('Confluence HTTP ' + res.status + (t ? ': ' + t.slice(0, 160) : ''));
          e.status = res.status; throw e;
        }
        return res.json();
      }
      async function getOne(k) {
        var d = await req('GET', '/' + encodeURIComponent(k));
        return d ? { value: d.value, version: d.version.number } : { value: null, version: null };
      }
      async function put(k, value, version) {
        if (version == null) return (await req('POST', '', { key: k, value: value })).version.number;
        return (await req('PUT', '/' + encodeURIComponent(k), { key: k, value: value, version: { number: version + 1 } })).version.number;
      }
      // 最新を読み直してから書く。別ウィンドウ(追加用ポップアップ等)と同時に保存しても上書きで消えないように、409なら読み直して再試行。
      async function mutate(k, fn) {
        for (var attempt = 0; attempt < 4; attempt++) {
          var g = await getOne(k);
          var v = g.value && typeof g.value === 'object' ? g.value : {};
          var r = fn(v) || {};
          if (r.changed === false) return { result: r, value: v };
          try { await put(k, v, g.version); return { result: r, value: v }; }
          catch (e) { if (e.status === 409 || (g.version == null && e.status === 400)) continue; throw e; }
        }
        throw new Error('別の保存と競合しました。ページを再読み込みしてください。');
      }
      function mutateShard(i, fn) {
        return mutate(key(i), function (v) { v.items = Array.isArray(v.items) ? v.items : []; return fn(v); })
          .then(function (out) { st.shardBytes[i] = size(out.value); return out.result; });
      }
      function mutateMeta(fn) {
        return mutate(metaKey, fn).then(function (out) { st.meta = out.value; return out.result; });
      }

      async function listAll() {
        var out = {};
        for (var start = 0; start < 1000; start += 50) {
          var d = await req('GET', '?expand=version&limit=50&start=' + start);
          var rs = (d && d.results) || [];
          rs.forEach(function (p) { out[p.key] = p; });
          if (rs.length < 50) break;
        }
        return out;
      }

      // 新規アイテムを空きの多い領域から順に詰める。入りきらなければ次の領域へ。
      async function place(list) {
        var pending = list.slice(), tried = new Set();
        while (pending.length) {
          var pick = -1;
          for (var i = 0; i < SHARDS; i++) if (!tried.has(i) && (pick < 0 || (st.shardBytes[i] || 0) < (st.shardBytes[pick] || 0))) pick = i;
          if (pick < 0) throw new Error('保存領域(' + SHARDS + '個)がいっぱいです。' + pending.length + '件を保存できませんでした。不要なリンクを削除してください。');
          tried.add(pick);
          var batch = pending;
          var r = await mutateShard(pick, function (v) {
            var rest = [], placed = [];
            batch.forEach(function (x) {
              v.items.push(x);
              if (size(v) > LIMIT) { v.items.pop(); rest.push(x); } else placed.push(x);
            });
            return { changed: placed.length > 0, rest: rest, placed: placed };
          });
          (r.placed || []).forEach(function (x) { st.shardOf.set(x.id, pick); st.snap.set(x.id, JSON.stringify(x)); });
          pending = r.rest || batch;
        }
      }

      async function load() {
        var wanted = [metaKey]; for (var i = 0; i < SHARDS; i++) wanted.push(key(i));
        var got = {}, props = null;
        try { props = await listAll(); } catch (_) { props = null; }
        var listOk = props && wanted.every(function (k) { return !props[k] || (props[k].value !== undefined && props[k].version); });
        if (listOk) {
          wanted.forEach(function (k) { got[k] = props[k] ? { value: props[k].value, version: props[k].version.number } : { value: null, version: null }; });
        } else {
          var arr = await Promise.all(wanted.map(getOne));
          wanted.forEach(function (k, n) { got[k] = arr[n]; });
        }
        st.meta = got[metaKey].value || {};
        st.shardOf = new Map(); st.snap = new Map();
        var items = [];
        for (var s = 0; s < SHARDS; s++) {
          var v = got[key(s)].value || { items: [] };
          st.shardBytes[s] = size(v);
          (v.items || []).forEach(function (x) {
            if (!x || !x.id || st.shardOf.has(x.id)) return;
            st.shardOf.set(x.id, s); st.snap.set(x.id, JSON.stringify(x)); items.push(x);
          });
        }
        // 旧形式(索引にitemsを直接持っていた)のデータは読み取り専用で一緒に表示し、書き込みは本人が保存するときに移行する。
        st.legacy = Array.isArray(st.meta.items) ? st.meta.items.filter(function (x) { return x && x.id && !st.shardOf.has(x.id); }) : null;
        (st.legacy || []).forEach(function (x) { items.push(x); });
        items.sort(function (a, b) { return String(a.createdAt || '').localeCompare(String(b.createdAt || '')); });
        var tags = (st.meta.tags && st.meta.tags.length) ? st.meta.tags : (st.meta.categories && st.meta.categories.length) ? st.meta.categories : null;
        st.tagsSnap = JSON.stringify(tags);
        return { items: items, tags: tags, meta: st.meta };
      }

      // 旧形式からの移行。先に分割先へ書いてから索引を小さくするので、途中で失敗しても旧データは残る。
      async function migrate() {
        if (!st.legacy) return false;
        if (st.legacy.length) await place(st.legacy);
        await mutateMeta(function (m) {
          delete m.items; m.schema = 2; m.shards = SHARDS;
          if (!m.tags && m.categories) m.tags = m.categories;
        });
        st.legacy = null;
        return true;
      }

      // 画面上の一覧(items)と前回保存した状態の差分だけを、該当する領域に書き込む。
      async function sync(items, tags) {
        await migrate();
        var byId = new Map(items.map(function (x) { return [x.id, x]; }));
        var ops = new Map();
        function op(i) { if (!ops.has(i)) ops.set(i, { remove: new Set(), upsert: new Map() }); return ops.get(i); }
        st.shardOf.forEach(function (i, id) { if (!byId.has(id)) op(i).remove.add(id); });
        var fresh = [];
        items.forEach(function (x) {
          if (!st.shardOf.has(x.id)) fresh.push(x);
          else if (st.snap.get(x.id) !== JSON.stringify(x)) op(st.shardOf.get(x.id)).upsert.set(x.id, x);
        });
        var moved = [];
        for (var entry of ops) {
          var i = entry[0], o = entry[1];
          var r = await mutateShard(i, function (v) {
            var out = [], over = [];
            v.items = v.items.filter(function (x) { return !o.remove.has(x.id); })
              .map(function (x) { return o.upsert.has(x.id) ? o.upsert.get(x.id) : x; });
            // 編集で大きくなって入りきらない場合は、その項目だけ別の領域へ移す
            while (size(v) > LIMIT) {
              var idx = -1;
              for (var n = v.items.length - 1; n >= 0; n--) if (o.upsert.has(v.items[n].id)) { idx = n; break; }
              if (idx < 0) break;
              over.push(v.items.splice(idx, 1)[0]);
            }
            return { over: over };
          });
          o.remove.forEach(function (id) { st.shardOf.delete(id); st.snap.delete(id); });
          o.upsert.forEach(function (x, id) { st.snap.set(id, JSON.stringify(x)); });
          (r.over || []).forEach(function (x) { st.shardOf.delete(x.id); moved.push(x); });
        }
        if (fresh.length || moved.length) await place(fresh.concat(moved));
        if (tags && JSON.stringify(tags) !== st.tagsSnap) {
          await mutateMeta(function (m) {
            var merged = tags.slice();
            (Array.isArray(m.tags) ? m.tags : []).forEach(function (t) { if (merged.indexOf(t) < 0) merged.push(t); });
            m.tags = merged; m.schema = 2; m.shards = SHARDS;
          });
          st.tagsSnap = JSON.stringify(tags);
        }
      }

      // 追加専用(ポップアップ用): 他のアイテムには触れずに足すだけ。
      async function addItems(newItems, tags) {
        await migrate();
        await place(newItems);
        if (tags && JSON.stringify(tags) !== st.tagsSnap) {
          await mutateMeta(function (m) {
            var cur = Array.isArray(m.tags) ? m.tags : [];
            tags.forEach(function (t) { if (cur.indexOf(t) < 0) cur.push(t); });
            m.tags = cur; m.schema = 2; m.shards = SHARDS;
          });
          st.tagsSnap = JSON.stringify(st.meta.tags);
        }
      }

      function usage() {
        var used = 0; for (var i = 0; i < SHARDS; i++) used += st.shardBytes[i] || 0;
        return { used: used, total: SHARDS * LIMIT };
      }
      return { shards: SHARDS, load: load, migrate: migrate, needsMigration: function () { return !!st.legacy; }, sync: sync, addItems: addItems, mutateMeta: mutateMeta, usage: usage, meta: function () { return st.meta; } };
    }
    return { create: create, SHARDS: DEFAULT_SHARDS, LIMIT: LIMIT };
  })();
  // END LC STORE

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

  // ==================================================================
  // ボード本体
  // ==================================================================
  var state = {
    isOwner: false, store: null, items: [], tags: CONFIG.DEFAULT_TAGS.slice(),
    q: '', kind: 'all', selTags: [], filtered: [], shown: 0,
    nCols: 0, colW: 0, colH: [], lb: -1, loadedAt: 0, busy: false
  };
  var els = {};
  var RENDER_CHUNK = 40, GAP = 14;

  function initBoard() {
    var app = document.createElement('div');
    app.className = 'rb-app';
    app.innerHTML =
      '<div class="rb-bar">' +
        '<label class="rb-search">' + ICON.search + '<input type="search" placeholder="タイトル・メモ・タグ・サイトで検索" aria-label="検索"></label>' +
        '<div class="rb-seg" role="group" aria-label="種類">' +
          '<button type="button" data-kind="all" aria-pressed="true">すべて</button>' +
          '<button type="button" data-kind="image" aria-pressed="false">画像</button>' +
          '<button type="button" data-kind="video" aria-pressed="false">動画</button>' +
        '</div>' +
        '<span class="rb-count"></span>' +
        '<span class="rb-spacer"></span>' +
        '<div class="rb-actions" hidden>' +
          '<button type="button" class="rb-btn rb-b-bm">' + ICON.bookmark + '<span>ブックマークレット</span></button>' +
          '<button type="button" class="rb-btn rb-b-import">' + ICON.importI + '<span>インポート</span></button>' +
          '<button type="button" class="rb-btn rb-b-export">' + ICON.exportI + '<span>エクスポート</span></button>' +
          '<div class="rb-menu-wrap">' +
            '<button type="button" class="rb-btn rb-btn-primary rb-b-add" aria-haspopup="true" aria-expanded="false">' + ICON.plus + '<span>追加</span></button>' +
            '<div class="rb-menu" hidden>' +
              '<button type="button" data-add="file">' + ICON.file + '<span>画像ファイルを選ぶ<small>ドラッグ&ドロップ・Ctrl+V でも追加できます</small></span></button>' +
              '<button type="button" data-add="url">' + ICON.link + '<span>URLで追加<small>画像URL・YouTube・Vimeo・mp4</small></span></button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="rb-tags"></div>' +
      '<div class="rb-status" role="status"></div>' +
      '<div class="rb-grid"></div>' +
      '<div class="rb-more"></div>' +
      '<div class="rb-foot"></div>' +
      '<div class="rb-drop" hidden><div class="rb-drop-msg">' + ICON.plus + '<b>ここにドロップしてボードに追加</b><span>画像ファイル、または他のタブの画像</span></div></div>' +
      '<input type="file" class="rb-file" accept="image/*" multiple hidden>';
    root.appendChild(app);

    var overlay = document.createElement('div');
    overlay.className = 'rb-overlay'; overlay.hidden = true;
    overlay.innerHTML = '<div class="rb-modal" role="dialog" aria-modal="true"></div>';
    root.appendChild(overlay);

    var lb = document.createElement('div');
    lb.className = 'rb-lb'; lb.hidden = true; lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-modal', 'true'); lb.setAttribute('aria-label', 'リファレンスの詳細');
    root.appendChild(lb);

    var toast = document.createElement('div');
    toast.className = 'rb-toast'; toast.hidden = true; toast.setAttribute('role', 'status');
    root.appendChild(toast);

    els = {
      app: app, search: app.querySelector('.rb-search input'), seg: app.querySelector('.rb-seg'), count: app.querySelector('.rb-count'),
      actions: app.querySelector('.rb-actions'), tags: app.querySelector('.rb-tags'), status: app.querySelector('.rb-status'),
      grid: app.querySelector('.rb-grid'), more: app.querySelector('.rb-more'), foot: app.querySelector('.rb-foot'),
      drop: app.querySelector('.rb-drop'), file: app.querySelector('.rb-file'),
      menu: app.querySelector('.rb-menu'), addBtn: app.querySelector('.rb-b-add'),
      overlay: overlay, modal: overlay.querySelector('.rb-modal'), lb: lb, toast: toast
    };

    // 検索・種類
    var qTimer = 0;
    els.search.addEventListener('input', function () { clearTimeout(qTimer); qTimer = setTimeout(function () { state.q = els.search.value.trim().toLowerCase(); render(); }, 120); });
    els.seg.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-kind]'); if (!b) return;
      state.kind = b.getAttribute('data-kind');
      els.seg.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      render();
    });
    // 追加メニュー
    els.addBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleMenu(); });
    els.menu.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-add]'); if (!b) return;
      toggleMenu(false);
      if (b.getAttribute('data-add') === 'file') els.file.click(); else openUrlModal({});
    });
    root.addEventListener('click', function (e) { if (!els.menu.hidden && !e.target.closest('.rb-menu-wrap')) toggleMenu(false); });
    els.file.addEventListener('change', function () { var f = Array.prototype.slice.call(els.file.files || []); els.file.value = ''; if (f.length) addFiles(f); });
    app.querySelector('.rb-b-bm').addEventListener('click', openBookmarkletModal);
    app.querySelector('.rb-b-import').addEventListener('click', openImportModal);
    app.querySelector('.rb-b-export').addEventListener('click', exportJson);

    // カード
    els.grid.addEventListener('click', onGridClick);
    els.grid.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('rb-card')) { e.preventDefault(); openLightbox(e.target.getAttribute('data-id')); }
    });
    els.grid.addEventListener('error', onMediaError, true);
    els.grid.addEventListener('load', onMediaLoad, true);
    els.grid.addEventListener('dragstart', function (e) { if (e.target.closest && e.target.closest('.rb-card')) { try { e.dataTransfer.setData('application/x-rb-card', '1'); } catch (_) {} } });
    els.grid.addEventListener('mouseover', function (e) { var v = e.target.closest && e.target.closest('.rb-card video'); if (v) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } });
    els.grid.addEventListener('mouseout', function (e) { var v = e.target.closest && e.target.closest('.rb-card video'); if (v && !v.contains(e.relatedTarget)) v.pause(); });

    // 続きの読み込みと列数の変化
    state.moreObs = new IntersectionObserver(function (en) { en.forEach(function (x) { if (x.isIntersecting) renderMore(); }); }, { rootMargin: '900px' });
    state.moreObs.observe(els.more);
    if (window.ResizeObserver) new ResizeObserver(function () { if (state.filtered.length && colCount() !== state.nCols) relayout(); }).observe(els.grid);

    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay && !state.busy) closeModal(); });
    KEYS.active = function () { return !els.lb.hidden || !els.overlay.hidden; };
    KEYS.handle = onKey;
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') refreshIfStale(); });

    if (!PAGE_ID) { setStatus('ページIDが取得できませんでした。ページを保存してから開いてください。', true); return; }
    setStatus('読み込み中…');
    state.store = LCStore.create(PAGE_ID, CONFIG.PROPERTY_KEY, cfFetch, CONFIG.SHARDS);
    var userP = apiCurrentUser().catch(function () { return null; });
    Promise.all([userP, state.store.load()]).then(function (r) {
      var u = r[0], data = r[1];
      var name = u && (u.username || u.name);
      state.isOwner = !!(u && CONFIG.OWNER_USERNAME && name === CONFIG.OWNER_USERNAME && !isEditDisabledHere());
      applyData(data);
      els.actions.hidden = !state.isOwner;
      if (state.isOwner) enableDrop();
      setStatus(state.items.length ? '' : (state.isOwner ? '' : 'まだリファレンスがありません'));
      renderTags(); render(); renderFoot();
    }).catch(function (err) {
      console.error(err);
      setStatus('読み込みに失敗しました: ' + err.message, true);
    });
  }

  function applyData(data) {
    state.items = (data.items || []).filter(function (x) { return x && x.id && (x.src || (x.att && x.att.n)); });
    state.tags = data.tags && data.tags.length ? data.tags.slice() : CONFIG.DEFAULT_TAGS.slice();
    state.items.forEach(function (it) { (it.tags || []).forEach(function (t) { if (state.tags.indexOf(t) < 0) state.tags.push(t); }); });
    state.loadedAt = Date.now();
  }
  // 別のタブ(追加用ポップアップなど)で増えた分を、戻ってきたときに反映する
  function refreshIfStale() {
    if (!state.store || state.busy || !els.overlay.hidden || !els.lb.hidden || Date.now() - state.loadedAt < 2000) return;
    var before = state.items.map(function (x) { return x.id; }).join();
    state.store.load().then(function (data) {
      applyData(data);
      if (state.items.map(function (x) { return x.id; }).join() !== before) { renderTags(); render(); renderFoot(); showToast('最新の状態を読み込みました'); }
    }).catch(function () {});
  }

  function setStatus(msg, isError) { els.status.textContent = msg || ''; els.status.className = 'rb-status' + (isError ? ' is-error' : ''); }
  var toastTimer = 0;
  function showToast(msg, isError) {
    els.toast.textContent = msg; els.toast.className = 'rb-toast' + (isError ? ' is-error' : ''); els.toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { els.toast.hidden = true; }, isError ? 6000 : 2600);
  }
  function toggleMenu(open) {
    var o = open === undefined ? els.menu.hidden : open;
    els.menu.hidden = !o; els.addBtn.setAttribute('aria-expanded', String(o));
  }
  function renderFoot() {
    if (!state.isOwner || !state.store) { els.foot.textContent = ''; return; }
    var u = state.store.usage();
    var pct = Math.round(u.used / u.total * 100);
    var atts = state.items.filter(function (x) { return x.att; }).length;
    els.foot.innerHTML = '<span>情報の保存領域 ' + pct + '% 使用(' + state.items.length + '件・うち添付 ' + atts + '件)</span><span>v' + VERSION + '</span>';
    els.foot.classList.toggle('is-warn', pct >= 85);
  }

  // 保存(変わった項目が入っている領域だけ書き込む)。失敗したら読み直す
  function persist(msg) {
    renderTags(); render();
    setStatus('保存中…');
    return state.store.sync(state.items, state.tags).then(function () {
      setStatus(''); renderFoot(); state.loadedAt = Date.now();
      if (msg) showToast(msg);
    }).catch(function (err) {
      console.error(err);
      setStatus('保存に失敗しました: ' + String(err.message).replace('不要なリンク', '不要なリファレンス'), true);
      return state.store.load().then(function (d) { applyData(d); renderTags(); render(); renderFoot(); });
    });
  }
  // 情報の保存領域(分割数×30,000バイト)がほぼいっぱいなら、画像を添付する前に止める
  function roomFor(n) {
    var u = state.store.usage();
    return u.total - u.used > 700 * Math.max(1, n);
  }
  var FULL_MSG = '情報の保存領域がいっぱいです。不要なリファレンスを削除してから追加してください。';
  function rememberTags(tags) {
    tags.forEach(function (t) { if (state.tags.indexOf(t) < 0) state.tags.push(t); });
    if (tags.length) lsSet('rb-last-tags:' + PAGE_ID, JSON.stringify(tags));
  }

  // ---------------- タグ ----------------
  function renderTags() {
    var used = {};
    state.items.forEach(function (it) { (it.tags || []).forEach(function (t) { used[t] = (used[t] || 0) + 1; }); });
    var list = state.tags.filter(function (t) { return used[t] || state.selTags.indexOf(t) >= 0; });
    state.selTags = state.selTags.filter(function (t) { return list.indexOf(t) >= 0; });
    if (!list.length) { els.tags.innerHTML = ''; return; }
    els.tags.innerHTML = list.map(function (t) {
      var on = state.selTags.indexOf(t) >= 0;
      return '<button type="button" class="rb-chip' + (on ? ' is-on' : '') + '" aria-pressed="' + on + '" data-tag="' + esc(t) + '" style="--dot:' + tagColor(t, state.tags) + '"><i></i>' + esc(t) + '<small>' + used[t] + '</small></button>';
    }).join('') + (state.selTags.length ? '<button type="button" class="rb-chip-clear">絞り込みを解除</button>' : '');
    els.tags.onclick = function (e) {
      var c = e.target.closest('.rb-chip');
      if (c) { toggleTag(c.getAttribute('data-tag')); return; }
      if (e.target.closest('.rb-chip-clear')) { state.selTags = []; renderTags(); render(); }
    };
  }
  function toggleTag(t, only) {
    if (only) state.selTags = [t];
    else { var i = state.selTags.indexOf(t); if (i < 0) state.selTags.push(t); else state.selTags.splice(i, 1); }
    renderTags(); render();
  }

  // ---------------- 石積み(マソンリー)表示 ----------------
  function colCount() {
    var W = els.grid.clientWidth || hostEl.clientWidth || 900;
    return Math.max(2, Math.floor((W + GAP) / (CONFIG.COLUMN_WIDTH + GAP)));
  }
  function render() {
    var q = state.q;
    state.filtered = state.items.filter(function (it) {
      if (state.kind !== 'all' && it.kind !== state.kind) return false;
      if (state.selTags.length && !state.selTags.some(function (t) { return (it.tags || []).indexOf(t) >= 0; })) return false;
      if (q && searchText(it).indexOf(q) < 0) return false;
      return true;
    }).reverse();
    els.count.textContent = state.filtered.length === state.items.length ? state.items.length + ' 件' : state.filtered.length + ' / ' + state.items.length + ' 件';
    relayout(0);
  }
  function relayout(keep) {
    var n = colCount();
    state.nCols = n;
    var W = els.grid.clientWidth || 900;
    state.colW = (W - GAP * (n - 1)) / n;
    state.colH = [];
    var html = '';
    for (var i = 0; i < n; i++) { html += '<div class="rb-col"></div>'; state.colH.push(0); }
    els.grid.innerHTML = state.filtered.length ? html : emptyHtml();
    els.grid.style.setProperty('--cols', n);
    var target = keep === 0 ? 0 : state.shown;
    state.shown = 0;
    renderMore(Math.max(target, RENDER_CHUNK));
  }
  function emptyHtml() {
    if (state.items.length) return '<div class="rb-empty">条件に合うリファレンスがありません</div>';
    if (!state.isOwner) return '<div class="rb-empty">まだリファレンスがありません</div>';
    return '<div class="rb-empty rb-empty-owner"><b>画像をここにドラッグ&ドロップ</b><span>または Ctrl+V で貼り付け、右上の「追加」、ブックマークレットからも追加できます</span></div>';
  }
  function renderMore(count) {
    var cols = els.grid.querySelectorAll('.rb-col');
    if (!cols.length) { els.more.textContent = ''; return; }
    var end = Math.min(state.filtered.length, state.shown + (count || RENDER_CHUNK));
    var frags = Array.prototype.map.call(cols, function () { return document.createDocumentFragment(); });
    var tpl = document.createElement('template');
    for (var i = state.shown; i < end; i++) {
      var it = state.filtered[i];
      var c = 0; for (var k = 1; k < state.colH.length; k++) if (state.colH[k] < state.colH[c] - 1) c = k;
      tpl.innerHTML = cardHtml(it);
      frags[c].appendChild(tpl.content.firstChild);
      state.colH[c] += state.colW * ratioOf(it) + GAP;
    }
    frags.forEach(function (f, n) { cols[n].appendChild(f); });
    state.shown = end;
    var rest = state.filtered.length - end;
    els.more.textContent = rest > 0 ? '続きを読み込み中…(残り ' + rest + ' 件)' : '';
    if (rest > 0) { state.moreObs.unobserve(els.more); state.moreObs.observe(els.more); }
  }
  function cardHtml(it) {
    var th = thumbOf(it, PAGE_ID);
    var prov = it.kind === 'video' ? videoProvider(it.src) || '動画' : '';
    var media;
    if (th) media = '<img src="' + esc(th) + '" alt="' + esc(it.title || '') + '" loading="lazy" decoding="async" referrerpolicy="no-referrer">';
    else if (it.kind === 'video' && isVideoFile(it.src)) media = '<video src="' + esc(it.src) + '#t=0.1" muted loop playsinline preload="metadata"></video>';
    else media = '<div class="rb-ph">' + ICON.play + '<span>' + esc(prov || domainOf(it.src)) + '</span></div>';
    return '<article class="rb-card" data-id="' + esc(it.id) + '" tabindex="0" aria-label="' + esc(it.title || domainOf(it.page || it.src) || 'リファレンス') + '">' +
      '<div class="rb-media" style="aspect-ratio:1/' + ratioOf(it).toFixed(4) + (it.c ? ';--c:' + it.c : '') + '">' + media + '</div>' +
    '</article>';
  }
  function itemById(id) { for (var i = 0; i < state.items.length; i++) if (state.items[i].id === id) return state.items[i]; return null; }
  function onGridClick(e) {
    var card = e.target.closest('.rb-card'); if (!card) return;
    openLightbox(card.getAttribute('data-id'));
  }
  function onMediaError(e) {
    var t = e.target; if (!t || (t.tagName !== 'IMG' && t.tagName !== 'VIDEO')) return;
    var box = t.closest('.rb-media'); if (!box || box.classList.contains('is-broken')) return;
    var it = itemById(box.parentNode.getAttribute('data-id'));
    // 縮小画像が無くなっていたら元画像で試す
    if (it && it.att && it.att.t && t.tagName === 'IMG' && t.getAttribute('src').indexOf(encodeURIComponent(it.att.t)) >= 0) { t.src = attHref(PAGE_ID, it.att.n); return; }
    box.classList.add('is-broken');
    var ph = document.createElement('div'); ph.className = 'rb-ph rb-ph-broken';
    ph.innerHTML = '<span>画像を表示できません</span><small>' + esc(it ? domainOf(it.src || '') || (it.att ? '添付: ' + it.att.n : '') : '') + '</small>';
    t.replaceWith(ph);
  }
  function onMediaLoad(e) {
    var t = e.target; if (!t || t.tagName !== 'IMG') return;
    var box = t.closest('.rb-media'); if (!box) return;
    var it = itemById(box.parentNode.getAttribute('data-id'));
    if (it && !it.w && t.naturalWidth && it.kind === 'image') box.style.aspectRatio = '1/' + Math.max(0.42, Math.min(2.4, t.naturalHeight / t.naturalWidth)).toFixed(4);
  }

  // ---------------- 詳細(ライトボックス) ----------------
  function openLightbox(id) {
    var i = -1; for (var n = 0; n < state.filtered.length; n++) if (state.filtered[n].id === id) { i = n; break; }
    if (i < 0) return;
    state.lb = i; state.lbReturn = root.activeElement;
    els.lb.hidden = false; lockScroll(true);
    drawLightbox();
  }
  function closeLightbox() {
    els.lb.hidden = true; els.lb.innerHTML = ''; state.lb = -1; lockScroll(false);
    if (state.lbReturn && state.lbReturn.focus) try { state.lbReturn.focus(); } catch (_) {}
  }
  function stepLightbox(d) {
    var n = state.lb + d; if (n < 0 || n >= state.filtered.length) return;
    state.lb = n; drawLightbox();
    if (n >= state.shown - 4) renderMore();
  }
  function drawLightbox() {
    var it = state.filtered[state.lb]; if (!it) return closeLightbox();
    var media, full = fullOf(it, PAGE_ID), y = youtubeId(it.src), v = vimeoId(it.src);
    if (it.kind === 'video' && y) media = '<div class="rb-lb-video' + (isShorts(it.src) ? ' is-tall' : '') + '"><iframe src="https://www.youtube-nocookie.com/embed/' + y + '?autoplay=1&rel=0&playsinline=1" title="YouTube" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>';
    else if (it.kind === 'video' && v) media = '<div class="rb-lb-video"><iframe src="https://player.vimeo.com/video/' + v + '?autoplay=1" title="Vimeo" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>';
    else if (it.kind === 'video') media = '<video src="' + esc(it.src) + '" controls autoplay loop muted playsinline></video>';
    else media = '<img src="' + esc(full) + '" alt="' + esc(it.title || '') + '" referrerpolicy="no-referrer">';
    var tags = (it.tags || []).map(function (t) { return '<button type="button" class="rb-chip" data-tag="' + esc(t) + '" style="--dot:' + tagColor(t, state.tags) + '"><i></i>' + esc(t) + '</button>'; }).join('');
    var links = '';
    if (it.page) links += '<a class="rb-btn" href="' + esc(it.page) + '" target="_blank" rel="noopener noreferrer">' + ICON.out + '<span>' + esc(domainOf(it.page)) + ' を開く</span></a>';
    if (it.kind === 'video' && it.src) links += '<a class="rb-btn" href="' + esc(it.src) + '" target="_blank" rel="noopener noreferrer">' + ICON.play + '<span>' + esc(videoProvider(it.src) || '動画') + 'で開く</span></a>';
    else if (full) links += '<a class="rb-btn" href="' + esc(full) + '" target="_blank" rel="noopener noreferrer">' + ICON.out + '<span>元の画像を開く</span></a>';
    if (canDownload(it)) links = '<button type="button" class="rb-btn rb-btn-primary" data-act="dl">' + ICON.importI + '<span>ダウンロード</span></button>' + links;
    var meta = [fmtDate(it.createdAt) + ' に追加', it.w ? it.w + ' × ' + it.h : '', it.att ? 'Confluenceに保存済み' : (it.kind === 'image' ? '外部の画像URL' : '')].filter(Boolean).join(' · ');
    els.lb.innerHTML =
      '<div class="rb-lb-stage">' + media + '</div>' +
      '<aside class="rb-lb-side">' +
        '<div class="rb-lb-head"><span class="rb-lb-pos">' + (state.lb + 1) + ' / ' + state.filtered.length + '</span>' +
          '<button type="button" class="rb-ic rb-lb-close" aria-label="閉じる">' + ICON.close + '</button></div>' +
        (it.title ? '<h2 class="rb-lb-title">' + esc(it.title) + '</h2>' : '') +
        (it.memo ? '<p class="rb-lb-memo">' + esc(it.memo) + '</p>' : '') +
        (tags ? '<div class="rb-lb-tags">' + tags + '</div>' : '') +
        '<div class="rb-lb-links">' + links + '</div>' +
        '<p class="rb-lb-meta">' + esc(meta) + '</p>' +
        (state.isOwner ? '<div class="rb-lb-own"><button type="button" class="rb-btn" data-act="edit">' + ICON.edit + '<span>編集</span></button><button type="button" class="rb-btn rb-btn-danger" data-act="del">' + ICON.trash + '<span>削除</span></button></div>' : '') +
      '</aside>' +
      '<button type="button" class="rb-lb-nav rb-lb-prev" aria-label="前へ"' + (state.lb > 0 ? '' : ' disabled') + '>' + ICON.left + '</button>' +
      '<button type="button" class="rb-lb-nav rb-lb-next" aria-label="次へ"' + (state.lb < state.filtered.length - 1 ? '' : ' disabled') + '>' + ICON.right + '</button>';
    var img = els.lb.querySelector('.rb-lb-stage img');
    if (img) img.addEventListener('error', function () { img.replaceWith(Object.assign(document.createElement('div'), { className: 'rb-lb-broken', textContent: '画像を表示できません(元のサイトで削除されたか、社内から読めない可能性があります)' })); });
    els.lb.onclick = function (e) {
      if (e.target.closest('.rb-lb-close') || e.target === els.lb || e.target.classList.contains('rb-lb-stage')) { closeLightbox(); return; }
      if (e.target.closest('.rb-lb-prev')) { stepLightbox(-1); return; }
      if (e.target.closest('.rb-lb-next')) { stepLightbox(1); return; }
      var c = e.target.closest('.rb-chip'); if (c) { var t = c.getAttribute('data-tag'); closeLightbox(); toggleTag(t, true); return; }
      var a = e.target.closest('[data-act]');
      if (a && a.getAttribute('data-act') === 'dl') { downloadItem(it, a); return; }
      if (a && state.isOwner) { var id = it.id; closeLightbox(); if (a.getAttribute('data-act') === 'edit') openEditModal(id); else confirmDelete(id); }
    };
    var cl = els.lb.querySelector('.rb-lb-close'); if (cl) cl.focus();
  }
  // ---------------- ダウンロード ----------------
  // 画像(添付・外部URL)と動画ファイル(mp4など)だけ。YouTube・Vimeo は保存できないのでボタンを出さない
  function canDownload(it) { return it.kind === 'image' || (it.kind === 'video' && isVideoFile(it.src)); }
  function fileNameFor(it, blob) {
    var base = (it.title || '').replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 80);
    var orig = it.att ? it.att.n : String(it.src || '').split(/[?#]/)[0].split('/').pop();
    var m = String(orig || '').match(/\.([A-Za-z0-9]{2,5})$/);
    var ext = m ? m[1].toLowerCase() : (String(blob && blob.type || '').split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace(/\+xml$/, '');
    return (base || (orig ? orig.replace(/\.[^.]+$/, '') : 'reference-' + it.id)) + '.' + ext;
  }
  function saveBlob(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    root.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  async function downloadItem(it, btn) {
    var src = it.att ? attHref(PAGE_ID, it.att.n) : it.src;
    var label = btn.querySelector('span'), text = label.textContent;
    btn.disabled = true; label.textContent = '取得中…';
    try {
      var r = await fetch(src, it.att ? { credentials: 'same-origin' } : { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var blob = await r.blob();
      saveBlob(blob, fileNameFor(it, blob));
      showToast('ダウンロードしました');
    } catch (err) {
      // サイトが別ドメインからの取得を許可していないときは、新しいタブで開いて保存してもらう
      window.open(src, '_blank', 'noopener');
      showToast('このサイトの' + (it.kind === 'video' ? '動画' : '画像') + 'は直接保存できないため、新しいタブで開きました。右クリックで保存してください', true);
    } finally { btn.disabled = false; label.textContent = text; }
  }

  function onKey(e) {
    if (!els.lb.hidden) {
      if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stepLightbox(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); stepLightbox(1); }
      return;
    }
    if (!els.overlay.hidden && e.key === 'Escape' && !state.busy) { e.preventDefault(); closeModal(); }
  }
  var scrollLocks = 0, savedOverflow = '';
  function lockScroll(on) {
    if (on) { if (scrollLocks++ === 0) { savedOverflow = document.documentElement.style.overflow; document.documentElement.style.overflow = 'hidden'; } }
    else if (scrollLocks > 0 && --scrollLocks === 0) document.documentElement.style.overflow = savedOverflow;
  }

  // ---------------- モーダル共通 ----------------
  function openModal(html, wide) {
    els.modal.innerHTML = html;
    els.modal.className = 'rb-modal' + (wide ? ' is-wide' : '');
    if (els.overlay.hidden) { els.overlay.hidden = false; lockScroll(true); }
    var f = els.modal.querySelector('[autofocus], input, textarea, button'); if (f) setTimeout(function () { try { f.focus(); } catch (_) {} }, 30);
  }
  function closeModal() {
    if (els.overlay.hidden) return;
    els.overlay.hidden = true; els.modal.innerHTML = ''; state.busy = false; lockScroll(false);
  }
  function modalError(msg) {
    var b = els.modal.querySelector('.rb-merr');
    if (!b) { b = document.createElement('div'); b.className = 'rb-merr'; var body = els.modal.querySelector('.rb-mbody'); (body || els.modal).appendChild(b); }
    b.textContent = msg;
  }
  // タグ入力欄(カンマ区切り)と候補チップ
  function tagFieldHtml(value) {
    var last = []; try { last = JSON.parse(lsGet('rb-last-tags:' + PAGE_ID) || '[]'); } catch (_) {}
    var order = last.filter(function (t) { return state.tags.indexOf(t) >= 0; });
    state.tags.forEach(function (t) { if (order.indexOf(t) < 0) order.push(t); });
    return '<label class="rb-field"><span>タグ(カンマ区切り)</span><input class="rb-in rb-in-tags" value="' + esc((value || []).join(', ')) + '" placeholder="例: UI, モーション"></label>' +
      '<div class="rb-sugg">' + order.map(function (t) { return '<button type="button" class="rb-sugg-chip" data-tag="' + esc(t) + '" style="--dot:' + tagColor(t, state.tags) + '"><i></i>' + esc(t) + '</button>'; }).join('') + '</div>';
  }
  function wireTagField(scope) {
    var input = scope.querySelector('.rb-in-tags');
    function sync() {
      var cur = splitTags(input.value);
      scope.querySelectorAll('.rb-sugg-chip').forEach(function (b) { b.classList.toggle('is-on', cur.indexOf(b.getAttribute('data-tag')) >= 0); });
    }
    scope.querySelectorAll('.rb-sugg-chip').forEach(function (b) {
      b.addEventListener('click', function () {
        var t = b.getAttribute('data-tag'), cur = splitTags(input.value), i = cur.indexOf(t);
        if (i < 0) cur.push(t); else cur.splice(i, 1);
        input.value = cur.join(', '); sync();
      });
    });
    input.addEventListener('input', sync); sync();
    return function () { return splitTags(input.value); };
  }

  // ---------------- 編集・削除 ----------------
  function openEditModal(id) {
    var it = itemById(id); if (!it) return;
    var th = thumbOf(it, PAGE_ID);
    openModal(
      '<div class="rb-mhead"><h3>リファレンスを編集</h3></div>' +
      '<div class="rb-mbody rb-edit">' +
        '<div class="rb-edit-prev" style="' + (it.c ? '--c:' + it.c : '') + '">' + (th ? '<img src="' + esc(th) + '" alt="" referrerpolicy="no-referrer">' : '<div class="rb-ph">' + ICON.play + '</div>') + '</div>' +
        '<div class="rb-edit-form">' +
          '<label class="rb-field"><span>タイトル</span><input class="rb-in rb-in-title" value="' + esc(it.title) + '"></label>' +
          tagFieldHtml(it.tags) +
          '<label class="rb-field"><span>メモ</span><textarea class="rb-in rb-in-memo" rows="3">' + esc(it.memo) + '</textarea></label>' +
          '<label class="rb-field"><span>見つけたページのURL</span><input class="rb-in rb-in-page" value="' + esc(it.page || '') + '" placeholder="https://"></label>' +
          (it.att ? '<p class="rb-note">画像はこのページに添付されています(' + esc(it.att.n) + ')</p>' :
            '<label class="rb-field"><span>' + (it.kind === 'video' ? '動画のURL' : '画像のURL') + '</span><input class="rb-in rb-in-src" value="' + esc(it.src || '') + '"></label>') +
          (it.kind === 'video' ? '<label class="rb-field"><span>サムネイル画像のURL(任意)</span><input class="rb-in rb-in-thumb" value="' + esc(it.thumb || '') + '" placeholder="空ならYouTubeは自動"></label>' : '') +
        '</div>' +
      '</div>' +
      '<div class="rb-mfoot"><button type="button" class="rb-btn rb-m-cancel">キャンセル</button><button type="button" class="rb-btn rb-btn-primary rb-m-save">保存</button></div>', true);
    var getTags = wireTagField(els.modal);
    els.modal.querySelector('.rb-m-cancel').onclick = closeModal;
    els.modal.querySelector('.rb-m-save').onclick = function () {
      var q = function (s) { var e = els.modal.querySelector(s); return e ? e.value.trim() : null; };
      var page = q('.rb-in-page'), src = q('.rb-in-src'), thumb = q('.rb-in-thumb');
      if (page && !isHttp(page)) return modalError('ページのURLは http(s):// で始めてください');
      if (src !== null && !isHttp(src)) return modalError((it.kind === 'video' ? '動画' : '画像') + 'のURLは http(s):// で始めてください');
      if (thumb && !isHttp(thumb)) return modalError('サムネイルのURLは http(s):// で始めてください');
      var tags = getTags();
      var next = Object.assign({}, it, { title: q('.rb-in-title').slice(0, 300), tags: tags, memo: q('.rb-in-memo').slice(0, 2000) });
      if (page) next.page = page; else delete next.page;
      if (src !== null) {
        if (src !== it.src) { delete next.w; delete next.h; }
        next.src = src; next.kind = videoProvider(src) ? 'video' : 'image';
      }
      if (thumb !== null) { if (thumb) next.thumb = thumb; else delete next.thumb; }
      var idx = state.items.indexOf(it); if (idx >= 0) state.items[idx] = next;
      rememberTags(tags);
      closeModal(); persist('保存しました');
    };
  }
  function confirmDelete(id) {
    var it = itemById(id); if (!it) return;
    var th = thumbOf(it, PAGE_ID);
    openModal(
      '<div class="rb-mhead"><h3>削除しますか？</h3></div>' +
      '<div class="rb-mbody rb-del">' + (th ? '<img src="' + esc(th) + '" alt="" referrerpolicy="no-referrer">' : '') +
        '<p>' + esc(it.title || domainOf(it.page || it.src) || 'このリファレンス') + '</p>' +
        (it.att ? '<p class="rb-note">' + (CONFIG.DELETE_ATTACHMENTS ? '添付の画像もゴミ箱に移します(スペースのゴミ箱から戻せます)。' : '添付の画像はページに残ります。') + '</p>' : '') +
      '</div>' +
      '<div class="rb-mfoot"><button type="button" class="rb-btn rb-m-cancel">キャンセル</button><button type="button" class="rb-btn rb-btn-danger rb-m-ok">削除</button></div>');
    els.modal.querySelector('.rb-m-cancel').onclick = closeModal;
    els.modal.querySelector('.rb-m-ok').onclick = function () {
      state.items = state.items.filter(function (x) { return x.id !== id; });
      closeModal();
      persist('削除しました').then(function () {
        if (!it.att || !CONFIG.DELETE_ATTACHMENTS || itemById(id)) return;
        var ids = [it.att.id, it.att.tid].filter(Boolean);
        Promise.all(ids.map(deleteAttachment)).catch(function (e) { showToast(e.message + '(添付はページに残っています)', true); });
      });
    };
  }

  // ---------------- ファイルを追加(ドロップ・貼り付け・選択) ----------------
  function enableDrop() {
    var depth = 0;
    function overBoard(e) {
      var r = hostEl.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    }
    function wanted(dt) {
      if (!dt || !dt.types) return false;
      var t = Array.prototype.slice.call(dt.types);
      if (t.indexOf('application/x-rb-card') >= 0) return false;
      return t.indexOf('Files') >= 0 || t.indexOf('text/uri-list') >= 0 || t.indexOf('text/html') >= 0;
    }
    function blocked() { return !els.overlay.hidden || !els.lb.hidden; }
    // Confluence 自体のドロップ添付と二重にならないよう、ボードの上では先に受け取って止める
    window.addEventListener('dragover', function (e) {
      if (blocked() || !wanted(e.dataTransfer) || !overBoard(e)) { els.drop.hidden = true; return; }
      e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy';
      els.drop.hidden = false;
    }, true);
    window.addEventListener('dragleave', function (e) { if (!e.relatedTarget) els.drop.hidden = true; }, true);
    window.addEventListener('drop', function (e) {
      els.drop.hidden = true;
      if (blocked() || !wanted(e.dataTransfer) || !overBoard(e)) return;
      e.preventDefault(); e.stopPropagation();
      handleTransfer(e.dataTransfer);
    }, true);
    document.addEventListener('paste', function (e) {
      if (blocked()) return;
      var a = document.activeElement;
      if (a && a !== document.body && a !== hostEl && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return;
      var ra = root.activeElement; if (ra && /^(INPUT|TEXTAREA|SELECT)$/.test(ra.tagName)) return;
      var r = hostEl.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) return;
      var cd = e.clipboardData; if (!cd) return;
      var files = Array.prototype.slice.call(cd.files || []).filter(function (f) { return /^image\//.test(f.type); });
      if (files.length) { e.preventDefault(); addFiles(files); return; }
      var txt = (cd.getData('text/plain') || '').trim();
      if (isHttp(txt) && !/\s/.test(txt)) { e.preventDefault(); openUrlModal({ src: txt }); }
    });
  }
  function handleTransfer(dt) {
    var files = Array.prototype.slice.call(dt.files || []);
    if (files.length) { addFiles(files); return; }
    var src = '', page = '';
    var html = dt.getData('text/html');
    if (html) {
      try {
        var d = new DOMParser().parseFromString(html, 'text/html');
        var img = d.querySelector('img[src]'); if (img) src = img.getAttribute('src');
        var a = d.querySelector('a[href]'); if (a && a.getAttribute('href') !== src) page = a.getAttribute('href');
      } catch (_) {}
    }
    var uri = (dt.getData('text/uri-list') || '').split(/\r?\n/).filter(function (l) { return l && l[0] !== '#'; })[0] || '';
    if (!src) src = uri; else if (!page && uri && uri !== src) page = uri;
    if (!isHttp(src)) { showToast('画像のURLを読み取れませんでした。画像を保存してからファイルとしてドロップしてください', true); return; }
    openUrlModal({ src: src, page: isHttp(page) ? page : '' });
  }
  function addFiles(all) {
    var files = all.filter(function (f) { return /^image\//.test(f.type) || /\.(jpe?g|png|gif|webp|avif|svg|bmp)$/i.test(f.name); });
    var skipped = all.length - files.length;
    if (!files.length) { showToast('画像ファイルではありません' + (all.some(function (f) { return /^video\//.test(f.type); }) ? '(動画はYouTube等のURLで追加してください)' : ''), true); return; }
    if (files.length > 60) { showToast('一度に追加できるのは60枚までです。先頭の60枚を追加します'); files = files.slice(0, 60); }
    openUploadModal(files, skipped);
  }
  function openUploadModal(files, skipped) {
    var urls = files.map(function (f) { return URL.createObjectURL(f); });
    openModal(
      '<div class="rb-mhead"><h3>' + files.length + '枚の画像を追加</h3><p>このページに添付して保存します' + (skipped ? '(画像以外の ' + skipped + ' 件は除外)' : '') + '</p></div>' +
      '<div class="rb-mbody">' +
        '<div class="rb-up-list">' + files.map(function (f, i) {
          return '<div class="rb-up" data-i="' + i + '"><div class="rb-up-img"><img src="' + urls[i] + '" alt=""><span class="rb-up-st"></span></div>' +
            '<input class="rb-in rb-up-title" value="' + esc(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 120)) + '" aria-label="タイトル"><small>' + fmtBytes(f.size) + '</small></div>';
        }).join('') + '</div>' +
        '<div class="rb-up-form">' + tagFieldHtml([]) +
          '<label class="rb-field"><span>メモ(全部に付けます)</span><input class="rb-in rb-in-memo"></label>' +
          '<label class="rb-field"><span>見つけたページのURL(任意)</span><input class="rb-in rb-in-page" placeholder="https://"></label>' +
        '</div>' +
      '</div>' +
      '<div class="rb-mfoot"><span class="rb-mprog"></span><button type="button" class="rb-btn rb-m-cancel">キャンセル</button><button type="button" class="rb-btn rb-btn-primary rb-m-save">' + files.length + '枚を追加</button></div>', true);
    var getTags = wireTagField(els.modal);
    var done = false;
    function cleanup() { urls.forEach(function (u) { URL.revokeObjectURL(u); }); }
    els.modal.querySelector('.rb-m-cancel').onclick = function () { if (state.busy) return; cleanup(); closeModal(); };
    els.modal.querySelector('.rb-m-save').onclick = async function () {
      if (done) { cleanup(); closeModal(); return; }
      var page = els.modal.querySelector('.rb-in-page').value.trim();
      if (page && !isHttp(page)) return modalError('ページのURLは http(s):// で始めてください');
      if (!roomFor(files.length)) return modalError(FULL_MSG);
      var tags = getTags(), memo = els.modal.querySelector('.rb-in-memo').value.trim().slice(0, 2000);
      var btn = els.modal.querySelector('.rb-m-save'), cancel = els.modal.querySelector('.rb-m-cancel'), prog = els.modal.querySelector('.rb-mprog');
      btn.disabled = true; cancel.disabled = true; state.busy = true;
      var rows = els.modal.querySelectorAll('.rb-up');
      var now = Date.now(), added = [], failed = 0, next = 0, finished = 0;
      async function worker() {
        while (next < files.length) {
          var i = next++, row = rows[i], st = row.querySelector('.rb-up-st');
          if (row.classList.contains('is-done')) { finished++; continue; }
          row.className = 'rb-up is-busy'; st.textContent = '送信中';
          try {
            var base = { title: row.querySelector('.rb-up-title').value.trim().slice(0, 300), tags: tags, memo: memo, createdAt: new Date(now - i).toISOString() };
            if (page) base.page = page;
            var it = await attachImage(PAGE_ID, files[i], files[i].name, base);
            added.push(it); row.className = 'rb-up is-done'; st.innerHTML = ICON.check;
          } catch (err) {
            failed++; row.className = 'rb-up is-fail'; st.textContent = '失敗'; row.title = err.message;
          }
          finished++; prog.textContent = finished + ' / ' + files.length;
        }
      }
      await Promise.all([worker(), worker()]);
      if (added.length) {
        added.sort(function (a, b) { return a.createdAt.localeCompare(b.createdAt); });
        state.items = state.items.concat(added);
        rememberTags(tags);
        await persist(added.length + '枚を追加しました');
      }
      state.busy = false;
      if (!failed) { cleanup(); closeModal(); return; }
      done = true; btn.disabled = false; cancel.disabled = false; btn.textContent = '閉じる';
      modalError(failed + '枚を追加できませんでした。失敗した画像にマウスを乗せると理由が出ます。');
    };
  }

  // ---------------- URLで追加 ----------------
  function openUrlModal(pre) {
    openModal(
      '<div class="rb-mhead"><h3>URLで追加</h3><p>画像のURL、YouTube・Vimeo のURL、mp4 のURLに対応しています</p></div>' +
      '<div class="rb-mbody rb-edit">' +
        '<div class="rb-edit-prev rb-url-prev"><div class="rb-ph">URLを入れるとここに表示されます</div></div>' +
        '<div class="rb-edit-form">' +
          '<label class="rb-field"><span>画像・動画のURL</span><input class="rb-in rb-in-src" value="' + esc(pre.src || '') + '" placeholder="https://" autofocus></label>' +
          '<label class="rb-field"><span>タイトル</span><input class="rb-in rb-in-title" value="' + esc(pre.title || '') + '"></label>' +
          tagFieldHtml([]) +
          '<label class="rb-field"><span>メモ</span><textarea class="rb-in rb-in-memo" rows="2"></textarea></label>' +
          '<label class="rb-field"><span>見つけたページのURL(任意)</span><input class="rb-in rb-in-page" value="' + esc(pre.page || '') + '" placeholder="https://"></label>' +
          '<label class="rb-check"><input type="checkbox" class="rb-in-copy"' + (lsGet('rb-copy-url') === '1' ? ' checked' : '') + '> 画像をこのページにコピーして保存(元のサイトから消えても残る)</label>' +
        '</div>' +
      '</div>' +
      '<div class="rb-mfoot"><button type="button" class="rb-btn rb-m-cancel">キャンセル</button><button type="button" class="rb-btn rb-btn-primary rb-m-save" disabled>追加</button></div>', true);
    getTagsUrl = wireTagField(els.modal);
    var srcIn = els.modal.querySelector('.rb-in-src'), prev = els.modal.querySelector('.rb-url-prev'), save = els.modal.querySelector('.rb-m-save');
    var probe = { src: '', ok: false, w: 0, h: 0, kind: 'image' }, timer = 0;
    function check() {
      var s = srcIn.value.trim();
      if (s === probe.src) return;
      probe = { src: s, ok: false, w: 0, h: 0, kind: 'image' };
      save.disabled = true;
      if (!isHttp(s)) { prev.innerHTML = '<div class="rb-ph">' + (s ? 'http(s):// で始まるURLを入れてください' : 'URLを入れるとここに表示されます') + '</div>'; return; }
      var prov = videoProvider(s);
      if (prov) {
        probe.kind = 'video'; probe.ok = true; save.disabled = false;
        var y = youtubeId(s);
        prev.innerHTML = y ? '<img src="https://i.ytimg.com/vi/' + y + '/hqdefault.jpg" alt="" referrerpolicy="no-referrer"><span class="rb-badge">' + ICON.play + prov + '</span>' : '<div class="rb-ph">' + ICON.play + '<span>' + prov + '</span></div>';
        els.modal.querySelector('.rb-in-copy').parentNode.hidden = true;
        return;
      }
      els.modal.querySelector('.rb-in-copy').parentNode.hidden = false;
      prev.innerHTML = '<div class="rb-ph">読み込み中…</div>';
      var im = new Image(); im.referrerPolicy = 'no-referrer';
      im.onload = function () {
        if (probe.src !== s) return;
        probe.ok = true; probe.w = im.naturalWidth; probe.h = im.naturalHeight; save.disabled = false;
        prev.innerHTML = ''; prev.appendChild(im);
        if (isFragileUrl(s)) els.modal.querySelector('.rb-in-copy').checked = true;
      };
      im.onerror = function () {
        if (probe.src !== s) return;
        prev.innerHTML = '<div class="rb-ph">画像として読み込めませんでした<small>Webページのアドレスの場合は、そのページでブックマークレットを使ってください</small></div>';
      };
      im.src = s;
    }
    srcIn.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(check, 300); });
    check();
    els.modal.querySelector('.rb-m-cancel').onclick = closeModal;
    save.onclick = async function () {
      if (!probe.ok) return;
      var g = function (s) { return els.modal.querySelector(s).value.trim(); };
      var page = g('.rb-in-page');
      if (page && !isHttp(page)) return modalError('ページのURLは http(s):// で始めてください');
      var src = probe.src;
      if (state.items.some(function (x) { return x.src && keyOf(x) === keyOf({ src: src }); })) return modalError('このURLはすでにボードにあります');
      if (!roomFor(1)) return modalError(FULL_MSG);
      var copy = probe.kind === 'image' && els.modal.querySelector('.rb-in-copy').checked;
      lsSet('rb-copy-url', els.modal.querySelector('.rb-in-copy').checked ? '1' : '0');
      var tags = getTagsUrl();
      var base = { id: uid(), kind: probe.kind, title: g('.rb-in-title').slice(0, 300), tags: tags, memo: g('.rb-in-memo').slice(0, 2000), createdAt: new Date().toISOString() };
      if (page) base.page = page;
      var it = null;
      save.disabled = true; state.busy = true;
      if (copy) {
        save.textContent = 'コピー中…';
        try {
          var r = await fetch(src, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          var blob = await r.blob();
          it = await attachImage(PAGE_ID, blob, src.split(/[?#]/)[0].split('/').pop(), base);
          it.src = src; // 元のURLも残す(重複チェック用)
        } catch (err) {
          showToast('このサイトの画像はコピーできませんでした。URLで保存します', true);
        }
      }
      if (!it) { it = Object.assign(base, { src: src }); if (probe.w) { it.w = probe.w; it.h = probe.h; } }
      state.items.push(it); rememberTags(tags);
      state.busy = false; closeModal();
      persist('追加しました');
    };
  }
  var getTagsUrl = function () { return []; };

  // ---------------- インポート・エクスポート ----------------
  function exportJson() {
    var data = { app: 'reference-board', version: VERSION, exportedAt: new Date().toISOString(), pageId: PAGE_ID, tags: state.tags, items: state.items };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    var d = new Date();
    a.download = 'reference-board-' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2) + '.json';
    a.href = URL.createObjectURL(blob);
    root.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    showToast(state.items.length + '件を書き出しました(添付の画像ファイルは含みません)');
  }
  function openImportModal() {
    openModal(
      '<div class="rb-mhead"><h3>インポート</h3><p>エクスポートしたJSON、または <code>[{"src":"画像URL","title":"…","tags":["…"],"page":"…"}]</code> の形式</p></div>' +
      '<div class="rb-mbody">' +
        '<label class="rb-field"><span>JSONファイル</span><input type="file" class="rb-in rb-imp-file" accept=".json,application/json"></label>' +
        '<label class="rb-field"><span>または貼り付け</span><textarea class="rb-in rb-imp-text" rows="8" spellcheck="false"></textarea></label>' +
        '<p class="rb-note">同じ画像URL・同じ添付はスキップします。添付の画像は、エクスポートしたのと同じページでだけ表示されます。</p>' +
      '</div>' +
      '<div class="rb-mfoot"><button type="button" class="rb-btn rb-m-cancel">キャンセル</button><button type="button" class="rb-btn rb-btn-primary rb-m-save">取り込む</button></div>', true);
    var text = els.modal.querySelector('.rb-imp-text');
    els.modal.querySelector('.rb-imp-file').onchange = function (e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      var fr = new FileReader(); fr.onload = function () { text.value = String(fr.result || ''); }; fr.readAsText(f);
    };
    els.modal.querySelector('.rb-m-cancel').onclick = closeModal;
    els.modal.querySelector('.rb-m-save').onclick = function () {
      var raw;
      try { raw = JSON.parse(text.value); } catch (e) { return modalError('JSONとして読めませんでした: ' + e.message); }
      var list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.items) ? raw.items : null;
      if (!list) return modalError('配列、または {"items": [...]} の形にしてください');
      var keys = new Set(state.items.map(keyOf)), ids = new Set(state.items.map(function (x) { return x.id; }));
      var add = [], skip = 0, bad = 0;
      list.forEach(function (r) {
        var it = normalizeItem(r);
        if (!it) { bad++; return; }
        if (keys.has(keyOf(it))) { skip++; return; }
        if (ids.has(it.id)) it.id = uid();
        keys.add(keyOf(it)); ids.add(it.id); add.push(it);
      });
      if (raw && Array.isArray(raw.tags)) raw.tags.forEach(function (t) { if (typeof t === 'string' && t && state.tags.indexOf(t) < 0) state.tags.push(t); });
      add.forEach(function (it) { it.tags.forEach(function (t) { if (state.tags.indexOf(t) < 0) state.tags.push(t); }); });
      add.sort(function (a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)); });
      state.items = state.items.concat(add);
      state.items.sort(function (a, b) { return String(a.createdAt || '').localeCompare(String(b.createdAt || '')); });
      closeModal();
      persist(add.length + '件を取り込みました' + (skip ? '(重複 ' + skip + '件をスキップ)' : '') + (bad ? '(読めない ' + bad + '件)' : ''));
    };
  }

  // ---------------- ブックマークレット ----------------
  function quickAddUrl() {
    if (CONFIG.QUICK_ADD_PAGE_URL) return CONFIG.QUICK_ADD_PAGE_URL;
    var u = new URL(location.href); u.hash = '';
    ['rb_add', 'rb_title', 'rb_page'].forEach(function (k) { u.searchParams.delete(k); });
    return u.href;
  }
  function openBookmarkletModal() {
    var code = makeBookmarklet(quickAddUrl());
    openModal(
      '<div class="rb-mhead"><h3>ブックマークレット</h3></div>' +
      '<div class="rb-mbody">' +
        '<p>下のボタンをブラウザのブックマークバーにドラッグして登録します。気になる画像や動画があるページでクリックすると、そのページの画像・動画の一覧が開き、選んでボードに追加できます。</p>' +
        '<p class="rb-bm-wrap"><a class="rb-bm" href="' + esc(code) + '" onclick="return false;">' + ICON.plus + 'リファレンスに追加</a></p>' +
        '<ul class="rb-note-list">' +
          '<li>YouTube・Vimeo のページや埋め込み動画は「動画」として追加されます。</li>' +
          '<li>「このページにコピーして保存」を選ぶと、画像を取得できるサイトではConfluenceに添付します。取得できないサイトはURLで保存します。</li>' +
          (CONFIG.QUICK_ADD_PAGE_URL ? '' : '<li>追加画面はこのボードのページで開きます。別の軽いページを用意する場合は <code>QUICK_ADD_PAGE_URL</code> を設定してください。</li>') +
        '</ul>' +
        '<label class="rb-field"><span>ドラッグできない場合は、このコードをブックマークのURLに貼り付けてください</span><textarea class="rb-in" rows="3" readonly>' + esc(code) + '</textarea></label>' +
      '</div>' +
      '<div class="rb-mfoot"><button type="button" class="rb-btn rb-m-cancel">閉じる</button></div>', true);
    els.modal.querySelector('textarea').addEventListener('focus', function (e) { e.target.select(); });
    els.modal.querySelector('.rb-m-cancel').onclick = closeModal;
  }

  // ==================================================================
  // ブックマークレット(見ているページで動く部分)
  //  ページ内の画像・動画を集めて追加画面(?rb_add=1)を開き、postMessage で渡す。
  //  「コピーして保存」のときは、追加画面からの依頼で画像を取得して渡す(元のページ側なら取れる画像が多いため)。
  //  ※ブックマークに入れると改行が消えるので、この関数の中では // コメントを使わない
  // ==================================================================
  function BOOKMARKLET(T) {
    var D = document, L = location, O;
    try { O = new URL(T, L.href).origin; } catch (e) { alert('reference-board: URLの設定が正しくありません'); return; }
    if (!O || O === 'null') O = '*';
    var seen = {}, out = [];
    function abs(u) { try { return new URL(u, L.href).href; } catch (e) { return ''; } }
    function push(o) {
      o.src = abs(o.src || '');
      if (!/^https?:/.test(o.src) || seen[o.src]) return;
      seen[o.src] = 1; out.push(o);
    }
    function yt(u) { var m = String(u || '').match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/); return m ? m[1] : ''; }
    function vm(u) { var m = String(u || '').match(/vimeo\.com\/(?:video\/)?(\d{6,})/); return m ? m[1] : ''; }
    function meta(p) { var e = D.querySelector('meta[property="' + p + '"],meta[name="' + p + '"]'); return e ? e.getAttribute('content') || '' : ''; }
    function ytItem(id, shorts, score) { return { kind: 'video', src: shorts ? 'https://www.youtube.com/shorts/' + id : 'https://www.youtube.com/watch?v=' + id, thumb: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg', score: score }; }
    function largest(img) {
      var best = img.currentSrc || img.src, bw = 0;
      (img.getAttribute('srcset') || img.getAttribute('data-srcset') || '').split(',').forEach(function (p) {
        var a = p.trim().split(/\s+/), w = parseFloat(a[1]) || 0;
        if (a[0] && /w$/.test(a[1] || '') && w > bw) { bw = w; best = a[0]; }
      });
      var link = img.closest && img.closest('a[href]');
      if (link && /\.(jpe?g|png|gif|webp|avif)(\?|#|$)/i.test(link.getAttribute('href'))) best = link.getAttribute('href');
      return best;
    }
    var y = yt(L.href), v = vm(L.href), ogi = meta('og:image') || meta('twitter:image');
    if (y) push(ytItem(y, /\/shorts\//.test(L.href), 4e9));
    if (v) push({ kind: 'video', src: 'https://vimeo.com/' + v, thumb: ogi ? abs(ogi) : '', score: 4e9 });
    Array.prototype.forEach.call(D.querySelectorAll('iframe[src]'), function (f) {
      var s = f.getAttribute('src'), a = yt(s), b = vm(s), r = f.getBoundingClientRect(), area = Math.round(r.width * r.height);
      if (a) push(ytItem(a, false, area)); else if (b) push({ kind: 'video', src: 'https://vimeo.com/' + b, score: area });
    });
    Array.prototype.forEach.call(D.querySelectorAll('video'), function (el) {
      var s = el.currentSrc || el.getAttribute('src') || ((el.querySelector('source[src]') || {}).src) || '';
      var poster = el.getAttribute('poster') ? abs(el.getAttribute('poster')) : '', r = el.getBoundingClientRect();
      var area = (el.videoWidth * el.videoHeight) || Math.round(r.width * r.height);
      if (s && !/^(blob|data):/.test(s)) push({ kind: 'video', src: s, thumb: poster, w: el.videoWidth || 0, h: el.videoHeight || 0, score: area });
      else if (poster) push({ kind: 'image', src: poster, w: el.videoWidth || 0, h: el.videoHeight || 0, score: area, alt: 'video poster' });
    });
    Array.prototype.forEach.call(D.images, function (img) {
      var r = img.getBoundingClientRect(), w = img.naturalWidth || Math.round(r.width), h = img.naturalHeight || Math.round(r.height);
      if (w < 120 || h < 120) return;
      var s = largest(img);
      if (!s || /^(data|blob):/.test(s)) return;
      push({ kind: 'image', src: s, w: w, h: h, score: w * h, alt: String(img.alt || '').slice(0, 200) });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    out = out.slice(0, 120);
    var payload = { type: 'rb-payload', v: 1, title: D.title, page: L.href, items: out };
    var w = window.open(T + (T.indexOf('?') < 0 ? '?' : '&') + 'rb_add=1&rb_title=' + encodeURIComponent(String(D.title).slice(0, 150)) + '&rb_page=' + encodeURIComponent(L.href.slice(0, 1500)), 'rb_add', 'width=1040,height=800');
    if (!w) { alert('ポップアップがブロックされました。このサイトでポップアップを許可してください。'); return; }
    function get(src) {
      return fetch(src, { mode: 'cors', credentials: 'omit' }).then(function (r) { if (!r.ok) throw 0; return r.blob(); })
        .catch(function () { return fetch(src, { credentials: 'include' }).then(function (r) { if (!r.ok) throw 0; return r.blob(); }); });
    }
    function on(e) {
      if (e.source !== w) return;
      var d = e.data || {};
      if (d.type === 'rb-ready') w.postMessage(payload, O);
      else if (d.type === 'rb-fetch') get(String(d.src)).then(function (b) { w.postMessage({ type: 'rb-blob', req: d.req, ok: true, blob: b }, O); }, function () { w.postMessage({ type: 'rb-blob', req: d.req, ok: false }, O); });
      else if (d.type === 'rb-done') removeEventListener('message', on);
    }
    addEventListener('message', on);
  }
  function makeBookmarklet(target) {
    var src = '(' + BOOKMARKLET.toString() + ')(' + JSON.stringify(target) + ');';
    src = src.replace(/\s*\n\s*/g, ' ');
    return 'javascript:' + encodeURIComponent(src).replace(/'/g, '%27');
  }
  window.ReferenceBoard.makeBookmarklet = makeBookmarklet;

  // ==================================================================
  // 追加画面(ブックマークレットから ?rb_add=1 で開く)
  // ==================================================================
  function initQuickAdd() {
    KEYS.active = function () { return true; }; // 追加画面はページ全体を覆うので、Confluence のショートカットは止める
    var st = { cands: [], sel: [], owner: false, store: null, keys: new Set(), tags: CONFIG.DEFAULT_TAGS.slice(), title: PARAMS.get('rb_title') || '', page: PARAMS.get('rb_page') || '', got: false, saving: false };
    if (!isHttp(st.page)) st.page = '';
    var app = document.createElement('div');
    app.className = 'rb-qa';
    app.innerHTML =
      '<header class="rb-qa-head">' +
        '<div><h1>リファレンスに追加</h1><p class="rb-qa-src"></p></div>' +
        '<p class="rb-qa-target"></p>' +
      '</header>' +
      '<div class="rb-qa-main">' +
        '<section class="rb-qa-cands" aria-label="ページ内の画像・動画">' +
          '<div class="rb-qa-tools"><span class="rb-qa-hint">読み込み中…</span><span class="rb-spacer"></span>' +
            '<button type="button" class="rb-btn rb-qa-all">すべて選ぶ</button><button type="button" class="rb-btn rb-qa-none">選択を解除</button></div>' +
          '<div class="rb-qa-grid"></div>' +
          '<form class="rb-qa-manual"><input class="rb-in" type="url" placeholder="一覧にない画像・動画のURLを貼り付けて候補に足す"><button class="rb-btn" type="submit">足す</button></form>' +
        '</section>' +
        '<aside class="rb-qa-form">' +
          '<div class="rb-qa-selinfo"></div>' +
          '<label class="rb-field"><span>タイトル</span><input class="rb-in rb-in-title"></label>' +
          '<div class="rb-qa-tagwrap"></div>' +
          '<label class="rb-field"><span>メモ</span><textarea class="rb-in rb-in-memo" rows="3"></textarea></label>' +
          '<label class="rb-check"><input type="checkbox" class="rb-in-copy"><span>画像をConfluenceにコピーして保存<small>元のサイトから消えても残ります。取得できない画像はURLで保存します。</small></span></label>' +
          '<p class="rb-qa-warn" hidden></p>' +
          '<button type="button" class="rb-btn rb-btn-primary rb-qa-save" disabled>追加</button>' +
          '<div class="rb-status rb-qa-status" role="status"></div>' +
        '</aside>' +
      '</div>';
    root.appendChild(app);
    var $ = function (s) { return app.querySelector(s); };
    var grid = $('.rb-qa-grid'), save = $('.rb-qa-save'), status = $('.rb-qa-status'), copy = $('.rb-in-copy');
    copy.checked = lsGet('rb-copy-qa') === '1';
    copy.addEventListener('change', function () { lsSet('rb-copy-qa', copy.checked ? '1' : '0'); refreshInfo(); });
    $('.rb-in-title').value = st.title;
    function setSt(msg, err) { status.textContent = msg || ''; status.className = 'rb-status rb-qa-status' + (err ? ' is-error' : ''); }
    function showSource() {
      $('.rb-qa-src').innerHTML = st.page ? '<a href="' + esc(st.page) + '" target="_blank" rel="noopener noreferrer">' + esc(st.title || st.page) + '</a><small>' + esc(domainOf(st.page)) + '</small>' : st.title ? '<span>' + esc(st.title) + '</span>' : '';
    }
    showSource();

    var tagGetter = function () { return []; };
    function drawTags() {
      var last = []; try { last = JSON.parse(lsGet('rb-last-tags:' + PAGE_ID) || '[]'); } catch (_) {}
      var order = last.filter(function (t) { return st.tags.indexOf(t) >= 0; });
      st.tags.forEach(function (t) { if (order.indexOf(t) < 0) order.push(t); });
      var wrap = $('.rb-qa-tagwrap');
      var cur = wrap.querySelector('.rb-in-tags') ? wrap.querySelector('.rb-in-tags').value : '';
      wrap.innerHTML = '<label class="rb-field"><span>タグ(カンマ区切り)</span><input class="rb-in rb-in-tags" placeholder="例: UI, モーション"></label>' +
        '<div class="rb-sugg">' + order.map(function (t) { return '<button type="button" class="rb-sugg-chip" data-tag="' + esc(t) + '" style="--dot:' + tagColor(t, st.tags) + '"><i></i>' + esc(t) + '</button>'; }).join('') + '</div>';
      var input = wrap.querySelector('.rb-in-tags'); input.value = cur;
      function sync() { var c = splitTags(input.value); wrap.querySelectorAll('.rb-sugg-chip').forEach(function (b) { b.classList.toggle('is-on', c.indexOf(b.getAttribute('data-tag')) >= 0); }); }
      wrap.querySelectorAll('.rb-sugg-chip').forEach(function (b) {
        b.onclick = function () { var c = splitTags(input.value), t = b.getAttribute('data-tag'), i = c.indexOf(t); if (i < 0) c.push(t); else c.splice(i, 1); input.value = c.join(', '); sync(); };
      });
      input.oninput = sync; sync();
      tagGetter = function () { return splitTags(input.value); };
    }
    drawTags();

    function candKey(c) { return c.src.replace(/^https?:/, ''); }
    function drawGrid() {
      var hint = $('.rb-qa-hint');
      if (!st.cands.length) {
        grid.innerHTML = '<div class="rb-empty">' + (st.got ? 'このページでは画像・動画が見つかりませんでした。下の欄にURLを貼り付けて追加できます。' : 'ページから画像を受け取れませんでした。ブックマークレットから開き直すか、下の欄にURLを貼り付けてください。') + '</div>';
        hint.textContent = ''; refreshInfo(); return;
      }
      hint.textContent = st.cands.length + '件の画像・動画が見つかりました。追加するものを選んでください';
      grid.innerHTML = st.cands.map(function (c, i) {
        var done = st.keys.has(candKey(c));
        var on = st.sel.indexOf(i) >= 0;
        var th = c.thumb || (c.kind === 'image' ? c.src : (youtubeId(c.src) ? 'https://i.ytimg.com/vi/' + youtubeId(c.src) + '/hqdefault.jpg' : ''));
        var r = c.kind === 'video' && !c.w ? (isShorts(c.src) ? 16 / 9 : 9 / 16) : c.w && c.h ? Math.max(0.42, Math.min(2.4, c.h / c.w)) : 1;
        var media = th ? '<img src="' + esc(th) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : c.kind === 'video' && isVideoFile(c.src) ? '<video src="' + esc(c.src) + '#t=0.1" muted preload="metadata"></video>' : '<div class="rb-ph">' + ICON.play + '</div>';
        var label = c.kind === 'video' ? (videoProvider(c.src) || '動画') : (c.w && c.h ? c.w + '×' + c.h : '');
        return '<button type="button" class="rb-qa-c' + (on ? ' is-on' : '') + (done ? ' is-done' : '') + '" data-i="' + i + '" aria-pressed="' + on + '"' + (done ? ' disabled' : '') + '>' +
          '<span class="rb-qa-m" style="aspect-ratio:1/' + r.toFixed(4) + '">' + media + '</span>' +
          '<span class="rb-qa-mark">' + ICON.check + '</span>' +
          '<span class="rb-qa-lab">' + (c.kind === 'video' ? ICON.play : '') + esc(done ? '追加済み' : label) + '</span>' +
        '</button>';
      }).join('');
      refreshInfo();
    }
    grid.addEventListener('click', function (e) {
      var b = e.target.closest('.rb-qa-c'); if (!b || b.disabled) return;
      var i = +b.getAttribute('data-i'), k = st.sel.indexOf(i);
      if (k < 0) st.sel.push(i); else st.sel.splice(k, 1);
      b.classList.toggle('is-on', k < 0); b.setAttribute('aria-pressed', String(k < 0));
      refreshInfo();
    });
    grid.addEventListener('error', function (e) {
      if (e.target.tagName !== 'IMG') return;
      var b = e.target.closest('.rb-qa-c'); if (b) b.classList.add('is-broken');
    }, true);
    $('.rb-qa-all').onclick = function () { st.sel = st.cands.map(function (c, i) { return i; }).filter(function (i) { return !st.keys.has(candKey(st.cands[i])); }); drawGrid(); };
    $('.rb-qa-none').onclick = function () { st.sel = []; drawGrid(); };
    $('.rb-qa-manual').onsubmit = function (e) {
      e.preventDefault();
      var inp = this.querySelector('input'), s = inp.value.trim();
      if (!isHttp(s)) { setSt('http(s):// で始まるURLを入れてください', true); return; }
      var c = { kind: videoProvider(s) ? 'video' : 'image', src: s };
      if (!st.cands.some(function (x) { return x.src === s; })) { st.cands.unshift(c); st.sel = st.sel.map(function (i) { return i + 1; }); st.sel.push(0); }
      inp.value = ''; setSt(''); drawGrid();
    };
    function refreshInfo() {
      var n = st.sel.length;
      var imgs = st.sel.filter(function (i) { return st.cands[i].kind === 'image'; }).length;
      $('.rb-qa-selinfo').innerHTML = n ? '<b>' + n + '件</b>を選択中' + (n - imgs ? '(動画 ' + (n - imgs) + '件)' : '') : '追加する画像・動画を選んでください';
      var fragile = st.sel.some(function (i) { return st.cands[i].kind === 'image' && isFragileUrl(st.cands[i].src); });
      var w = $('.rb-qa-warn');
      w.hidden = !(fragile && !copy.checked);
      w.textContent = '選んだ画像に、時間がたつと表示できなくなるURL(SNSの一時URLなど)が含まれています。コピーして保存がおすすめです。';
      save.disabled = !n || !st.owner || st.saving;
      save.textContent = n ? n + '件を追加' : '追加';
    }

    // 元のページからデータを受け取る
    function sanitize(c) {
      if (!c || !isHttp(c.src)) return null;
      var o = { kind: c.kind === 'video' ? 'video' : 'image', src: String(c.src).slice(0, 2000) };
      if (isHttp(c.thumb)) o.thumb = String(c.thumb).slice(0, 2000);
      if (+c.w > 0 && +c.h > 0) { o.w = Math.round(+c.w); o.h = Math.round(+c.h); }
      if (o.kind === 'image' && videoProvider(o.src)) o.kind = 'video';
      return o;
    }
    var opener = window.opener;
    window.addEventListener('message', function (e) {
      if (!opener || e.source !== opener) return;
      var d = e.data || {};
      if (d.type === 'rb-payload' && !st.got) {
        st.got = true;
        if (typeof d.title === 'string' && d.title) st.title = d.title.slice(0, 300);
        if (isHttp(d.page)) st.page = String(d.page).slice(0, 2000);
        st.cands = (Array.isArray(d.items) ? d.items : []).map(sanitize).filter(Boolean).slice(0, 150);
        if (!$('.rb-in-title').value) $('.rb-in-title').value = st.title;
        showSource();
        var first = -1; for (var i = 0; i < st.cands.length; i++) if (!st.keys.has(candKey(st.cands[i]))) { first = i; break; }
        st.sel = first >= 0 ? [first] : [];
        drawGrid();
      } else if (d.type === 'rb-blob' && pending[d.req]) {
        var p = pending[d.req]; delete pending[d.req];
        if (d.ok && d.blob instanceof Blob) p.resolve(d.blob); else p.reject(new Error('取得できませんでした'));
      }
    });
    var pending = {};
    function viaOpener(src) {
      return new Promise(function (resolve, reject) {
        if (!opener || opener.closed) { reject(new Error('元のページが閉じられています')); return; }
        var req = uid();
        pending[req] = { resolve: resolve, reject: reject };
        try { opener.postMessage({ type: 'rb-fetch', req: req, src: src }, '*'); } catch (e) { delete pending[req]; reject(e); return; }
        setTimeout(function () { if (pending[req]) { delete pending[req]; reject(new Error('時間切れ')); } }, 20000);
      });
    }
    function getBlob(src) {
      return viaOpener(src).catch(function () {
        return fetch(src, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); });
      });
    }
    (async function handshake() {
      if (!opener) { drawGrid(); return; }
      for (var n = 0; n < 24 && !st.got; n++) {
        try { opener.postMessage({ type: 'rb-ready' }, '*'); } catch (_) { break; }
        await sleep(250);
      }
      if (!st.got) drawGrid();
    })();

    // 保存先の読み込み
    if (!PAGE_ID) { setSt('保存先のページIDが分かりません。TARGET_PAGE_ID を設定してください。', true); return; }
    st.store = LCStore.create(PAGE_ID, CONFIG.PROPERTY_KEY, cfFetch, CONFIG.SHARDS);
    Promise.all([apiCurrentUser().catch(function () { return null; }), st.store.load(), apiPageInfo(PAGE_ID).catch(function () { return null; })]).then(function (r) {
      var u = r[0], data = r[1], info = r[2];
      var name = u && (u.username || u.name);
      st.owner = !!(u && CONFIG.OWNER_USERNAME && name === CONFIG.OWNER_USERNAME);
      (data.items || []).forEach(function (x) { if (x && x.src) st.keys.add(keyOf(x)); });
      if (data.tags && data.tags.length) st.tags = data.tags.slice();
      (data.items || []).forEach(function (x) { (x.tags || []).forEach(function (t) { if (st.tags.indexOf(t) < 0) st.tags.push(t); }); });
      $('.rb-qa-target').innerHTML = '追加先 <b>' + esc(info ? info.title : 'ページ ' + PAGE_ID) + '</b>' + (info && info.space ? '<small>' + esc(info.space.name || info.space.key) + '</small>' : '') + '<small>' + (data.items || []).length + '件</small>';
      if (!st.owner) setSt('追加できるのは ' + (CONFIG.OWNER_USERNAME || '設定したユーザー') + ' だけです(ログイン中: ' + (name || '不明') + ')', true);
      drawTags();
      if (st.got) { st.sel = st.sel.filter(function (i) { return !st.keys.has(candKey(st.cands[i])); }); drawGrid(); } else refreshInfo();
    }).catch(function (err) { setSt('保存先を読み込めませんでした: ' + err.message, true); });

    save.onclick = async function () {
      if (!st.sel.length || !st.owner || st.saving) return;
      var u = st.store.usage();
      if (u.total - u.used < 700 * st.sel.length) { setSt('情報の保存領域がいっぱいです。ボードで不要なリファレンスを削除してください。', true); return; }
      st.saving = true; refreshInfo();
      var tags = tagGetter(), title = $('.rb-in-title').value.trim().slice(0, 300), memo = $('.rb-in-memo').value.trim().slice(0, 2000);
      var now = Date.now(), items = [], fallback = 0, failed = 0;
      var sel = st.sel.slice().sort(function (a, b) { return a - b; });
      for (var k = 0; k < sel.length; k++) {
        var c = st.cands[sel[k]];
        setSt((k + 1) + ' / ' + sel.length + ' を保存中…');
        var base = { id: uid(), kind: c.kind, title: title, tags: tags, memo: memo, createdAt: new Date(now - k).toISOString() };
        if (st.page) base.page = st.page;
        var it = null;
        if (c.kind === 'image' && copy.checked) {
          try {
            var blob = await getBlob(c.src);
            it = await attachImage(PAGE_ID, blob, c.src.split(/[?#]/)[0].split('/').pop(), base);
            it.src = c.src;
          } catch (err) {
            if (err && err.status) { failed++; continue; } // Confluence側の失敗(権限・容量)はURL保存にしない
            fallback++;
          }
        }
        if (!it) { it = Object.assign(base, { src: c.src }); if (c.thumb) it.thumb = c.thumb; if (c.w) { it.w = c.w; it.h = c.h; } }
        items.push(it);
      }
      try {
        if (items.length) {
          var allTags = st.tags.slice(); tags.forEach(function (t) { if (allTags.indexOf(t) < 0) allTags.push(t); });
          items.sort(function (a, b) { return a.createdAt.localeCompare(b.createdAt); });
          await st.store.addItems(items, allTags);
          if (tags.length) lsSet('rb-last-tags:' + PAGE_ID, JSON.stringify(tags));
          items.forEach(function (x) { st.keys.add(keyOf(x)); });
        }
      } catch (err) {
        st.saving = false; refreshInfo();
        setSt('保存に失敗しました: ' + err.message, true); return;
      }
      st.saving = false; st.sel = [];
      var msg = items.length + '件を追加しました' + (fallback ? '(' + fallback + '件はコピーできずURLで保存)' : '') + (failed ? '(' + failed + '件は添付に失敗)' : '');
      drawGrid();
      setSt(msg, failed > 0);
      try { if (opener) opener.postMessage({ type: 'rb-done' }, '*'); } catch (_) {}
      if (!failed && !fallback && opener) setTimeout(function () { window.close(); }, 1200);
    };
  }

  function CSS() {
    return [
      ':host { all: initial; display: block; }',
      '*, *::before, *::after { box-sizing: border-box; }',
      '[hidden] { display: none !important; }',
      '.rb-app, .rb-overlay, .rb-lb, .rb-toast, .rb-qa {',
      '  --ink: #15171C; --text: #2A2D35; --muted: #6B7080; --faint: #9AA0AE; --line: #E4E6EB; --line-strong: #CDD1D9;',
      '  --canvas: #F4F5F7; --surface: #FFFFFF; --accent: #5B5BD6; --accent-ink: #4A46C4; --accent-soft: #EEEDFC;',
      '  --danger: #C0392B; --danger-soft: #FCEBE8; --warn: #9A5B00; --warn-soft: #FBF0DD; --ok: #1F8A5A;',
      '  font-family: "BIZ UDPGothic", "BIZ UDPゴシック", "Hiragino Sans", "Yu Gothic UI", system-ui, sans-serif;',
      '  font-size: 14px; line-height: 1.6; color: var(--text); font-feature-settings: "palt" 1; letter-spacing: .01em; -webkit-font-smoothing: antialiased;',
      '}',
      'button, input, textarea, select { font: inherit; color: inherit; letter-spacing: inherit; }',
      'button { cursor: pointer; }',
      ':focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }',
      'code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; background: var(--canvas); padding: 1px 5px; border-radius: 5px; }',
      '.rb-app { position: relative; display: grid; gap: 12px; padding-bottom: 8px; }',

      /* ツールバー */
      '.rb-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; }',
      '.rb-search { flex: 1 1 240px; max-width: 420px; display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 14px; border-radius: 999px; background: var(--canvas); border: 1px solid transparent; color: var(--muted); transition: border-color .15s, background .15s; }',
      '.rb-search:focus-within { background: var(--surface); border-color: var(--accent); box-shadow: 0 0 0 3px rgba(91,91,214,.14); }',
      '.rb-search input { flex: 1; min-width: 0; border: 0; background: transparent; outline: none; font-size: 14px; color: var(--ink); height: 100%; }',
      '.rb-seg { display: inline-flex; padding: 3px; gap: 2px; border-radius: 999px; background: var(--canvas); }',
      '.rb-seg button { border: 0; background: transparent; height: 32px; padding: 0 14px; border-radius: 999px; font-size: 13px; color: var(--muted); }',
      '.rb-seg button[aria-pressed="true"] { background: var(--surface); color: var(--ink); font-weight: 700; box-shadow: 0 1px 2px rgba(20,22,30,.1); }',
      '.rb-count { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }',
      '.rb-spacer { flex: 1 1 0; }',
      '.rb-actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }',
      '.rb-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 36px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--text); font-size: 13px; text-decoration: none; white-space: nowrap; transition: border-color .15s, background .15s, color .15s; }',
      '.rb-btn:hover { border-color: var(--line-strong); color: var(--ink); }',
      '.rb-btn:disabled { opacity: .5; cursor: default; }',
      '.rb-btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 700; }',
      '.rb-btn-primary:hover { background: var(--accent-ink); border-color: var(--accent-ink); color: #fff; }',
      '.rb-btn-danger { color: var(--danger); }',
      '.rb-btn-danger:hover { background: var(--danger-soft); border-color: var(--danger); color: var(--danger); }',
      '.rb-menu-wrap { position: relative; }',
      '.rb-menu { position: absolute; right: 0; top: calc(100% + 6px); z-index: 50; width: 290px; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 12px 32px rgba(20,22,30,.14); padding: 6px; display: grid; gap: 2px; }',
      '.rb-menu button { display: flex; gap: 10px; align-items: flex-start; text-align: left; border: 0; background: transparent; padding: 10px; border-radius: 10px; color: var(--ink); font-size: 13.5px; font-weight: 700; }',
      '.rb-menu button svg { margin-top: 3px; color: var(--accent); flex: none; }',
      '.rb-menu button small { display: block; font-weight: 400; color: var(--muted); font-size: 12px; }',
      '.rb-menu button:hover { background: var(--canvas); }',

      /* タグ */
      '.rb-tags { display: flex; flex-wrap: wrap; gap: 6px; }',
      '.rb-tags:empty { display: none; }',
      '.rb-chip, .rb-sugg-chip { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); font-size: 12.5px; color: var(--text); }',
      '.rb-chip i, .rb-sugg-chip i, .rb-ctags i { width: 7px; height: 7px; border-radius: 50%; background: var(--dot); flex: none; }',
      '.rb-chip small { color: var(--faint); font-size: 11px; font-variant-numeric: tabular-nums; }',
      '.rb-chip:hover, .rb-sugg-chip:hover { border-color: var(--line-strong); }',
      '.rb-chip.is-on, .rb-sugg-chip.is-on { background: var(--ink); border-color: var(--ink); color: #fff; }',
      '.rb-chip.is-on small { color: rgba(255,255,255,.6); }',
      '.rb-chip-clear { border: 0; background: transparent; color: var(--accent-ink); font-size: 12.5px; padding: 0 8px; }',
      '.rb-status { font-size: 12.5px; color: var(--muted); }',
      '.rb-status:empty { display: none; }',
      '.rb-status.is-error { color: var(--danger); }',

      /* 石積み */
      '.rb-grid { display: flex; gap: 14px; align-items: flex-start; min-height: 120px; }',
      '.rb-col { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 14px; }',
      '.rb-card { position: relative; border-radius: 16px; outline: none; cursor: zoom-in; }',
      '.rb-card:focus-visible { box-shadow: 0 0 0 3px var(--accent); }',
      '.rb-media { position: relative; overflow: hidden; border-radius: 16px; background: var(--c, #ECEDF1); }',
      '.rb-media > img, .rb-media > video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }',
      '.rb-ph { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 12px; text-align: center; color: var(--muted); font-size: 12px; background: var(--canvas); }',
      '.rb-ph svg { width: 22px; height: 22px; opacity: .6; }',
      '.rb-ph small { color: var(--faint); font-size: 11px; word-break: break-all; }',
      '.rb-ph-broken { background: repeating-linear-gradient(135deg, #F2F3F6 0 10px, #ECEDF1 10px 20px); }',
      '.rb-badge { position: absolute; left: 10px; bottom: 10px; display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 9px; border-radius: 999px; background: rgba(15,16,20,.72); color: #fff; font-size: 11.5px; font-weight: 700; pointer-events: none; backdrop-filter: blur(6px); }',
      '.rb-hov { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: space-between; padding: 10px; background: linear-gradient(180deg, rgba(10,11,15,.32), transparent 34%, transparent 62%, rgba(10,11,15,.42)); opacity: 0; transition: opacity .16s; }',
      '.rb-card:hover .rb-hov, .rb-card:focus-within .rb-hov { opacity: 1; }',
      '@media (hover: none) { .rb-hov { opacity: 1; background: none; } .rb-hov-top { display: none; } }',
      '.rb-hov-top { display: flex; justify-content: flex-end; gap: 6px; }',
      '.rb-hov-bot { display: flex; justify-content: flex-start; }',
      '.rb-ic { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; border: 0; background: rgba(255,255,255,.94); color: var(--ink); box-shadow: 0 1px 3px rgba(0,0,0,.18); }',
      '.rb-ic:hover { background: #fff; color: var(--accent-ink); }',
      '.rb-ic[data-act="del"]:hover { color: var(--danger); }',
      '.rb-pill { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; height: 28px; padding: 0 11px; border-radius: 999px; background: rgba(255,255,255,.94); color: var(--ink); font-size: 12px; font-weight: 700; text-decoration: none; box-shadow: 0 1px 3px rgba(0,0,0,.18); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }',
      '.rb-pill:hover { background: #fff; color: var(--accent-ink); }',
      '.rb-cap { padding: 7px 4px 0; display: grid; gap: 3px; }',
      '.rb-title { font-size: 12.5px; font-weight: 700; color: var(--ink); line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }',
      '.rb-ctags { display: flex; flex-wrap: wrap; gap: 2px 10px; font-size: 11px; color: var(--muted); }',
      '.rb-ctags span { display: inline-flex; align-items: center; gap: 4px; }',
      '.rb-ctags i { width: 6px; height: 6px; }',
      '.rb-empty { flex: 1; padding: 56px 16px; text-align: center; color: var(--muted); font-size: 13px; border-radius: 18px; background: var(--canvas); }',
      '.rb-empty-owner { display: grid; gap: 4px; border: 2px dashed var(--line-strong); background: transparent; }',
      '.rb-empty-owner b { color: var(--ink); font-size: 15px; }',
      '.rb-more { text-align: center; font-size: 12px; color: var(--faint); min-height: 1px; }',
      '.rb-foot { display: flex; justify-content: space-between; gap: 12px; font-size: 11.5px; color: var(--faint); }',
      '.rb-foot:empty { display: none; }',
      '.rb-foot.is-warn span:first-child { color: var(--warn); font-weight: 700; }',
      '.rb-drop { position: absolute; inset: -6px; z-index: 40; border-radius: 20px; border: 2px dashed var(--accent); background: rgba(238,237,252,.86); pointer-events: none; }',
      '.rb-drop-msg { position: sticky; top: 38vh; margin: 64px auto; width: max-content; max-width: 90%; display: grid; justify-items: center; gap: 4px; padding: 18px 26px; border-radius: 16px; background: var(--surface); box-shadow: 0 12px 32px rgba(20,22,30,.16); color: var(--muted); font-size: 12.5px; text-align: center; }',
      '.rb-drop-msg b { color: var(--accent-ink); font-size: 15px; }',
      '.rb-drop-msg svg { width: 22px; height: 22px; color: var(--accent); }',

      /* モーダル */
      '.rb-overlay { position: fixed; inset: 0; z-index: 100000; background: rgba(15,16,22,.46); display: flex; align-items: center; justify-content: center; padding: 16px; }',
      '.rb-modal { width: 100%; max-width: 460px; max-height: calc(100vh - 32px); display: flex; flex-direction: column; background: var(--surface); border-radius: 20px; box-shadow: 0 24px 64px rgba(10,12,20,.3); overflow: hidden; }',
      '.rb-modal.is-wide { max-width: 760px; }',
      '.rb-mhead { padding: 20px 22px 4px; }',
      '.rb-mhead h3 { margin: 0; font-size: 17px; color: var(--ink); }',
      '.rb-mhead p { margin: 4px 0 0; font-size: 12.5px; color: var(--muted); }',
      '.rb-mbody { padding: 14px 22px; overflow: auto; display: grid; gap: 12px; align-content: start; }',
      '.rb-mbody p { margin: 0; font-size: 13px; }',
      '.rb-mfoot { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 12px 22px 20px; }',
      '.rb-mprog { margin-right: auto; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }',
      '.rb-merr { background: var(--danger-soft); color: var(--danger); border-radius: 10px; padding: 8px 12px; font-size: 12.5px; }',
      '.rb-field { display: grid; gap: 5px; font-size: 12px; color: var(--muted); }',
      '.rb-in { width: 100%; border: 1px solid var(--line); border-radius: 10px; padding: 9px 11px; background: var(--surface); color: var(--ink); font-size: 13.5px; outline: none; transition: border-color .15s, box-shadow .15s; }',
      'textarea.rb-in { resize: vertical; min-height: 40px; }',
      '.rb-in:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(91,91,214,.14); }',
      '.rb-sugg { display: flex; flex-wrap: wrap; gap: 5px; margin-top: -4px; }',
      '.rb-sugg-chip { height: 26px; padding: 0 10px; font-size: 12px; }',
      '.rb-check { display: flex; gap: 8px; align-items: flex-start; font-size: 12.5px; color: var(--text); cursor: pointer; }',
      '.rb-check input { margin: 3px 0 0; width: 16px; height: 16px; accent-color: var(--accent); flex: none; }',
      '.rb-check small { display: block; color: var(--muted); font-size: 11.5px; }',
      '.rb-note { font-size: 12px !important; color: var(--muted); }',
      '.rb-note-list { margin: 0; padding-left: 18px; font-size: 12.5px; color: var(--muted); display: grid; gap: 4px; }',
      '.rb-edit { grid-template-columns: 220px minmax(0, 1fr); gap: 18px; }',
      '@media (max-width: 640px) { .rb-edit { grid-template-columns: 1fr; } }',
      '.rb-edit-prev { position: relative; align-self: start; min-height: 160px; border-radius: 14px; overflow: hidden; background: var(--c, var(--canvas)); }',
      '.rb-edit-prev img { display: block; width: 100%; max-height: 360px; object-fit: contain; background: var(--canvas); }',
      '.rb-edit-form { display: grid; gap: 12px; align-content: start; }',
      '.rb-del { justify-items: center; text-align: center; }',
      '.rb-del img { max-width: 220px; max-height: 200px; border-radius: 12px; object-fit: cover; }',
      '.rb-up-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 12px; }',
      '.rb-up { display: grid; gap: 4px; }',
      '.rb-up small { font-size: 11px; color: var(--faint); }',
      '.rb-up .rb-in { padding: 6px 8px; font-size: 12px; }',
      '.rb-up-img { position: relative; aspect-ratio: 1; border-radius: 12px; overflow: hidden; background: var(--canvas); }',
      '.rb-up-img img { width: 100%; height: 100%; object-fit: cover; display: block; transition: opacity .2s; }',
      '.rb-up-st { position: absolute; right: 6px; top: 6px; display: none; align-items: center; justify-content: center; min-width: 24px; height: 24px; padding: 0 8px; border-radius: 999px; font-size: 11px; font-weight: 700; color: #fff; background: rgba(15,16,20,.72); }',
      '.rb-up.is-busy .rb-up-st, .rb-up.is-done .rb-up-st, .rb-up.is-fail .rb-up-st { display: inline-flex; }',
      '.rb-up.is-busy img { opacity: .55; }',
      '.rb-up.is-done .rb-up-st { background: var(--ok); padding: 0; }',
      '.rb-up.is-fail .rb-up-st { background: var(--danger); }',
      '.rb-up-form { display: grid; gap: 12px; }',
      '.rb-bm-wrap { text-align: center; margin: 6px 0 !important; }',
      '.rb-bm { display: inline-flex; align-items: center; gap: 8px; padding: 10px 20px; border-radius: 999px; background: var(--ink); color: #fff; font-weight: 700; text-decoration: none; cursor: grab; }',

      /* ライトボックス */
      '.rb-lb { position: fixed; inset: 0; z-index: 100000; background: rgba(12,13,18,.94); display: grid; grid-template-columns: minmax(0, 1fr) 340px; color: #EDEEF2; }',
      '.rb-lb-stage { position: relative; display: flex; align-items: center; justify-content: center; padding: 28px 72px; min-height: 0; min-width: 0; }',
      '.rb-lb-stage > img, .rb-lb-stage > video { max-width: 100%; max-height: calc(100vh - 56px); object-fit: contain; border-radius: 6px; box-shadow: 0 10px 40px rgba(0,0,0,.4); background: #1c1d24; }',
      '.rb-lb-video { width: 100%; max-width: min(1280px, calc((100vh - 56px) * 16 / 9)); aspect-ratio: 16 / 9; }',
      '.rb-lb-video.is-tall { max-width: calc((100vh - 56px) * 9 / 16); aspect-ratio: 9 / 16; }',
      '.rb-lb-video iframe { width: 100%; height: 100%; border: 0; border-radius: 8px; background: #000; }',
      '.rb-lb-broken { padding: 40px; color: #B7BAC6; font-size: 13px; text-align: center; }',
      '.rb-lb-side { background: #191A21; padding: 18px 20px 24px; overflow: auto; display: flex; flex-direction: column; gap: 14px; border-left: 1px solid rgba(255,255,255,.06); }',
      '.rb-lb-head { display: flex; align-items: center; justify-content: space-between; }',
      '.rb-lb-pos { font-size: 12px; color: #9DA1AE; font-variant-numeric: tabular-nums; }',
      '.rb-lb-close { background: rgba(255,255,255,.1); color: #fff; box-shadow: none; }',
      '.rb-lb-close:hover { background: rgba(255,255,255,.2); color: #fff; }',
      '.rb-lb-title { margin: 0; font-size: 17px; line-height: 1.5; color: #fff; word-break: break-word; }',
      '.rb-lb-memo { margin: 0; font-size: 13px; color: #C9CBD4; white-space: pre-wrap; word-break: break-word; }',
      '.rb-lb-tags { display: flex; flex-wrap: wrap; gap: 6px; }',
      '.rb-lb .rb-chip { background: rgba(255,255,255,.07); border-color: rgba(255,255,255,.12); color: #E6E7EC; }',
      '.rb-lb .rb-chip:hover { border-color: rgba(255,255,255,.3); }',
      '.rb-lb-links, .rb-lb-own { display: flex; flex-wrap: wrap; gap: 8px; }',
      '.rb-lb .rb-btn { background: rgba(255,255,255,.07); border-color: rgba(255,255,255,.14); color: #EDEEF2; max-width: 100%; }',
      '.rb-lb .rb-btn span { overflow: hidden; text-overflow: ellipsis; }',
      '.rb-lb .rb-btn:hover { background: rgba(255,255,255,.14); color: #fff; }',
      '.rb-lb .rb-btn-danger:hover { background: rgba(192,57,43,.3); border-color: #E06A5D; }',
      '.rb-lb-meta { margin: 0; font-size: 11.5px; color: #8D91A0; }',
      '.rb-lb-own { margin-top: auto; padding-top: 12px; border-top: 1px solid rgba(255,255,255,.08); }',
      '.rb-lb-nav { position: absolute; top: 50%; transform: translateY(-50%); width: 46px; height: 46px; border-radius: 50%; border: 0; background: rgba(255,255,255,.1); color: #fff; display: flex; align-items: center; justify-content: center; }',
      '.rb-lb-nav:hover:not(:disabled) { background: rgba(255,255,255,.22); }',
      '.rb-lb-nav:disabled { opacity: .2; cursor: default; }',
      '.rb-lb-prev { left: 14px; } .rb-lb-next { right: 354px; }',
      '@media (max-width: 860px) {',
      '  .rb-lb { grid-template-columns: 1fr; grid-template-rows: minmax(0, 1fr) auto; }',
      '  .rb-lb-stage { padding: 16px 12px 8px; }',
      '  .rb-lb-stage > img, .rb-lb-stage > video { max-height: 58vh; }',
      '  .rb-lb-video { max-width: calc(58vh * 16 / 9); } .rb-lb-video.is-tall { max-width: calc(58vh * 9 / 16); }',
      '  .rb-lb-side { max-height: 42vh; border-left: 0; }',
      '  .rb-lb-nav { top: auto; bottom: calc(42vh + 12px); transform: none; width: 40px; height: 40px; }',
      '  .rb-lb-prev { left: 10px; } .rb-lb-next { right: 10px; }',
      '}',
      '.rb-toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 100001; max-width: calc(100vw - 32px); padding: 10px 18px; border-radius: 999px; background: var(--ink); color: #fff; font-size: 13px; box-shadow: 0 10px 28px rgba(0,0,0,.25); }',
      '.rb-toast.is-error { background: var(--danger); border-radius: 14px; }',

      /* 追加画面(ポップアップ) */
      '.rb-qa { position: fixed; inset: 0; z-index: 100000; overflow: auto; background: var(--canvas); padding: 18px 20px 28px; }',
      '.rb-qa-head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 8px 20px; margin-bottom: 14px; }',
      '.rb-qa-head h1 { margin: 0; font-size: 19px; color: var(--ink); }',
      '.rb-qa-src { margin: 2px 0 0; font-size: 12.5px; display: flex; gap: 8px; align-items: baseline; min-width: 0; }',
      '.rb-qa-src a { color: var(--text); text-decoration: none; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 52vw; }',
      '.rb-qa-src a:hover { color: var(--accent-ink); }',
      '.rb-qa-src small, .rb-qa-target small { color: var(--faint); font-size: 11.5px; margin-left: 8px; }',
      '.rb-qa-target { margin: 0; font-size: 12.5px; color: var(--muted); }',
      '.rb-qa-target b { color: var(--ink); }',
      '.rb-qa-main { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 18px; align-items: start; }',
      '@media (max-width: 760px) { .rb-qa-main { grid-template-columns: 1fr; } }',
      '.rb-qa-cands { display: grid; gap: 10px; min-width: 0; }',
      '.rb-qa-tools { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }',
      '.rb-qa-tools .rb-btn { height: 30px; padding: 0 12px; font-size: 12px; }',
      '.rb-qa-hint { font-size: 12.5px; color: var(--muted); }',
      '.rb-qa-grid { columns: 170px; column-gap: 10px; }',
      '.rb-qa-grid .rb-empty { column-span: all; }',
      '.rb-qa-c { position: relative; display: block; width: 100%; margin: 0 0 10px; padding: 0; border: 0; background: transparent; break-inside: avoid; border-radius: 14px; text-align: left; }',
      '.rb-qa-m { position: relative; display: block; overflow: hidden; border-radius: 14px; background: #E7E8EC; box-shadow: inset 0 0 0 1px rgba(0,0,0,.04); transition: transform .12s; }',
      '.rb-qa-m img, .rb-qa-m video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }',
      '.rb-qa-c:hover .rb-qa-m { transform: scale(.985); }',
      '.rb-qa-c.is-on .rb-qa-m { box-shadow: 0 0 0 3px var(--accent); }',
      '.rb-qa-mark { position: absolute; right: 8px; top: 8px; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,.92); color: transparent; box-shadow: 0 1px 3px rgba(0,0,0,.2); border: 1.5px solid rgba(0,0,0,.12); }',
      '.rb-qa-c.is-on .rb-qa-mark { background: var(--accent); color: #fff; border-color: var(--accent); }',
      '.rb-qa-lab { position: absolute; left: 8px; bottom: 8px; display: inline-flex; gap: 4px; align-items: center; height: 22px; padding: 0 8px; border-radius: 999px; background: rgba(15,16,20,.66); color: #fff; font-size: 11px; font-variant-numeric: tabular-nums; }',
      '.rb-qa-lab:empty { display: none; }',
      '.rb-qa-c.is-done { cursor: default; } .rb-qa-c.is-done .rb-qa-m { opacity: .4; } .rb-qa-c.is-done .rb-qa-mark { display: none; }',
      '.rb-qa-c.is-broken .rb-qa-m { background: repeating-linear-gradient(135deg, #EEEFF2 0 8px, #E6E7EB 8px 16px); }',
      '.rb-qa-c.is-broken img { display: none; }',
      '.rb-qa-manual { display: flex; gap: 8px; }',
      '.rb-qa-manual .rb-btn { height: 40px; }',
      '.rb-qa-form { position: sticky; top: 0; display: grid; gap: 12px; padding: 18px; border-radius: 18px; background: var(--surface); box-shadow: 0 1px 2px rgba(20,22,30,.06), 0 8px 24px rgba(20,22,30,.06); }',
      '.rb-qa-selinfo { font-size: 13px; color: var(--muted); } .rb-qa-selinfo b { color: var(--ink); font-size: 15px; }',
      '.rb-qa-warn { margin: 0; font-size: 12px; color: var(--warn); background: var(--warn-soft); border-radius: 10px; padding: 8px 10px; }',
      '.rb-qa-save { height: 44px; font-size: 14px; }'
    ].join('\n');
  }

  if (QUICK) initQuickAdd(); else initBoard();
})();
