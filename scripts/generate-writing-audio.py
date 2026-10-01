#!/usr/bin/env python3
"""Build bundled Mandarin stroke-order narration MP3s.

Build-only dependencies: edge-tts==7.2.8 mutagen==1.47.0.
The deployed app only plays same-origin files. Use --dry-run for inputs,
--check for offline verification, or --id to select one or more clip IDs.
Completed recordings are retained after interruptions.
"""

import argparse
import asyncio
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "public/data/writing-audio.json"
OUTPUT = ROOT / "public/audio/writing"
VERSION = 1
VOICE = "zh-CN-XiaoxiaoNeural"
RATE = "-8%"
NUMBERS = ("一", "二", "三", "四", "五", "六", "七", "八", "九", "十",
           "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十")
GUIDES = {
    "guide-start": "我们一笔一笔看。",
    "guide-done": "写好啦，轮到你试一试。",
}


def all_clips():
    clips = [{"id": f"stroke-{number:02d}", "text": f"第{label}画",
              "language": "zh-CN", "kind": "stroke", "strokeNumber": number}
             for number, label in enumerate(NUMBERS, start=1)]
    clips += [{"id": key, "text": value, "language": "zh-CN", "kind": "guide"}
              for key, value in GUIDES.items()]
    return clips


def source(clip):
    # Terminal punctuation gives each standalone stroke announcement a clear end.
    text = clip["text"] + ("。" if clip["kind"] == "stroke" else "")
    value = {"version": VERSION, "voice": VOICE, "rate": RATE,
             "text": text, "clip": clip}
    digest = hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    return value, digest


def inspect_audio(path):
    from mutagen.mp3 import MP3
    info = MP3(path).info
    if path.stat().st_size < 1000 or not 0.25 <= info.length <= 15:
        raise ValueError(f"Incomplete or implausible recording: {path.name}")
    return {"durationSeconds": round(info.length, 3), "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "sampleRate": info.sample_rate, "bitrate": info.bitrate}


def verify(clip, manifest):
    entry = manifest.get(clip["id"])
    if not entry:
        raise ValueError(f"Missing recording: {clip['id']}")
    value, digest = source(clip)
    expected = {"src": f"/audio/writing/{clip['id']}.mp3", "text": clip["text"],
                "language": clip["language"], "kind": clip["kind"],
                "sourceHash": digest, "voice": value["voice"], "rate": value["rate"],
                "synthesisText": value["text"]}
    if "strokeNumber" in clip:
        expected["strokeNumber"] = clip["strokeNumber"]
    for key, expected_value in expected.items():
        if entry.get(key) != expected_value:
            raise ValueError(f"Recording needs regeneration: {clip['id']} ({key})")
    actual = inspect_audio(OUTPUT / f"{clip['id']}.mp3")
    for key, actual_value in actual.items():
        if entry.get(key) != actual_value:
            raise ValueError(f"Recording verification failed: {clip['id']} ({key})")


async def generate(clips, manifest, force, concurrency):
    import edge_tts
    OUTPUT.mkdir(parents=True, exist_ok=True)
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    semaphore = asyncio.Semaphore(concurrency)

    async def one(clip):
        if not force:
            try:
                verify(clip, manifest)
                print(f"KEEP {clip['id']}", flush=True)
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
                except Exception:
                    temporary.unlink(missing_ok=True)
                    if attempt == 3:
                        raise
                    await asyncio.sleep(2 * (attempt + 1))
            manifest[clip["id"]] = {
                "src": f"/audio/writing/{clip['id']}.mp3",
                "text": clip["text"], "language": clip["language"], "kind": clip["kind"],
                **({"strokeNumber": clip["strokeNumber"]} if "strokeNumber" in clip else {}),
                "label": "自然语音（AI 合成）", "synthetic": True,
                "provider": "Microsoft Edge Read Aloud", "voice": value["voice"],
                "rate": value["rate"], "sourceHash": digest,
                "synthesisText": value["text"], **details,
            }
            # Serial writes within the event loop preserve every finished clip.
            manifest_part = MANIFEST.with_suffix(".json.part")
            manifest_part.write_text(json.dumps(dict(sorted(manifest.items())), ensure_ascii=False, indent=2) + "\n")
            manifest_part.replace(MANIFEST)
            print(f"SAVE {clip['id']} {details['durationSeconds']}s", flush=True)

    await asyncio.gather(*(one(clip) for clip in clips))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--id", action="append", help="Clip ID to generate/check (repeatable)")
    parser.add_argument("--force", action="store_true", help="Regenerate unchanged recordings")
    parser.add_argument("--check", action="store_true", help="Verify recordings offline")
    parser.add_argument("--dry-run", action="store_true", help="Show synthesis input without network")
    parser.add_argument("--concurrency", type=int, default=3, choices=range(1, 9))
    args = parser.parse_args()
    clips = all_clips()
    if args.id:
        unknown = set(args.id) - {clip["id"] for clip in clips}
        if unknown:
            parser.error("Unknown clip IDs: " + ", ".join(sorted(unknown)))
        clips = [clip for clip in clips if clip["id"] in args.id]
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    if args.dry_run:
        for clip in clips:
            value, digest = source(clip)
            print(json.dumps({"id": clip["id"], **value, "sourceHash": digest}, ensure_ascii=False))
    elif args.check:
        for clip in clips:
            verify(clip, manifest)
        print(f"PASS: {len(clips)} recordings match narration, voice, and audio hashes")
    else:
        asyncio.run(generate(clips, manifest, args.force, args.concurrency))


if __name__ == "__main__":
    main()
