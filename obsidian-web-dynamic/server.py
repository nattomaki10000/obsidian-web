#!/usr/bin/env python3
"""
obsidian-web: run an Obsidian app bundle (obsidian.asar) in a normal browser.

    python server.py --asar obsidian.asar --vault ./MyVault
    python server.py --asar obsidian.asar --mobile-zip public.zip --vault ./MyVault   # phones get the mobile build

The Electron main process is replaced by this server:
  * static files of the app are served from an extracted copy of the asar
  * ipcRenderer.sendSync(...)  -> POST /__ipc/<channel>   (answered synchronously)
  * Node "fs" calls            -> /__fs/...               (confined to the vault)
  * app:// resource URLs       -> /__vault/...
Only the Python standard library is used.
"""
import argparse
import base64
import json
import mimetypes
import os
import posixpath
import re
import secrets
import shutil
import socketserver
import struct
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(HERE, "web")

mimetypes.add_type("text/markdown", ".md")
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("font/woff2", ".woff2")


# --------------------------------------------------------------------------
# asar extraction
# --------------------------------------------------------------------------
def extract_asar(src, dst):
    """Extract an Electron ASAR archive (pure python)."""
    with open(src, "rb") as f:
        f.read(4)
        header_size = struct.unpack("<I", f.read(4))[0]
        f.read(4)
        json_len = struct.unpack("<I", f.read(4))[0]
        header = json.loads(f.read(json_len))
        base = 8 + header_size
        dst_real = os.path.realpath(dst)

        def walk(node, path):
            for name, ent in node.get("files", {}).items():
                p = os.path.join(path, name)
                if os.path.commonpath([dst_real, os.path.realpath(p)]) != dst_real:
                    continue  # path traversal guard
                if "files" in ent:
                    os.makedirs(p, exist_ok=True)
                    walk(ent, p)
                elif "link" in ent or ent.get("unpacked"):
                    continue
                else:
                    f.seek(base + int(ent["offset"]))
                    os.makedirs(os.path.dirname(p), exist_ok=True)
                    with open(p, "wb") as o:
                        o.write(f.read(ent["size"]))

        os.makedirs(dst, exist_ok=True)
        walk(header, dst)


def prepare_app(asar, cache, required=True):
    app_dir = os.path.join(cache, "app")
    stamp_file = os.path.join(cache, "asar.stamp")
    if asar:
        st = os.stat(asar)
        stamp = "%d:%d" % (st.st_size, int(st.st_mtime))
        old = open(stamp_file).read() if os.path.exists(stamp_file) else ""
        if old != stamp or not os.path.exists(os.path.join(app_dir, "package.json")):
            print("Extracting %s ..." % asar)
            if os.path.isdir(app_dir):
                shutil.rmtree(app_dir)
            os.makedirs(cache, exist_ok=True)
            extract_asar(asar, app_dir)
            with open(stamp_file, "w") as f:
                f.write(stamp)
    if not os.path.exists(os.path.join(app_dir, "package.json")):
        if required:
            sys.exit("No app found. Pass --asar obsidian.asar (or --mobile-zip public.zip)")
        return None
    return app_dir


# --------------------------------------------------------------------------
# mobile build (the "public" folder of the Android APK / iOS IPA, as a zip)
# --------------------------------------------------------------------------
def zip_prefix(names):
    """Folder inside the zip that holds index.html (the shortest one), or None."""
    best = None
    for n in names:
        if n == "index.html" or n.endswith("/index.html"):
            pre = n[:-len("index.html")]
            if best is None or len(pre) < len(best):
                best = pre
    return best


def looks_like_mobile_zip(path):
    """True for a zip that holds index.html + app.js + cordova.js (and no package.json)."""
    try:
        with zipfile.ZipFile(path) as z:
            names = [n.replace("\\", "/") for n in z.namelist()]
    except (zipfile.BadZipFile, OSError):
        return False
    pre = zip_prefix(names)
    if pre is None:
        return False
    have = {n[len(pre):] for n in names if n.startswith(pre)}
    return {"index.html", "app.js", "cordova.js"} <= have and "package.json" not in have


