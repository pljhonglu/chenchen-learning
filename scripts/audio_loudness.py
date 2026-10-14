"""Measure final MP3s and apply explicit gain with a peak guard, never blind loudnorm."""
import json
import math
import re
import subprocess
import tempfile
from pathlib import Path

TARGET = -18.0
TOLERANCE = 1.0
PEAK_LIMIT = -1.0
POLICY = "measured gain to -18 LUFS +/-1; oversampled -2 dB limiter; post-MP3 true peak <= -1 dBTP; LAME 48 kbps"


def measure(path):
    result = subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-i", str(path),
        "-af", "loudnorm=I=-18:TP=-2:LRA=7:print_format=json", "-f", "null", "-"],
        check=True, capture_output=True, text=True)
    data = json.loads(re.findall(r"\{[^{}]+\}", result.stderr)[-1])
    values = {"integratedLufs": float(data["input_i"]), "truePeakDbtp": float(data["input_tp"])}
    if not all(math.isfinite(v) for v in values.values()):
        raise ValueError(f"Unmeasurable speech loudness: {path}")
    return values


def acceptable(values):
    return abs(values["integratedLufs"] - TARGET) <= TOLERANCE and values["truePeakDbtp"] <= PEAK_LIMIT


def encode_verified(source, target):
    """Always retry from original samples, avoiding cumulative lossy encoding."""
    initial = measure(source)
    gain = TARGET - initial["integratedLufs"]
    with tempfile.TemporaryDirectory(prefix="chenchen-loudness-") as directory:
        wav = Path(directory) / "normalized.wav"
        encoded = Path(directory) / "normalized.mp3"
        for _ in range(4):
            # This FFmpeg version has no alimiter latency option: pad/trim the 5 ms lookahead.
            filters = (f"aresample=96000,volume={gain:.4f}dB,apad=pad_dur=0.005,"
                       "alimiter=limit=0.794328:attack=5:release=50:level=false,atrim=start=0.005")
            subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                "-i", str(source), "-af", filters, "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", str(wav)],
                check=True, capture_output=True)
            subprocess.run(["lame", "--silent", "--noreplaygain", "-T", "-b", "48", "-m", "m", str(wav), str(encoded)],
                check=True, capture_output=True)
            actual = measure(encoded)
            if acceptable(actual):
                Path(target).write_bytes(encoded.read_bytes())
                return actual
            if actual["truePeakDbtp"] > PEAK_LIMIT:
                raise ValueError(f"Encoded peak exceeds ceiling: {source}: {actual}")
            gain += TARGET - actual["integratedLufs"]
    raise ValueError(f"Could not normalize speech: {source}: {actual}")
