#!/usr/bin/env python3
"""Bundle the single-character examples in public/pinyin-data.js.

Matching character readings are copied from the checked-in writing audio;
remaining readings use edge-tts==7.2.8 with mutagen==1.47.0 for validation.
--dry-run prints the full source recipe; --check verifies everything offline.
The application only plays the bundled files and makes no synthesis requests.
"""

import argparse
import asyncio
import hashlib
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
CURRICULUM = PUBLIC / "pinyin-data.js"
WRITING_MANIFEST = PUBLIC / "data/writing-vocabulary-audio.json"
MANIFEST = PUBLIC / "data/pinyin-examples-audio.json"
OUTPUT = PUBLIC / "audio/pinyin/examples"
VERSION = 1
VOICE = "zh-CN-XiaoxiaoNeural"
RATE = "-8%"


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def all_clips():
    # Accept only this data file's JSON-like literals, never execute JavaScript.
    source = re.sub(r"^\s*//[^\n]*", "", CURRICULUM.read_text(encoding="utf-8"), flags=re.MULTILINE)
    match = re.fullmatch(r"\s*window\.ChenchenPinyinData\s*=\s*(\{.*\})\s*;\s*", source, re.DOTALL)
    if not match:
        raise ValueError("Expected window.ChenchenPinyinData = {data};")
    payload = re.sub(r"([{,]\s*)(initials|finals|id|examples|c|pinyin)\s*:", r'\1"\2":', match.group(1))
    payload = re.sub(r",\s*([}\]])", r"\1", payload)
    data = json.loads(payload)
    if set(data) != {"initials", "finals"} or len(data["initials"]) != 23 or len(data["finals"]) != 24:
        raise ValueError("Expected the 23 initial and 24 final collection")
    clips = {}
    for row in data["initials"] + data["finals"]:
        examples = row.get("examples", [])
        if len(examples) != 3 or len({item.get("c") for item in examples}) != 3:
            raise ValueError(f"Expected three distinct characters for {row.get('id')}")
        for item in examples:
            text, pinyin = item.get("c"), item.get("pinyin")
            if not isinstance(text, str) or len(text) != 1 or not isinstance(pinyin, str) or not pinyin.strip():
                raise ValueError(f"Invalid character example: {item}")
            clip = {"id": f"char-{ord(text):x}", "text": text, "pinyin": pinyin,
                    "kind": "character", "language": "zh-CN"}
            previous = clips.get(clip["id"])
            if previous and previous != clip:
                raise ValueError(f"Conflicting readings for {text}")
            clips[clip["id"]] = clip
    return list(clips.values())


def source(clip, writing):
    reusable = writing.get(clip["id"])
    if (reusable and reusable.get("text") == clip["text"]
            and reusable.get("pinyin") == clip["pinyin"]
            and reusable.get("synthesisText") == clip["text"] + "。"):
        origin = {"type": "reuse", "manifest": "/data/writing-vocabulary-audio.json",
                  "id": clip["id"], "src": reusable["src"], "sha256": reusable["sha256"],
                  "sourceHash": reusable["sourceHash"]}
        value = {"version": VERSION, "clip": clip, "origin": origin,
                 **{key: reusable[key] for key in ["voice", "rate", "synthesisText", "provider"]}}
    else:
        value = {"version": VERSION, "clip": clip, "voice": VOICE, "rate": RATE,
                 "synthesisText": clip["text"] + "。", "provider": "Microsoft Edge Read Aloud",
                 "origin": {"type": "synthesis", "generator": "scripts/generate-pinyin-examples-audio.py",
                            "dependencies": {"edge-tts": "7.2.8", "mutagen": "1.47.0"}}}
    return value, digest(value)