def extract_mobile_zip(src, dst):
    with zipfile.ZipFile(src) as z:
        infos = [i for i in z.infolist() if not i.filename.endswith("/")]
        pre = zip_prefix([i.filename.replace("\\", "/") for i in infos]) or ""
        dst_real = os.path.realpath(dst)
        os.makedirs(dst, exist_ok=True)
        for i in infos:
            name = i.filename.replace("\\", "/")
            if not name.startswith(pre) or name.startswith("__MACOSX/") or name.endswith(".DS_Store"):
                continue
            p = os.path.join(dst, *name[len(pre):].split("/"))
            if os.path.commonpath([dst_real, os.path.realpath(p)]) != dst_real:
                continue  # path traversal guard
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with z.open(i) as r, open(p, "wb") as o:
                shutil.copyfileobj(r, o)


def mobile_info(app_dir):
    with open(os.path.join(app_dir, "app.js"), encoding="utf-8", errors="replace") as f:
        js = f.read()
    t = re.search(r'"(I understand and agree[^"]*)"', js)
    v = re.search(r'\b\w+="(1\.\d+\.\d+)",\w+="\d+\.\d+\.\d+"', js)
    return (v.group(1) if v else "1.14.4"), (t.group(1) if t else "")


def prepare_mobile(zips, cache):
    """Extract every mobile zip once (cached by size+mtime). Returns [{key, dir, name, hint, version, terms}]."""
    out = []
    for idx, zp in enumerate(zips):
        st = os.stat(zp)
        stamp = "%s:%d:%d" % (os.path.abspath(zp), st.st_size, int(st.st_mtime))
        d = os.path.join(cache, "mobile", str(idx))
        sf = os.path.join(d + ".stamp")
        old = open(sf).read() if os.path.exists(sf) else ""
        if old != stamp or not os.path.exists(os.path.join(d, "index.html")):
            print("Extracting %s ..." % zp)
            if os.path.isdir(d):
                shutil.rmtree(d)
            os.makedirs(os.path.dirname(d), exist_ok=True)
            extract_mobile_zip(zp, d)
            with open(sf, "w") as f:
                f.write(stamp)
        version, terms = mobile_info(d)
        base = os.path.basename(zp).lower()
        hint = "android" if re.search(r"android|apk", base) else ("ios" if re.search(r"ios|ipa|iphone|ipad", base) else None)
        out.append({"key": str(idx), "dir": d, "name": os.path.basename(zp), "hint": hint, "version": version, "terms": terms})
    return out


def is_mobile_ua(ua):
    return bool(re.search(r"Android|iPhone|iPod|iPad|Mobile", ua or "", re.I))


def ua_platform(ua):
    return "android" if re.search(r"Android", ua or "", re.I) else "ios"


def pick_mobile(platform):
    """Which extracted mobile build to serve: prefer the one whose file name matches the platform."""
    for m in S.mobile:
        if m["hint"] == platform:
            return m
    for m in S.mobile:
        if m["hint"] is None:
            return m
    return S.mobile[0] if S.mobile else None


# --------------------------------------------------------------------------
# state
# --------------------------------------------------------------------------
class State:
    pass


S = State()
S.appjs_cache = None
S.app_dir = None
S.mobile = []


class FsError(Exception):
    def __init__(self, code, msg=None):
        super().__init__(msg or code)
        self.code = code


ERRNO_MAP = {
    2: "ENOENT", 17: "EEXIST", 39: "ENOTEMPTY", 21: "EISDIR", 20: "ENOTDIR",
    13: "EACCES", 1: "EPERM", 22: "EINVAL", 18: "EXDEV", 36: "ENAMETOOLONG",
}


def vpath_to_real(vp, for_write=False):
    """Map a virtual path (/<VNAME>/...) to a real path inside the vault."""
    if not isinstance(vp, str):
        raise FsError("EINVAL")
    vp = posixpath.normpath("/" + vp.replace("\\", "/").lstrip("/"))
    root = S.vroot
    if vp == root:
        rel = ""
    elif vp.startswith(root + "/"):
        rel = vp[len(root) + 1:]
    else:
        raise FsError("EACCES" if for_write else "ENOENT")
    real = os.path.join(S.vault, *rel.split("/")) if rel else S.vault
    # symlink escape guard
    rp = os.path.realpath(real)
    if rp != S.vault_real and not rp.startswith(S.vault_real + os.sep):
        raise FsError("EACCES" if for_write else "ENOENT")
    return real


