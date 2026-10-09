/* obsidian-web (static edition) service worker
 *   <scope>app/...      -> Obsidian files that the launcher extracted from the user's obsidian.asar (Cache Storage)
 *   <scope>__vault/...  -> files of the vault; the open Obsidian page reads them via the File System Access API
 */
const APP_CACHE = 'ow-app';
const SCOPE = new URL(self.registration.scope);

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || !u.pathname.startsWith(SCOPE.pathname)) return;
  const rel = u.pathname.slice(SCOPE.pathname.length);
  if (rel.startsWith('app/')) e.respondWith(serveApp(u, rel));
  else if (rel.startsWith('__vault/')) e.respondWith(serveVault(e, rel.slice('__vault/'.length)));
});

async function serveApp(u, rel) {
  if (rel === 'app/shim.js') { // the shim is a normal static file of this site
    return fetch(new URL('app-shim.js', SCOPE), { cache: 'no-cache' });
  }
  const cache = await caches.open(APP_CACHE);
  let r = await cache.match(u.origin + u.pathname);
  if (!r && (rel === 'app/' || rel === 'app')) r = await cache.match(new URL('app/index.html', SCOPE).href);
  if (!r) return new Response('Not found (did you load obsidian.asar in the launcher?)', { status: 404 });
  return r;
}

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  bmp: 'image/bmp', avif: 'image/avif', pdf: 'application/pdf', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  m4a: 'audio/mp4', flac: 'audio/flac', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8', json: 'application/json', css: 'text/css',
};

async function serveVault(e, rest) {
  let vpath;
  try { vpath = '/' + rest.split('/').map(decodeURIComponent).join('/'); } catch (_) { return new Response('bad path', { status: 400 }); }
  let client = e.clientId ? await self.clients.get(e.clientId) : null;
  if (!client) {
    const all = await self.clients.matchAll({ type: 'window' });
    client = all.find(c => new URL(c.url).pathname.startsWith(SCOPE.pathname + 'app/')) || null;
  }
  if (!client) return new Response('Obsidian is not open', { status: 503 });

  const reply = await new Promise(resolve => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve({ ok: false, code: 'ETIMEDOUT' }), 30000);
    ch.port1.onmessage = ev => { clearTimeout(timer); resolve(ev.data); };
    client.postMessage({ type: 'ow-vault-read', path: vpath }, [ch.port2]);
  });
  if (!reply.ok) return new Response(reply.code || 'error', { status: reply.code === 'ENOENT' ? 404 : 500 });

  const ext = vpath.split('.').pop().toLowerCase();
  const type = reply.type || MIME[ext] || 'application/octet-stream';
  const size = reply.buf.byteLength;
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(e.request.headers.get('Range') || '');
  if (m && (m[1] || m[2])) {
    let start, end;
    if (m[1]) { start = +m[1]; end = m[2] ? Math.min(+m[2], size - 1) : size - 1; }
    else { start = Math.max(0, size - +m[2]); end = size - 1; }
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
    headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + size;
    return new Response(reply.buf.slice(start, end + 1), { status: 206, headers });
  }
  return new Response(reply.buf, { status: 200, headers });
}
