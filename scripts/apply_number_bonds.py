#!/usr/bin/env python3
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
PARTS = Path(__file__).resolve().parent / "site_parts"

def main():
    app = "".join((PARTS / f"app.part{i}.js").read_text(encoding="utf-8") for i in range(3))
    css = (PARTS / "styles.full.css").read_text(encoding="utf-8")
    assert "renderBondPanel" in app and "nb-grid" in app
    assert "nb-grid" in css and "nb-fork" in css
    (ROOT / "app.js").write_text(app, encoding="utf-8")
    (ROOT / "styles.css").write_text(css, encoding="utf-8")
    print("wrote", len(app), len(css))

if __name__ == "__main__":
    main()