def real_to_vpath(real):
    rel = os.path.relpath(real, S.vault).replace(os.sep, "/")
    return S.vroot if rel == "." else S.vroot + "/" + rel


def stat_dict(st):
    import stat as _s
    if _s.S_ISDIR(st.st_mode):
        t = "directory"
    elif _s.S_ISLNK(st.st_mode):
        t = "symlink"
    elif _s.S_ISREG(st.st_mode):
        t = "file"
    else:
        t = "other"
    birth = getattr(st, "st_birthtime", None) or st.st_ctime
    return {
        "type": t, "size": st.st_size, "mode": st.st_mode,
        "mtimeMs": st.st_mtime * 1000.0, "ctimeMs": st.st_ctime * 1000.0,
        "atimeMs": st.st_atime * 1000.0, "birthtimeMs": birth * 1000.0,
    }


def fs_op(op, a):
    """JSON fs operations. `a` is the argument dict."""
    if op == "exists":
        try:
            return os.path.exists(vpath_to_real(a["path"]))
        except FsError:
            return False
    if op == "stat":
        return stat_dict(os.stat(vpath_to_real(a["path"])))
    if op == "lstat":
        return stat_dict(os.lstat(vpath_to_real(a["path"])))
    if op == "readdir":
        out = []
        with os.scandir(vpath_to_real(a["path"])) as it:
            for e in it:
                if a.get("types"):
                    t = "directory" if e.is_dir(follow_symlinks=False) else (
                        "symlink" if e.is_symlink() else "file")
                    out.append({"name": e.name, "type": t})
                else:
                    out.append(e.name)
        return out
    if op == "mkdir":
        p = vpath_to_real(a["path"], True)
        if a.get("recursive"):
            os.makedirs(p, exist_ok=True)
        else:
            os.mkdir(p)
        return None
    if op == "rmdir":
        p = vpath_to_real(a["path"], True)
        if p == S.vault:
            raise FsError("EPERM")
        if a.get("recursive"):
            shutil.rmtree(p)
        else:
            os.rmdir(p)
        return None
    if op == "rm":
        p = vpath_to_real(a["path"], True)
        if p == S.vault:
            raise FsError("EPERM")
        try:
            if os.path.isdir(p) and not os.path.islink(p):
                if a.get("recursive"):
                    shutil.rmtree(p)
                else:
                    raise FsError("EISDIR")
            else:
                os.remove(p)
        except FileNotFoundError:
            if not a.get("force"):
                raise
        return None
    if op == "unlink":
        p = vpath_to_real(a["path"], True)
        if os.path.isdir(p) and not os.path.islink(p):
            raise FsError("EISDIR")
        os.remove(p)
        return None
    if op == "rename":
        src, dst = vpath_to_real(a["from"], True), vpath_to_real(a["to"], True)
        if src == S.vault:
            raise FsError("EPERM")
        os.replace(src, dst)
        return None
    if op == "copyFile":
        shutil.copy2(vpath_to_real(a["from"]), vpath_to_real(a["to"], True))
        return None
    if op == "readdirStat":  # one level, with stat info (used by the mobile build)
        out = []
        with os.scandir(vpath_to_real(a["path"])) as it:
            for e in it:
                try:
                    st = e.stat()
                except OSError:
                    try:
                        st = e.stat(follow_symlinks=False)
                    except OSError:
                        continue
                d = stat_dict(st)
                out.append({"name": e.name, "type": d["type"], "size": d["size"],
                            "mtimeMs": d["mtimeMs"], "ctimeMs": d["birthtimeMs"] or d["ctimeMs"]})
        return out
    if op == "statAll":  # recursive flat list, names relative to `path` (used by the mobile build)
        root = vpath_to_real(a["path"])
        out = []

        def walk(d, pre):
            with os.scandir(d) as it:
                for e in it:
                    try:
                        st = e.stat()
                    except OSError:
                        continue
                    sd = stat_dict(st)
                    rel = pre + "/" + e.name if pre else e.name
                    out.append({"name": rel, "type": sd["type"], "size": sd["size"],
                                "mtimeMs": sd["mtimeMs"], "ctimeMs": sd["birthtimeMs"] or sd["ctimeMs"]})
                    if sd["type"] == "directory" and not e.is_symlink():
                        walk(e.path, rel)
        walk(root, "")
        return out
    if op == "copy":  # file or folder
        src, dst = vpath_to_real(a["from"]), vpath_to_real(a["to"], True)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if os.path.isdir(src):
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)
        return None
    if op == "realpath":
        p = vpath_to_real(a["path"])
        if not os.path.exists(p):
            raise FileNotFoundError(2, "no such file or directory")
        return real_to_vpath(os.path.realpath(p)) if os.path.realpath(p).startswith(S.vault_real) else a["path"]
    if op == "utimes":
        p = vpath_to_real(a["path"], True)
        os.utime(p, (float(a["atime"]), float(a["mtime"])))
        return None
    if op == "access":
        p = vpath_to_real(a["path"])
        if not os.path.exists(p):
            raise FileNotFoundError(2, "no such file or directory")
        return None
    if op == "sigs":
        # signature of each watched directory (non-recursive) for client side polling
        res = {}
        for vp in a.get("paths", []):
            try:
                d = vpath_to_real(vp)
                sig = {}
                with os.scandir(d) as it:
                    for e in it:
                        try:
                            st = e.stat(follow_symlinks=False)
                            sig[e.name] = [st.st_mtime_ns // 1000000, st.st_size, 1 if e.is_dir(follow_symlinks=False) else 0]
                        except OSError:
                            pass
                res[vp] = sig
            except (FsError, OSError):
                res[vp] = None
        return res
    raise FsError("EINVAL", "unknown fs op " + op)


# --------------------------------------------------------------------------
# IPC (replacement for Electron main process)
# --------------------------------------------------------------------------
def trash_item(vp):
    real = vpath_to_real(vp, True)
    if real == S.vault or not os.path.lexists(real):
        return False
    tdir = os.path.join(S.vault, ".trash")
    os.makedirs(tdir, exist_ok=True)
    name = os.path.basename(real)
    dest = os.path.join(tdir, name)
    n = 1
    while os.path.lexists(dest):
        stem, ext = os.path.splitext(name)
        dest = os.path.join(tdir, "%s %d%s" % (stem, n, ext))
        n += 1
    shutil.move(real, dest)
    return True


def save_settings():
    try:
        with open(S.settings_file, "w") as f:
            json.dump(S.settings, f)
    except OSError:
        pass


def ipc(channel, args):
    st = S.settings
    if channel == "version" or channel == "latest-public-version":
        return S.version
    if channel == "terms":
        return S.terms
    if channel == "vault":
        return {"id": "web", "path": S.vroot}
    if channel == "vault-list":
        return {"web": {"path": S.vroot, "ts": int(time.time() * 1000), "open": True}}
    if channel == "vault-open":
        return "Switching or creating vaults is not supported in the browser version."
    if channel in ("vault-remove", "vault-move"):
        return False
    if channel == "vault-message":
        return ""
    if channel == "policy":
        return {}
    if channel == "file-url":
        return "/__vault/"
    if channel in ("desktop-dir", "documents-dir", "get-documents-path", "get-default-vault-path"):
        return posixpath.dirname(S.vroot) or "/"
    if channel == "resources":
        return "/"
    if channel == "get-sandbox-vault-path":
        return S.vroot
    if channel in ("is-quitting", "is-closing", "update", "check-update"):
        return False if channel != "check-update" else None
    if channel == "disable-update":
        return True
    if channel in ("insider-build", "cli", "disable-gpu"):
        return False
    if channel == "frame":
        return "native"
    if channel == "adblock-lists":
        return []
    if channel == "adblock-frequency":
        return 1
    if channel == "set-language":
        if args and args[0]:
            st["language"] = args[0]
        else:
            st.pop("language", None)
        save_settings()
        return None
    if channel == "get-icon":
        return None
    if channel in ("set-icon", "starter", "help", "sandbox"):
        return None
    if channel == "relaunch":
        return ""
    if channel == "trash":
        try:
            return trash_item(args[0])
        except Exception:
            return False
    if channel == "copy-asar":
        return False
    if channel == "register-cli":
        return {"success": False, "message": "Not available in the browser version."}
    if channel == "request-url":
        return request_url(args[0])
    return None


def request_url(p):
    """Server-side HTTP request used by Obsidian's requestUrl()."""
    try:
        url = p["url"]
        if not re.match(r"^https?://", url, re.I):
            return {"error": {"message": "Only http(s) URLs are allowed"}}
        body = p.get("body")
        data = None
        if isinstance(body, dict) and "__b64" in body:
            data = base64.b64decode(body["__b64"])
        elif isinstance(body, str):
            data = body.encode("utf-8")
        req = urllib.request.Request(url, data=data, method=(p.get("method") or "GET").upper())
        if p.get("contentType"):
            req.add_header("Content-Type", p["contentType"])
        for k, v in (p.get("headers") or {}).items():
            try:
                req.add_header(k, str(v))
            except Exception:
                pass
        if not req.has_header("User-agent"):
            req.add_header("User-Agent", "obsidian-web")
        try:
            resp = urllib.request.urlopen(req, timeout=30)
        except urllib.error.HTTPError as e:
            resp = e
        raw = resp.read()
        headers = {k.lower(): v for k, v in resp.headers.items()}
        return {"status": resp.status if hasattr(resp, "status") else resp.code,
                "headers": headers, "body": {"__b64": base64.b64encode(raw).decode()}}
    except Exception as e:  # noqa
        return {"error": {"message": str(e)}}


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------
COOKIE = "ow_token"


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "obsidian-web"

    def log_message(self, fmt, *args):
        if S.verbose:
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # ---- helpers
    def send_bytes(self, code, body, ctype="application/octet-stream", extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_json(self, obj, code=200):
        self.send_bytes(code, json.dumps(obj).encode(), "application/json")

    def host_ok(self):
        host = (self.headers.get("Host") or "").lower()
        return host in S.allowed_hosts

    def authed(self):
        ck = self.headers.get("Cookie") or ""
        for part in ck.split(";"):
            k, _, v = part.strip().partition("=")
            if k == COOKIE and secrets.compare_digest(v, S.token):
                return True
        return False

    def read_body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def deny(self, code=403, msg="Forbidden"):
        self.send_bytes(code, msg.encode(), "text/plain; charset=utf-8")

    # ---- routing
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if not self.host_ok():
            return self.deny(403, "Bad Host header")
        u = urllib.parse.urlsplit(self.path)
        path = urllib.parse.unquote(u.path)
        if path == "/" or path == "/index.html":
            return self.serve_index(u)
        if path.startswith("/m/") or path == "/m":
            return self.serve_mobile(u, path)
        if path.startswith("/__vault/"):
            return self.serve_vault(path[len("/__vault/"):])
        if path == "/__fs/read":
            return self.fs_read(u)
        if path.startswith("/__"):
            return self.deny(404, "Not found")
        if path == "/shim.js":
            return self.serve_file(os.path.join(WEB_DIR, "shim.js"))
        return self.serve_static(path)

    def do_PUT(self):
        if not (self.host_ok() and self.authed() and self.headers.get("X-Obsidian-Web") == "1"):
            return self.deny()
        u = urllib.parse.urlsplit(self.path)
        if u.path != "/__fs/write":
            return self.deny(404, "Not found")
        q = urllib.parse.parse_qs(u.query)
        body = self.read_body()
        try:
            p = vpath_to_real(q["p"][0], True)
            if p == S.vault or os.path.isdir(p):
                raise FsError("EISDIR")
            with open(p, "ab" if q.get("append", ["0"])[0] == "1" else "wb") as f:
                f.write(body)
            self.send_json({"ok": True})
        except Exception as e:
            self.send_json({"error": self.err(e)})

    def do_POST(self):
        if not (self.host_ok() and self.authed() and self.headers.get("X-Obsidian-Web") == "1"):
            return self.deny()
        path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
        try:
            data = json.loads(self.read_body() or b"{}")
        except ValueError:
            return self.deny(400, "Bad JSON")
        if path.startswith("/__ipc/"):
            ch = path[len("/__ipc/"):]
            try:
                return self.send_json({"ret": ipc(ch, data.get("args", []))})
            except Exception as e:
                return self.send_json({"ret": None, "error": str(e)})
        if path.startswith("/__fs/"):
            try:
                return self.send_json({"ok": True, "result": fs_op(path[len("/__fs/"):], data)})
            except Exception as e:
                return self.send_json({"error": self.err(e)})
        return self.deny(404, "Not found")

    @staticmethod
    def err(e):
        if isinstance(e, FsError):
            return {"code": e.code, "message": "%s: %s" % (e.code, e)}
        if isinstance(e, OSError):
            code = ERRNO_MAP.get(e.errno, "EIO")
            return {"code": code, "message": "%s: %s" % (code, e.strerror or e)}
        return {"code": "EIO", "message": str(e)}

    # ---- handlers
    def serve_index(self, u):
        q = urllib.parse.parse_qs(u.query)
        keep = "".join("&%s=%s" % (k, urllib.parse.quote(q[k][0])) for k in ("ui", "platform") if k in q)
        keep = "?" + keep[1:] if keep else ""
        if "token" in q and secrets.compare_digest(q["token"][0], S.token):
            self.send_response(302)
            self.send_header("Set-Cookie", "%s=%s; Path=/; HttpOnly; SameSite=Strict" % (COOKIE, S.token))
            self.send_header("Location", "/" + keep)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if not self.authed():
            return self.deny(403, "Open the URL printed by the server (it contains ?token=...).")
        # phones get the mobile build (when a mobile zip is present), PCs keep the desktop build (asar)
        ui = (q.get("ui") or [""])[0]
        ua = self.headers.get("User-Agent") or ""
        want_mobile = bool(S.mobile) and (ui == "mobile" or (ui != "desktop" and is_mobile_ua(ua)) or S.app_dir is None)
        if ui == "desktop" and S.app_dir is None:
            want_mobile = bool(S.mobile)
        if want_mobile:
            m = pick_mobile((q.get("platform") or [ua_platform(ua)])[0])
            self.send_response(302)
            self.send_header("Location", "/m/%s/%s" % (m["key"], keep))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if S.app_dir is None:
            return self.deny(404, "No app is available")
        with open(os.path.join(S.app_dir, "index.html"), encoding="utf-8") as f:
            html = f.read()
        boot = "<script>window.__OW=%s;</script>\n<script src=\"shim.js\"></script>\n" % json.dumps(
            {"vault": S.vroot, "version": S.version, "language": S.settings.get("language")})
        html = html.replace("<head>", "<head>\n" + boot, 1)
        self.send_bytes(200, html.encode("utf-8"), "text/html; charset=utf-8")

    def serve_mobile(self, u, path):
        """/m/<n>/...  -> the extracted mobile build number n."""
        mm = re.match(r"^/m/(\d+)(/.*)?$", path)
        entry = next((m for m in S.mobile if mm and m["key"] == mm.group(1)), None)
        if not entry:
            return self.deny(404, "Not found")
        rest = (mm.group(2) or "")
        if rest == "":
            self.send_response(302)
            self.send_header("Location", "/m/%s/%s" % (entry["key"], ("?" + u.query) if u.query else ""))
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        rel = posixpath.normpath("/" + rest).lstrip("/")
        if rel in ("", "index.html"):
            if not self.authed():
                return self.deny(403, "Open the URL printed by the server (it contains ?token=...).")
            q = urllib.parse.parse_qs(u.query)
            platform = (q.get("platform") or [ua_platform(self.headers.get("User-Agent"))])[0]
            if platform not in ("android", "ios"):
                platform = "ios"
            with open(os.path.join(entry["dir"], "index.html"), encoding="utf-8") as f:
                html = f.read()
            boot = "<script>window.__OWM=%s;</script>\n<script src=\"mobile-shim.js\"></script>\n" % json.dumps(
                {"vault": S.vroot.lstrip("/"), "version": entry["version"], "terms": entry["terms"], "platform": platform})
            html = html.replace("<head>", "<head>\n" + boot, 1)
            return self.send_bytes(200, html.encode("utf-8"), "text/html; charset=utf-8")
        if rel == "mobile-shim.js":
            return self.serve_file(os.path.join(WEB_DIR, "mobile-shim.js"))
        fp = os.path.join(entry["dir"], *rel.split("/"))
        base = os.path.realpath(entry["dir"])
        rp = os.path.realpath(fp)
        if not rp.startswith(base + os.sep) or not os.path.isfile(rp):
            return self.deny(404, "Not found")
        self.serve_file(rp)

    def serve_file(self, fp, ranged=False):
        try:
            size = os.path.getsize(fp)
        except OSError:
            return self.deny(404, "Not found")
        ctype = mimetypes.guess_type(fp)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        start, end, code = 0, size - 1, 200
        extra = {}
        rng = self.headers.get("Range") if ranged else None
        if rng:
            m = re.match(r"bytes=(\d*)-(\d*)$", rng)
            if m and (m.group(1) or m.group(2)):
                if m.group(1):
                    start = int(m.group(1))
                    end = int(m.group(2)) if m.group(2) else size - 1
                else:
                    start = max(0, size - int(m.group(2)))
                end = min(end, size - 1)
                if start > end or start >= size:
                    return self.send_bytes(416, b"", extra={"Content-Range": "bytes */%d" % size})
                code = 206
                extra["Content-Range"] = "bytes %d-%d/%d" % (start, end, size)
        length = end - start + 1
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-cache")
        for k, v in extra.items():
            self.send_header(k, v)
        self.end_headers()
        if self.command == "HEAD":
            return
        with open(fp, "rb") as f:
            f.seek(start)
            left = length
            while left > 0:
                chunk = f.read(min(1 << 20, left))
                if not chunk:
                    break
                self.wfile.write(chunk)
                left -= len(chunk)

    def serve_patched_appjs(self, fp):
        # Modals (e.g. Settings) would open as separate Electron windows; keep them in-page.
        key = os.stat(fp).st_mtime_ns
        if S.appjs_cache is None or S.appjs_cache[0] != key:
            with open(fp, encoding="utf-8") as f:
                js = f.read()
            js = js.replace("Qy.canPopoutWindow&&this.shouldUsePopout()", "!1&&this.shouldUsePopout()")
            S.appjs_cache = (key, js.encode("utf-8"))
        self.send_bytes(200, S.appjs_cache[1], "application/javascript; charset=utf-8")

    def serve_static(self, path):
        rel = posixpath.normpath("/" + path).lstrip("/")
        fp = os.path.join(S.app_dir, *rel.split("/"))
        base = os.path.realpath(S.app_dir)
        rp = os.path.realpath(fp)
        if not (rp == base or rp.startswith(base + os.sep)) or not os.path.isfile(rp):
            return self.deny(404, "Not found")
        # never expose the electron main process code
        if rel in ("main.js",):
            return self.deny(404, "Not found")
        if rel == "app.js":
            return self.serve_patched_appjs(rp)
        self.serve_file(rp)

    def serve_vault(self, rel):
        if not self.authed():
            return self.deny()
        try:
            rel = rel.split("?")[0]
            real = vpath_to_real("/" + rel)
        except FsError:
            return self.deny(404, "Not found")
        if not os.path.isfile(real):
            return self.deny(404, "Not found")
        self.serve_file(real, ranged=True)

    def fs_read(self, u):
        if not (self.authed() and self.headers.get("X-Obsidian-Web") == "1"):
            return self.deny()
        q = urllib.parse.parse_qs(u.query)
        try:
            p = vpath_to_real(q["p"][0])
            with open(p, "rb") as f:
                body = f.read()
            self.send_bytes(200, body)
        except Exception as e:
            self.send_bytes(404, json.dumps(self.err(e)).encode(), "application/json",
                            {"X-OW-Error": "1"})


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


# --------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="Run Obsidian (from obsidian.asar) in a browser")
    ap.add_argument("--asar", help="path to obsidian.asar (needed on first run)")
    ap.add_argument("--mobile-zip", action="append", default=[], metavar="ZIP",
                    help="zip of the mobile app's public folder (APK/IPA); phones get this build. "
                         "Zips in this folder that look like one are picked up automatically.")
    ap.add_argument("--allow-host", action="append", default=[], metavar="HOST[:PORT]",
                    help="extra Host header to accept (reverse proxy / LAN address)")
    ap.add_argument("--vault", default="./vault", help="vault directory (created if missing)")
    ap.add_argument("--host", default="127.0.0.1", help="bind address (default: 127.0.0.1)")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--cache", default="./.obsidian-web", help="where the extracted app and token are kept")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    S.verbose = args.verbose
    cache = os.path.abspath(args.cache)
    os.makedirs(cache, exist_ok=True)
    # mobile builds: --mobile-zip, plus any zip in this folder that looks like one
    zips = [os.path.abspath(z) for z in args.mobile_zip]
    for fn in sorted(os.listdir(HERE)):
        fp = os.path.join(HERE, fn)
        if fn.lower().endswith(".zip") and fp not in zips and looks_like_mobile_zip(fp):
            zips.append(fp)
    for z in zips:
        if not looks_like_mobile_zip(z):
            sys.exit("Not an Obsidian mobile public folder zip: %s" % z)
    S.mobile = prepare_mobile(zips, cache)
    if not args.asar and not os.path.exists(os.path.join(cache, "app", "package.json")) \
            and os.path.exists(os.path.join(HERE, "obsidian.asar")):
        args.asar = os.path.join(HERE, "obsidian.asar")
    S.app_dir = prepare_app(args.asar, cache, required=not S.mobile)

    S.version, S.terms = "", ""
    if S.app_dir:
        with open(os.path.join(S.app_dir, "package.json"), encoding="utf-8") as f:
            S.version = json.load(f)["version"]
        with open(os.path.join(S.app_dir, "main.js"), encoding="utf-8", errors="replace") as f:
            m = re.search(r'"(I understand and agree[^"]*)"', f.read())
        S.terms = m.group(1) if m else ""

    vault = os.path.abspath(args.vault)
    fresh = not os.path.exists(vault)
    os.makedirs(vault, exist_ok=True)
    if fresh and not os.listdir(vault):
        sandbox = os.path.join(S.app_dir, "sandbox") if S.app_dir else ""
        if sandbox and os.path.isdir(sandbox):
            shutil.copytree(sandbox, vault, dirs_exist_ok=True)
            print("Created a new vault from Obsidian's sample notes: %s" % vault)
    S.vault = vault
    S.vault_real = os.path.realpath(vault)
    S.vroot = "/" + (os.path.basename(vault.rstrip(os.sep)) or "vault")

    S.settings_file = os.path.join(cache, "settings.json")
    try:
        with open(S.settings_file) as f:
            S.settings = json.load(f)
    except (OSError, ValueError):
        S.settings = {}

    tok_file = os.path.join(cache, "token")
    if os.path.exists(tok_file):
        S.token = open(tok_file).read().strip()
    else:
        S.token = secrets.token_urlsafe(24)
        fd = os.open(tok_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(S.token)

    hosts = {"%s:%d" % (h, args.port) for h in ("127.0.0.1", "localhost", "[::1]")}
    if args.host not in ("0.0.0.0", "::", "127.0.0.1", "localhost"):
        hosts.add("%s:%d" % (args.host, args.port))
    hosts.update(h for h in args.allow_host)
    S.allowed_hosts = {h.lower() for h in hosts}
    if args.host in ("0.0.0.0", "::"):
        print("WARNING: listening on all interfaces. Anyone who gets the token URL can read/write the vault.\n"
              "         Host header checks only allow localhost; use a reverse proxy/SSH tunnel for remote use.")

    srv = Server((args.host, args.port), Handler)
    show_host = "localhost" if args.host in ("0.0.0.0", "::", "127.0.0.1") else args.host
    print("\nObsidian %s  |  vault: %s" % (S.version or "(mobile only)", vault))
    for m in S.mobile:
        print("Mobile build: %s (Obsidian %s)  -> served to phones" % (m["name"], m["version"]))
    if S.mobile and S.app_dir:
        print("PCs get the desktop build; add ?ui=mobile or ?ui=desktop to the URL to force one.")
    print("Open:  http://%s:%d/?token=%s\n" % (show_host, args.port, S.token))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
