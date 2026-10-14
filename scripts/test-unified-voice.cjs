/* A new word must not silently bring back a different speaker or device voice. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.join(__dirname, '../public');
const collections = ['english', 'writing-vocabulary', 'writing', 'pinyin-examples', 'poem'];
const readings = new Map();
const reference = fs.readFileSync(path.join(__dirname, 'assets/serena-reference.wav'));
assert.equal(crypto.createHash('sha256').update(reference).digest('hex'),
  '2793c83db0c7783e8e9a9eb85901eadd7ea191e1ae0ab3ff1b4ac8a993ca1b57', 'Approved voice reference changed');
let count = 0;
for (const name of collections) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data', `${name}-audio.json`)));
  for (const [id, clip] of Object.entries(manifest)) {
    const label = `${name}/${id}`;
    assert.equal(clip.provider, 'Qwen3-TTS (local MLX)', `${label}: changed speech provider`);
    assert.equal(clip.voice, 'Serena', `${label}: mixed speaker`);
    assert.equal(clip.synthesis.speaker, clip.voice, `${label}: wrong model speaker`);
    assert.equal(clip.synthetic, true, `${label}: missing AI voice disclosure`);
    assert.equal(clip.sampleRate, 24000, `${label}: inconsistent sample rate`);
    assert.equal(clip.bitrate, 48000, `${label}: inconsistent encoding`);
    assert.equal(clip.synthesis.model, 'mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit');
    assert.equal(clip.synthesis.revision, 'e7dd0585652209fa0d7783659aad4e8a324de11c');
    assert.equal(clip.sourceVersion, 4);
    assert.equal(clip.synthesis.referenceSha256, '2793c83db0c7783e8e9a9eb85901eadd7ea191e1ae0ab3ff1b4ac8a993ca1b57');
    assert.equal(clip.synthesis.seed, 20261014);
    assert.equal(clip.synthesis.batchSize, 1);
    assert.equal(clip.synthesis.temperature, 0.3);
    assert.equal(clip.synthesis.topK, 20);
    assert.equal(clip.synthesis.topP, 0.8);
    assert.ok(Math.abs(clip.loudness.integratedLufs + 18) <= 1, `${label}: inconsistent loudness`);
    assert.ok(clip.loudness.truePeakDbtp <= -1, `${label}: peak too high`);
    const bytes = fs.readFileSync(path.join(root, clip.src));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), clip.sha256, `${label}: audio hash changed`);
    const key = JSON.stringify([clip.synthesisText, clip.synthesis.language, clip.synthesis.style]);
    if (readings.has(key)) assert.equal(clip.sha256, readings.get(key), `${label}: same reading has different recordings`);
    readings.set(key, clip.sha256);
    count++;
  }
}
assert.ok(count >= 1000, 'All lesson collections must be covered');
console.log(`PASS: ${count} lesson files use one female speaker and consistent encoding; ${readings.size} unique readings`);
