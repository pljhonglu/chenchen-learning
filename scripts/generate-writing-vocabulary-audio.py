#!/usr/bin/env python3
"""Generate bundled character/word MP3s from public/writing-vocabulary.js.

Build-only dependencies: edge-tts==7.2.8 mutagen==1.47.0.
--dry-run lists input without network; --check verifies existing audio offline.
The published app plays the generated files without a speech service.
"""

import argparse
import asyncio
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CURRICULUM = ROOT / "public/writing-vocabulary.js"
MANIFEST = ROOT / "public/data/writing-vocabulary-audio.json"
OUTPUT = ROOT / "public/audio/writing-vocabulary"
VERSION = 1
VOICE = "zh-CN-XiaoxiaoNeural"
RATE = "-8%"


def recording_id(kind, text):
    return kind + "-" + "-".join(f"{ord(character):x}" for character in text)


def all_clips():
    # Parse the JSON payload without evaluating executable JavaScript.
    match = re.fullmatch(r"\s*window\.ChenchenWritingVocabulary\s*=\s*(\[.*\])\s*;\s*",
                         CURRICULUM.read_text(encoding="utf-8"), re.DOTALL)
    if not match:
        raise ValueError("Expected window.ChenchenWritingVocabulary = [JSON array];")
    data = json.loads(match.group(1))
    characters = set()
    clips = {}
    for item in data:
        character = item.get("c")
        if not isinstance(character, str) or len(character) != 1 or character in characters:
            raise ValueError(f"Invalid or duplicate character: {character}")
        characters.add(character)
        pinyin = item.get("pinyin")
        if not isinstance(pinyin, str) or not pinyin.strip():
            raise ValueError(f"Missing character pinyin: {character}")
        clip = {"id": recording_id("char", character), "text": character,
                "pinyin": pinyin, "language": "zh-CN", "kind": "character"}
        if item.get("characterSpeech"):
            if not isinstance(item["characterSpeech"], str):
                raise ValueError(f"Invalid characterSpeech: {character}")
            clip["characterSpeech"] = item["characterSpeech"]
        clips[clip["id"]] = clip
        words = item.get("words")
        if not isinstance(words, list) or len(words) != 3:
            raise ValueError(f"Expected three words for: {character}")
        for word in words:
            text, pinyin = word.get("text"), word.get("pinyin")
            if not isinstance(text, str) or not text or not isinstance(pinyin, str) or not pinyin.strip():
                raise ValueError(f"Invalid word for: {character}")
            clip = {"id": recording_id("word", text), "text": text,
                    "pinyin": pinyin, "language": "zh-CN", "kind": "word"}
            previous = clips.get(clip["id"])
            if previous and previous != clip:
                raise ValueError(f"Conflicting pronunciation for shared word: {text}")
            clips[clip["id"]] = clip
    if not clips:
        raise ValueError("Empty writing vocabulary")
    return list(clips.values())


def source(clip):
    speech = clip.get("characterSpeech", clip["text"])
    text = speech if speech.endswith(("。", "！", "？", ".", "!", "?")) else speech + "。"
    value = {"version": VERSION, "voice": VOICE, "rate": RATE,
             "text": text, "clip": clip}
    digest = hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    return value, digest


