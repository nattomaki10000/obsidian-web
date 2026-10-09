/* obsidian-web browser shim
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

  // ------------------------------------------------------------------ transport
  function encArg(v) {
    if (v instanceof ArrayBuffer) return { __b64: b64enc(new Uint8Array(v)) };
    if (ArrayBuffer.isView(v)) return { __b64: b64enc(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    if (Array.isArray(v)) return v.map(encArg);
    if (v && typeof v === 'object' && v.constructor === Object) { const o = {}; for (const k in v) o[k] = encArg(v[k]); return o; }
    return v;
  }
  function postSync(url_, payload) {
    const x = new XMLHttpRequest();
    x.open('POST', url_, false);
    x.setRequestHeader('X-Obsidian-Web', '1');
    x.setRequestHeader('Content-Type', 'application/json');
    x.send(JSON.stringify(payload));
    if (x.status !== 200) throw new Error('obsidian-web: ' + url_ + ' -> HTTP ' + x.status);
    return JSON.parse(x.responseText);
  }
  async function postAsync(url_, payload) {
    const r = await fetch(url_, { method: 'POST', headers: { ...HDR, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!r.ok) throw new Error('obsidian-web: ' + url_ + ' -> HTTP ' + r.status);
    return r.json();
  }

  // ------------------------------------------------------------------ fs
  function mkErr(e, syscall, p) {
    const err = new Error((e.message || e.code) + (p ? ", " + syscall + " '" + p + "'" : ''));
    err.code = e.code; err.syscall = syscall; err.path = p;
    err.errno = ({ ENOENT: -2, EEXIST: -17, ENOTEMPTY: -39, EISDIR: -21, ENOTDIR: -20, EACCES: -13, EPERM: -1 })[e.code] || -5;
    return err;
  }
  class Stats {
    constructor(o) {
      Object.assign(this, o);
      this.mtime = new Date(o.mtimeMs); this.ctime = new Date(o.ctimeMs);
      this.atime = new Date(o.atimeMs); this.birthtime = new Date(o.birthtimeMs);
    }
    isFile() { return this.type === 'file'; }
    isDirectory() { return this.type === 'directory'; }
    isSymbolicLink() { return this.type === 'symlink'; }
  }
  class Dirent {
    constructor(o) { this.name = o.name; this._t = o.type; }
    isFile() { return this._t === 'file'; }
    isDirectory() { return this._t === 'directory'; }
    isSymbolicLink() { return this._t === 'symlink'; }
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

  function opSync(op, args, syscall, p) {
    const r = postSync('/__fs/' + op, args);
    if (r.error) throw mkErr(r.error, syscall || op, p);
    return r.result;
  }
  async function opAsync(op, args, syscall, p) {
    const r = await postAsync('/__fs/' + op, args);
    if (r.error) throw mkErr(r.error, syscall || op, p);
    return r.result;
  }
  function readSync(p) {
    const x = new XMLHttpRequest();
    x.open('GET', '/__fs/read?p=' + encodeURIComponent(p), false);
    x.setRequestHeader('X-Obsidian-Web', '1');
    x.overrideMimeType('text/plain; charset=x-user-defined');
    x.send();
    if (x.getResponseHeader('X-OW-Error')) throw mkErr(JSON.parse(x.responseText), 'open', p);
    return str2bin(x.responseText);
  }
  async function readAsync(p) {
    const r = await fetch('/__fs/read?p=' + encodeURIComponent(p), { headers: HDR });
    if (r.headers.get('X-OW-Error')) throw mkErr(await r.json(), 'open', p);
    return new Uint8Array(await r.arrayBuffer());
  }
  function writeSync(p, data, e, append) {
    const x = new XMLHttpRequest();
    x.open('PUT', '/__fs/write?append=' + (append ? 1 : 0) + '&p=' + encodeURIComponent(p), false);
    x.setRequestHeader('X-Obsidian-Web', '1');
    x.send(toBytes(data, e));
    const r = JSON.parse(x.responseText);
    if (r.error) throw mkErr(r.error, 'open', p);
  }
  async function writeAsync(p, data, e, append) {
    const r = await fetch('/__fs/write?append=' + (append ? 1 : 0) + '&p=' + encodeURIComponent(p), { method: 'PUT', headers: HDR, body: toBytes(data, e) });
    const j = await r.json();
    if (j.error) throw mkErr(j.error, 'open', p);
  }

  // polling based fs.watch (one request for all watched directories)
  const watched = new Map(); // vpath -> {sig, set:Set<watcher>}
  let pollTimer = null, polling = false;
  async function pollWatches() {
    if (polling || !watched.size) return;
    polling = true;
    try {
      const paths = [...watched.keys()];
      const r = await postAsync('/__fs/sigs', { paths });
      const res = (r.result) || {};
      for (const p of paths) {
        const rec = watched.get(p); if (!rec) continue;
        const now = res[p], prev = rec.sig;
        rec.sig = now;
        if (prev === undefined) continue; // baseline
        const emit = (ev, name) => rec.set.forEach(w => w.emit('change', ev, name));
        if (now === null && prev !== null) { rec.set.forEach(w => w.emit('error', new Error('ENOENT'))); continue; }
        if (!now || !prev) continue;
        for (const n in now) {
          if (!prev[n]) emit('rename', n);
          else if (prev[n][0] !== now[n][0] || prev[n][1] !== now[n][1]) emit('change', n);
        }
        for (const n in prev) if (!now[n]) emit('rename', n);
      }
    } catch (e) { /* server away */ } finally { polling = false; }
  }
  function fsWatch(p) {
    p = P(p);
    const w = new Emitter();
    let rec = watched.get(p);
    if (!rec) { rec = { sig: undefined, set: new Set() }; watched.set(p, rec); }
    rec.set.add(w);
    if (!pollTimer) pollTimer = setInterval(pollWatches, 1500);
    w.close = () => {
      rec.set.delete(w);
      if (!rec.set.size) watched.delete(p);
      if (!watched.size && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    };
    return w;
  }

  const fsp = {
    async readFile(p, o) { p = P(p); return finishRead(await readAsync(p), o); },
    async writeFile(p, d, o) { p = P(p); await writeAsync(p, d, encOf(o), false); },
    async appendFile(p, d, o) { p = P(p); await writeAsync(p, d, encOf(o), true); },
    async stat(p) { p = P(p); return new Stats(await opAsync('stat', { path: p }, 'stat', p)); },
    async lstat(p) { p = P(p); return new Stats(await opAsync('lstat', { path: p }, 'lstat', p)); },
    async readdir(p, o) {
      p = P(p); const t = !!(o && o.withFileTypes);
      const r = await opAsync('readdir', { path: p, types: t }, 'scandir', p);
      return t ? r.map(x => new Dirent(x)) : r;
    },
    async mkdir(p, o) { p = P(p); await opAsync('mkdir', { path: p, recursive: !!(o && o.recursive) }, 'mkdir', p); },
    async rmdir(p, o) { p = P(p); await opAsync('rmdir', { path: p, recursive: !!(o && o.recursive) }, 'rmdir', p); },
    async rm(p, o) { p = P(p); await opAsync('rm', { path: p, recursive: !!(o && o.recursive), force: !!(o && o.force) }, 'rm', p); },
    async unlink(p) { p = P(p); await opAsync('unlink', { path: p }, 'unlink', p); },
    async rename(a, b) { await opAsync('rename', { from: P(a), to: P(b) }, 'rename', P(a)); },
    async copyFile(a, b) { await opAsync('copyFile', { from: P(a), to: P(b) }, 'copyfile', P(a)); },
    async realpath(p) { p = P(p); return opAsync('realpath', { path: p }, 'realpath', p); },
    async access(p) { p = P(p); await opAsync('access', { path: p }, 'access', p); },
    async utimes(p, a, m) { p = P(p); await opAsync('utimes', { path: p, atime: +a, mtime: +m }, 'utime', p); },
  };
  const fs = {
    promises: fsp,
    constants: { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1, COPYFILE_EXCL: 1 },
    existsSync(p) { try { return !!opSync('exists', { path: P(p) }); } catch (e) { return false; } },
    statSync(p, o) { p = P(p); try { return new Stats(opSync('stat', { path: p }, 'stat', p)); } catch (e) { if (o && o.throwIfNoEntry === false && e.code === 'ENOENT') return undefined; throw e; } },
    lstatSync(p) { p = P(p); return new Stats(opSync('lstat', { path: p }, 'lstat', p)); },
    readFileSync(p, o) { p = P(p); return finishRead(readSync(p), o); },
    writeFileSync(p, d, o) { p = P(p); writeSync(p, d, encOf(o), false); },
    appendFileSync(p, d, o) { p = P(p); writeSync(p, d, encOf(o), true); },
    readdirSync(p, o) { p = P(p); const t = !!(o && o.withFileTypes); const r = opSync('readdir', { path: p, types: t }, 'scandir', p); return t ? r.map(x => new Dirent(x)) : r; },
    mkdirSync(p, o) { p = P(p); opSync('mkdir', { path: p, recursive: !!(o && o.recursive) }, 'mkdir', p); },
    rmdirSync(p, o) { p = P(p); opSync('rmdir', { path: p, recursive: !!(o && o.recursive) }, 'rmdir', p); },
    rmSync(p, o) { p = P(p); opSync('rm', { path: p, recursive: !!(o && o.recursive), force: !!(o && o.force) }, 'rm', p); },
    unlinkSync(p) { p = P(p); opSync('unlink', { path: p }, 'unlink', p); },
    renameSync(a, b) { opSync('rename', { from: P(a), to: P(b) }, 'rename', P(a)); },
    copyFileSync(a, b) { opSync('copyFile', { from: P(a), to: P(b) }, 'copyfile', P(a)); },
    realpathSync(p) { p = P(p); return opSync('realpath', { path: p }, 'realpath', p); },
    accessSync(p) { p = P(p); opSync('access', { path: p }, 'access', p); },
    watch: fsWatch,
  };

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
    sendSync(channel, ...args) {
      let r;
      try { r = postSync('/__ipc/' + channel, { args: encArg(args) }); }
      catch (e) {
        // Chrome forbids synchronous XHR while the page is being unloaded (is-closing check)
        if (channel === 'is-closing' || channel === 'is-quitting') return false;
        throw e;
      }
      if (channel === 'relaunch') setTimeout(() => location.reload(), 50);
      return r.ret;
    },
    async invoke(channel, ...args) { return (await postAsync('/__ipc/' + channel, { args: encArg(args) })).ret; },
    send(channel, ...args) {
      switch (channel) {
        case 'request-url': {
          const id = args[0];
          postAsync('/__ipc/request-url', { args: encArg([args[1]]) }).then(r => {
            const v = r.ret || {};
            if (v.error || !v.body) { ipcEm.emit(id, {}, { error: new Error((v.error && v.error.message) || 'request failed') }); return; }
            const u = b64dec(v.body.__b64);
            ipcEm.emit(id, {}, { status: v.status, headers: v.headers, body: u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) });
          }).catch(err => ipcEm.emit(id, {}, { error: err }));
          return;
        }
        case 'open-url': { const u = String(args[0]); if (/^(https?|mailto|obsidian):/i.test(u)) window.open(u, '_blank', 'noopener'); return; }
        case 'print-to-pdf': setTimeout(() => { window.print(); ipcEm.emit('print-to-pdf', {}); }, 0); return;
        default: return; // menus, browser sessions, ... are not applicable
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
