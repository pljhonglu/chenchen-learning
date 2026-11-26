#!/usr/bin/env python3
"""Stage all spoken lessons with one local Qwen3-TTS female speaker.

See docs/unified-audio.md. Completed, hashed clips survive interruptions.
No model or inference dependency is deployed to the NAS.
"""
import argparse
import hashlib
import importlib.util
import json
import re
import shutil
import subprocess
import time
from functools import lru_cache
from pathlib import Path

from audio_loudness import measure, acceptable, encode_verified
from unified_voice import PROVIDER, VOICE, REFERENCE_AUDIO, REFERENCE_TEXT, REFERENCE_SHA256, MODEL_SHA256, fields, digest, recipe

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
COLLECTIONS = ("english", "writing-vocabulary", "writing", "pinyin-examples", "poem")


@lru_cache(None)
def module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), ROOT / f"scripts/generate-{name}-audio.py")
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def jobs(collections=COLLECTIONS):
    result = []
    for name in collections:
        source = module(name)
        clips = json.loads(source.POEMS.read_text()) if name == "poem" else source.all_clips()
        for clip in clips:
            if name == "poem":
                text, corrections, _ = source.build_input(clip)
                language, style = "zh-CN", "poem"
                metadata = {"pronunciationCorrections": corrections}
            else:
                text = clip["text"] + "。" if name == "pinyin-examples" else source.source(clip)[0]["text"]
                language, style = clip["language"], "guide" if clip["kind"] == "guide" else "word"
                metadata = {key: value for key, value in clip.items() if key != "id"}
            target = (source.OUTPUT / f"{clip['id']}.mp3").relative_to(PUBLIC)
            value = recipe(clip, text, language, style)
            # Identical readings share bytes across features without changing their IDs.
            speech_key = digest({"text": value["text"], "synthesis": value["synthesis"]})
            entry = {"src": "/" + target.as_posix(), **metadata, **fields(clip, text, language, style)}
            result.append({"collection": name, "id": clip["id"], "clip": clip, "text": text,
                           "language": language, "style": style, "target": target,
                           "entry": entry, "speechKey": speech_key})
    return result


def audio_details(job, path):
    details = module(job["collection"]).inspect_audio(path)
    if job["style"] == "word":
        characters = len(re.findall(r"[\u4e00-\u9fff]", job["text"]))
        limit = max(3.0, characters * .9 + 1) if characters else 4.0
        if details["durationSeconds"] > limit:
            raise ValueError(f"Implausibly long word recording: {job['id']}")
    loudness = measure(path)
    if not acceptable(loudness):
        raise ValueError(f"Loudness outside acceptance limits: {job['id']}: {loudness}")
    return {**details, "loudness": loudness}


def check(public, selected):
    all_jobs = jobs(selected)
    for name in selected:
        manifest = json.loads((public / "data" / f"{name}-audio.json").read_text())
        expected = {job["id"] for job in all_jobs if job["collection"] == name}
        if set(manifest) != expected:
            raise ValueError(f"{name}: manifest does not match curriculum")
        for job in [job for job in all_jobs if job["collection"] == name]:
            entry = manifest[job["id"]]
            for key, value in {**job["entry"], **audio_details(job, public / job["target"])}.items():
                if entry.get(key) != value:
                    raise ValueError(f"{name}/{job['id']}: stale {key}")
            if name == "pinyin-examples":
                verify_origin(entry, public)
        print(f"PASS {name}: {len(expected)} recordings, one female voice, source recipes and MP3 hashes", flush=True)


def verify_origin(entry, public):
    origin = entry.get("origin", {})
    if origin.get("type") == "reuse":
        writing = json.loads((public / "data/writing-vocabulary-audio.json").read_text())
        original = writing[origin["id"]]
        for key in ("src", "sha256", "sourceHash"):
            if origin.get(key) != original[key]:
                raise ValueError(f"Stale writing reuse: {entry['text']} ({key})")
        for key in ("text", "pinyin", "synthesisText", "voice", "sha256"):
            if entry[key] != original[key]:
                raise ValueError(f"Inconsistent writing reuse: {entry['text']} ({key})")
    elif origin != {"type": "synthesis", "generator": "scripts/generate-unified-audio.py",
                    "dependencies": {"mlx-audio": "0.5.8", "mutagen": "1.48.1"}}:
        raise ValueError(f"Missing local model provenance: {entry['text']}")


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)


