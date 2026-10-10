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
    js: 'application/javascript', mjs: 'application/javascript', css: 'text/css', html: 'text/html; charset=utf-8', json: 'application/json', svg: 'image/svg+xml',
    png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
    wasm: 'application/wasm', txt: 'text/plain', md: 'text/markdown', map: 'application/json', mp3: 'audio/mpeg', ico: 'image/x-icon',
  };
  const mimeOf = p => MIME[p.split('.').pop().toLowerCase()] || 'application/octet-stream';

  // ---------------------------------------------------------------- app source -> Cache Storage
  // Every source (uploaded asar, asar next to this page, extracted folder) is reduced to
  //   entries: [path, ...]   and   read(path) -> ArrayBuffer
  async function ingest(paths, read, onStep) {
    const set = new Set(paths);
    // desktop build (obsidian.asar): index.html + app.js + package.json (+ main.js)
    // mobile build (APK/IPA "public" folder): index.html + app.js + cordova.js, no package.json
    const mobile = set.has('index.html') && set.has('app.js') && !set.has('package.json') && set.has('cordova.js');
    if (!set.has('index.html') || !set.has('app.js') || (!mobile && !set.has('package.json'))) throw new Error('Obsidianのアプリとして読めませんでした(index.html / app.js / package.json が見つかりません)。モバイル版の場合は、APK/IPAから取り出した public フォルダのzipを選んでください');

    let version, terms = '';
    if (mobile) {
      const js = dec.decode(await read('app.js'));
      const t = /"(I understand and agree[^"]*)"/.exec(js); if (t) terms = t[1];
      const v = /\b\w+="(1\.\d+\.\d+)",\w+="\d+\.\d+\.\d+"/.exec(js);
      version = v ? v[1] : '1.14.4';
      if (!terms) throw new Error('モバイル版のapp.jsから利用規約の文言を取得できませんでした(未対応のバージョンかもしれません)');
    } else {
      version = JSON.parse(dec.decode(await read('package.json'))).version;
      if (set.has('main.js')) { const m = /"(I understand and agree[^"]*)"/.exec(dec.decode(await read('main.js'))); if (m) terms = m[1]; }
    }

    await caches.delete(APP_CACHE);
    const cache = await caches.open(APP_CACHE);
    const sandbox = [];
    let done = 0, patched = false;
    for (const p of paths) {
      done++;
      if (p === 'main.js' || p === 'ow-files.json' || p.endsWith('/')) continue; // Electron main process code / our manifest are not served
      let body = await read(p);
      if (p === 'index.html') {
        let html = dec.decode(body);
        html = mobile
          ? html.replace('<head>', '<head>\n<script>window.__OWM=' + JSON.stringify({ version, terms, platform: currentPlatform() }) + ';</script>\n<script src="mobile-shim.js"></script>\n')
          : html.replace('<head>', '<head>\n<script>window.__OW=' + JSON.stringify({ version, terms }) + ';</script>\n<script src="shim.js"></script>\n');
        body = new TextEncoder().encode(html);
      } else if (p === 'app.js' && !mobile) {
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
    await idbSet('meta', { version, terms, sandbox, patched: mobile ? true : patched, mobile, loadedAt: Date.now() });
    return { version, patched, mobile };
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


  // ---------------------------------------------------------------- zip (public folder from an APK / IPA)
  async function inflateRaw(u8) {
    const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).arrayBuffer();
  }
  function readZipIndex(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf), len = buf.byteLength;
    let eocd = -1;
    for (let i = len - 22; i >= Math.max(0, len - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('zipとして読めませんでした');
    const total = dv.getUint16(eocd + 10, true);
    let off = dv.getUint32(eocd + 16, true);
    const ents = {};
    for (let n = 0; n < total; n++) {
      if (dv.getUint32(off, true) !== 0x02014b50) throw new Error('zipの目次が壊れています');
      const flags = dv.getUint16(off + 8, true), method = dv.getUint16(off + 10, true);
      const csize = dv.getUint32(off + 20, true), usize = dv.getUint32(off + 24, true);
      const nlen = dv.getUint16(off + 28, true), elen = dv.getUint16(off + 30, true), clen = dv.getUint16(off + 32, true);
      const lho = dv.getUint32(off + 42, true);
      const name = dec.decode(u8.subarray(off + 46, off + 46 + nlen)).replace(/\\/g, '/');
      off += 46 + nlen + elen + clen;
      if (name.endsWith('/') || name.startsWith('__MACOSX/') || name.split('/').pop() === '.DS_Store') continue;
      if (flags & 1) throw new Error('パスワード付きzipには対応していません');
      ents[name] = { method, csize, usize, lho };
    }
    return { ents, dv, u8 };
  }
  async function ingestZipBuffer(buf, fileName) {
    const { ents, dv, u8 } = readZipIndex(buf);
    // the zip may contain one wrapper folder ("public/", "Android-public/", ...): use the folder that holds index.html
    let prefix = null;
    for (const name of Object.keys(ents)) {
      if (name === 'index.html' || name.endsWith('/index.html')) {
        const pre = name.slice(0, name.length - 'index.html'.length);
        if (prefix === null || pre.length < prefix.length) prefix = pre;
      }
    }
    if (prefix === null) throw new Error('zipの中に index.html が見つかりません(APK/IPAから取り出した public フォルダのzipですか?)');
    const files = {};
    for (const [name, e] of Object.entries(ents)) if (name.startsWith(prefix)) files[name.slice(prefix.length)] = e;
    return ingest(Object.keys(files), async p => {
      const e = files[p];
      const start = e.lho + 30 + dv.getUint16(e.lho + 26, true) + dv.getUint16(e.lho + 28, true);
      const raw = u8.subarray(start, start + e.csize);
      if (e.method === 0) return raw.slice().buffer;
      if (e.method === 8) return inflateRaw(raw);
      throw new Error('未対応の圧縮方式です: ' + p);
    }, (d, n) => msg('展開中… ' + d + ' / ' + n));
  }
  async function ingestAnyBuffer(buf, fileName) {
    const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
    if (head[0] === 0x50 && head[1] === 0x4b) return ingestZipBuffer(buf, fileName); // "PK" -> zip
    return ingestAsarBuffer(buf);
  }

  // Which native shell to imitate: the Android and iOS builds take different code paths for storage.
  // "auto" follows the browser that opens the app (an Android browser -> Android, anything else -> iOS);
  // the zip's file name is not used (it is often renamed).
  const uaPlatform = () => /Android/i.test(navigator.userAgent) ? 'android' : 'ios';
  function currentPlatform() { const v = localStorage.getItem('ow.mobilePlatform'); return v === 'android' || v === 'ios' ? v : uaPlatform(); }
  function guessPlatform() { /* kept for callers; nothing to do: see currentPlatform() */ }

  // ---- sources placed next to this page (the launcher picks by device)
  //   PC     : obsidian/          (folder + ow-files.json, recommended)  or  obsidian.asar
  //   phone  : obsidian-mobile/   (folder + ow-files.json, recommended)  or  obsidian-mobile.zip
  //            (either build, Android's or iOS's, works on any phone: the launcher imitates the phone it is opened on)
  const isMobileUA = () => /Android|iPhone|iPod|iPad|Mobile/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const uiParam = () => { const q = new URLSearchParams(location.search).get('ui'); return q === 'mobile' || q === 'desktop' ? q : null; };
  const wantedUi = () => uiParam() || (isMobileUA() ? 'mobile' : 'desktop');
  function candidates(ui) {
    if (ui === 'desktop') return [{ ui, kind: 'dir', base: 'obsidian/' }, { ui, kind: 'asar', url: 'obsidian.asar' }];
    return [{ ui, kind: 'dir', base: 'obsidian-mobile/' }, { ui, kind: 'zip', url: 'obsidian-mobile.zip' }];
  }
  const probeUrl = c => new URL(c.kind === 'dir' ? c.base + 'ow-files.json' : c.url, BASE).href;
  const srcLabel = c => c.kind === 'dir' ? c.base + ' フォルダ' : c.url;
  async function exists(url, method) { try { return (await fetch(url, { method: method || 'HEAD', cache: 'no-cache' })).ok; } catch (e) { return false; } }
  async function detectSource() {
    const ui = wantedUi();
    for (const u of [ui, ui === 'mobile' ? 'desktop' : 'mobile']) { // this device's kind first; the other kind only when it is all there is
      for (const c of candidates(u)) if (await exists(probeUrl(c))) return c;
    }
    return null;
  }
  async function ingestFromSite(src, onStep) {
    if (src.kind === 'dir') {
      const files = await (await fetch(probeUrl(src), { cache: 'no-cache' })).json();
      return ingest(files, async p => {
        const r = await fetch(new URL(src.base + p.split('/').map(encodeURIComponent).join('/'), BASE), { cache: 'no-cache' });
        if (!r.ok) throw new Error('取得できません: ' + src.base + p + ' (' + r.status + ')');
        return r.arrayBuffer();
      }, onStep);
    }
    const r = await fetch(new URL(src.url, BASE), { cache: 'no-cache' });
    if (!r.ok) throw new Error(src.url + ' を取得できません (' + r.status + ')');
    return ingestAnyBuffer(await r.arrayBuffer(), src.url);
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
    const where = siteSource ? '(このサイトの ' + srcLabel(siteSource) + ')' : '';
    const other = meta && siteSource && !!meta.mobile !== (siteSource.ui === 'mobile') ? ' ※いま読み込まれているのは' + (meta.mobile ? 'モバイル版' : 'デスクトップ版') + 'です。この端末向けに切り替えるには「このサイトから読み込み直す」を押してください' : '';
    if (meta && cached) setState('asarState', '読み込み済み: Obsidian ' + meta.version + (meta.mobile ? '(モバイル版 / ' + (currentPlatform() === 'android' ? 'Android' : 'iOS') + '動作)' : '') + where + (meta.patched === false ? ' ※未知のバージョン: 一部機能が動かない可能性' : '') + other, 'ok');
    else { meta = null; setState('asarState', siteSource ? '未読み込み' + where + 'を検出しました' : '未読み込み(このサイトに obsidian/ obsidian.asar obsidian-mobile/ obsidian-mobile.zip のどれもありません)'); }
    $('reload').hidden = !siteSource;

    vaultRec = await idbGet('vault');
    if (vaultRec) {
      const name = vaultRec.kind === 'opfs' ? (meta && meta.mobile ? 'ブラウザ内ストレージ' : OPFS_NAME + '(ブラウザ内)') : vaultRec.handle.name;
      setState('vaultState', '選択中: ' + name + (meta && meta.mobile ? '(この中にvaultが並びます)' : ''), 'ok');
    } else setState('vaultState', '未選択');
    $('open').disabled = !(meta && vaultRec);
    $('open').textContent = !vaultRec ? 'Obsidianを開く' : meta && meta.mobile ? 'モバイル版Obsidianを開く' : '「' + (vaultRec.kind === 'opfs' ? OPFS_NAME : vaultRec.handle.name) + '」をObsidianで開く';
    $('platform').value = localStorage.getItem('ow.mobilePlatform') || 'auto';
  }

  // ---------------------------------------------------------------- actions
  $('asarFile').addEventListener('change', async ev => {
    const f = ev.target.files[0]; ev.target.value = '';
    if (!f) return;
    msg('展開中… (数十MBあるため数秒〜十数秒かかります)');
    $('open').disabled = true;
    try {
      const r = await ingestAnyBuffer(await f.arrayBuffer(), f.name);
      msg('Obsidian ' + r.version + (r.mobile ? '(モバイル版)' : '') + ' を読み込みました。', 'ok');
    } catch (e) { console.error(e); msg('読み込みに失敗しました: ' + e.message, 'err'); progress(null); }
    await refresh();
  });

  async function loadFromSite() {
    $('open').disabled = true; $('reload').disabled = true;
    msg('このサイトから読み込み中…(初回は数秒かかります)');
    try {
      const r = await ingestFromSite(siteSource, (d, n) => msg('読み込み中… ' + d + ' / ' + n));
      msg('Obsidian ' + r.version + (r.mobile ? '(モバイル版)' : '') + ' を読み込みました。', 'ok');
    } catch (e) { console.error(e); msg('読み込みに失敗しました: ' + e.message, 'err'); progress(null); }
    $('reload').disabled = false;
    await refresh();
  }
  $('reload').addEventListener('click', loadFromSite);
  $('platform').addEventListener('change', async () => {
    const v = $('platform').value;
    if (v === 'auto') localStorage.removeItem('ow.mobilePlatform'); else localStorage.setItem('ow.mobilePlatform', v);
    await refresh();
  });

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
      if (meta.mobile) { // folders the mobile UI picked ("Device storage" / "Open folder as vault"): ask for access again
        for (const h of Object.values((await idbGet('mounts')) || {})) {
          try { if ((await h.queryPermission({ mode: 'readwrite' })) !== 'granted') await h.requestPermission({ mode: 'readwrite' }); } catch (_) { /* best effort */ }
        }
      }
      if (!meta.mobile && await isEmpty(root)) { msg('サンプルノートを作成中…'); await seedSampleNotes(root, meta); }
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
    // first visit: load automatically, no upload needed. With ?ui=mobile / ?ui=desktop, switch to that kind if another one is loaded.
    if (siteSource && (!meta || (uiParam() && !!meta.mobile !== (siteSource.ui === 'mobile')))) await loadFromSite();
    if (need) msg(need === 'permission' ? 'フォルダへのアクセス許可が切れました。「開く」を押して許可し直してください。' : 'vaultが選択されていません。', 'err');
  })();
})();
