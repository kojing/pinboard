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
    st.store = LCStore.create(PAGE_ID, CONFIG.PROPERTY_KEY, cfFetch);
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
