#!/usr/bin/env python3
"""Build bundled English words, Mandarin meanings and instruction MP3s.

Build-only dependencies: edge-tts==7.2.8 mutagen==1.47.0.
The deployed app plays same-origin files and needs no speech service or voice.
Use --dry-run for inputs, --check for offline verification, or --id to select
one or more clip IDs. Completed recordings are retained after interruptions.
"""

import argparse
import asyncio
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CURRICULUM = ROOT / "public/data/english.json"
MANIFEST = ROOT / "public/data/english-audio.json"
OUTPUT = ROOT / "public/audio/english"
VERSION = 1
VOICES = {"en-GB": "en-GB-SoniaNeural", "zh-CN": "zh-CN-XiaoxiaoNeural"}
RATES = {"en-GB": "-12%", "zh-CN": "-8%"}
PROVIDERS = {
    "edge": {"provider": "Microsoft Edge Read Aloud", "voices": VOICES, "rates": RATES,
             "label": "自然语音（AI 合成）"},
    "macos": {"provider": "Apple macOS Speech",
              "voices": {"en-GB": "Daniel", "zh-CN": "Tingting (中文（中国大陆）)"},
              "rates": {"en-GB": "145 wpm", "zh-CN": "175 wpm"},
              "label": "离线语音（系统合成）"},
}

GUIDES = {
    "guide-welcome": "欢迎来到英语小花园。家长不用读英语，点图片就能听。点开始，我们一起听一听，说一说。",
    "guide-learn": "点图片，听单词。听完以后，轮到你说啦。",
    "guide-listen": "听一听，选出声音说的那张图片。",
    "guide-recall": "看着图片，试着自己说。想不起来，可以点小喇叭。",
    "guide-correct": "找对啦！我们再听一遍。",
    "guide-retry": "没关系，再听一遍，试着找一找。",
    "guide-next": "准备好了，就点下面的大按钮。",
    "guide-done": "今天的英语练习完成啦！送你一朵小花，休息一下吧。",
    "guide-break": "我们先休息一下，下次再来。",
    "guide-error": "声音暂时没有准备好，请家长点重试。",
    "guide-your-turn": "轮到你说啦。",
    "guide-start": "我们开始今天的英语。",
    "guide-saved": "已经记下今天的练习啦。",
    "guide-choices": "点小喇叭可以再听一次。",
}


def all_clips():
    data = json.loads(CURRICULUM.read_text())
    items = data["items"]
    ids = [item["id"] for item in items]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate curriculum IDs")
    clips = []
    for item in items:
        for kind, text, language in (
            ("word", item["word"], "en-GB"),
            ("meaning", item["meaning"] + "。", "zh-CN"),
        ):
            clips.append({"id": f"{item['id']}-{kind}", "text": text,
                          "language": language, "itemId": item["id"], "kind": kind})
    clips += [{"id": key, "text": value, "language": "zh-CN", "kind": "guide"}
              for key, value in GUIDES.items()]
    return clips


def source(clip, provider="edge"):
    language = clip["language"]
    settings = PROVIDERS[provider]
    # Terminal punctuation makes isolated word prosody consistent.
    text = clip["text"] + ("." if clip["kind"] == "word" else "")
    value = {"version": VERSION, "voice": settings["voices"][language], "rate": settings["rates"][language],
             "text": text, "clip": clip}
    if provider == "macos":
        value.update(provider=settings["provider"], renderer="say + ffmpeg + lame",
                     sampleRate=24000, bitrate=48000)
    digest = hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    return value, digest


