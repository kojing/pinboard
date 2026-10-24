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
