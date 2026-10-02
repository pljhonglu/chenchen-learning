/* Offline curriculum and audio contracts for the three clickable example characters. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const root = path.join(__dirname, '../public');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const window = {};
vm.runInNewContext(read('pinyin-data.js'), { window }, { timeout: 1000 });
const data = window.ChenchenPinyinData;
const audio = JSON.parse(read('data/pinyin-examples-audio.json'));
const writingAudio = JSON.parse(read('data/writing-vocabulary-audio.json'));
const initials = 'b p m f d t n l g k h j q x zh ch sh r z c s y w'.split(' ');
const finals = 'a o e i u ü ai ei ui ao ou iu ie üe er an en in un ün ang eng ing ong'.split(' ');

const tones = { a: 'āáǎà', e: 'ēéěè', i: 'īíǐì', o: 'ōóǒò', u: 'ūúǔù', ü: 'ǖǘǚǜ' };
const stripTone = pinyin => Object.entries(tones).reduce((text, [plain, accented]) =>
  text.replace(new RegExp(`[${accented}]`, 'g'), plain), pinyin);
const initialOf = spelling => spelling.match(/^(zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])/)?.[0];
function finalOf(spelling) {
  // Zero-initial i/u/ü syllables use y/w spelling in ordinary written pinyin.
  if (spelling.startsWith('y')) return {
    yi: 'i', ya: 'ia', ye: 'ie', yao: 'iao', you: 'iu', yan: 'ian', yin: 'in',
    yang: 'iang', ying: 'ing', yong: 'iong', yu: 'ü', yue: 'üe', yuan: 'üan', yun: 'ün',
  }[spelling];
  if (spelling.startsWith('w')) return {
    wu: 'u', wa: 'ua', wo: 'uo', wai: 'uai', wei: 'ui', wan: 'uan', wen: 'un', wang: 'uang', weng: 'ueng',
  }[spelling];
  const [, initial = '', final] = spelling.match(/^(zh|ch|sh|[bpmfdtnlgkhjqxrzcs])?(.*)$/);
  // j/q/x + u always represents ü, and must not be filed under plain u/un.
  return /^[jqx]$/.test(initial) && final.startsWith('u') ? `ü${final.slice(1)}` : final;
}

assert.deepEqual(Array.from(data.initials, item => item.id), initials, 'Initial collection differs from the 23 taught sounds');
assert.deepEqual(Array.from(data.finals, item => item.id), finals, 'Final collection differs from the 24 taught sounds');
const expectedClips = new Map();
for (const [kind, rows] of Object.entries(data)) {
  for (const row of rows) {
    assert.equal(row.examples.length, 3, `${row.id}: expected three examples`);
    assert.equal(new Set(row.examples.map(item => item.c)).size, 3, `${row.id}: repeated example character`);
    for (const example of row.examples) {
      assert.match(example.c, /^\p{Unified_Ideograph}$/u, `${row.id}: example must be a single Han character`);
      assert.match(example.pinyin, /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/u, `${example.c}: missing tone mark`);
      const spelling = stripTone(example.pinyin);
      assert.match(spelling, /^[a-zü]+$/u, `${example.c}: invalid pinyin`);
      assert.equal(kind === 'initials' ? initialOf(spelling) : finalOf(spelling), row.id,
        `${example.c} (${example.pinyin}) does not have ${kind === 'initials' ? 'initial' : 'final'} ${row.id}`);
      // i's standard vowel examples must not be replaced by zi/ci/si/zhi/chi/shi/ri.
      if (kind === 'finals' && row.id === 'i') assert.doesNotMatch(spelling, /^(?:z|c|s|zh|ch|sh|r)i$/);
      const id = `char-${example.c.codePointAt(0).toString(16)}`;
      if (expectedClips.has(id)) assert.equal(expectedClips.get(id).pinyin, example.pinyin, `${example.c}: shared character has conflicting pronunciations`);
      expectedClips.set(id, { text: example.c, pinyin: example.pinyin });
    }
  }
}

assert.deepEqual(Object.keys(audio).sort(), Array.from(expectedClips.keys()).sort(), 'Audio must cover exactly the unique example characters');
const audioFiles = fs.readdirSync(path.join(root, 'audio/pinyin/examples')).filter(file => file.endsWith('.mp3')).sort();
assert.deepEqual(audioFiles, Array.from(expectedClips.keys(), id => `${id}.mp3`).sort(), 'Bundled recordings must match the manifest');
let reused = 0;
let generated = 0;
for (const [id, example] of expectedClips) {
  const clip = audio[id];
  assert.equal(clip.src, `/audio/pinyin/examples/${id}.mp3`, `${id}: incorrect recording path`);
  assert.equal(clip.text, example.text, `${id}: incorrect character`);
  assert.equal(clip.pinyin, example.pinyin, `${id}: incorrect pronunciation`);
  assert.equal(clip.language, 'zh-CN', `${id}: incorrect narration language`);
  assert.equal(clip.kind, 'character', `${id}: incorrect clip kind`);
  assert.equal(clip.synthetic, true, `${id}: missing synthesis provenance`);
  assert.equal(clip.sourceVersion, 1, `${id}: unknown recipe version`);
  assert.equal(clip.provider, 'Microsoft Edge Read Aloud', `${id}: missing provider provenance`);
  assert.equal(clip.voice, 'zh-CN-XiaoxiaoNeural', `${id}: unexpected voice`);
  assert.equal(clip.rate, '-8%', `${id}: unexpected reading speed`);
  assert.match(clip.sourceHash, /^[0-9a-f]{64}$/, `${id}: missing source recipe hash`);
  assert.equal(clip.synthesisText, `${example.text}。`, `${id}: clicking an example must read only its character`);
  const bytes = fs.readFileSync(path.join(root, clip.src.slice(1)));
  assert.ok(bytes.length > 1000, `${id}: empty or truncated audio`);
  assert.equal(clip.bytes, bytes.length, `${id}: incorrect byte count`);
  assert.equal(clip.sha256, hash(bytes), `${id}: changed audio hash`);
  assert.ok(clip.durationSeconds >= 0.25 && clip.durationSeconds <= 12, `${id}: implausible duration`);
  assert.equal(clip.sampleRate, 24000, `${id}: unexpected sample rate`);
  assert.ok(clip.bitrate >= 16000, `${id}: implausible bitrate`);
  assert.ok(bytes.subarray(0, 3).toString() === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0), `${id}: not an MP3`);
  if (clip.origin.type === 'reuse') {
    reused++;
    const original = writingAudio[id];
    assert.ok(original, `${id}: missing original writing recording`);
    assert.equal(clip.origin.manifest, '/data/writing-vocabulary-audio.json');
    assert.equal(clip.origin.id, id);
    for (const key of ['src', 'sha256', 'sourceHash']) assert.equal(clip.origin[key], original[key], `${id}: incorrect reuse source ${key}`);
    for (const key of ['text', 'pinyin', 'voice', 'rate', 'synthesisText', 'sha256']) assert.equal(clip[key], original[key], `${id}: copied audio differs in ${key}`);
    assert.equal(hash(fs.readFileSync(path.join(root, original.src.slice(1)))), clip.sha256, `${id}: reuse must be a byte-identical local copy`);
  } else {
    generated++;
    assert.equal(clip.origin.type, 'synthesis', `${id}: unknown provenance type`);
    assert.equal(clip.origin.generator, 'scripts/generate-pinyin-examples-audio.py', `${id}: missing generator provenance`);
    assert.equal(clip.origin.dependencies['edge-tts'], '7.2.8');
    assert.equal(clip.origin.dependencies.mutagen, '1.47.0');
    assert.ok(!writingAudio[id] || writingAudio[id].pinyin !== example.pinyin || writingAudio[id].synthesisText !== `${example.text}。`, `${id}: matching single-character local recording was unnecessarily synthesized`);
  }
}

console.log(`PASS: 47 sounds × 3 examples, ${expectedClips.size} distinct character readings (${reused} reused, ${generated} synthesized), pinyin correspondence, local audio coverage, provenance and hashes`);