def trim_target(samples, sample_rate, settings):
    import numpy as np
    frame = int(sample_rate * settings["frameSeconds"])
    energy = np.array([np.sqrt(np.mean(samples[i:i + frame] ** 2)) for i in range(0, len(samples), frame)])
    active = energy > max(settings["absoluteThreshold"], float(energy.max()) * settings["relativeThreshold"])
    gaps, start = [], None
    for index, on in enumerate(active):
        if not on and start is None:
            start = index
        if on and start is not None:
            if (index - start) * settings["frameSeconds"] >= settings["minSilenceSeconds"] and start > 10 and index < len(active) - 25:
                gaps.append((start, index))
            start = None
    if not gaps:
        raise ValueError("No clear pause before the target word")
    begin = max(0, (gaps[-1][1] - round(settings["leadingSeconds"] / settings["frameSeconds"])) * frame)
    end = min(len(samples), np.flatnonzero(active)[-1] * frame + int(settings["trailingSeconds"] * sample_rate))
    if end - begin < .25 * sample_rate:
        raise ValueError("Cropped target is incomplete")
    return samples[begin:end]


def generate(args):
    import numpy as np
    import mlx.core as mx
    from mlx_audio.audio_io import write
    from mlx_audio.tts.utils import load_model

    if hashlib.sha256(REFERENCE_AUDIO.read_bytes()).hexdigest() != REFERENCE_SHA256:
        raise ValueError("Reference audio hash mismatch")
    selected = jobs(args.collections)
    unique = {job["speechKey"]: job for job in selected}
    requested = set(args.regenerate_id or [])
    known = {f"{job['collection']}/{job['id']}" for job in selected}
    if requested - known:
        raise ValueError(f"Unknown recording IDs: {sorted(requested - known)}")
    forced = {job["speechKey"] for job in selected if f"{job['collection']}/{job['id']}" in requested}
    cache = args.cache_dir
    cache.mkdir(parents=True, exist_ok=True)
    pending = []
    for key, job in unique.items():
        try:
            if key in forced:
                raise ValueError("Requested regeneration")
            stored = json.loads((cache / f"{key}.json").read_text())
            if stored != audio_details(job, cache / f"{key}.mp3"):
                raise ValueError("Cache hash mismatch")
        except (OSError, ValueError):
            pending.append(job)
    print(f"{len(selected)} lesson files; {len(unique)} unique readings; {len(pending)} to generate", flush=True)
    if pending:
        with (args.model_dir / "model.safetensors").open("rb") as weights:
            if hashlib.file_digest(weights, "sha256").hexdigest() != MODEL_SHA256:
                raise ValueError("Pinned Base model hash mismatch")
        model = load_model(str(args.model_dir))
        # Group equal languages and similar lengths to limit padded generation work.
        pending.sort(key=lambda job: (job["language"], job["style"], len(job["text"]), job["speechKey"]))
        done, started = 0, time.monotonic()
        retries = {}

        def retry(job, reason):
            key = job["speechKey"]
            retries[key] = retries.get(key, 0) + 1
            if retries[key] > 3:
                raise ValueError(f"Repeated {reason}: {job['id']}")
            pending.append(job)
            print(f"RETRY {job['id']}: {reason}; attempt {retries[key] + 1}", flush=True)

        while pending:
            first = pending[0]
            batch = []
            while pending and len(batch) < args.batch_size and (pending[0]["language"], pending[0]["style"]) == (first["language"], first["style"]):
                if batch and (first["entry"]["synthesis"].get("trim") or pending[0]["entry"]["synthesis"].get("trim")):
                    break
                batch.append(pending.pop(0))
            seed = first["entry"]["synthesis"].get("seed", int(first["speechKey"][:8], 16))
            mx.random.seed(seed)
            max_tokens = first["entry"]["synthesis"]["maxTokens"]
            completed = set()
            for result in model.batch_generate(texts=[job["entry"]["synthesisText"] for job in batch],
                    ref_audio=str(REFERENCE_AUDIO), ref_text=REFERENCE_TEXT,
                    lang_code="english" if first["language"].startswith("en") else "chinese",
                    temperature=0.3, top_k=20, top_p=0.8, repetition_penalty=1.05,
                    max_tokens=max_tokens, verbose=False):
                job = batch[result.sequence_idx]
                samples = np.asarray(result.audio)
                failure = ("token limit" if result.token_count >= max_tokens else
                           "invalid audio" if samples.size < 6000 or not np.isfinite(samples).all() or np.max(np.abs(samples)) < .01 else None)
                if failure:
                    retry(job, failure)
                    completed.add(result.sequence_idx)
                    continue
                if job["entry"]["synthesis"].get("trim"):
                    try:
                        samples = trim_target(samples, result.sample_rate, job["entry"]["synthesis"]["trim"])
                    except ValueError as error:
                        retry(job, str(error))
                        completed.add(result.sequence_idx)
                        continue
                raw, normalized = cache / "raw.wav", cache / "normalized.wav"
                write(str(raw), samples, result.sample_rate)
                target = cache / f"{job['speechKey']}.mp3"
                temporary = target.with_suffix(".mp3.part")
                encode_verified(raw, temporary)
                try:
                    details = audio_details(job, temporary)
                except ValueError as error:
                    temporary.unlink(missing_ok=True)
                    retry(job, str(error))
                    completed.add(result.sequence_idx)
                    continue
                temporary.replace(target)
                save_json(cache / f"{job['speechKey']}.json", details)
                completed.add(result.sequence_idx)
                done += 1
                print(f"SAVE {done} ({time.monotonic()-started:.0f}s) {job['collection']}/{job['id']} {job['text']!r} {details['durationSeconds']}s", flush=True)
            if completed != set(range(len(batch))):
                raise ValueError("Model did not return all batch recordings")
            mx.clear_cache()
    # Publish only into the requested staging directory, after generation completes.
    manifests = {name: {} for name in args.collections}
    for job in selected:
        target = args.output_root / job["target"]
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(cache / f"{job['speechKey']}.mp3", target)
        manifests[job["collection"]][job["id"]] = {**job["entry"], **audio_details(job, target)}
    if "pinyin-examples" in manifests:
        writing = manifests.get("writing-vocabulary") or json.loads((PUBLIC / "data/writing-vocabulary-audio.json").read_text())
        for key, entry in manifests["pinyin-examples"].items():
            original = writing.get(key)
            if original and all(original.get(field) == entry[field] for field in ("text", "pinyin", "synthesisText", "voice", "sha256")):
                entry["origin"] = {"type": "reuse", "manifest": "/data/writing-vocabulary-audio.json", "id": key,
                                   **{field: original[field] for field in ("src", "sha256", "sourceHash")}}
            else:
                entry["origin"] = {"type": "synthesis", "generator": "scripts/generate-unified-audio.py",
                                   "dependencies": {"mlx-audio": "0.5.8", "mutagen": "1.48.1"}}
    for name, manifest in manifests.items():
        save_json(args.output_root / "data" / f"{name}-audio.json", dict(sorted(manifest.items())))
    check(args.output_root, args.collections)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--collections", nargs="+", choices=COLLECTIONS, default=list(COLLECTIONS))
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--output-root", type=Path, help="Staged public directory; required for generation")
    parser.add_argument("--cache-dir", type=Path, help="Persistent generation cache outside the repository")
    parser.add_argument("--model-dir", type=Path, help="Downloaded, pinned Base model")
    parser.add_argument("--regenerate-id", action="append", help="Regenerate collection/id; repeatable")
    parser.add_argument("--batch-size", type=int, default=1, choices=[1])
    args = parser.parse_args()
    if args.check:
        check(args.output_root or PUBLIC, args.collections)
    else:
        if not all((args.output_root, args.cache_dir, args.model_dir)):
            parser.error("Generation requires --output-root, --cache-dir and --model-dir")
        if args.output_root.resolve() == PUBLIC or PUBLIC in args.output_root.resolve().parents:
            parser.error("Generate to staging, check the recordings, then copy to public")
        generate(args)


if __name__ == "__main__":
    main()
