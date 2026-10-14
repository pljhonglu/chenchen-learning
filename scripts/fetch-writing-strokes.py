#!/usr/bin/env python3
"""Vendor the selected Hanzi Writer Data 2.0.1 characters for same-origin playback."""
import base64
import hashlib
import io
import json
from pathlib import Path
import re
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://registry.npmjs.org/hanzi-writer-data/-/hanzi-writer-data-2.0.1.tgz'
INTEGRITY = 'nbQwM+MaryGoq7pBMIZLCd3lFq03nXuJuwku1+6UbjL58uU+9OULVcMkoNvNuJSoIV7f1bbPRfD4D/LQa5S7qg=='

def selected_characters():
    # Retired vocabulary stays bundled for saved drafts and custom classroom cards.
    source = (ROOT / 'public/writing-vocabulary.js').read_text(encoding='utf-8')
    match = re.fullmatch(r'\s*window\.ChenchenWritingVocabulary\s*=\s*(\[.*\])\s*;\s*', source, re.DOTALL)
    if not match:
        raise ValueError('Expected the writing vocabulary JSON array')
    characters = [item['c'] for item in json.loads(match.group(1))]
    if len(set(characters)) != len(characters) or any(len(c) != 1 for c in characters):
        raise ValueError('Invalid or duplicate writing character')
    return list(dict.fromkeys(characters + list('辰明')))

def main():
    with urllib.request.urlopen(URL, timeout=90) as response:
        raw = response.read()
    if base64.b64encode(hashlib.sha512(raw).digest()).decode() != INTEGRITY:
        raise RuntimeError('Upstream package integrity mismatch')
    directory = ROOT / 'public/data/strokes'
    directory.mkdir(parents=True, exist_ok=True)
    manifest = {'source': 'hanzi-writer-data', 'version': '2.0.1', 'url': URL, 'license': 'Arphic Public License', 'characters': {}}
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
        for character in selected_characters():
            source = archive.extractfile('package/' + character + '.json')
            if source is None:
                raise RuntimeError('Missing character: ' + character)
            content = source.read()
            data = json.loads(content)
            if len(data['strokes']) != len(data['medians']) or not 1 <= len(data['strokes']) <= 20:
                raise RuntimeError('Invalid stroke geometry: ' + character)
            name = format(ord(character), 'x') + '.json'
            (directory / name).write_bytes(content)
            manifest['characters'][character] = {'src': '/data/strokes/' + name, 'strokeCount': len(data['strokes']), 'sha256': hashlib.sha256(content).hexdigest()}
        for license_name in ['ARPHICPL.TXT', 'APL']:
            try:
                source = archive.extractfile('package/' + license_name)
                if source is not None:
                    (directory / license_name).write_bytes(source.read())
            except KeyError:
                pass
    if not (directory / 'ARPHICPL.TXT').exists():
        raise RuntimeError('Required font-data license missing')
    (ROOT / 'public/data/writing-strokes.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(f'Saved {len(manifest["characters"])} local characters, with original stroke paths and medians.')
    print('Stroke counts:', ' '.join(c + ':' + str(e['strokeCount']) for c, e in manifest['characters'].items()))

if __name__ == '__main__':
    main()
