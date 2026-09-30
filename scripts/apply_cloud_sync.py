#!/usr/bin/env python3
from pathlib import Path
import tarfile, io, sys, base64, re
root = Path(__file__).resolve().parents[1]
parts_dir = root / "scripts/site_parts"

def load_raw():
    meta = parts_dir / "sync.h.meta"
    hex_parts = sorted(
        [p for p in parts_dir.glob("sync.h*") if re.fullmatch(r"sync\.h\d+", p.name)],
        key=lambda p: int(re.search(r"h(\d+)$", p.name).group(1)),
    )
    if meta.is_file() and hex_parts:
        expect = int(meta.read_text().strip().split()[0])
        if len(hex_parts) >= expect:
            return bytes.fromhex("".join(p.read_text(encoding="ascii").strip() for p in hex_parts[:expect]))
        print("hex incomplete", len(hex_parts), "expect", expect, "; falling back", file=sys.stderr)
    chunks = sorted(
        [p for p in parts_dir.glob("sync_bundle.b64.c*") if re.fullmatch(r"sync_bundle\.b64\.c\d+", p.name)],
        key=lambda p: int(re.search(r"c(\d+)$", p.name).group(1)),
    )
    if chunks:
        by_i = {int(re.search(r"c(\d+)$", p.name).group(1)): p for p in chunks}
        ordered = []
        i = 0
        while i in by_i:
            ordered.append(by_i[i])
            i += 1
        if ordered:
            print("using b64 chunks", [p.name for p in ordered])
            b64 = "".join(p.read_text(encoding="ascii") for p in ordered)
            return base64.b64decode(re.sub(r"\s+", "", b64))
    bundle = parts_dir / "sync_bundle.b64"
    if bundle.is_file():
        return base64.b64decode(re.sub(r"\s+", "", bundle.read_text(encoding="ascii")))
    sys.exit("no sync bundle")

raw = load_raw()
with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as tf:
    tf.extractall(root, filter="data")
for f in ["app.js", "styles.css", "README.md", "cloudflare/src/index.js"]:
    p = root / f
    assert p.is_file() and p.stat().st_size > 0, f
    print("ok", f, p.stat().st_size)
js = (root / "app.js").read_text(encoding="utf-8")
assert "API_BASE" in js
assert "chenchen-learning-api.pljhonglu.workers.dev" in js
assert "sync-card" in (root / "styles.css").read_text(encoding="utf-8")
print("cloud sync frontend applied")