def inspect_audio(path):
    from mutagen.mp3 import MP3
    info = MP3(path).info
    if path.stat().st_size < 1000 or not 0.25 <= info.length <= 60:
        raise ValueError(f"Incomplete or implausible recording: {path.name}")
    return {"durationSeconds": round(info.length, 3), "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "sampleRate": info.sample_rate, "bitrate": info.bitrate}


def verify(clip, manifest):
    entry = manifest.get(clip["id"])
    if not entry:
        raise ValueError(f"Missing recording: {clip['id']}")
    from unified_voice import PROVIDER, verify_source
    if entry.get("provider") == PROVIDER:
        text = source(clip)[0]["text"]
        verify_source(entry, clip, text, clip["language"], "guide" if clip["kind"] == "guide" else "word")
        expected = {"src": f"/audio/english/{clip['id']}.mp3",
                    **{key: value for key, value in clip.items() if key != "id"},
                    **inspect_audio(OUTPUT / f"{clip['id']}.mp3")}
        for key, value in expected.items():
            if entry.get(key) != value:
                raise ValueError(f"Recording verification failed: {clip['id']} ({key})")
        return
    provider = next((key for key, settings in PROVIDERS.items()
                     if settings["provider"] == entry.get("provider")), None)
    if not provider:
        raise ValueError(f"Unknown audio provider: {clip['id']}")
    value, digest = source(clip, provider)
    if entry["sourceHash"] != digest:
        raise ValueError(f"Recording needs regeneration: {clip['id']}")
    if entry["src"] != f"/audio/english/{clip['id']}.mp3":
        raise ValueError(f"Unexpected recording path: {clip['id']}")
    for field in ("voice", "rate"):
        if entry[field] != value[field]:
            raise ValueError(f"Unexpected {field}: {clip['id']}")
    if entry["synthesisText"] != value["text"]:
        raise ValueError(f"Unexpected synthesis text: {clip['id']}")
    actual = inspect_audio(OUTPUT / f"{clip['id']}.mp3")
    for key in ("sha256", "bytes", "durationSeconds", "sampleRate", "bitrate"):
        if entry[key] != actual[key]:
            raise ValueError(f"Recording verification failed: {clip['id']} ({key})")


def synthesize_macos(value, target):
    with tempfile.TemporaryDirectory(prefix="chenchen-english-") as directory:
        raw = Path(directory) / "speech.aiff"
        pcm = Path(directory) / "speech.wav"
        subprocess.run(["say", "-v", value["voice"], "-r", value["rate"].split()[0],
                        "-o", str(raw), value["text"]], check=True, capture_output=True, timeout=45)
        subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                        "-i", str(raw), "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", str(pcm)],
                       check=True, capture_output=True, timeout=30)
        subprocess.run(["lame", "--silent", "--noreplaygain", "-b", "48", "-m", "m", str(pcm), str(target)],
                       check=True, capture_output=True, timeout=30)


async def generate(clips, manifest, force, concurrency, provider):
    OUTPUT.mkdir(parents=True, exist_ok=True)
    semaphore = asyncio.Semaphore(concurrency)

    async def one(clip):
        if not force:
            try:
                verify(clip, manifest)
                print(f"KEEP {clip['id']}", flush=True)
                return
            except (ValueError, KeyError, OSError):
                pass
        value, digest = source(clip, provider)
        target = OUTPUT / f"{clip['id']}.mp3"
        temporary = target.with_suffix(".mp3.part")
        async with semaphore:
            for attempt in range(4):
                try:
                    if provider == "macos":
                        await asyncio.to_thread(synthesize_macos, value, temporary)
                    else:
                        import edge_tts
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
                "src": f"/audio/english/{clip['id']}.mp3",
                "text": clip["text"], "language": clip["language"], "kind": clip["kind"],
                "label": PROVIDERS[provider]["label"], "synthetic": True,
                "provider": PROVIDERS[provider]["provider"], "voice": value["voice"],
                "rate": value["rate"], "sourceHash": digest,
                "synthesisText": value["text"], **details,
            }
            # Serial writes within the event loop keep every finished clip on disk.
            MANIFEST.write_text(json.dumps(dict(sorted(manifest.items())), ensure_ascii=False, indent=2) + "\n")
            print(f"SAVE {clip['id']} {details['durationSeconds']}s", flush=True)

    await asyncio.gather(*(one(clip) for clip in clips))
    MANIFEST.write_text(json.dumps(dict(sorted(manifest.items())), ensure_ascii=False, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--id", action="append", help="Clip ID to generate/check (repeatable)")
    parser.add_argument("--force", action="store_true", help="Regenerate unchanged recordings")
    parser.add_argument("--check", action="store_true", help="Verify recordings offline")
    parser.add_argument("--dry-run", action="store_true", help="Show synthesis input without network")
    parser.add_argument("--concurrency", type=int, default=3, choices=range(1, 9))
    parser.add_argument("--provider", choices=PROVIDERS, default="edge",
                        help="Provider for new/changed clips; macos uses installed Daniel and Tingting")
    args = parser.parse_args()
    clips = all_clips()
    if args.id:
        unknown = set(args.id) - {clip["id"] for clip in clips}
        if unknown:
            parser.error("Unknown clip IDs: " + ", ".join(sorted(unknown)))
        clips = [clip for clip in clips if clip["id"] in args.id]
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    active_ids = {clip["id"] for clip in all_clips()}
    manifest = {key: value for key, value in manifest.items() if key in active_ids}
    if args.dry_run:
        for clip in clips:
            value, digest = source(clip, args.provider)
            print(json.dumps({"id": clip["id"], **value, "sourceHash": digest}, ensure_ascii=False))
    elif args.check:
        for clip in clips:
            verify(clip, manifest)
        print(f"PASS: {len(clips)} recordings match curriculum, guides, voices, and audio hashes")
    else:
        asyncio.run(generate(clips, manifest, args.force, args.concurrency, args.provider))


if __name__ == "__main__":
    main()
