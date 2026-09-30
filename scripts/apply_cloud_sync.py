#!/usr/bin/env python3
from pathlib import Path
import tarfile, io, sys, base64, re
root = Path(__file__).resolve().parents[1]
parts_dir = root / "scripts/site_parts"

def load_raw():
    hex_parts = sorted(
        parts_dir.glob("sync.h*"),
        key=lambda p: int(re.search(r"h(\d+)$", p.name).group(1)),
    )
    if hex_parts:
        return bytes.fromhex("".join(p.read_text(encoding="ascii").strip() for p in hex_parts))
    chunks = sorted(
        [p for p in parts_dir.glob("sync_bundle.b64.c*") if re.fullmatch(r"sync_bundle\.b64\.c\d+", p.name)],
        key=lambda p: int(re.search(r"c(\d+)$", p.name).group(1)),
    )
    # Prefer contiguous c0..cN only (stop before gap); if c0..c3 exist ignore higher
    if chunks:
        by_i = {int(re.search(r"c(\d+)$", p.name).group(1)): p for p in chunks}
        ordered = []
        i = 0
        while i in by_i:
            ordered.append(by_i[i])
            i += 1
        if ordered:
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
assert "API_BASE" in (root / "app.js").read_text(encoding="utf-8")
assert "chenchen-learning-api.pljhonglu.workers.dev" in (root / "app.js").read_text(encoding="utf-8")
assert "sync-card" in (root / "styles.css").read_text(encoding="utf-8")
print("cloud sync frontend applied")
