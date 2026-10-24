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
    document.addEventListener('keydown', onKey);
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
