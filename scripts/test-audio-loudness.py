"""Integration regression: quiet short speech must pass after MP3 encoding."""
import subprocess
import tempfile
import unittest
from pathlib import Path
import numpy as np
from scipy.signal import correlate
from audio_loudness import measure, acceptable, encode_verified

ROOT = Path(__file__).resolve().parents[1]


def decode(path):
    result = subprocess.run(['ffmpeg','-v','error','-i',str(path),'-f','f32le','-ac','1','-ar','24000','-'],capture_output=True,check=True)
    return np.frombuffer(result.stdout, dtype='<f4')


class LoudnessRegression(unittest.TestCase):
    def test_quiet_short_words_preserve_speech(self):
        with tempfile.TemporaryDirectory() as directory:
            for word in ['word-51fa-53d1', 'word-8033-673a']:
                source = ROOT/'public/audio/writing-vocabulary'/f'{word}.mp3'
                quiet, target = Path(directory)/'quiet.wav', Path(directory)/'fixed.mp3'
                subprocess.run(['ffmpeg','-v','error','-y','-i',str(source),'-af','volume=-20dB','-c:a','pcm_f32le',str(quiet)], check=True)
                self.assertFalse(acceptable(measure(quiet)))
                encode_verified(quiet, target)
                self.assertTrue(acceptable(measure(target)))
                a, b = decode(quiet), decode(target)
                self.assertLessEqual(abs(len(b)-len(a)), 1152)
                similarity = np.max(correlate(b, a, method='fft')) / np.sqrt(np.sum(a*a)*np.sum(b*b))
                # Lossy MP3 re-encoding and peak limiting can change individual samples.
                # Correlation still guards against replacing, cropping or re-synthesizing speech.
                self.assertGreater(similarity, .95, f'{word}: speech waveform changed beyond gain/codec effects')

    def test_silence_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'silence.wav'
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','anullsrc=r=24000:cl=mono','-t','1',str(path)],check=True)
            with self.assertRaises(ValueError):
                encode_verified(path, Path(directory)/'invalid.mp3')


if __name__ == '__main__':
    unittest.main()
