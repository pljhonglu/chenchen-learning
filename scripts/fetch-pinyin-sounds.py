#!/usr/bin/env python3
"""Fetch licensed, recorded pinyin sounds (not character or Latin-letter TTS).

Requires Python 3, mutagen, and FFmpeg. Set FFMPEG to its executable if needed.
Downloads are pinned to an immutable upstream revision. The only sound edit is
ong: remove the initial consonant from dong1, with exact boundaries below.
"""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import urllib.request

from mutagen.id3 import ID3, TXXX, TIT2
from mutagen.mp3 import MP3

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/audio/pinyin"
SOURCES = OUT / "sources"
REVISION = "ff9ed3d0c631195bd2c06f39450f3264c7124040"
BASE = f"https://raw.githubusercontent.com/hugolpz/audio-cmn/{REVISION}/"
LICENSE = "CC-BY-SA-3.0"
LICENSE_URL = "https://creativecommons.org/licenses/by-sa/3.0/"
# Initials use the standard teaching 呼读音; y/w have the same sound as i/u.
# yi/wu/yu, wei/you/ye/yue, yin/wen/yun/ying are zero-initial orthographic
# syllables. y/w here do not add a consonant to the corresponding final.
SOUNDS = {
    "b": "bo1", "p": "po1", "m": "mo1", "f": "fo1",
    "d": "de1", "t": "te1", "n": "ne1", "l": "le1",
    "g": "ge1", "k": "ke1", "h": "he1", "j": "ji1",
    "q": "qi1", "x": "xi1", "zh": "zhi1", "ch": "chi1",
    "sh": "shi1", "r": "ri1", "z": "zi1", "c": "ci1", "s": "si1",
    "y": "yi1", "w": "wu1",
    "a": "a1", "o": "o1", "e": "e1", "i": "yi1", "u": "wu1", "ü": "yu1",
    "ai": "ai1", "ei": "ei1", "ui": "wei1", "ao": "ao1", "ou": "ou1",
    "iu": "you1", "ie": "ye1", "üe": "yue1", "er": "er1",
    "an": "an1", "en": "en1", "in": "yin1", "un": "wen1", "ün": "yun1",
    "ang": "ang1", "eng": "eng1", "ing": "ying1", "ong": "dong1",
}
ONG_EDIT = {
    "source": "cmn-dong1.mp3",
    "startSeconds": 0.370,
    "endSeconds": None,
    "fadeInSeconds": 0.008,
    "leadingSilenceSeconds": 0.120,
    "sampleRate": 48000,
    "bitrate": "64k",
    "description": "Removed d onset and release; kept the ong vowel and nasal tail. No pitch or speed change.",
    "validation": "Waveform and spectrogram inspected against dong1, gong1 and hong1; not a substitute for a Mandarin educator's listening review.",
}


def download(relative):
    request = urllib.request.Request(BASE + relative, headers={"User-Agent": "chenchen-learning-pinyin/1.0"})
    with urllib.request.urlopen(request, timeout=45) as response:
        return response.read()


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def tags_dict(audio):
    names = ["SWAC_SPEAK_NAME", "SWAC_COLL_AUTHORS", "SWAC_COLL_LICENSE", "SWAC_COLL_COPYRIGHT", "SWAC_COLL_DESC", "SWAC_TEXT", "SWAC_TECH_DATE"]
    return {name: str(audio.tags.get("TXXX:" + name, "")) for name in names}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    SOURCES.mkdir(exist_ok=True)
    sources = sorted(set(SOUNDS.values()))
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        blobs = dict(zip(sources, executor.map(lambda name: download(f"64k/syllabs/cmn-{name}.mp3"), sources)))
    (SOURCES / "audio-cmn-README.md").write_bytes(download("README.md"))
    original = SOURCES / "cmn-dong1.mp3"
    original.write_bytes(blobs["dong1"])
    records = []
    with tempfile.TemporaryDirectory(prefix="chenchen-pinyin-") as temp:
        temporary = Path(temp)
        for symbol, source in SOUNDS.items():
            original_blob = blobs[source]
            source_file = temporary / f"cmn-{source}.mp3"
            source_file.write_bytes(original_blob)
            metadata = tags_dict(MP3(source_file))
            if metadata["SWAC_COLL_LICENSE"] != LICENSE:
                raise ValueError(f"Unconfirmed recording license for {source}: {metadata}")
            target = OUT / f"sound-{symbol.replace('ü', 'v')}.mp3"
            if symbol != "ong":
                target.write_bytes(original_blob)
                modification = "Filename only; MP3 bytes and ID3 metadata are unchanged."
            else:
                executable = os.environ.get("FFMPEG") or shutil.which("ffmpeg")
                if not executable:
                    raise RuntimeError("FFmpeg is required for the documented ong excerpt; set FFMPEG.")
                subprocess.run([
                    executable, "-hide_banner", "-loglevel", "error", "-y", "-i", str(source_file),
                    "-af", "atrim=start=0.370,asetpts=N/SR/TB,afade=t=in:st=0:d=0.008,adelay=120,asetpts=N/SR/TB",
                    "-ar", "48000", "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "64k", str(target),
                ], check=True)
                tags = ID3(source_file)
                tags.add(TIT2(encoding=3, text="ong: vowel and nasal excerpt from dong1 (cmn)"))
                tags.add(TXXX(encoding=3, desc="CHENCHEN_ADAPTATION", text=json.dumps(ONG_EDIT, ensure_ascii=False)))
                tags.save(target)
                modification = ONG_EDIT
            result = MP3(target)
            records.append({
                "symbol": symbol,
                "file": f"/audio/pinyin/{target.name}",
                "sourceSyllable": source,
                "sourceUrl": BASE + f"64k/syllabs/cmn-{source}.mp3",
                "sourceSha256": sha256(original_blob),
                "sha256": sha256(target.read_bytes()),
                "duration": round(result.info.length, 6),
                "bytes": target.stat().st_size,
                "license": LICENSE,
                "sourceId3": metadata,
                "modification": modification,
            })
    manifest = {
        "description": "Recorded pinyin sounds: 23 initial teaching sounds and 24 finals. Not TTS.",
        "sourceRepository": "https://github.com/hugolpz/audio-cmn",
        "sourceRevision": REVISION,
        "license": LICENSE,
        "licenseUrl": LICENSE_URL,
        "attribution": "Chen Wang 王琛 (speaker); Wang Chen, Lopez Hugo, Vion Nicolas; Copyright © 2013",
        "items": records,
    }
    (OUT / "sound-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(f"Saved {len(records)} recorded pinyin sounds and verified their embedded {LICENSE} license.")


if __name__ == "__main__":
    main()
