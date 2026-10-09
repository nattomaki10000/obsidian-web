/* obsidian-web (static edition) launcher */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const BASE = new URL('./', location.href);
  const APP_CACHE = 'ow-app';
  const OPFS_NAME = 'お試しvault';
  const dec = new TextDecoder();

  // ---------------------------------------------------------------- IndexedDB (key/value)
  function idbOpen() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('obsidian-web', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbGet(k) {
    const db = await idbOpen();
    return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  }
  async function idbSet(k, v) {
    const db = await idbOpen();
    return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
  }

  // ---------------------------------------------------------------- UI helpers
  function msg(text, cls) { const m = $('msg'); m.textContent = text || ''; m.style.color = cls === 'err' ? 'var(--err)' : cls === 'ok' ? 'var(--ok)' : ''; }
  function setState(id, text, cls) { const e = $(id); e.textContent = text; e.className = 'state' + (cls ? ' ' + cls : ''); }
  function progress(p) { const b = $('bar'); b.style.display = p == null ? 'none' : 'block'; if (p != null) b.firstElementChild.style.width = Math.round(p * 100) + '%'; }

  const MIME = {
    js: 'application/javascript', css: 'text/css', html: 'text/html; charset=utf-8', json: 'application/json', svg: 'image/svg+xml',
    png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
    wasm: 'application/wasm', txt: 'text/plain', md: 'text/markdown', map: 'application/json', mp3: 'audio/mpeg', ico: 'image/x-icon',
  };
  const mimeOf = p => MIME[p.split('.').pop().toLowerCase()] || 'application/octet-stream';

  // ---------------------------------------------------------------- app source -> Cache Storage
  // Every source (uploaded asar, asar next to this page, extracted folder) is reduced to
  //   entries: [path, ...]   and   read(path) -> ArrayBuffer
  async function ingest(paths, read, onStep) {
    const set = new Set(paths);
    if (!set.has('index.html') || !set.has('app.js') || !set.has('package.json')) throw new Error('Obsidianのアプリとして読めませんでした(index.html / app.js / package.json が見つかりません)');

    const version = JSON.parse(dec.decode(await read('package.json'))).version;
    let terms = '';
    if (set.has('main.js')) { const m = /"(I understand and agree[^"]*)"/.exec(dec.decode(await read('main.js'))); if (m) terms = m[1]; }

    await caches.delete(APP_CACHE);
    const cache = await caches.open(APP_CACHE);
    const sandbox = [];
    let done = 0, patched = false;
    for (const p of paths) {
      done++;
      if (p === 'main.js' || p === 'ow-files.json') continue; // Electron main process code / our manifest are not served
      let body = await read(p);
      if (p === 'index.html') {
        let html = dec.decode(body);
        html = html.replace('<head>', '<head>\n<script>window.__OW=' + JSON.stringify({ version, terms }) + ';</script>\n<script src="shim.js"></script>\n');
        body = new TextEncoder().encode(html);
      } else if (p === 'app.js') {
        // settings & other modals would open as separate Electron windows; keep them in the page
        const js = dec.decode(body), from = 'Qy.canPopoutWindow&&this.shouldUsePopout()';
        patched = js.includes(from);
        body = new TextEncoder().encode(js.replace(from, '!1&&this.shouldUsePopout()'));
      }
      if (p.startsWith('sandbox/')) sandbox.push(p.slice('sandbox/'.length));
      await cache.put(new URL('app/' + p, BASE).href, new Response(body, { headers: { 'Content-Type': mimeOf(p) } }));
      if (done % 25 === 0) { progress(done / paths.length); if (onStep) onStep(done, paths.length); await new Promise(r => setTimeout(r)); }
    }
    progress(null);
    await idbSet('meta', { version, terms, sandbox, patched, loadedAt: Date.now() });
    return { version, patched };
  }

  async function ingestAsarBuffer(buf) {
    if (buf.byteLength < 16) throw new Error('ファイルが小さすぎます');
    const dv = new DataView(buf);
    const hsize = dv.getUint32(4, true), jlen = dv.getUint32(12, true);
    let header;
    try { header = JSON.parse(dec.decode(new Uint8Array(buf, 16, jlen))); } catch (e) { throw new Error('asarとして読めませんでした'); }
    const base = 8 + hsize, ents = {};
    (function walk(node, pre) {
      for (const [name, ent] of Object.entries(node.files || {})) {
        const p = pre ? pre + '/' + name : name;
        if (ent.files) walk(ent, p);
        else if (!ent.link && !ent.unpacked) ents[p] = ent;
      }
    })(header, '');
    return ingest(Object.keys(ents), async p => buf.slice(base + Number(ents[p].offset), base + Number(ents[p].offset) + ents[p].size));
  }

  // ---- sources placed next to this page
  const ASAR_URL = new URL('obsidian.asar', BASE).href;
  const DIR_MANIFEST = new URL('obsidian/ow-files.json', BASE).href;
  async function exists(url, method) { try { return (await fetch(url, { method: method || 'HEAD', cache: 'no-cache' })).ok; } catch (e) { return false; } }
  async function detectSource() {
    if (await exists(DIR_MANIFEST)) return 'dir';   // an extracted folder wins: no big download
    if (await exists(ASAR_URL)) return 'asar';
    return null;
  }
  async function ingestFromSite(kind, onStep) {
    if (kind === 'dir') {
      const files = await (await fetch(DIR_MANIFEST, { cache: 'no-cache' })).json();
      return ingest(files, async p => {
        const r = await fetch(new URL('obsidian/' + p.split('/').map(encodeURIComponent).join('/'), BASE), { cache: 'no-cache' });
        if (!r.ok) throw new Error('取得できません: obsidian/' + p + ' (' + r.status + ')');
        return r.arrayBuffer();
      }, onStep);
    }
    const r = await fetch(ASAR_URL, { cache: 'no-cache' });
    if (!r.ok) throw new Error('obsidian.asar を取得できません (' + r.status + ')');
    return ingestAsarBuffer(await r.arrayBuffer());
  }

  // ---------------------------------------------------------------- vault helpers
  async function opfsRoot() { return (await navigator.storage.getDirectory()).getDirectoryHandle(OPFS_NAME, { create: true }); }
  async function isEmpty(dir) { for await (const _ of dir.entries()) return false; return true; }
  async function seedSampleNotes(root, meta) {
    for (const rel of meta.sandbox || []) {
      const r = await fetch(new URL('app/sandbox/' + rel.split('/').map(encodeURIComponent).join('/'), BASE));
      if (!r.ok) continue;
      const parts = rel.split('/'), name = parts.pop();
      let d = root;
      for (const part of parts) d = await d.getDirectoryHandle(part, { create: true });
      const w = await (await d.getFileHandle(name, { create: true })).createWritable();
      await w.write(await r.arrayBuffer());
      await w.close();
    }
  }

  // ---------------------------------------------------------------- state / refresh
  let meta = null, vaultRec = null, siteSource = null;
  async function refresh() {
    meta = await idbGet('meta');
    const cached = meta && await caches.open(APP_CACHE).then(c => c.match(new URL('app/index.html', BASE).href));
    const where = siteSource === 'dir' ? '(このサイトの obsidian/ フォルダ)' : siteSource === 'asar' ? '(このサイトの obsidian.asar)' : '';
    if (meta && cached) setState('asarState', '読み込み済み: Obsidian ' + meta.version + where + (meta.patched === false ? ' ※未知のバージョン: 一部機能が動かない可能性' : ''), 'ok');
    else { meta = null; setState('asarState', siteSource ? '未読み込み' + where + 'を検出しました' : '未読み込み(このサイトに obsidian.asar も obsidian/ もありません)'); }
    $('reload').hidden = !siteSource;

    vaultRec = await idbGet('vault');
    if (vaultRec) {
      const name = vaultRec.kind === 'opfs' ? OPFS_NAME + '(ブラウザ内)' : vaultRec.handle.name;
      setState('vaultState', '選択中: ' + name, 'ok');
    } else setState('vaultState', '未選択');
    $('open').disabled = !(meta && vaultRec);
    $('open').textContent = vaultRec ? '「' + (vaultRec.kind === 'opfs' ? OPFS_NAME : vaultRec.handle.name) + '」をObsidianで開く' : 'Obsidianを開く';
  }

  // ---------------------------------------------------------------- actions
  $('asarFile').addEventListener('change', async ev => {
    const f = ev.target.files[0]; ev.target.value = '';
    if (!f) return;
    msg('展開中… (数十MBあるため数秒かかります)');
    $('open').disabled = true;
    try {
      const r = await ingestAsarBuffer(await f.arrayBuffer());
      msg('Obsidian ' + r.version + ' を読み込みました。', 'ok');
    } catch (e) { console.error(e); msg('読み込みに失敗しました: ' + e.message, 'err'); progress(null); }
    await refresh();
  });

  async function loadFromSite() {
    $('open').disabled = true; $('reload').disabled = true;
    msg('このサイトから読み込み中…(初回は数秒かかります)');
    try {
      const r = await ingestFromSite(siteSource, (d, n) => msg('読み込み中… ' + d + ' / ' + n));
      msg('Obsidian ' + r.version + ' を読み込みました。', 'ok');
    } catch (e) { console.error(e); msg('読み込みに失敗しました: ' + e.message, 'err'); progress(null); }
    $('reload').disabled = false;
    await refresh();
  }
  $('reload').addEventListener('click', loadFromSite);

  $('pickFolder').addEventListener('click', async () => {
    try {
      const handle = await window.showDirectoryPicker({ id: 'obsidian-vault', mode: 'readwrite' });
      await idbSet('vault', { kind: 'fsa', handle });
      localStorage.setItem('ow.vaultName', handle.name);
      msg('');
    } catch (e) { if (e.name !== 'AbortError') msg('フォルダを選べませんでした: ' + e.message, 'err'); }
    await refresh();
  });

  $('useOpfs').addEventListener('click', async () => {
    try {
      await opfsRoot();
      await idbSet('vault', { kind: 'opfs', name: OPFS_NAME });
      localStorage.setItem('ow.vaultName', OPFS_NAME);
      msg('');
    } catch (e) { msg('ブラウザ内ストレージを使えませんでした: ' + e.message, 'err'); }
    await refresh();
  });

  $('open').addEventListener('click', async () => {
    $('open').disabled = true;
    try {
      await navigator.serviceWorker.ready;
      let root;
      if (vaultRec.kind === 'opfs') root = await opfsRoot();
      else {
        let p = await vaultRec.handle.queryPermission({ mode: 'readwrite' });
        if (p !== 'granted') p = await vaultRec.handle.requestPermission({ mode: 'readwrite' });
        if (p !== 'granted') throw new Error('フォルダへの読み書きが許可されませんでした');
        root = vaultRec.handle;
      }
      if (await isEmpty(root)) { msg('サンプルノートを作成中…'); await seedSampleNotes(root, meta); }
      localStorage.setItem('ow.vaultName', vaultRec.kind === 'opfs' ? OPFS_NAME : vaultRec.handle.name);
      location.href = new URL('app/index.html', BASE).href;
    } catch (e) { console.error(e); msg('開けませんでした: ' + e.message, 'err'); $('open').disabled = false; }
  });

  // ---------------------------------------------------------------- init
  (async () => {
    if (!('showDirectoryPicker' in window)) { $('unsupported').hidden = false; $('pickFolder').disabled = true; }
    if (!('serviceWorker' in navigator) || !window.isSecureContext) {
      msg('Service Worker が使えません。HTTPS または http://localhost で開いてください(file:// では動きません)。', 'err');
      return;
    }
    try { await navigator.serviceWorker.register('sw.js'); } catch (e) { msg('Service Worker の登録に失敗: ' + e.message, 'err'); return; }
    const need = new URLSearchParams(location.search).get('need');
    siteSource = await detectSource();
    await refresh();
    if (siteSource && !meta) await loadFromSite();   // first visit: load automatically, no upload needed
    if (need) msg(need === 'permission' ? 'フォルダへのアクセス許可が切れました。「開く」を押して許可し直してください。' : 'vaultが選択されていません。', 'err');
  })();
})();
