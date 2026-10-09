/* obsidian-web (static edition) browser shim
 * Provides the small part of Electron / Node that the Obsidian renderer expects,
 * backed by server.py. Loaded before app.js.
 */
(function () {
  'use strict';
  const OW = window.__OW || {};
  const HDR = { 'X-Obsidian-Web': '1' };
  const enc = new TextEncoder();
  const dec = new TextDecoder('utf-8');

  // ------------------------------------------------------------------ bytes
  function bin2str(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return s;
  }
  function str2bin(s) {
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff;
    return u;
  }
  function b64enc(u8) { return btoa(bin2str(u8)); }
  function b64dec(s) {
    s = String(s).replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
    while (s.length % 4) s += '=';
    return str2bin(atob(s));
  }
  function strToBytes(str, e) {
    switch ((e || 'utf8').toLowerCase()) {
      case 'hex': { const u = new Uint8Array(str.length >> 1); for (let i = 0; i < u.length; i++) u[i] = parseInt(str.substr(i * 2, 2), 16); return u; }
      case 'base64': case 'base64url': return b64dec(str);
      case 'binary': case 'latin1': case 'ascii': return str2bin(str);
      case 'utf16le': case 'ucs2': case 'ucs-2': case 'utf-16le': {
        const u = new Uint8Array(str.length * 2);
        for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); u[i * 2] = c & 255; u[i * 2 + 1] = c >> 8; }
        return u;
      }
      default: return enc.encode(str);
    }
  }

  class Buffer extends Uint8Array {
    static from(v, a, b) {
      if (typeof v === 'string') { const u = strToBytes(v, a); const o = new Buffer(u.length); o.set(u); return o; }
      if (v instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && v instanceof SharedArrayBuffer)) {
        const off = a || 0; return new Buffer(v, off, b === undefined ? v.byteLength - off : b);
      }
      if (ArrayBuffer.isView(v)) { const o = new Buffer(v.byteLength); o.set(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)); return o; }
      if (Array.isArray(v)) { const o = new Buffer(v.length); o.set(v); return o; }
      if (v && v.type === 'Buffer' && Array.isArray(v.data)) return Buffer.from(v.data);
      throw new TypeError('Unsupported Buffer.from argument');
    }
    static alloc(n, fill) { const b = new Buffer(n); if (fill !== undefined) b.fill(typeof fill === 'string' ? fill.charCodeAt(0) : fill); return b; }
    static allocUnsafe(n) { return new Buffer(n); }
    static isBuffer(x) { return x instanceof Buffer; }
    static byteLength(s, e) { return typeof s === 'string' ? strToBytes(s, e).length : s.byteLength; }
    static concat(list, total) {
      if (total === undefined) total = list.reduce((n, b) => n + b.length, 0);
      const o = new Buffer(total); let p = 0;
      for (const b of list) { if (p >= total) break; o.set(b.subarray(0, Math.min(b.length, total - p)), p); p += b.length; }
      return o;
    }
    static compare(a, b) { return a.compare(b); }
    toString(e, s, t) {
      const u = (s !== undefined || t !== undefined) ? this.subarray(s || 0, t === undefined ? this.length : t) : this;
      switch ((e || 'utf8').toLowerCase()) {
        case 'hex': { let h = ''; for (let i = 0; i < u.length; i++) h += (u[i] < 16 ? '0' : '') + u[i].toString(16); return h; }
        case 'base64': return b64enc(u);
        case 'base64url': return b64enc(u).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        case 'binary': case 'latin1': case 'ascii': return bin2str(u);
        case 'utf16le': case 'ucs2': case 'ucs-2': case 'utf-16le': { let r = ''; for (let i = 0; i + 1 < u.length; i += 2) r += String.fromCharCode(u[i] | (u[i + 1] << 8)); return r; }
        default: return dec.decode(u);
      }
    }
    slice(s, e) { return this.subarray(s, e); }
    equals(o) { if (this.length !== o.length) return false; for (let i = 0; i < this.length; i++) if (this[i] !== o[i]) return false; return true; }
    compare(o) { const n = Math.min(this.length, o.length); for (let i = 0; i < n; i++) if (this[i] !== o[i]) return this[i] < o[i] ? -1 : 1; return this.length === o.length ? 0 : this.length < o.length ? -1 : 1; }
    copy(t, ts = 0, ss = 0, se = this.length) { t.set(this.subarray(ss, se), ts); return se - ss; }
    write(str, off = 0, len, e) { const u = strToBytes(str, e); const n = Math.min(u.length, this.length - off, len === undefined ? Infinity : len); this.set(u.subarray(0, n), off); return n; }
    toJSON() { return { type: 'Buffer', data: Array.from(this) }; }
    _dv() { return new DataView(this.buffer, this.byteOffset, this.byteLength); }
    readUInt8(o = 0) { return this[o]; }
    readUInt16LE(o = 0) { return this._dv().getUint16(o, true); }
    readUInt16BE(o = 0) { return this._dv().getUint16(o, false); }
    readUInt32LE(o = 0) { return this._dv().getUint32(o, true); }
    readUInt32BE(o = 0) { return this._dv().getUint32(o, false); }
    readInt32LE(o = 0) { return this._dv().getInt32(o, true); }
    readInt32BE(o = 0) { return this._dv().getInt32(o, false); }
    writeUInt8(v, o = 0) { this[o] = v; return o + 1; }
    writeUInt16LE(v, o = 0) { this._dv().setUint16(o, v, true); return o + 2; }
    writeUInt32LE(v, o = 0) { this._dv().setUint32(o, v, true); return o + 4; }
    writeUInt32BE(v, o = 0) { this._dv().setUint32(o, v, false); return o + 4; }
  }
  window.Buffer = Buffer;

  // ------------------------------------------------------------------ process
  window.process = window.process || {
    platform: 'linux', arch: 'x64', env: {}, argv: [], pid: 1, type: 'renderer', title: 'obsidian',
    versions: { electron: '28.2.3', chrome: '120.0.0.0' }, // no "node": libraries must stay in browser mode
    cwd: () => '/', nextTick: (f, ...a) => queueMicrotask(() => f(...a)),
    memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0 }), hrtime: () => [0, 0],
    getSystemVersion: () => 'browser', uptime: () => performance.now() / 1000,
    on() { return this; }, off() { return this; }, once() { return this; }, emit() { return false; },
  };

  // ------------------------------------------------------------------ path (posix)
  function normalizeParts(p, abs) {
    const out = [];
    for (const s of p.split('/')) {
      if (!s || s === '.') continue;
      if (s === '..') { if (out.length && out[out.length - 1] !== '..') out.pop(); else if (!abs) out.push('..'); }
      else out.push(s);
    }
    return out;
  }
  const path = {
    sep: '/', delimiter: ':',
    isAbsolute: p => p.charAt(0) === '/',
    normalize(p) {
      if (p === '') return '.';
      const abs = p.charAt(0) === '/', trail = p.charAt(p.length - 1) === '/';
      let r = normalizeParts(p, abs).join('/');
      if (!r && !abs) r = '.';
      if (r && trail) r += '/';
      return (abs ? '/' : '') + r;
    },
    join(...a) { const j = a.filter(x => x !== '').join('/'); return j ? path.normalize(j) : '.'; },
    resolve(...a) {
      let r = '';
      for (let i = a.length - 1; i >= 0 && r.charAt(0) !== '/'; i--) if (a[i]) r = a[i] + (r ? '/' + r : '');
      if (r.charAt(0) !== '/') r = '/' + r;
      return '/' + normalizeParts(r, true).join('/');
    },
    dirname(p) {
      if (!p) return '.';
      const abs = p.charAt(0) === '/';
      let e = p.length; while (e > 1 && p.charAt(e - 1) === '/') e--;
      const i = p.lastIndexOf('/', e - 1);
      if (i === -1) return '.';
      if (i === 0) return abs ? '/' : '.';
      return p.slice(0, i).replace(/\/+$/, '') || '/';
    },
    basename(p, ext) {
      let e = p.length; while (e > 1 && p.charAt(e - 1) === '/') e--;
      p = p.slice(0, e);
      let b = p.slice(p.lastIndexOf('/') + 1);
      if (ext && b.endsWith(ext) && b !== ext) b = b.slice(0, -ext.length);
      return b;
    },
    extname(p) {
      const b = path.basename(p), i = b.lastIndexOf('.');
      return i <= 0 ? '' : b.slice(i);
    },
    relative(from, to) {
      const f = normalizeParts(path.resolve(from), true), t = normalizeParts(path.resolve(to), true);
      let i = 0; while (i < f.length && i < t.length && f[i] === t[i]) i++;
      return [...f.slice(i).map(() => '..'), ...t.slice(i)].join('/');
    },
    parse(p) {
      const base = path.basename(p), ext = path.extname(p), dir = p.includes('/') ? path.dirname(p) : '';
      return { root: p.charAt(0) === '/' ? '/' : '', dir, base, ext, name: ext ? base.slice(0, -ext.length) : base };
    },
    format(o) { const dir = o.dir || o.root || ''; const base = o.base || ((o.name || '') + (o.ext || '')); return dir ? (dir === o.root ? dir + base : dir + '/' + base) : base; },
  };
  path.posix = path;

  // ------------------------------------------------------------------ url / os
  const url = {
    pathToFileURL(p) {
      const href = 'file://' + encodeURI(path.resolve(p)).replace(/[?#]/g, c => encodeURIComponent(c));
      return { href, toString: () => href, pathname: href.slice(7) };
    },
    fileURLToPath(u) { return decodeURIComponent(String(u && u.href || u).replace(/^file:\/\//, '')); },
  };
  const os = {
    hostname: () => location.hostname, version: () => 'browser', release: () => navigator.userAgent,
    platform: () => 'linux', type: () => 'Linux', arch: () => 'x64', homedir: () => '/', tmpdir: () => '/tmp',
    EOL: '\n', cpus: () => [], totalmem: () => 0, freemem: () => 0,
  };

  // ------------------------------------------------------------------ permissive stub
  const stubSeen = new Set();
  function stub(name, over) {
    over = over || {};
    const f = function () { return undefined; };
    return new Proxy(f, {
      get(t, k) {
        if (k in over) return over[k];
        if (k === 'then' || typeof k === 'symbol') return undefined;
        const full = name + '.' + k;
        if (!stubSeen.has(full)) { stubSeen.add(full); console.debug('[obsidian-web] unimplemented:', full); }
        return stub(full);
      },
      apply() { return undefined; },
      set() { return true; },
    });
  }

  // ------------------------------------------------------------------ tiny emitter
  class Emitter {
    constructor() { this._l = {}; }
    on(e, f) { (this._l[e] = this._l[e] || []).push(f); return this; }
    addListener(e, f) { return this.on(e, f); }
    once(e, f) { const w = (...a) => { this.off(e, w); f(...a); }; w._f = f; return this.on(e, w); }
    off(e, f) { const l = this._l[e]; if (l) this._l[e] = l.filter(x => x !== f && x._f !== f); return this; }
    removeListener(e, f) { return this.off(e, f); }
    removeAllListeners(e) { if (e) delete this._l[e]; else this._l = {}; return this; }
    emit(e, ...a) { const l = (this._l[e] || []).slice(); l.forEach(f => { try { f(...a); } catch (err) { console.error(err); } }); return l.length > 0; }
    listenerCount(e) { return (this._l[e] || []).length; }
  }

  // ------------------------------------------------------------------ vault storage (File System Access API)
  // The vault is a FileSystemDirectoryHandle chosen on the launcher page (or a browser-private OPFS folder).
  const VNAME = localStorage.getItem('ow.vaultName') || 'vault';
  const VROOT = '/' + VNAME;
  const BASE = new URL('../', location.href); // site root; the app itself lives in <root>/app/
  const RES_PREFIX = new URL('__vault/', BASE).pathname;

  // ------------------------------------------------------------------ Web Worker paths
  // Obsidian starts the graph view's physics worker with an absolute path: new Worker("/sim.js").
  // On a static site the app lives in <root>/app/, so "/sim.js" would point outside of it (404)
  // and the graph nodes would never move. Redirect root-absolute worker scripts into <root>/app/.
  (function patchWorker() {
    const NativeWorker = window.Worker;
    if (!NativeWorker || NativeWorker.__owPatched) return;
    const APP = new URL('app/', BASE);
    function fix(url) {
      if (typeof url === 'string' || url instanceof URL) {
        const s = String(url);
        if (/^\/(?!\/)/.test(s) && !s.startsWith(BASE.pathname + 'app/')) return new URL(s.slice(1), APP).href;
        if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('//')) {
          try {
            const u = new URL(s, location.href);
            if (u.origin === location.origin && !u.pathname.startsWith(BASE.pathname)) return new URL(u.pathname.slice(1) + u.search, APP).href;
          } catch (_) { /* leave as is */ }
        }
      }
      return url;
    }
    function PatchedWorker(url, opts) {
      if (!new.target) throw new TypeError("Failed to construct 'Worker': Please use the 'new' operator");
      return new NativeWorker(fix(url), opts);
    }
    PatchedWorker.prototype = NativeWorker.prototype;
    PatchedWorker.__owPatched = true;
    window.Worker = PatchedWorker;
  })();

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

  let ROOT = null, caseInsens = false;
  const ready = (async () => {
    const rec = await idbGet('vault');
    if (!rec) throw new Error('no-vault');
    if (rec.kind === 'opfs') {
      ROOT = await (await navigator.storage.getDirectory()).getDirectoryHandle(rec.name, { create: true });
    } else {
      if ((await rec.handle.queryPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('permission');
      ROOT = rec.handle;
    }
    // detect a case-insensitive file system (Windows/macOS) with a short-lived probe file
    try {
      const fh = await ROOT.getFileHandle('.ow_CaseProbe', { create: true });
      try { await ROOT.getFileHandle('.ow_caseprobe'); caseInsens = true; } catch (e) { caseInsens = false; }
      await ROOT.removeEntry('.ow_CaseProbe');
      void fh;
    } catch (e) { /* read-only? ignore */ }
  })();
  ready.catch(e => {
    console.error('[obsidian-web] vault not ready:', e);
    if (!window.__OW_NO_REDIRECT) location.replace(BASE.href + '?need=' + encodeURIComponent(e.message));
  });

  const ERRNO = { ENOENT: -2, EEXIST: -17, ENOTEMPTY: -39, EISDIR: -21, ENOTDIR: -20, EACCES: -13, EPERM: -1, EBUSY: -16, ENOSPC: -28, EAGAIN: -11, ENOSYS: -38 };
  function mkErr(code, syscall, p) {
    const err = new Error(code + ': ' + (syscall || 'error') + (p ? " '" + p + "'" : ''));
    err.code = code; err.syscall = syscall; err.path = p; err.errno = ERRNO[code] || -5;
    return err;
  }
  function domErr(e, syscall, p, typeMismatch) {
    if (e && typeof e.code === 'string' && /^E[A-Z]+$/.test(e.code)) return e;
    let code = 'EIO';
    switch (e && e.name) {
      case 'NotFoundError': code = 'ENOENT'; break;
      case 'TypeMismatchError': code = typeMismatch || 'ENOTDIR'; break;
      case 'InvalidModificationError': code = 'ENOTEMPTY'; break;
      case 'NotAllowedError': case 'SecurityError': code = 'EACCES'; break;
      case 'QuotaExceededError': code = 'ENOSPC'; break;
      case 'NoModificationAllowedError': code = 'EBUSY'; break;
    }
    return mkErr(code, syscall, p);
  }

  class Stats {
    constructor(o) {
      Object.assign(this, o);
      this.mtime = new Date(o.mtimeMs); this.ctime = new Date(o.ctimeMs);
      this.atime = new Date(o.atimeMs); this.birthtime = new Date(o.birthtimeMs);
    }
    isFile() { return this.type === 'file'; }
    isDirectory() { return this.type === 'directory'; }
    isSymbolicLink() { return false; }
  }
  class Dirent {
    constructor(o) { this.name = o.name; this._t = o.type; }
    isFile() { return this._t === 'file'; }
    isDirectory() { return this._t === 'directory'; }
    isSymbolicLink() { return false; }
  }
  const P = p => (p instanceof URL ? decodeURIComponent(p.pathname) : String(p));
  function toBytes(d, e) {
    if (typeof d === 'string') return strToBytes(d, e);
    if (d instanceof ArrayBuffer) return new Uint8Array(d);
    if (ArrayBuffer.isView(d)) return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
    return enc.encode(String(d));
  }
  const encOf = o => (typeof o === 'string' ? o : o && o.encoding) || null;
  const finishRead = (u8, o) => { const b = Buffer.from(u8.buffer, u8.byteOffset, u8.length); const e = encOf(o); return e ? b.toString(e) : b; };
  const mkStat = (type, f) => {
    const t = f ? f.lastModified : 0;
    return new Stats({ type, size: f ? f.size : 0, mode: type === 'directory' ? 0o40755 : 0o100644, mtimeMs: t, ctimeMs: t, atimeMs: t, birthtimeMs: t });
  };

  // virtual path -> path parts relative to the vault root
  function relParts(p, syscall) {
    p = path.normalize(String(p));
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    if (p === VROOT) return [];
    if (!p.startsWith(VROOT + '/')) throw mkErr('ENOENT', syscall, p);
    return p.slice(VROOT.length + 1).split('/');
  }

  // paths we have seen (for the few synchronous existsSync calls)
  const knownRaw = new Set([VROOT]), knownLow = new Set([VROOT.toLowerCase()]);
  const overlay = new Map(); // sync writes: path -> Uint8Array | null (= deleted)
  const addKnown = p => { p = path.normalize(p); knownRaw.add(p); knownLow.add(p.toLowerCase()); };
  const delKnown = p => {
    p = path.normalize(p);
    for (const k of [...knownRaw]) if (k === p || k.startsWith(p + '/')) { knownRaw.delete(k); knownLow.delete(k.toLowerCase()); }
  };
  const isKnown = p => { p = path.normalize(p); return caseInsens ? knownLow.has(p.toLowerCase()) : knownRaw.has(p); };

  const dirCache = new Map();
  async function getDir(parts, create, syscall, p) {
    await ready;
    let h = ROOT, key = '';
    for (const part of parts) {
      key += '/' + part;
      let c = dirCache.get(key);
      if (!c) {
        try { c = await h.getDirectoryHandle(part, { create: !!create }); } catch (e) { throw domErr(e, syscall, p, 'ENOTDIR'); }
        dirCache.set(key, c);
      }
      h = c;
    }
    return h;
  }
  const dropDirCache = parts => {
    const pre = '/' + parts.join('/');
    for (const k of [...dirCache.keys()]) if (k === pre || k.startsWith(pre + '/')) dirCache.delete(k);
  };
  const locks = new Map();
  function withLock(key, fn) {
    const prev = locks.get(key) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    locks.set(key, next);
    next.finally(() => { if (locks.get(key) === next) locks.delete(key); }).catch(() => {});
    return next;
  }

  async function statP(p, syscall) {
    syscall = syscall || 'stat';
    const parts = relParts(p, syscall);
    if (!parts.length) { await ready; return mkStat('directory'); }
    const name = parts[parts.length - 1];
    const dir = await getDir(parts.slice(0, -1), false, syscall, p);
    try {
      const f = await (await dir.getFileHandle(name)).getFile();
      addKnown(p); return mkStat('file', f);
    } catch (e) { if (e.name !== 'TypeMismatchError') throw domErr(e, syscall, p); }
    try { await dir.getDirectoryHandle(name); addKnown(p); return mkStat('directory'); }
    catch (e) { throw domErr(e, syscall, p); }
  }
  async function readP(p) {
    const parts = relParts(p, 'open');
    if (!parts.length) throw mkErr('EISDIR', 'read', p);
    const name = parts[parts.length - 1];
    const dir = await getDir(parts.slice(0, -1), false, 'open', p);
    let fh;
    try { fh = await dir.getFileHandle(name); } catch (e) { throw domErr(e, 'open', p, 'EISDIR'); }
    try { return new Uint8Array(await (await fh.getFile()).arrayBuffer()); } catch (e) { throw domErr(e, 'read', p); }
  }
  function writeBytes(p, bytes, append) {
    return withLock(p, async () => {
      const parts = relParts(p, 'open');
      if (!parts.length) throw mkErr('EISDIR', 'open', p);
      const name = parts.pop();
      const dir = await getDir(parts, false, 'open', p);
      let fh;
      try { fh = await dir.getFileHandle(name, { create: true }); } catch (e) { throw domErr(e, 'open', p, 'EISDIR'); }
      let w;
      try {
        w = await fh.createWritable({ keepExistingData: !!append });
        if (append) await w.seek((await fh.getFile()).size);
        await w.write(bytes);
        await w.close();
      } catch (e) { try { if (w) await w.abort(); } catch (_) { /* ignore */ } throw domErr(e, 'open', p); }
      addKnown(p);
    });
  }
  async function removeP(p, recursive, syscall) {
    const parts = relParts(p, syscall);
    if (!parts.length) throw mkErr('EPERM', syscall, p);
    const name = parts[parts.length - 1];
    const dir = await getDir(parts.slice(0, -1), false, syscall, p);
    try { await dir.removeEntry(name, { recursive: !!recursive }); } catch (e) { throw domErr(e, syscall, p); }
    dropDirCache(parts); delKnown(p);
  }
  async function mkdirP(p, recursive) {
    const parts = relParts(p, 'mkdir');
    if (!parts.length) { if (recursive) return; throw mkErr('EEXIST', 'mkdir', p); }
    if (recursive) { await getDir(parts, true, 'mkdir', p); addKnown(p); return; }
    const name = parts.pop();
    const dir = await getDir(parts, false, 'mkdir', p);
    let exists = true;
    try { await dir.getFileHandle(name); } catch (e) { exists = e.name === 'TypeMismatchError'; }
    if (exists) throw mkErr('EEXIST', 'mkdir', p);
    try { await dir.getDirectoryHandle(name); throw mkErr('EEXIST', 'mkdir', p); } catch (e) { if (e.code === 'EEXIST') throw e; }
    try { await dir.getDirectoryHandle(name, { create: true }); } catch (e) { throw domErr(e, 'mkdir', p); }
    addKnown(p);
  }
  async function readdirP(p, types) {
    const parts = relParts(p, 'scandir');
    const dir = await getDir(parts, false, 'scandir', p);
    const out = [];
    try {
      for await (const [name, h] of dir.entries()) {
        out.push(types ? new Dirent({ name, type: h.kind === 'directory' ? 'directory' : 'file' }) : name);
        addKnown(path.join(p, name));
      }
    } catch (e) { throw domErr(e, 'scandir', p); }
    return out;
  }
  async function copyDirP(a, b) {
    await mkdirP(b, true);
    for (const e of await readdirP(a, true)) {
      const sa = path.join(a, e.name), sb = path.join(b, e.name);
      if (e.isDirectory()) await copyDirP(sa, sb); else await writeBytes(sb, await readP(sa));
    }
  }
  async function renameP(a, b) {
    const pa = relParts(a, 'rename'), pb = relParts(b, 'rename');
    const st = await statP(a, 'rename');
    if (!window.__OW_NO_MOVE && (st.isFile() || !(await statP(b).catch(() => null)))) {
      try { // FileSystemHandle.move() when the browser supports it for this folder
        const sd = await getDir(pa.slice(0, -1), false, 'rename', a);
        const h = st.isFile() ? await sd.getFileHandle(pa[pa.length - 1]) : await sd.getDirectoryHandle(pa[pa.length - 1]);
        const dd = await getDir(pb.slice(0, -1), false, 'rename', b);
        if (typeof h.move === 'function') {
          await h.move(dd, pb[pb.length - 1]);
          dropDirCache(pa); delKnown(a); addKnown(b);
          return;
        }
      } catch (e) { /* fall back to copy + delete */ }
    }
    if (st.isFile()) { await writeBytes(b, await readP(a)); await removeP(a, false, 'rename'); }
    else { await copyDirP(a, b); await removeP(a, true, 'rename'); }
    addKnown(b);
  }
  async function trashP(p) {
    const parts = relParts(p, 'trash');
    if (!parts.length) return false;
    await getDir(['.trash'], true, 'trash', p);
    const name = parts[parts.length - 1], ext = path.extname(name);
    let dest = VROOT + '/.trash/' + name, n = 1;
    while (await statP(dest).then(() => true, () => false)) { dest = VROOT + '/.trash/' + path.basename(name, ext) + ' ' + n + ext; n++; }
    await renameP(p, dest);
    return true;
  }

  // ---- fs.watch: periodic scan of watched directories (File System Access has no change events)
  const watched = new Map();
  let scanning = false, lastScanMs = 0, lastScanEnd = 0;
  async function sigOf(p) {
    let dir;
    try { dir = await getDir(relParts(p), false, 'watch', p); } catch (e) { return null; }
    const sig = {};
    try {
      for await (const [name, h] of dir.entries()) {
        if (h.kind === 'file') { try { const f = await h.getFile(); sig[name] = [f.lastModified, f.size, 0]; } catch (_) { /* gone */ } }
        else sig[name] = [0, 0, 1];
      }
    } catch (e) { return null; }
    return sig;
  }
  async function pollWatches(force) {
    if (scanning || !watched.size || document.hidden) return;
    if (!force && performance.now() - lastScanEnd < lastScanMs * 3) return; // back off on big vaults
    scanning = true;
    const t0 = performance.now();
    try {
      dirCache.clear();
      const paths = [...watched.keys()];
      for (let i = 0; i < paths.length; i += 6) {
        await Promise.all(paths.slice(i, i + 6).map(async p => {
          const rec = watched.get(p); if (!rec) return;
          const now = await sigOf(p), prev = rec.sig;
          rec.sig = now;
          if (prev === undefined) return;
          const emit = (ev, name) => rec.set.forEach(w => w.emit('change', ev, name));
          if (now === null && prev !== null) { rec.set.forEach(w => w.emit('error', new Error('ENOENT'))); return; }
          if (!now || !prev) return;
          for (const n in now) {
            if (!prev[n]) emit('rename', n);
            else if (prev[n][0] !== now[n][0] || prev[n][1] !== now[n][1]) emit('change', n);
          }
          for (const n in prev) if (!now[n]) emit('rename', n);
        }));
      }
    } catch (e) { /* ignore */ } finally { scanning = false; lastScanEnd = performance.now(); lastScanMs = lastScanEnd - t0; }
  }
  let pollTimer = null;
  function fsWatch(p) {
    p = path.normalize(P(p));
    const w = new Emitter();
    let rec = watched.get(p);
    if (!rec) { rec = { sig: undefined, set: new Set() }; watched.set(p, rec); }
    rec.set.add(w);
    if (!pollTimer) pollTimer = setInterval(() => pollWatches(false), 4000);
    w.close = () => {
      rec.set.delete(w);
      if (!rec.set.size) watched.delete(p);
      if (!watched.size && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    };
    return w;
  }
  addEventListener('focus', () => pollWatches(true));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pollWatches(true); });

  const fsp = {
    async readFile(p, o) { return finishRead(await readP(P(p)), o); },
    async writeFile(p, d, o) { await writeBytes(P(p), toBytes(d, encOf(o)), false); },
    async appendFile(p, d, o) { await writeBytes(P(p), toBytes(d, encOf(o)), true); },
    stat: p => statP(P(p), 'stat'),
    lstat: p => statP(P(p), 'lstat'),
    async readdir(p, o) { return readdirP(P(p), !!(o && o.withFileTypes)); },
    async mkdir(p, o) { await mkdirP(P(p), !!(o && o.recursive)); },
    async rmdir(p, o) {
      p = P(p);
      const st = await statP(p, 'rmdir');
      if (!st.isDirectory()) throw mkErr('ENOTDIR', 'rmdir', p);
      await removeP(p, !!(o && o.recursive), 'rmdir');
    },
    async rm(p, o) {
      p = P(p);
      try { await removeP(p, !!(o && o.recursive), 'rm'); }
      catch (e) { if (!(o && o.force && e.code === 'ENOENT')) throw e; }
    },
    async unlink(p) {
      p = P(p);
      if ((await statP(p, 'unlink')).isDirectory()) throw mkErr('EISDIR', 'unlink', p);
      await removeP(p, false, 'unlink');
    },
    rename: (a, b) => renameP(P(a), P(b)),
    async copyFile(a, b) { await writeBytes(P(b), await readP(P(a)), false); },
    async realpath(p) { p = path.normalize(P(p)); await statP(p, 'realpath'); return p; },
    async access(p) { await statP(P(p), 'access'); },
    async utimes() { /* modification times cannot be set through the File System Access API */ },
  };

  // Only a handful of synchronous fs calls touch the vault (a writability probe at start-up).
  // They are served from memory and mirrored to the real file system in the background.
  let syncQueue = Promise.resolve();
  const queue = fn => { syncQueue = syncQueue.then(() => ready).then(fn).catch(e => console.warn('[obsidian-web] background fs op failed', e)); };
  const noSync = name => { throw mkErr('EAGAIN', name, '(not available synchronously in the browser)'); };
  const ovKey = p => { p = path.normalize(p); return caseInsens ? p.toLowerCase() : p; };
  const fs = {
    promises: fsp,
    constants: { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1, COPYFILE_EXCL: 1 },
    existsSync(p) {
      p = P(p); const k = ovKey(p);
      if (overlay.has(k)) return overlay.get(k) !== null;
      return isKnown(p);
    },
    statSync(p, o) {
      p = P(p); const k = ovKey(p);
      if (overlay.get(k)) return mkStat('file', { size: overlay.get(k).length, lastModified: Date.now() });
      if (path.normalize(p) === VROOT) return mkStat('directory');
      if (o && o.throwIfNoEntry === false) return undefined;
      throw mkErr('ENOENT', 'stat', p);
    },
    lstatSync(p) { return fs.statSync(p); },
    readFileSync(p, o) {
      p = P(p); const v = overlay.get(ovKey(p));
      if (v) return finishRead(v, o);
      return noSync('open');
    },
    writeFileSync(p, d, o) {
      p = P(p); const bytes = toBytes(d, encOf(o)).slice();
      overlay.set(ovKey(p), bytes); addKnown(p);
      queue(() => writeBytes(p, bytes, false));
    },
    appendFileSync(p, d, o) {
      p = P(p); const add = toBytes(d, encOf(o)).slice();
      const old = overlay.get(ovKey(p)); const nb = new Uint8Array((old ? old.length : 0) + add.length);
      if (old) nb.set(old); nb.set(add, old ? old.length : 0);
      overlay.set(ovKey(p), nb); addKnown(p);
      queue(() => writeBytes(p, add, true));
    },
    unlinkSync(p) { p = P(p); overlay.set(ovKey(p), null); delKnown(p); queue(() => removeP(p, false, 'unlink').catch(() => {})); },
    rmSync(p, o) { p = P(p); overlay.set(ovKey(p), null); delKnown(p); queue(() => fsp.rm(p, o).catch(() => {})); },
    mkdirSync(p, o) { p = P(p); addKnown(p); queue(() => mkdirP(p, !!(o && o.recursive))); },
    readdirSync() { return noSync('scandir'); },
    renameSync() { return noSync('rename'); },
    copyFileSync() { return noSync('copyfile'); },
    rmdirSync() { return noSync('rmdir'); },
    realpathSync(p) { return path.normalize(P(p)); },
    accessSync(p) { if (!fs.existsSync(p)) throw mkErr('ENOENT', 'access', P(p)); },
    watch: fsWatch,
  };

  // ---- /__vault/... requests (images, pdf, audio...) are answered by the service worker through this page
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', async ev => {
      const d = ev.data;
      if (!d || d.type !== 'ow-vault-read') return;
      const port = ev.ports[0];
      try {
        const parts = relParts(d.path, 'open');
        const name = parts.pop();
        const dir = await getDir(parts, false, 'open', d.path);
        const f = await (await dir.getFileHandle(name)).getFile();
        const buf = await f.arrayBuffer();
        port.postMessage({ ok: true, buf, type: f.type, mtime: f.lastModified }, [buf]);
      } catch (e) { port.postMessage({ ok: false, code: (e && e.code) || 'EIO' }); }
    });
  }

  // ------------------------------------------------------------------ IPC (the "main process" is just this page now)
  function ipcLocal(ch, args) {
    switch (ch) {
      case 'version': case 'latest-public-version': return OW.version;
      case 'terms': return OW.terms;
      case 'vault': return { id: 'web', path: VROOT };
      case 'vault-list': return { web: { path: VROOT, ts: Date.now(), open: true } };
      case 'vault-open': return 'In the browser version the vault is chosen on the launcher page.';
      case 'vault-remove': case 'vault-move': return false;
      case 'vault-message': return '';
      case 'policy': return {};
      case 'file-url': return RES_PREFIX;
      case 'desktop-dir': case 'documents-dir': case 'get-documents-path': case 'get-default-vault-path': case 'resources': return '/';
      case 'get-sandbox-vault-path': return VROOT;
      case 'is-quitting': case 'is-closing': case 'update': return false;
      case 'check-update': return null;
      case 'disable-update': return true;
      case 'insider-build': case 'cli': case 'disable-gpu': return false;
      case 'frame': return 'native';
      case 'adblock-lists': return [];
      case 'adblock-frequency': return 1;
      case 'trash': trashP(args[0]).catch(e => console.error('[obsidian-web] trash failed', e)); return true;
      case 'relaunch': setTimeout(() => location.reload(), 50); return '';
      case 'register-cli': return { success: false, message: 'Not available in the browser version.' };
      default: return null;
    }
  }
  async function requestUrl(p) {
    try {
      if (!/^https?:\/\//i.test(p.url)) throw new Error('Only http(s) URLs are allowed');
      const init = { method: (p.method || 'GET').toUpperCase(), headers: Object.assign({}, p.headers || {}) };
      if (p.contentType) init.headers['Content-Type'] = p.contentType;
      if (p.body != null && init.method !== 'GET' && init.method !== 'HEAD') init.body = p.body;
      const r = await fetch(p.url, init); // subject to CORS in a browser
      const body = await r.arrayBuffer();
      const headers = {}; r.headers.forEach((v, k) => { headers[k] = v; });
      return { status: r.status, headers, body };
    } catch (e) { return { error: e }; }
  }

  // ------------------------------------------------------------------ DOM menu (replacement for native Menu)
  let mouse = { x: 20, y: 20 };
  addEventListener('mousemove', e => { mouse = { x: e.clientX, y: e.clientY }; }, true);
  addEventListener('contextmenu', e => { mouse = { x: e.clientX, y: e.clientY }; }, true);
  const ROLES = { copy: 'copy', cut: 'cut', paste: 'paste', selectAll: 'selectAll', undo: 'undo', redo: 'redo', delete: 'delete' };
  function closeMenus() { document.querySelectorAll('.ow-native-menu').forEach(m => m.remove()); }
  function renderMenu(items, x, y, parentEl) {
    const m = document.createElement('div');
    m.className = 'menu ow-native-menu';
    Object.assign(m.style, { position: 'fixed', zIndex: 100000, left: x + 'px', top: y + 'px' });
    for (const it of items) {
      if (it.visible === false) continue;
      if (it.type === 'separator') { const s = document.createElement('div'); s.className = 'menu-separator'; m.appendChild(s); continue; }
      const row = document.createElement('div');
      row.className = 'menu-item' + (it.enabled === false ? ' is-disabled' : '');
      const t = document.createElement('div'); t.className = 'menu-item-title';
      t.textContent = (it.checked ? '\u2713 ' : '') + (it.label || it.role || '');
      row.appendChild(t);
      if (it.submenu && it.submenu.length) {
        const arrow = document.createElement('div'); arrow.className = 'menu-item-icon'; arrow.textContent = '\u25B8'; row.appendChild(arrow);
        row.addEventListener('mouseenter', () => {
          m.querySelectorAll(':scope > .ow-native-menu').forEach(s => s.remove());
          const r = row.getBoundingClientRect();
          m.appendChild(renderMenu(it.submenu, r.right, r.top));
        });
      } else if (it.enabled !== false) {
        row.addEventListener('mousedown', ev => { ev.preventDefault(); ev.stopPropagation(); });
        row.addEventListener('click', ev => {
          ev.stopPropagation(); closeMenus();
          if (typeof it.click === 'function') it.click(it, null, ev);
          else if (it.role && ROLES[it.role]) document.execCommand(ROLES[it.role]);
        });
      }
      m.appendChild(row);
    }
    if (!parentEl && !x && !y) { m.style.left = mouse.x + 'px'; m.style.top = mouse.y + 'px'; }
    return m;
  }
  const Menu = {
    buildFromTemplate(template) {
      return {
        items: template,
        popup(opts) {
          closeMenus();
          const o = (opts && typeof opts === 'object' && 'x' in opts) ? opts : mouse;
          const m = renderMenu(template, o.x, o.y);
          document.body.appendChild(m);
          const r = m.getBoundingClientRect();
          if (r.right > innerWidth) m.style.left = Math.max(0, innerWidth - r.width - 4) + 'px';
          if (r.bottom > innerHeight) m.style.top = Math.max(0, innerHeight - r.height - 4) + 'px';
          setTimeout(() => {
            const off = ev => { if (!ev.target.closest || !ev.target.closest('.ow-native-menu')) { closeMenus(); removeEventListener('mousedown', off, true); } };
            addEventListener('mousedown', off, true);
            addEventListener('keydown', function esc(ev) { if (ev.key === 'Escape') { closeMenus(); removeEventListener('keydown', esc, true); } }, true);
          }, 0);
        },
        closePopup: closeMenus,
      };
    },
    setApplicationMenu() {}, getApplicationMenu: () => null,
  };

  // ------------------------------------------------------------------ electron
  const ipcEm = new Emitter();
  const ipcRenderer = Object.assign(ipcEm, {
    sendSync(channel, ...args) { return ipcLocal(channel, args); },
    async invoke(channel, ...args) { return ipcLocal(channel, args); },
    send(channel, ...args) {
      switch (channel) {
        case 'request-url': {
          const id = args[0];
          requestUrl(args[1]).then(v => ipcEm.emit(id, {}, v.error ? { error: v.error } : v));
          return;
        }
        case 'open-url': { const u = String(args[0]); if (/^(https?|mailto|obsidian):/i.test(u)) window.open(u, '_blank', 'noopener'); return; }
        case 'print-to-pdf': setTimeout(() => { window.print(); ipcEm.emit('print-to-pdf', {}); }, 0); return;
        default: return;
      }
    },
    postMessage() {},
  });

  const clip0 = navigator.clipboard;
  const origRead = clip0 && clip0.readText ? clip0.readText.bind(clip0) : () => Promise.resolve('');
  const origWrite = clip0 && clip0.writeText ? clip0.writeText.bind(clip0) : () => Promise.resolve();
  const clipboard = {
    readText: () => origRead(), writeText: t => { origWrite(t); }, readHTML: () => '', writeHTML() {},
    readImage: () => stub('clipboard.image', { isEmpty: () => true }), write(o) { if (o && o.text) origWrite(o.text); },
    has: () => false, clear() {}, availableFormats: () => [],
  };

  let zoom = 1;
  const webFrame = {
    getZoomFactor: () => zoom,
    setZoomFactor(f) { zoom = f; document.documentElement.style.zoom = f; },
    getZoomLevel: () => Math.log(zoom) / Math.log(1.2),
    setZoomLevel(l) { webFrame.setZoomFactor(Math.pow(1.2, l)); },
    insertCSS() { return ''; }, removeInsertedCSS() {},
  };
  const nativeImage = {
    createFromBuffer: b => stub('nativeImage', { isEmpty: () => !b || !b.length, toPNG: () => b, toDataURL: () => 'data:image/png;base64,' + Buffer.from(b).toString('base64'), getSize: () => ({ width: 0, height: 0 }) }),
    createFromDataURL: u => stub('nativeImage', { isEmpty: () => false, toDataURL: () => u }),
    createEmpty: () => stub('nativeImage', { isEmpty: () => true }),
  };

  const dark = matchMedia('(prefers-color-scheme: dark)');
  const nativeTheme = {
    get shouldUseDarkColors() { return dark.matches; },
    themeSource: 'system',
    on(ev, f) { if (ev === 'updated') dark.addEventListener('change', f); return nativeTheme; },
    removeAllListeners() { return nativeTheme; }, removeListener() { return nativeTheme; },
  };

  const session = stub('session', {
    availableSpellCheckerLanguages: [], getSpellCheckerLanguages: () => [], setSpellCheckerLanguages() {},
  });
  const webContents = stub('webContents', {
    id: 1, session, capturePage: () => Promise.reject(new Error('Screenshots are not available in the browser version')),
    getZoomFactor: () => zoom, setZoomFactor: webFrame.setZoomFactor, isDevToolsOpened: () => false,
    on() { return webContents; }, once() { return webContents; }, off() { return webContents; }, removeListener() { return webContents; },
    executeJavaScript: code => Promise.resolve((0, eval)(code)),
  });
  const win = stub('window', {
    id: 1, webContents, isMaximized: () => false, isMinimized: () => false, isFullScreen: () => !!document.fullscreenElement,
    isFocused: () => document.hasFocus(), isAlwaysOnTop: () => false, isDestroyed: () => false, isVisible: () => true,
    close: () => window.close(), setTitle: t => { document.title = t; }, getTitle: () => document.title,
    setFullScreen: f => { if (f) document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); else document.exitFullscreen && document.exitFullscreen(); },
    getBounds: () => ({ x: 0, y: 0, width: innerWidth, height: innerHeight }),
    on() { return win; }, once() { return win; }, off() { return win; }, removeListener() { return win; }, removeAllListeners() { return win; },
  });
  const remote = {
    getCurrentWindow: () => win, getCurrentWebContents: () => webContents, getGlobal: () => undefined,
    app: stub('app', {
      getVersion: () => OW.version, getName: () => 'Obsidian', getLocale: () => navigator.language,
      getPreferredSystemLanguages: () => Array.from(navigator.languages || [navigator.language]),
      getPath: () => '/', isPackaged: true,
    }),
    Menu, MenuItem: function (o) { return o; },
    dialog: { showOpenDialogSync: () => undefined, showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }), showSaveDialog: () => Promise.resolve({ canceled: true }), showMessageBox: () => Promise.resolve({ response: 0 }) },
    shell: { showItemInFolder() {}, openExternal: u => { if (/^(https?|mailto):/i.test(u)) window.open(u, '_blank', 'noopener'); return Promise.resolve(); }, openPath: () => Promise.resolve('') },
    nativeTheme, clipboard,
    safeStorage: { isEncryptionAvailable: () => false, encryptString() { throw new Error('unavailable'); }, decryptString() { throw new Error('unavailable'); } },
    session: { fromPartition: () => session, defaultSession: session },
    webContents: { fromId: () => webContents, getAllWebContents: () => [] },
    screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: innerWidth, height: innerHeight }, scaleFactor: devicePixelRatio }), getAllDisplays: () => [] },
  };
  const electron = {
    ipcRenderer, remote, webFrame, clipboard, nativeImage, shell: remote.shell,
    webUtils: { getPathForFile: () => '' },
    contextBridge: stub('contextBridge'),
  };

  // ------------------------------------------------------------------ require
  const modules = { electron, '@electron/remote': remote, fs, 'original-fs': fs, path, url, os };
  window.require = function (name) {
    name = String(name).replace(/^node:/, '');
    return Object.prototype.hasOwnProperty.call(modules, name) ? modules[name] : undefined;
  };
  window.__OW_SHIM__ = true;
})();
