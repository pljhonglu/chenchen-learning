#!/usr/bin/env python3
"""Build the checked-in Mandarin audio library; the deployed app needs no TTS API.

Install build-only dependencies with:
  python3 -m pip install edge-tts==7.2.8 mutagen==1.47.0
Run with --dry-run to inspect the exact synthesis inputs, or --check to verify
the existing MP3s and their source hashes without contacting the voice service.
"""

import argparse
import asyncio
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
POEMS = ROOT / "public/data/poems.json"
MANIFEST = ROOT / "public/data/poem-audio.json"
OUTPUT = ROOT / "public/audio/poems"
VOICE = "zh-CN-XiaoxiaoNeural"
RATE = "-22%"
VERSION = 1

# The Edge Read Aloud service does not support custom SSML/phoneme tags. These
# same-sound characters disambiguate synthesis input ONLY. Original text and
# pinyin stay in poems.json; corrections are recorded alongside every recording.
# Apply by BOTH character and intended pronunciation, never by character alone.
PRONUNCIATIONS = {
    ("朝", "zhāo"): "招", ("还", "huán"): "环", ("重", "chóng"): "虫",
    ("行", "háng"): "航", ("查", "zhā"): "渣", ("见", "xiàn"): "现",
    ("挑", "tiǎo"): "窕", ("长", "zhǎng"): "掌", ("泊", "bó"): "博",
    ("笼", "lǒng"): "拢", ("纶", "lún"): "轮", ("冠", "guān"): "关",
    ("露", "lù"): "路", ("种", "zhòng"): "众", ("曲", "qū"): "屈",
    ("乐", "yuè"): "月", ("为", "wèi"): "未", ("应", "yìng"): "映",
    ("和", "hé"): "河", ("磨", "mó"): "摩", ("蒙", "méng"): "萌",
}


def build_input(poem):
    corrections = []

    def correct(text, pinyin, location):
        # Titles may contain a subtitle for which titlePy has no annotation.
        rendered = []
        for index, char in enumerate(text):
            py = pinyin[index] if index < len(pinyin) else ""
            replacement = PRONUNCIATIONS.get((char, py), char)
            rendered.append(replacement)
            if replacement != char:
                corrections.append({"location": location, "index": index,
                                    "character": char, "pinyin": py,
                                    "spokenAs": replacement})
        return "".join(rendered)

    segments = [correct(poem["title"], poem.get("titlePy", []), "title"),
                correct(poem.get("dynasty", ""), poem.get("dynastyPy", []), "dynasty")
                + "，" + correct(poem.get("author", ""), poem.get("authorPy", []), "author")]
    for index, line in enumerate(poem["lines"]):
        assert line["text"] == "".join(x["c"] for x in line["chars"]), poem["id"]
        segments.append(correct(line["text"], [x["p"] for x in line["chars"]], f"line-{index + 1}"))
    # Full stops leave a clear breath between short lines for young listeners.
    text = "。\n".join(segments) + "。"
    source = {"version": VERSION, "voice": VOICE, "rate": RATE, "text": text,
              "poem": {k: poem[k] for k in ("id", "title", "titlePy", "dynasty", "dynastyPy", "author", "authorPy", "lines")}}
    digest = hashlib.sha256(json.dumps(source, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    return text, corrections, digest


def inspect_audio(path):
    from mutagen.mp3 import MP3
    info = MP3(path).info
    if path.stat().st_size < 4000 or not 3 <= info.length <= 100:
        raise ValueError(f"Incomplete or implausible recording: {path.name}")
    return {"durationSeconds": round(info.length, 3), "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "sampleRate": info.sample_rate, "bitrate": info.bitrate}


def verify(poem, manifest):
    entry = manifest.get(poem["id"])
    if not entry:
        raise ValueError(f"Missing manifest entry: {poem['id']}")
    expected_source = build_input(poem)[2]
    if entry["sourceHash"] != expected_source:
        raise ValueError(f"Recording needs regeneration after text/pinyin change: {poem['id']}")
    path = OUTPUT / f"{poem['id']}.mp3"
    actual = inspect_audio(path)
    for key in ("sha256", "bytes", "durationSeconds"):
        if entry[key] != actual[key]:
            raise ValueError(f"Recording verification failed: {poem['id']} ({key})")


async def generate(poems, manifest, force):
    import edge_tts
    OUTPUT.mkdir(parents=True, exist_ok=True)
    semaphore = asyncio.Semaphore(2)

    async def one(poem):
        if not force:
            try:
                verify(poem, manifest)
                print(f"KEEP {poem['id']} {poem['title']}", flush=True)
                return
            except (ValueError, KeyError, OSError):
                pass
        text, corrections, source_hash = build_input(poem)
        target = OUTPUT / f"{poem['id']}.mp3"
        temporary = target.with_suffix(".mp3.part")
        async with semaphore:
            for attempt in range(3):
                try:
                    speech = edge_tts.Communicate(text, VOICE, rate=RATE)
                    await asyncio.wait_for(speech.save(str(temporary)), timeout=45)
                    details = inspect_audio(temporary)
                    temporary.replace(target)
                    break
                except Exception:
                    temporary.unlink(missing_ok=True)
                    if attempt == 2:
                        raise
                    await asyncio.sleep(2 * (attempt + 1))
        manifest[poem["id"]] = {
            "src": f"/audio/poems/{poem['id']}.mp3",
            "label": "自然语音（AI 合成）", "synthetic": True,
            "provider": "Microsoft Edge Read Aloud", "voice": VOICE, "rate": RATE,
            "sourceHash": source_hash, "synthesisText": text,
            "pronunciationCorrections": corrections, **details,
        }
        # Preserve every completed recording if a later request fails.
        MANIFEST.write_text(json.dumps(dict(sorted(manifest.items())), ensure_ascii=False, indent=2) + "\n")
        print(f"SAVE {poem['id']} {poem['title']} {details['durationSeconds']}s", flush=True)

    await asyncio.gather(*(one(poem) for poem in poems))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--id", action="append", help="Regenerate/check only this poem ID (repeatable)")
    parser.add_argument("--force", action="store_true", help="Regenerate even unchanged recordings")
    parser.add_argument("--check", action="store_true", help="Verify every selected recording without network")
    parser.add_argument("--dry-run", action="store_true", help="Print synthesis inputs without network")
    args = parser.parse_args()
    poems = json.loads(POEMS.read_text())
    if args.id:
        unknown = set(args.id) - {p["id"] for p in poems}
        if unknown:
            parser.error("Unknown poem IDs: " + ", ".join(sorted(unknown)))
        poems = [p for p in poems if p["id"] in args.id]
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    if args.dry_run:
        for poem in poems:
            text, corrections, digest = build_input(poem)
            print(json.dumps({"id": poem["id"], "text": text, "corrections": corrections, "sourceHash": digest}, ensure_ascii=False))
    elif args.check:
        for poem in poems:
            verify(poem, manifest)
        print(f"PASS: {len(poems)} recordings match their poem text, pinyin, and audio hashes")
    else:
        asyncio.run(generate(poems, manifest, args.force))


if __name__ == "__main__":
    main()
