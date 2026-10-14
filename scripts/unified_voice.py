"""Shared, offline-verifiable recipe for the site's single female TTS voice.

Heavy model dependencies are deliberately imported only by the generator.
"""
import hashlib
import json
from pathlib import Path
from audio_loudness import POLICY

PROVIDER = "Qwen3-TTS (local MLX)"
VOICE = "Serena"
MODEL = "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit"
REVISION = "e7dd0585652209fa0d7783659aad4e8a324de11c"
MODEL_SHA256 = "b965c581ccf6aa852a4124feeb7a8a111542ee7b213139368b4cc7ba7fd4728b"
VERSION = 4
INSTRUCTION = "Speak clearly and gently, at a relaxed pace."
REFERENCE_AUDIO = Path(__file__).resolve().parent / "assets/serena-reference.wav"
REFERENCE_TEXT = "你好，我们一起来读一读。太阳，月亮，小船，苹果。慢慢来，每天学会一点点。"
REFERENCE_SHA256 = "2793c83db0c7783e8e9a9eb85901eadd7ea191e1ae0ab3ff1b4ac8a993ca1b57"
SETTINGS = {
    "model": MODEL, "revision": REVISION, "renderer": "mlx-audio==0.5.8",
    "speaker": VOICE, "referenceText": REFERENCE_TEXT, "referenceSha256": REFERENCE_SHA256,
    "seed": 20261014, "batchSize": 1,
    "temperature": 0.3, "topK": 20, "topP": 0.8, "repetitionPenalty": 1.05,
    "sampleRate": 24000, "bitrate": 48000,
    "normalization": POLICY,
}

# Match the approved fixed-reference audition, including the contextual mouth reading.
PRONUNCIATION_INPUTS = {word + ".": word.capitalize() + "." for word in ("avocado", "hippo", "pineapple", "toe")}
PRONUNCIATION_INPUTS.update({"弟。": "地。", "指。": "纸。"})
CONTEXT_READINGS = {text: (context, 20261014) for text, context in {
    "mouth.": "Open your mouth. Mouth.",
    "习。": "学习。习。", "写。": "写字。写。", "牙。": "牙齿。牙。",
    "蝶。": "蝴蝶。蝶。", "雪。": "下雪。雪。", "人手。": "人手不够。人手。",
    "叶。": "绿叶。叶。",
}.items()}
TRIM = {"method": "last-phrase", "frameSeconds": .01, "minSilenceSeconds": .18,
        "absoluteThreshold": .003, "relativeThreshold": .035,
        "leadingSeconds": .05, "trailingSeconds": .15}


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def recipe(clip, text, language, style="word"):
    synthesis = {**SETTINGS, "language": "English" if language.startswith("en") else "Chinese",
                 "style": style, "maxTokens": 2048 if style == "poem" else 768 if style == "guide" else 256}
    value = {"version": VERSION, "clip": clip, "text": text,
             "voice": VOICE, "rate": "natural", "provider": PROVIDER, "synthesis": synthesis}
    if style == "word" and text in PRONUNCIATION_INPUTS:
        value.update(text=PRONUNCIATION_INPUTS[text], spokenText=text)
    if style == "word" and text in CONTEXT_READINGS:
        contextual, seed = CONTEXT_READINGS[text]
        synthesis.update(seed=seed, trim=TRIM)
        value.update(text=contextual, spokenText=text)
    return value


def fields(clip, text, language, style="word"):
    value = recipe(clip, text, language, style)
    return {"label": "自然女声（AI 合成）", "synthetic": True,
            "provider": PROVIDER, "voice": VOICE, "rate": value["rate"],
            "sourceVersion": VERSION, "synthesisText": value["text"], "spokenText": text,
            "sourceHash": digest(value), "synthesis": value["synthesis"]}


def verify_source(entry, clip, text, language, style="word"):
    for key, expected in fields(clip, text, language, style).items():
        if entry.get(key) != expected:
            raise ValueError(f"Unified voice recipe mismatch: {clip['id']} ({key})")
