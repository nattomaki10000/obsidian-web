#!/usr/bin/env python3
"""
Prepare an extracted Obsidian app directory for the static edition.

  python prepare.py obsidian.asar              # extract to ./obsidian and write ./obsidian/ow-files.json
  python prepare.py obsidian.asar -o myapp     # choose the output folder
  python prepare.py --manifest-only obsidian   # you extracted it yourself (e.g. `npx @electron/asar extract`)

A static host cannot list a directory, so the launcher reads ow-files.json to know which files exist.
Only the standard library is used.
"""
import argparse
import json
import os
import struct
import sys


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


def write_manifest(d):
    files = []
    for root, _, names in os.walk(d):
        for n in names:
            rel = os.path.relpath(os.path.join(root, n), d).replace(os.sep, "/")
            if rel != "ow-files.json":
                files.append(rel)
    files.sort()
    for need in ("index.html", "app.js", "package.json"):
        if need not in files:
            sys.exit("%s does not look like an extracted Obsidian app (missing %s)" % (d, need))
    with open(os.path.join(d, "ow-files.json"), "w") as f:
        json.dump(files, f)
    return len(files)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", help="obsidian.asar (or, with --manifest-only, the extracted folder)")
    ap.add_argument("-o", "--out", default="obsidian", help="output folder (default: ./obsidian)")
    ap.add_argument("--manifest-only", action="store_true", help="only write ow-files.json into an already extracted folder")
    a = ap.parse_args()
    if a.manifest_only:
        d = a.src
    else:
        d = a.out
        print("Extracting %s -> %s ..." % (a.src, d))
        extract_asar(a.src, d)
    n = write_manifest(d)
    print("OK: %d files listed in %s" % (n, os.path.join(d, "ow-files.json")))


if __name__ == "__main__":
    main()