def inspect_audio(path):
    from mutagen.mp3 import MP3
    info = MP3(path).info
    if path.stat().st_size < 1000 or not 0.25 <= info.length <= 20:
        raise ValueError(f"Incomplete or implausible recording: {path.name}")
    return {"durationSeconds": round(info.length, 3), "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "sampleRate": info.sample_rate, "bitrate": info.bitrate}


def verify(clip, manifest):
    entry = manifest.get(clip["id"])
    if not entry:
        raise ValueError(f"Missing recording: {clip['id']}")
    value, digest = source(clip)
    expected = {"src": f"/audio/writing-vocabulary/{clip['id']}.mp3",
                **{key: val for key, val in clip.items() if key != "id"},
                "sourceHash": digest, "voice": value["voice"], "rate": value["rate"],
                "synthesisText": value["text"]}
    for key, expected_value in expected.items():
        if entry.get(key) != expected_value:
            raise ValueError(f"Recording needs regeneration: {clip['id']} ({key})")
    for key, actual_value in inspect_audio(OUTPUT / f"{clip['id']}.mp3").items():
        if entry.get(key) != actual_value:
            raise ValueError(f"Recording verification failed: {clip['id']} ({key})")


def save_manifest(manifest):
    temporary = MANIFEST.with_suffix(".json.part")
    temporary.write_text(json.dumps(dict(sorted(manifest.items())), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(MANIFEST)


async def generate(clips, manifest, force, concurrency):
    import edge_tts
    OUTPUT.mkdir(parents=True, exist_ok=True)
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    semaphore = asyncio.Semaphore(concurrency)
    completed = 0

    async def one(clip):
        nonlocal completed
        if not force:
            try:
                verify(clip, manifest)
                completed += 1
                print(f"KEEP {completed}/{len(clips)} {clip['id']} {clip['text']}", flush=True)
                return
            except (ValueError, KeyError, OSError):
                pass
        value, digest = source(clip)
        target = OUTPUT / f"{clip['id']}.mp3"
        temporary = target.with_suffix(".mp3.part")
        async with semaphore:
            for attempt in range(4):
                try:
                    speech = edge_tts.Communicate(value["text"], value["voice"], rate=value["rate"])
                    await asyncio.wait_for(speech.save(str(temporary)), timeout=45)
                    details = inspect_audio(temporary)
                    temporary.replace(target)
                    break
                except Exception as error:
                    temporary.unlink(missing_ok=True)
                    if attempt == 3:
                        raise
                    print(f"RETRY {clip['id']} attempt {attempt + 2}: {type(error).__name__}", flush=True)
                    await asyncio.sleep(2 * (attempt + 1))
            manifest[clip["id"]] = {
                "src": f"/audio/writing-vocabulary/{clip['id']}.mp3",
                **{key: val for key, val in clip.items() if key != "id"},
                "label": "自然语音（AI 合成）", "synthetic": True,
                "provider": "Microsoft Edge Read Aloud", "voice": value["voice"],
                "rate": value["rate"], "sourceHash": digest,
                "synthesisText": value["text"], **details,
            }
            save_manifest(manifest)
            completed += 1
            print(f"SAVE {completed}/{len(clips)} {clip['id']} {clip['text']} {details['durationSeconds']}s", flush=True)

    await asyncio.gather(*(one(clip) for clip in clips))
    # Also persist pruning when all remaining recordings were already valid.
    save_manifest(manifest)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--id", action="append", help="Clip ID to generate/check (repeatable)")
    parser.add_argument("--force", action="store_true", help="Regenerate unchanged recordings")
    parser.add_argument("--check", action="store_true", help="Verify recordings offline")
    parser.add_argument("--dry-run", action="store_true", help="Show synthesis input without network")
    parser.add_argument("--concurrency", type=int, default=4, choices=range(1, 9))
    args = parser.parse_args()
    clips = all_clips()
    if args.id:
        unknown = set(args.id) - {clip["id"] for clip in clips}
        if unknown:
            parser.error("Unknown clip IDs: " + ", ".join(sorted(unknown)))
        clips = [clip for clip in clips if clip["id"] in args.id]
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {}
    if args.dry_run:
        for clip in clips:
            value, digest = source(clip)
            print(json.dumps({"id": clip["id"], **value, "sourceHash": digest}, ensure_ascii=False))
    elif args.check:
        if not args.id and set(manifest) != {clip["id"] for clip in clips}:
            raise ValueError("Manifest IDs do not match the full character/word vocabulary")
        for clip in clips:
            verify(clip, manifest)
        print(f"PASS: {len(clips)} recordings match vocabulary, pinyin, voice, and audio hashes")
    else:
        if not args.id:
            ids = {clip["id"] for clip in clips}
            manifest = {key: value for key, value in manifest.items() if key in ids}
        asyncio.run(generate(clips, manifest, args.force, args.concurrency))


if __name__ == "__main__":
    main()
