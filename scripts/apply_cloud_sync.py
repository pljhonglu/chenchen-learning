#!/usr/bin/env python3
from pathlib import Path
import tarfile, io, sys, base64, re
root = Path(__file__).resolve().parents[1]
parts_dir = root / "scripts/site_parts"
chunks = sorted(
    parts_dir.glob("sync_bundle.b64.c*"),
    key=lambda p: int(re.search(r"c(\d+)$", p.name).group(1)),
)
bundle = parts_dir / "sync_bundle.b64"
if chunks:
    b64 = "".join(p.read_text(encoding="ascii") for p in chunks)
    raw = base64.b64decode(re.sub(r"\s+", "", b64))
elif bundle.is_file():
    raw = base64.b64decode(re.sub(r"\s+", "", bundle.read_text(encoding="ascii")))
else:
    parts = sorted(parts_dir.glob("sync.h*"))
    if not parts:
        sys.exit("no sync bundle")
    raw = bytes.fromhex("".join(p.read_text(encoding="ascii").strip() for p in parts))
with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as tf:
    tf.extractall(root, filter="data")
for f in ["app.js", "styles.css", "README.md", "cloudflare/src/index.js"]:
    p = root / f
    assert p.is_file() and p.stat().st_size > 0, f
    print("ok", f, p.stat().st_size)
assert "API_BASE" in (root / "app.js").read_text(encoding="utf-8")
assert "sync-card" in (root / "styles.css").read_text(encoding="utf-8")
print("cloud sync frontend applied")
