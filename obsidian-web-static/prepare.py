#!/usr/bin/env python3
"""
Prepare an extracted Obsidian app directory for the static edition.

  python prepare.py obsidian.asar              # extract to ./obsidian and write ./obsidian/ow-files.json
  python prepare.py public.zip                 # mobile app (zip of the APK/IPA "public" folder)
                                               #   -> ./obsidian-mobile and ./obsidian-mobile/ow-files.json
  python prepare.py obsidian.asar -o myapp     # choose the output folder
  python prepare.py --manifest-only obsidian   # you extracted it yourself (e.g. `npx @electron/asar extract`)

A static host cannot list a directory, so the launcher reads ow-files.json to know which files exist.
Only the standard library is used.
"""
import argparse
import json
import os
import shutil
import struct
import sys
import zipfile


def extract_asar(src, dst):
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


def extract_zip(src, dst):
    """Extract the zip of a mobile app's public folder. A wrapper folder ("public/") inside the zip is stripped."""
    with zipfile.ZipFile(src) as z:
        infos = [i for i in z.infolist() if not i.filename.endswith("/")]
        pre = None
        for i in infos:
            n = i.filename.replace("\\", "/")
            if n == "index.html" or n.endswith("/index.html"):
                p = n[:-len("index.html")]
                if pre is None or len(p) < len(pre):
                    pre = p
        if pre is None:
            sys.exit("%s has no index.html: is it the public folder of the APK/IPA?" % src)
        dst_real = os.path.realpath(dst)
        os.makedirs(dst, exist_ok=True)
        for i in infos:
            n = i.filename.replace("\\", "/")
            if not n.startswith(pre) or n.startswith("__MACOSX/") or n.endswith(".DS_Store"):
                continue
            p = os.path.join(dst, *n[len(pre):].split("/"))
            if os.path.commonpath([dst_real, os.path.realpath(p)]) != dst_real:
                continue  # path traversal guard
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with z.open(i) as r, open(p, "wb") as o:
                shutil.copyfileobj(r, o)


def write_manifest(d):
    files = []
    for root, _, names in os.walk(d):
        for n in names:
            rel = os.path.relpath(os.path.join(root, n), d).replace(os.sep, "/")
            if rel != "ow-files.json":
                files.append(rel)
    files.sort()
    # desktop app (from obsidian.asar): index.html, app.js, package.json
    # mobile app (APK/IPA public folder): index.html, app.js, cordova.js
    need = ("index.html", "app.js", "cordova.js") if ("package.json" not in files and "cordova.js" in files) else ("index.html", "app.js", "package.json")
    for n in need:
        if n not in files:
            sys.exit("%s does not look like an extracted Obsidian app (missing %s)" % (d, n))
    with open(os.path.join(d, "ow-files.json"), "w") as f:
        json.dump(files, f)
    return len(files)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", help="obsidian.asar, or the mobile public.zip (or, with --manifest-only, the extracted folder)")
    ap.add_argument("-o", "--out", default=None, help="output folder (default: ./obsidian, or ./obsidian-mobile for a zip)")
    ap.add_argument("--manifest-only", action="store_true", help="only write ow-files.json into an already extracted folder")
    a = ap.parse_args()
    if a.manifest_only:
        d = a.src
    else:
        is_zip = zipfile.is_zipfile(a.src)
        d = a.out or ("obsidian-mobile" if is_zip else "obsidian")
        print("Extracting %s -> %s ..." % (a.src, d))
        if is_zip:
            extract_zip(a.src, d)
        else:
            extract_asar(a.src, d)
    n = write_manifest(d)
    print("OK: %d files listed in %s" % (n, os.path.join(d, "ow-files.json")))


if __name__ == "__main__":
    main()
