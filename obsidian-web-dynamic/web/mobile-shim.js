/* obsidian-web (dynamic edition) — Capacitor emulation for the *mobile* Obsidian "public" folder
 * (the www/public directory extracted from the Android APK or the iOS IPA), served by server.py.
 *
 * The mobile build talks to a native shell through Capacitor plugins (Filesystem, App, Device, ...).
 * This file runs before app.js and pretends to be that shell. Unlike the static edition, the "device storage"
 * is the server's vault folder, reached through server.py's /__fs/* API (same-origin, token cookie).
 * The device looks like it has one folder, "<vault name>", and nothing else.
 */
(() => {
  'use strict';
  const CFG = window.__OWM || {};
  const PLATFORM = CFG.platform === 'android' ? 'android' : 'ios';
  const VNAME = CFG.vault || 'vault';
  const VAULT_BASE = location.origin + '/__vault'; // served by server.py (cookie-authenticated)
  const HDR = { 'X-Obsidian-Web': '1' };
  const POLL_MS = 1500;

  // Capture the real clipboard functions: the app replaces navigator.clipboard.* with calls into the plugin.
  const clip = navigator.clipboard || null;
  const realClip = clip ? { readText: clip.readText && clip.readText.bind(clip), writeText: clip.writeText && clip.writeText.bind(clip) } : {};

  // ------------------------------------------------------------------ root-absolute URLs ("/i18n/ja.txt", "/i18n/mapping.txt")
  // Obsidian loads these with root-absolute paths, but this build is served under /m/<n>/. Redirect them into that folder
  // (the server's own endpoints, /__fs/*, /__ipc/*, /__vault/*, and other /m/ paths are left alone).
  (function patchFetchAndXhr() {
    const APP = new URL('./', location.href);
    function fixUrl(input) {
      try {
        const u = new URL(String(input), location.href);
        if (u.origin !== location.origin || !/^https?:$/.test(u.protocol)) return null;
        const rel = u.pathname.slice(1);
        if (!rel || rel.startsWith('m/') || rel.startsWith('__')) return null;
        return new URL(rel + u.search + u.hash, APP).href;
      } catch (_) { return null; }
    }
    const nativeFetch = window.fetch;
    if (nativeFetch && !nativeFetch.__owPatched) {
      const patchedFetch = function (input, init) {
        if (typeof input === 'string' || input instanceof URL) { const f = fixUrl(input); if (f) input = f; }
        else if (typeof Request !== 'undefined' && input instanceof Request) { const f = fixUrl(input.url); if (f) input = new Request(f, input); }
        return nativeFetch.call(this, input, init);
      };
      patchedFetch.__owPatched = true;
      window.fetch = patchedFetch;
    }
    const nativeOpen = XMLHttpRequest.prototype.open;
    if (!nativeOpen.__owPatched) {
      const patchedOpen = function (method, url) {
        const f = fixUrl(url), args = Array.prototype.slice.call(arguments);
        if (f) args[1] = f;
        return nativeOpen.apply(this, args);
      };
      patchedOpen.__owPatched = true;
      XMLHttpRequest.prototype.open = patchedOpen;
    }
  })();

  // ------------------------------------------------------------------ small helpers
  const err = (message, code) => { const e = new Error(message); if (code) e.code = code; return e; };
  const b64ToBytes = b64 => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  const bytesToB64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const parts = p => String(p == null ? '' : p).replace(/\\/g, '/').split('/').filter(x => x && x !== '.');
  const lsKey = k => 'CapacitorStorage.' + k;
  const uriOf = path => { const ps = parts(path); return ps.length ? VAULT_BASE + '/' + ps.map(encodeURIComponent).join('/') : VAULT_BASE; };

  // ------------------------------------------------------------------ server file API
  async function fsop(op, args) {
    const r = await fetch('/__fs/' + op, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, HDR), body: JSON.stringify(args || {}), credentials: 'same-origin' });
    if (!r.ok) throw err('Server error ' + r.status + (r.status === 403 ? ' (open the URL with ?token=... again)' : ''), 'EIO');
    const j = await r.json();
    if (j.error) throw err(j.error.message, j.error.code);
    return j.result;
  }
  // The only folder on this "device" is the vault. Returns the server-side virtual path.
  function vp(path, write) {
    const ps = parts(path);
    if (ps.length && ps[0] !== VNAME) throw write ? err('EACCES: only the vault "' + VNAME + '" can be used with this server', 'EACCES') : err('ENOENT: ' + path, 'ENOENT');
    if (!ps.length && write) throw err('EACCES: cannot change the storage root', 'EACCES');
    return '/' + ps.join('/');
  }
  const isRoot = path => parts(path).length === 0;
  const kind = t => (t === 'directory' ? 'directory' : 'file');
  const info = (e, base) => ({ name: e.name, type: kind(e.type), size: e.size || 0, ctime: e.ctimeMs || e.mtimeMs || 0, mtime: e.mtimeMs || 0, uri: base ? uriOf(base + '/' + e.name) : undefined });

  async function readBytes(path) {
    const r = await fetch('/__fs/read?p=' + encodeURIComponent(vp(path)), { headers: HDR, credentials: 'same-origin' });
    if (!r.ok) {
      let e = {}; try { e = await r.json(); } catch (_) { /* ignore */ }
      throw err(e.message || 'Cannot read ' + path, e.code || 'ENOENT');
    }
    return new Uint8Array(await r.arrayBuffer());
  }
  async function putBytes(path, bytes, append, retried) {
    const r = await fetch('/__fs/write?p=' + encodeURIComponent(vp(path, true)) + (append ? '&append=1' : ''), { method: 'PUT', headers: HDR, body: bytes, credentials: 'same-origin' });
    const j = await r.json().catch(() => ({ error: { message: 'Server error ' + r.status, code: 'EIO' } }));
    if (j.error) {
      if (j.error.code === 'ENOENT' && !retried) { // parent folder is missing: create it and try again
        const ps = parts(path); ps.pop();
        if (ps.length) { await fsop('mkdir', { path: vp(ps.join('/'), true), recursive: true }); return putBytes(path, bytes, append, true); }
      }
      throw err(j.error.message, j.error.code);
    }
  }
  const parentOf = path => { const ps = parts(path); ps.pop(); return ps.join('/'); };

  // ------------------------------------------------------------------ plugins
  const listeners = Object.create(null); // plugin -> event -> Map(id -> cb)
  let nextId = 1;
  const emit = (plugin, event, data) => { const m = listeners[plugin] && listeners[plugin][event]; if (m) m.forEach(cb => { try { cb(data); } catch (e) { console.error(e); } }); };

  // Change detection: the server has no push channel, so poll the folder listing and emit "change" events like the native plugin.
  let watchPath = null, snap = null, timer = null, polling = false;
  const sig = e => e.type + ':' + e.size + ':' + e.mtimeMs;
  async function pollOnce() {
    if (polling || !watchPath || document.hidden) return;
    polling = true;
    try {
      const list = await fsop('statAll', { path: vp(watchPath) });
      const next = new Map(list.map(e => [e.name, sig(e)]));
      if (snap) {
        const changed = [];
        next.forEach((v, k) => { if (snap.get(k) !== v) changed.push(k); });
        snap.forEach((v, k) => { if (!next.has(k)) changed.push(k); });
        for (const rel of changed) emit('Filesystem', 'change', { path: watchPath.replace(/\/+$/, '') + '/' + rel });
      }
      snap = next;
    } catch (e) { /* server briefly unreachable: try again next tick */ } finally { polling = false; }
  }
  function startPolling(path) {
    watchPath = path;
    if (!timer) timer = setInterval(pollOnce, POLL_MS);
  }

  const Filesystem = {
    async getUri({ directory, path }) {
      if (directory === 'ICLOUD') throw err('iCloud is not available in the browser', 'UNAVAILABLE');
      return { uri: uriOf(path) };
    },
    async checkPerms() { return { publicStorage: 'granted' }; },
    async requestPerms() { return { publicStorage: 'granted' }; },
    async requestPermissions() { return { publicStorage: 'granted' }; },
    async verifyIcloud() { },
    async choose() { throw err('Picking other folders is not available with this server (one server = one vault).', 'UNAVAILABLE'); },
    async startWatch({ path }) { startPolling(path == null ? watchPath : path); },
    async stopWatch() { if (timer) { clearInterval(timer); timer = null; } snap = null; },
    async watchAndStatAll({ path }) {
      const list = await fsop('statAll', { path: vp(path) });
      startPolling(path);
      snap = new Map(list.map(e => [e.name, sig(e)]));
      return { children: list.map(e => info(e)) };
    },
    async readFile({ path, encoding }) {
      const u8 = await readBytes(path);
      return { data: encoding ? new TextDecoder().decode(u8) : bytesToB64(u8) };
    },
    async writeFile({ path, data, encoding }) {
      await putBytes(path, encoding ? new TextEncoder().encode(data == null ? '' : data) : b64ToBytes(data || ''), false);
      return { uri: uriOf(path) };
    },
    async appendFile({ path, data, encoding }) {
      await putBytes(path, encoding ? new TextEncoder().encode(data == null ? '' : data) : b64ToBytes(data || ''), true);
    },
    async deleteFile({ path }) { await fsop('unlink', { path: vp(path, true) }); },
    async mkdir({ path }) { await fsop('mkdir', { path: vp(path, true), recursive: true }); },
    async rmdir({ path, recursive }) { await fsop('rmdir', { path: vp(path, true), recursive: recursive !== false }); },
    async readdir({ path }) {
      if (isRoot(path)) return { files: [{ name: VNAME, type: 'directory', size: 0, ctime: 0, mtime: 0, uri: uriOf(VNAME) }] };
      const base = parts(path).join('/');
      return { files: (await fsop('readdirStat', { path: vp(path) })).map(e => info(e, base)) };
    },
    async stat({ path }) {
      if (isRoot(path)) return { type: 'directory', size: 0, ctime: 0, mtime: 0, uri: uriOf('') };
      const s = await fsop('stat', { path: vp(path) });
      return { type: kind(s.type), size: s.size || 0, ctime: s.birthtimeMs || s.ctimeMs || 0, mtime: s.mtimeMs || 0, uri: uriOf(path) };
    },
    async setTimes({ path, mtime }) {
      try { if (mtime) await fsop('utimes', { path: vp(path, true), atime: mtime / 1000, mtime: mtime / 1000 }); } catch (e) { /* not critical */ }
    },
    async rename({ from, to }) {
      const dir = parentOf(to); if (dir) await fsop('mkdir', { path: vp(dir, true), recursive: true });
      await fsop('rename', { from: vp(from, true), to: vp(to, true) });
    },
    async copy({ from, to }) { await fsop('copy', { from: vp(from), to: vp(to, true) }); },
    async open() { /* no "open with default app" in a browser */ },
    async trash({ path }) { // server moves it to <vault>/.trash
      const r = await fetch('/__ipc/trash', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, HDR), body: JSON.stringify({ args: [vp(path, true)] }), credentials: 'same-origin' });
      const j = await r.json().catch(() => ({}));
      if (!j.ret) throw err('Trash failed', 'EIO');
    },
    async addListener() { },
  };

  const App = {
    async getInfo() { return { id: 'md.obsidian', name: 'Obsidian', version: CFG.version || '1.0.0', build: CFG.build || '1', terms: CFG.terms || '' }; },
    async getManagedPolicy() { throw err('not available', 'UNAVAILABLE'); },
    async getLaunchUrl() { return undefined; },
    async getFonts() { return { fonts: [] }; },
    async isInstalledFromStore() { return { value: false }; },
    async minimizeApp() { },
    async setBackgroundColor() { },
    async takeScreenshot() { throw err('Screenshots are not available in the browser', 'UNAVAILABLE'); },
    async setQuickActions() { },
    async requestUrl({ url, method, contentType, headers, body, binary }) {
      const h = Object.assign({}, headers || {}); if (contentType) h['Content-Type'] = contentType;
      const init = { method: method || 'GET', headers: h };
      if (body != null && init.method !== 'GET' && init.method !== 'HEAD') init.body = binary ? b64ToBytes(body) : body;
      const r = await fetch(url, init); // subject to the browser's CORS rules
      const out = {}; r.headers.forEach((v, k) => { out[k] = v; });
      return { status: r.status, headers: out, body: bytesToB64(new Uint8Array(await r.arrayBuffer())) };
    },
    async addListener() { },
  };

  let wake = null;
  const impl = {
    Filesystem, App,
    Browser: { async open({ url }) { window.open(url, '_blank', 'noopener'); }, async close() { }, async addListener() { } },
    Clipboard: {
      async read() {
        try { return { type: 'text/plain', value: realClip.readText ? await realClip.readText() : '' }; } catch (e) { return { type: 'text/plain', value: '' }; }
      },
      async write({ string }) { if (typeof string === 'string' && realClip.writeText) await realClip.writeText(string); },
    },
    SplashScreen: { async hide() { }, async show() { } },
    StatusBar: { async hide() { }, async show() { }, async setStyle() { }, async setBackgroundColor() { }, async setOverlaysWebView() { } },
    Device: {
      async getInfo() {
        return { name: 'Browser', model: 'Web', platform: PLATFORM, operatingSystem: PLATFORM, osVersion: '16.0', manufacturer: 'obsidian-web', isVirtual: false, webViewVersion: '' };
      },
    },
    KeepAwake: {
      async keepAwake() { try { if (navigator.wakeLock && !wake) wake = await navigator.wakeLock.request('screen'); } catch (e) { /* ignore */ } },
      async allowSleep() { try { if (wake) { await wake.release(); wake = null; } } catch (e) { /* ignore */ } },
    },
    Keyboard: {
      async hide() { }, async show() { }, async setStyle() { }, async addListener() { },
      async isMultiWindowMode() { return { isMultiWindowMode: false }; },
      async hasPhysicalKeyboard() { return { value: true }; },
    },
    // Do NOT call navigator.vibrate here: the app routes navigator.vibrate into this plugin.
    Haptics: { async impact() { }, async vibrate() { }, async notification() { }, async selectionStart() { }, async selectionChanged() { }, async selectionEnd() { } },
    Preferences: {
      async get({ key }) { return { value: localStorage.getItem(lsKey(key)) }; },
      async set({ key, value }) { localStorage.setItem(lsKey(key), value); },
      async remove({ key }) { localStorage.removeItem(lsKey(key)); },
      async keys() { const keys = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('CapacitorStorage.')) keys.push(k.slice(17)); } return { keys }; },
      async clear() { for (const k of (await impl.Preferences.keys()).keys) localStorage.removeItem(lsKey(k)); },
    },
    SecureStorage: { // no keychain in the browser: localStorage (same as the plugin's own web fallback)
      async setSynchronizeKeychain() { },
      async internalGetItem({ prefixedKey }) { return { data: localStorage.getItem(prefixedKey) }; },
      async internalSetItem({ prefixedKey, data }) { localStorage.setItem(prefixedKey, data); },
      async internalRemoveItem({ prefixedKey }) {
        if (localStorage.getItem(prefixedKey) !== null) { localStorage.removeItem(prefixedKey); return { success: true }; }
        return { success: false };
      },
      async getPrefixedKeys({ prefix }) { const keys = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(prefix)) keys.push(k); } return { keys }; },
      async clearItemsWithPrefix({ prefix }) { for (const k of (await impl.SecureStorage.getPrefixedKeys({ prefix })).keys) localStorage.removeItem(k); },
    },
    InAppReview: { async requestReview() { } },
  };

  // ------------------------------------------------------------------ the bridge Capacitor's bundled runtime expects
  const headers = Object.keys(impl).map(name => ({
    name,
    methods: Object.keys(impl[name]).filter(m => m !== 'addListener')
      .map(m => ({ name: m, rtype: 'promise' }))
      .concat([{ name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'promise' }]),
  }));

  const Cap = window.Capacitor = window.Capacitor || {};
  Cap.PluginHeaders = headers;
  Cap.nativePromise = (plugin, method, options) => {
    if (method === 'removeListener') {
      const m = listeners[plugin] && listeners[plugin][options && options.eventName];
      if (m) m.delete(options.callbackId);
      return Promise.resolve();
    }
    const p = impl[plugin], fn = p && p[method];
    if (!fn) return Promise.reject(Object.assign(new Error('"' + plugin + '.' + method + '()" is not implemented'), { code: 'UNIMPLEMENTED' }));
    try { return Promise.resolve(fn.call(p, options || {})); } catch (e) { return Promise.reject(e); }
  };
  Cap.nativeCallback = (plugin, method, options, callback) => {
    if (method !== 'addListener') return undefined;
    const id = 'owm' + (nextId++);
    const byEvent = listeners[plugin] || (listeners[plugin] = Object.create(null));
    (byEvent[options.eventName] || (byEvent[options.eventName] = new Map())).set(id, callback);
    return id;
  };
  window.CapacitorCustomPlatform = { name: PLATFORM };
  window.__OWM_EMIT = emit;

  // ------------------------------------------------------------------ first visit: open the (only) vault straight away
  try {
    if (localStorage.getItem('mobile-selected-vault') === null && !localStorage.getItem('owm-autoopened')) {
      localStorage.setItem('owm-autoopened', '1');
      localStorage.setItem('mobile-selected-vault', PLATFORM === 'ios' ? 'documents/' + VNAME : VNAME);
    }
  } catch (_) { /* ignore */ }
  document.documentElement.classList.add('owm');
})();