def inspect_audio(path):
    from mutagen.mp3 import MP3
    info = MP3(path).info
    if path.stat().st_size < 1000 or not 0.25 <= info.length <= 12:
        raise ValueError(f"Incomplete or implausible recording: {path.name}")
    return {"durationSeconds": round(info.length, 3), "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "sampleRate": info.sample_rate, "bitrate": info.bitrate}


def expected(clip, writing):
    value, source_hash = source(clip, writing)
    return {"src": f"/audio/pinyin/examples/{clip['id']}.mp3",
            **{key: val for key, val in clip.items() if key != "id"},
            **{key: value[key] for key in ["voice", "rate", "synthesisText", "provider", "origin"]},
            "synthetic": True, "sourceHash": source_hash, "sourceVersion": VERSION}


def verify(clip, manifest, writing):
    entry = manifest.get(clip["id"])
    if not entry:
        raise ValueError(f"Missing recording: {clip['id']}")
    for key, value in expected(clip, writing).items():
        if entry.get(key) != value:
            raise ValueError(f"Recording needs regeneration: {clip['id']} ({key})")
    details = inspect_audio(OUTPUT / f"{clip['id']}.mp3")
    for key, value in details.items():
        if entry.get(key) != value:
            raise ValueError(f"Audio metadata mismatch: {clip['id']} ({key})")
    if entry["origin"]["type"] == "reuse":
        original = PUBLIC / entry["origin"]["src"].lstrip("/")
        if inspect_audio(original)["sha256"] != details["sha256"]:
            raise ValueError(f"Copied audio differs from writing source: {clip['id']}")


def save_manifest(manifest):
    temporary = MANIFEST.with_suffix(".json.part")
    temporary.write_text(json.dumps(dict(sorted(manifest.items())), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(MANIFEST)


async def generate(clips, manifest, writing, force, concurrency):
    OUTPUT.mkdir(parents=True, exist_ok=True)
    semaphore = asyncio.Semaphore(concurrency)
    completed = 0

    async def one(clip):
        nonlocal completed
        if not force:
            try:
                verify(clip, manifest, writing)
                completed += 1
                print(f"KEEP {completed}/{len(clips)} {clip['text']}", flush=True)
                return
            except (ValueError, KeyError, OSError):
                pass
        entry = expected(clip, writing)
        target = OUTPUT / f"{clip['id']}.mp3"
        temporary = target.with_suffix(".mp3.part")
        async with semaphore:
            for attempt in range(4):
                try:
                    if entry["origin"]["type"] == "reuse":
                        original = PUBLIC / entry["origin"]["src"].lstrip("/")
                        if inspect_audio(original)["sha256"] != entry["origin"]["sha256"]:
                            raise ValueError(f"Writing source failed hash verification: {clip['text']}")
                        shutil.copyfile(original, temporary)
                    else:
                        import edge_tts
                        speech = edge_tts.Communicate(entry["synthesisText"], entry["voice"], rate=entry["rate"])
                        await asyncio.wait_for(speech.save(str(temporary)), timeout=45)
                    details = inspect_audio(temporary)
                    temporary.replace(target)
                    break
                except Exception as error:
                    temporary.unlink(missing_ok=True)
                    if attempt == 3:
                        raise
                    print(f"RETRY {clip['text']} attempt {attempt + 2}: {type(error).__name__}", flush=True)
                    await asyncio.sleep(2 * (attempt + 1))
            manifest[clip["id"]] = {**entry, **details}
            save_manifest(manifest)
            completed += 1
            print(f"SAVE {completed}/{len(clips)} {clip['text']} ({entry['origin']['type']}, {details['durationSeconds']}s)", flush=True)

    await asyncio.gather(*(one(clip) for clip in clips))
    save_manifest(manifest)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--id", action="append", help="Clip ID to generate/check (repeatable)")
    parser.add_argument("--force", action="store_true", help="Recreate existing files")
    parser.add_argument("--check", action="store_true", help="Verify existing recordings offline")
    parser.add_argument("--dry-run", action="store_true", help="Print source recipes without writing files or using the network")
    parser.add_argument("--concurrency", type=int, default=4, choices=range(1, 9))
    args = parser.parse_args()
    clips = all_clips()
    if args.id:
        unknown = set(args.id) - {clip["id"] for clip in clips}
        if unknown:
            parser.error("Unknown clip IDs: " + ", ".join(sorted(unknown)))
        clips = [clip for clip in clips if clip["id"] in args.id]
    writing = json.loads(WRITING_MANIFEST.read_text(encoding="utf-8"))
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {}
    if args.dry_run:
        for clip in clips:
            value, source_hash = source(clip, writing)
            print(json.dumps({"id": clip["id"], **value, "sourceHash": source_hash}, ensure_ascii=False))
    elif args.check:
        if not args.id and set(manifest) != {clip["id"] for clip in clips}:
            raise ValueError("Manifest IDs do not match the complete pinyin example collection")
        for clip in clips:
            verify(clip, manifest, writing)
        print(f"PASS: {len(clips)} character recordings match pinyin, source recipes, metadata, and MP3 hashes")
    else:
        if not args.id:
            ids = {clip["id"] for clip in clips}
            manifest = {key: value for key, value in manifest.items() if key in ids}
        asyncio.run(generate(clips, manifest, writing, args.force, args.concurrency))
        if not args.id:
            # Remove recordings for examples replaced in the curriculum only
            # after every replacement has been generated successfully.
            for recording in OUTPUT.glob("char-*.mp3"):
                if recording.stem not in ids:
                    recording.unlink()


if __name__ == "__main__":
    main()
