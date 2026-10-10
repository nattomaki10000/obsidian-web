/* obsidian-web (static edition) — Capacitor emulation for the *mobile* Obsidian "public" folder
 * (the www/public directory extracted from the Android APK or the iOS IPA).
 *
 * The mobile build does not use Electron. It talks to a native shell through Capacitor plugins
 * (Filesystem, App, Device, ...). This file runs before app.js and pretends to be that shell:
 *   - Capacitor decides the platform from CapacitorCustomPlatform -> "android" / "ios"
 *   - native plugin calls (Capacitor.nativePromise / nativeCallback) are answered here
 *   - the "device storage" is a directory handle: OPFS (browser-internal) or a folder picked in the launcher
 * Everything stays in the browser; nothing is sent anywhere.
 */
(() => {
  'use strict';
  const CFG = window.__OWM || {};
  let stored = null; try { stored = localStorage.getItem('ow.mobilePlatform'); } catch (_) { /* ignore */ }
  const PLATFORM = (stored === 'android' || stored === 'ios' ? stored : /Android/i.test(navigator.userAgent) ? 'android' : 'ios');
  const APP_BASE = new URL('./', location.href);          // <scope>app/
  const VAULT_BASE = new URL('../__vault', location.href).href; // <scope>__vault   (served by sw.js)
  const OPFS_ROOT_NAME = 'mobile-vaults';

  // Capture the real clipboard functions: the app replaces navigator.clipboard.* with calls into the plugin.
  const clip = navigator.clipboard || null;
  const realClip = clip ? { readText: clip.readText && clip.readText.bind(clip), writeText: clip.writeText && clip.writeText.bind(clip) } : {};

  // ------------------------------------------------------------------ root-absolute URLs ("/i18n/ja.txt", "/i18n/mapping.txt")
  // Obsidian loads these with root-absolute paths. On a static site the app lives in <site>/app/, so they would hit the host's
  // real root (404, and the UI language never changes). Redirect same-origin requests outside <site>/app/ and <site>/__vault/ into app/.
  (function patchFetchAndXhr() {
    const SITE = new URL('../', location.href), APP = APP_BASE;
    function fixUrl(input) {
      try {
        const u = new URL(String(input), location.href);
        if (u.origin !== location.origin || !/^https?:$/.test(u.protocol)) return null; // external, blob:, data: ...
        const rel = u.pathname.startsWith(SITE.pathname) ? u.pathname.slice(SITE.pathname.length) : u.pathname.slice(1);
        if (!rel || rel.startsWith('app/') || rel.startsWith('__vault/')) return null;
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
  const enoent = p => err('File does not exist: ' + p, 'ENOENT');
  const b64ToBytes = b64 => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  const bytesToB64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const parts = p => String(p == null ? '' : p).replace(/\\/g, '/').split('/').filter(x => x && x !== '.');
  const lsKey = k => 'CapacitorStorage.' + k;

  // ------------------------------------------------------------------ storage root
  const idb = () => new Promise((res, rej) => {
    const r = indexedDB.open('obsidian-web', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const idbGet = async k => { const db = await idb(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); };

  const idbSet = async (k, v) => { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); };

  // Folders picked with the app's own "Open folder as vault" / "Device storage" (Android UI) live under a virtual path.
  const MOUNT = 'obsidian-web-mounts';
  let mountsP = null;
  const getMounts = () => mountsP || (mountsP = idbGet('mounts').then(m => m || {}));
  async function locate(path) { // -> { root, ps }
    const ps = parts(path);
    if (ps[0] === MOUNT && ps.length > 1) {
      const h = (await getMounts())[ps[1]];
      if (!h) throw enoent(path);
      if ((await h.queryPermission({ mode: 'readwrite' })) !== 'granted') throw err('Folder permission expired. Go back to the launcher and open again.', 'EACCES');
      return { root: h, ps: ps.slice(2) };
    }
    return { root: await getRoot(), ps };
  }

  let rootP = null;
  function getRoot() {
    if (!rootP) rootP = (async () => {
      const rec = await idbGet('vault');
      if (rec && rec.kind === 'fsa' && rec.handle) {
        const h = rec.handle;
        if ((await h.queryPermission({ mode: 'readwrite' })) !== 'granted') throw err('Folder permission expired. Go back to the launcher and open again.', 'EACCES');
        return h;
      }
      return (await navigator.storage.getDirectory()).getDirectoryHandle(OPFS_ROOT_NAME, { create: true });
    })();
    return rootP;
  }

  async function getDir(ps, create, root) {
    let d = root || await getRoot();
    for (const name of ps) {
      try { d = await d.getDirectoryHandle(name, { create: !!create }); }
      catch (e) { throw (e && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')) ? enoent(ps.join('/')) : e; }
    }
    return d;
  }
  async function getEntry(path) { // -> { handle, kind, parent, name } | null
    const { root, ps } = await locate(path);
    if (!ps.length) return { handle: root, kind: 'directory', parent: null, name: '' };
    const name = ps.pop();
    let parent;
    try { parent = await getDir(ps, false, root); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    try { return { handle: await parent.getFileHandle(name), kind: 'file', parent, name }; } catch (e) { if (e.name !== 'NotFoundError' && e.name !== 'TypeMismatchError') throw e; }
    try { return { handle: await parent.getDirectoryHandle(name), kind: 'directory', parent, name }; } catch (e) { if (e.name !== 'NotFoundError' && e.name !== 'TypeMismatchError') throw e; }
    return null;
  }
  async function need(path) { const e = await getEntry(path); if (!e) throw enoent(path); return e; }

  async function statOf(entry) {
    if (entry.kind === 'file') {
      const f = await entry.handle.getFile();
      return { type: 'file', size: f.size, ctime: f.lastModified, mtime: f.lastModified };
    }
    return { type: 'directory', size: 0, ctime: 0, mtime: 0 };
  }
  const uriOf = path => { const ps = parts(path); return ps.length ? VAULT_BASE + '/' + ps.map(encodeURIComponent).join('/') : VAULT_BASE; };

  async function dirAndName(path, create) {
    const { root, ps } = await locate(path);
    if (!ps.length) throw err('Invalid path', 'EINVAL');
    const name = ps.pop();
    return { dir: await getDir(ps, create, root), name };
  }
  async function writeBytes(path, bytes, append) {
    const { dir, name } = await dirAndName(path, true);
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable({ keepExistingData: !!append });
    try {
      if (append) { const size = (await fh.getFile()).size; await w.seek(size); }
      await w.write(bytes);
      await w.close();
    } catch (e) { try { await w.abort(); } catch (_) { /* ignore */ } throw e; }
  }

  async function copyEntry(src, dstDir, dstName) {
    if (src.kind === 'file') {
      const f = await src.handle.getFile();
      const fh = await dstDir.getFileHandle(dstName, { create: true });
      const w = await fh.createWritable(); await w.write(f); await w.close();
    } else {
      const nd = await dstDir.getDirectoryHandle(dstName, { create: true });
      for await (const [n, h] of src.handle.entries()) await copyEntry({ handle: h, kind: h.kind }, nd, n);
    }
  }
  // ------------------------------------------------------------------ plugins
  const listeners = Object.create(null); // plugin -> event -> Map(id -> cb)
  let nextId = 1;
  const emit = (plugin, event, data) => { const m = listeners[plugin] && listeners[plugin][event]; if (m) m.forEach(cb => { try { cb(data); } catch (e) { console.error(e); } }); };

  const Filesystem = {
    async getUri({ directory, path }) {
      if (directory === 'ICLOUD') throw err('iCloud is not available in the browser', 'UNAVAILABLE');
      return { uri: uriOf(path) };
    },
    async checkPerms() { return { publicStorage: 'granted' }; },
    async requestPerms() { return { publicStorage: 'granted' }; },
    async requestPermissions() { return { publicStorage: 'granted' }; },
    async verifyIcloud() { },
    async choose() { // "Device storage" / "Open folder as vault" (Android UI): use the browser's folder picker
      if (!window.showDirectoryPicker) throw err('This browser cannot pick folders. Choose "App storage" instead.', 'UNAVAILABLE');
      let h;
      try { h = await window.showDirectoryPicker({ id: 'obsidian-web-ext', mode: 'readwrite' }); }
      catch (e) { throw e && e.name === 'AbortError' ? err('User canceled', 'CANCELED') : e; }
      const mounts = await getMounts();
      let name = (h.name || 'folder').replace(/[\\/]/g, '_'), n = 1;
      for (; mounts[name] && !(await mounts[name].isSameEntry(h)); n++) name = (h.name || 'folder') + '-' + (n + 1);
      mounts[name] = h; await idbSet('mounts', mounts);
      return { path: '/' + MOUNT + '/' + name, isRoot: false };
    },
    async startWatch() { },
    async stopWatch() { },
    async watchAndStatAll({ path }) { // flat, recursive list; names are relative to `path`
      const e = await need(path);
      if (e.kind !== 'directory') throw err('Not a directory: ' + path, 'ENOTDIR');
      const children = [];
      const walk = async (dir, pre) => {
        for await (const [name, h] of dir.entries()) {
          const rel = pre ? pre + '/' + name : name;
          if (h.kind === 'file') { const f = await h.getFile(); children.push({ name: rel, type: 'file', size: f.size, ctime: f.lastModified, mtime: f.lastModified }); }
          else { children.push({ name: rel, type: 'directory', size: 0, ctime: 0, mtime: 0 }); await walk(h, rel); }
        }
      };
      await walk(e.handle, '');
      return { children };
    },
    async readFile({ path, encoding }) {
      const e = await need(path);
      if (e.kind !== 'file') throw err('Path is a directory: ' + path, 'EISDIR');
      const f = await e.handle.getFile();
      if (encoding) return { data: await f.text() };
      return { data: bytesToB64(new Uint8Array(await f.arrayBuffer())) };
    },
    async writeFile({ path, data, encoding }) {
      await writeBytes(path, encoding ? new TextEncoder().encode(data == null ? '' : data) : b64ToBytes(data || ''), false);
      return { uri: uriOf(path) };
    },
    async appendFile({ path, data, encoding }) {
      await writeBytes(path, encoding ? new TextEncoder().encode(data == null ? '' : data) : b64ToBytes(data || ''), true);
    },
    async deleteFile({ path }) {
      const e = await need(path);
      if (e.kind !== 'file') throw err('Path is a directory: ' + path, 'EISDIR');
      await e.parent.removeEntry(e.name);
    },
    async mkdir({ path }) { const { root, ps } = await locate(path); await getDir(ps, true, root); },
    async rmdir({ path, recursive }) {
      const e = await need(path);
      if (!e.parent) throw err('Cannot remove the root', 'EPERM');
      await e.parent.removeEntry(e.name, { recursive: recursive !== false });
    },
    async readdir({ path }) {
      const e = await need(path);
      if (e.kind !== 'directory') throw err('Not a directory: ' + path, 'ENOTDIR');
      const base = parts(path).join('/'), files = [];
      for await (const [name, h] of e.handle.entries()) {
        if (h.kind === 'file') {
          const f = await h.getFile();
          files.push({ name, type: 'file', size: f.size, ctime: f.lastModified, mtime: f.lastModified, uri: uriOf(base ? base + '/' + name : name) });
        } else files.push({ name, type: 'directory', size: 0, ctime: 0, mtime: 0, uri: uriOf(base ? base + '/' + name : name) });
      }
      return { files };
    },
    async stat({ path }) {
      const e = await need(path);
      return { ...(await statOf(e)), uri: uriOf(path) };
    },
    async setTimes() { /* the web has no way to set file times */ },
    async rename({ from, to }) {
      const src = await need(from);
      if (!src.parent) throw err('Cannot move the root', 'EPERM');
      const { dir, name } = await dirAndName(to, true);
      if (typeof src.handle.move === 'function') {
        try { await src.handle.move(dir, name); return; } catch (e) { /* fall back to copy + delete */ }
      }
      await copyEntry(src, dir, name);
      await src.parent.removeEntry(src.name, { recursive: true });
    },
    async copy({ from, to }) {
      const src = await need(from);
      const { dir, name } = await dirAndName(to, true);
      await copyEntry(src, dir, name);
    },
    async open() { /* no "open with default app" in a browser */ },
    async trash() { throw err('Trash is not available (using the vault .trash folder instead)', 'UNAVAILABLE'); },
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

  // ------------------------------------------------------------------ the service worker asks this page for vault files (images, pdf, audio, large attachments)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', async ev => {
      const d = ev.data;
      if (!d || d.type !== 'ow-vault-read') return;
      const port = ev.ports[0];
      try {
        const e = await need(d.path);
        if (e.kind !== 'file') throw enoent(d.path);
        const f = await e.handle.getFile();
        const buf = await f.arrayBuffer();
        port.postMessage({ ok: true, buf, type: f.type, mtime: f.lastModified }, [buf]);
      } catch (e) { port.postMessage({ ok: false, code: (e && e.code) || 'EIO' }); }
    });
  }

  // ------------------------------------------------------------------ the mobile UI is built for a touch screen and a phone-sized viewport
  document.documentElement.classList.add('owm');
})();
