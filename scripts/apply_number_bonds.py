#!/usr/bin/env python3
"""Idempotent: replace 分解组合 math UI with workbook-style number bonds."""
from pathlib import Path
import base64
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from number_bonds_data_a import SNIPPET_B64_0
from number_bonds_data_b import SNIPPET_B64_1, CSS_B64
SNIPPET_B64 = SNIPPET_B64_0 + SNIPPET_B64_1

def _decode(b64: str) -> str:
    raw = re.sub(r"\s+", "", b64)
    pad = (-len(raw)) % 4
    return base64.b64decode(raw + ("=" * pad)).decode("utf-8")

def apply_app(app_path: Path) -> bool:
    app = app_path.read_text(encoding="utf-8")
    snippet = _decode(SNIPPET_B64)
    if not snippet.endswith("\n"):
        snippet += "\n"
    start = app.find("  const NB_CIRCLES")
    if start < 0:
        start = app.find("  function genDecomp()")
    end = app.find("  // ---------- Pinyin ----------")
    if start < 0 or end < 0:
        raise SystemExit(f"markers missing start={start} end={end}")
    new = app[:start] + snippet + ("" if snippet.endswith("\n\n") else "\n") + app[end:]
    if new == app:
        print("app.js unchanged")
        return False
    app_path.write_text(new, encoding="utf-8")
    print("app.js updated", app_path.stat().st_size)
    return True

def apply_css(css_path: Path) -> bool:
    css = css_path.read_text(encoding="utf-8")
    block = _decode(CSS_B64)
    if not block.endswith("\n"):
        block += "\n"
    start = css.find("/* Number bonds workbook")
    legacy = css.find("/* Decompose */")
    legacy2 = css.find("/* Decompose (legacy dots kept) */")
    if start >= 0:
        end = legacy2 if legacy2 > start else css.find("/* Pinyin */")
        if end < 0:
            raise SystemExit("css end marker missing")
        new = css[:start] + block + css[end:]
    else:
        if legacy < 0:
            raise SystemExit("/* Decompose */ missing")
        new = css[:legacy] + block + "/* Decompose (legacy dots kept) */\n" + css[legacy + len("/* Decompose */"):]
    if new == css:
        print("styles.css unchanged")
        return False
    css_path.write_text(new, encoding="utf-8")
    print("styles.css updated", css_path.stat().st_size)
    return True

def main() -> None:
    changed = False
    changed |= apply_app(ROOT / "app.js")
    changed |= apply_css(ROOT / "styles.css")
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    css = (ROOT / "styles.css").read_text(encoding="utf-8")
    assert "renderBondPanel" in app and "nb-grid" in app
    assert "nb-grid" in css and "nb-fork" in css
    print("OK" if changed else "OK (noop)")

if __name__ == "__main__":
    main()
