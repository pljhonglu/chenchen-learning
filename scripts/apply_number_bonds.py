#!/usr/bin/env python3
from pathlib import Path
import base64, gzip, re
ROOT = Path(__file__).resolve().parents[1]
PARTS = Path(__file__).resolve().parent / "site_parts"

def read_joined(name):
    p = PARTS / name
    if p.exists():
        return p.read_text(encoding="ascii")
    chunks = sorted(PARTS.glob(f"{name}.c*"), key=lambda x: int(x.name.rsplit(".c", 1)[-1]))
    if not chunks:
        raise SystemExit(f"missing {name}")
    return "".join(c.read_text(encoding="ascii") for c in chunks)

def load_bundle():
    raw = re.sub(r"\s+", "", read_joined("bundle.gz.b64"))
    pad = (-len(raw)) % 4
    data = gzip.decompress(base64.b64decode(raw + ("=" * pad)))
    js_b, css_b = data.split(b"\n=====CSS=====\n", 1)
    return js_b.decode("utf-8"), css_b.decode("utf-8")

def apply_app(path, snippet):
    app = path.read_text(encoding="utf-8")
    if not snippet.endswith("\n"): snippet += "\n"
    start = app.find("  const NB_CIRCLES")
    if start < 0: start = app.find("  function genDecomp()")
    end = app.find("  // ---------- Pinyin ----------")
    if start < 0 or end < 0: raise SystemExit("markers missing")
    new = app[:start] + snippet + ("" if snippet.endswith("\n\n") else "\n") + app[end:]
    if new == app:
        print("app.js unchanged"); return False
    path.write_text(new, encoding="utf-8"); print("app.js updated", path.stat().st_size); return True

def apply_css(path, block):
    css = path.read_text(encoding="utf-8")
    if not block.endswith("\n"): block += "\n"
    start = css.find("/* Number bonds workbook")
    legacy = css.find("/* Decompose */")
    legacy2 = css.find("/* Decompose (legacy dots kept) */")
    if start >= 0:
        end = legacy2 if legacy2 > start else css.find("/* Pinyin */")
        new = css[:start] + block + css[end:]
    else:
        if legacy < 0: raise SystemExit("no marker")
        new = css[:legacy] + block + "/* Decompose (legacy dots kept) */\n" + css[legacy+len("/* Decompose */"):]
    if new == css:
        print("styles.css unchanged"); return False
    path.write_text(new, encoding="utf-8"); print("styles.css updated", path.stat().st_size); return True

def main():
    js, css = load_bundle()
    apply_app(ROOT / "app.js", js)
    apply_css(ROOT / "styles.css", css)
    assert "renderBondPanel" in (ROOT/"app.js").read_text(encoding="utf-8")
    assert "nb-fork" in (ROOT/"styles.css").read_text(encoding="utf-8")
    print("OK")

if __name__ == "__main__":
    main()
