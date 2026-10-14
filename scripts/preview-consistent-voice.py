#!/usr/bin/env python3
"""Generate a small fixed-reference audition without touching published audio.

Requires the local mlx-audio environment. A reference and its exact transcript
must be supplied; use an authorized recording or a synthetic voice reference.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

SAMPLES = {
    'chinese': ['王。', '太。', '小船。', '苹果。', '毛荔枝。', '太阳。'],
    'english': ['Apple.', 'Rambutan.', 'Durian.', 'Cherry.', 'Mouth.', 'Ball.'],
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model-dir', type=Path, required=True)
    parser.add_argument('--reference-audio', type=Path, required=True)
    parser.add_argument('--reference-text', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    public = Path(__file__).resolve().parents[1] / 'public'
    output = args.output_dir.resolve()
    if output == public or public in output.parents:
        parser.error('Auditions must be staged outside public/')
    transcript = args.reference_text.read_text().strip()
    if not transcript or not args.reference_audio.is_file():
        parser.error('A reference audio file and non-empty transcript are required')
    import mlx.core as mx
    import numpy as np
    from mlx_audio.audio_io import write
    from mlx_audio.tts.utils import load_model
    output.mkdir(parents=True, exist_ok=True)
    model = load_model(str(args.model_dir))
    spec = importlib.util.spec_from_file_location("unified_generator", Path(__file__).with_name("generate-unified-audio.py"))
    generator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(generator)
    from unified_voice import TRIM
    pieces, manifest = [], []
    for language, texts in SAMPLES.items():
        for index, text in enumerate(texts):
            synthesis_text = "Open your mouth. Mouth." if text == "Mouth." else text
            mx.random.seed(20261014)
            for result in model.batch_generate(
                texts=[synthesis_text], ref_audio=str(args.reference_audio), ref_text=transcript,
                lang_code=language, temperature=.3, top_k=20, top_p=.8,
                repetition_penalty=1.05, max_tokens=256,
            ):
                audio = np.asarray(result.audio)
                if result.token_count >= 256 or not np.isfinite(audio).all() or audio.size < 2400:
                    raise ValueError(f'Invalid or incomplete sample: {text}')
                if synthesis_text != text:
                    audio = generator.trim_target(audio, result.sample_rate, TRIM)
                filename = f'{language}-{index}.wav'
                write(str(output / filename), audio, result.sample_rate)
                pieces.extend([audio, np.zeros(round(.6 * result.sample_rate), dtype=np.float32)])
                row = {'text': text, 'synthesisText': synthesis_text, 'language': language, 'file': filename,
                       'duration': len(audio) / result.sample_rate}
                manifest.append(row)
                print(json.dumps(row, ensure_ascii=False), flush=True)
    write(str(output / 'fixed-reference-preview.wav'), np.concatenate(pieces), model.sample_rate)
    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    (output / 'recipe.json').write_text(json.dumps({
        'modelDirectory': str(args.model_dir), 'referenceText': transcript,
        'referenceSha256': hashlib.sha256(args.reference_audio.read_bytes()).hexdigest(),
        'seed': 20261014, 'temperature': .3, 'topK': 20, 'topP': .8,
        'batchSize': 1, 'purpose': 'Audition only; subjective consistency needs listening',
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
