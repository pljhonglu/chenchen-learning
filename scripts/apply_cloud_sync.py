#!/usr/bin/env python3
"""Restore app.js/styles.css/README + cloudflare/src/index.js from scripts/site_parts/sync.h*"""
from pathlib import Path
import tarfile, io, sys
root = Path(__file__).resolve().parents[1]
parts = sorted((root/'scripts/site_parts').glob('sync.h*'))
if not parts:
    sys.exit('no sync.h* parts')
hexdata = ''.join(p.read_text(encoding='ascii').strip() for p in parts)
raw = bytes.fromhex(hexdata)
with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as tf:
    tf.extractall(root)
for f in ['app.js','styles.css','README.md','cloudflare/src/index.js']:
    p = root/f
    assert p.is_file() and p.stat().st_size > 0, f
    print('ok', f, p.stat().st_size)
assert 'API_BASE' in (root/'app.js').read_text(encoding='utf-8')
assert 'sync-card' in (root/'styles.css').read_text(encoding='utf-8')
assert 'chenchen-learning-api' in (root/'cloudflare/src/index.js').read_text(encoding='utf-8')
print('cloud sync frontend applied')
