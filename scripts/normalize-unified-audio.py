#!/usr/bin/env python3
"""Remaster existing speech without invoking TTS. Stage first; never overwrite inputs."""
import argparse
import concurrent.futures
import hashlib
import importlib.util
import json
import subprocess
from pathlib import Path
from audio_loudness import measure, acceptable, encode_verified

spec = importlib.util.spec_from_file_location('generator', Path(__file__).with_name('generate-unified-audio.py'))
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-root', type=Path, required=True)
    args = parser.parse_args()
    output = args.output_root.resolve()
    if output == g.PUBLIC or g.PUBLIC in output.parents:
        parser.error('Output must be outside public/')
    jobs = g.jobs()
    originals = {name: json.loads((g.PUBLIC/'data'/f'{name}-audio.json').read_text()) for name in g.COLLECTIONS}
    unique = {}
    for job in jobs:
        old = originals[job['collection']][job['id']]
        source = g.PUBLIC / job['target']
        assert hashlib.sha256(source.read_bytes()).hexdigest() == old['sha256'], job['id']
        previous = {k:v for k,v in old['synthesis'].items() if k != 'normalization'}
        current = {k:v for k,v in job['entry']['synthesis'].items() if k != 'normalization'}
        assert previous == current and old['synthesisText'] == job['entry']['synthesisText'], job['id']
        job['original'] = old
        unique.setdefault(old['sha256'], job)
    cache = output / '.processing'
    cache.mkdir(parents=True, exist_ok=True)
    def process(item):
        sha, job = item
        source = g.PUBLIC/job['target']
        target = cache/f'{sha}.mp3'
        before = measure(source)
        changed = not acceptable(before)
        if changed:
            after = encode_verified(source, target)
        else:
            target.write_bytes(source.read_bytes())
            after = before
        details = g.module(job['collection']).inspect_audio(target)
        if changed:
            def decoded_size(path):
                return len(subprocess.run(['ffmpeg','-v','error','-i',str(path),'-f','f32le','-ac','1','-ar','24000','-'], capture_output=True, check=True).stdout)
            assert 0 <= decoded_size(target)-decoded_size(source) <= 1152 * 4, job['id']
        return sha, {'file': target, 'details': {**details, 'loudness': after},
                     'audit': {'src': job['entry']['src'], 'changed': changed, 'before': before, 'after': after}}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results = dict(pool.map(process, unique.items()))
    manifests = {name:{} for name in g.COLLECTIONS}
    for job in jobs:
        result = results[job['original']['sha256']]
        target = output/job['target']; target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(result['file'].read_bytes())
        manifests[job['collection']][job['id']] = {**job['entry'], **result['details']}
    for key, entry in manifests['pinyin-examples'].items():
        origin = dict(originals['pinyin-examples'][key]['origin'])
        if origin['type'] == 'reuse':
            original = manifests['writing-vocabulary'][origin['id']]
            origin.update({k:original[k] for k in ('src','sha256','sourceHash')})
        entry['origin'] = origin
    for name, manifest in manifests.items():
        g.save_json(output/'data'/f'{name}-audio.json', manifest)
    report = [x['audit'] for x in results.values()]
    g.save_json(output.parent/'loudness-report.json', report)
    print(f"PASS: {len(jobs)} files, {len(results)} unique recordings, {sum(x['changed'] for x in report)} adjusted", flush=True)


if __name__ == '__main__':
    main()
