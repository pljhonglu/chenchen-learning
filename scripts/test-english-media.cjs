/* Curriculum/media contracts: no missing or mismatched classroom assets. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.join(__dirname, '../public');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const curriculum = read('data/english.json');
const audio = read('data/english-audio.json');
const art = read('data/english-illustrations.json');
const ids = new Set();
const themes = new Set(curriculum.themes.map(t => t.id));
assert.equal(curriculum.items.length, 87);
assert.equal(curriculum.items.filter(i => i.source === 'classroom').length, 39);
assert.equal(curriculum.items.filter(i => i.source === 'extension').length, 48);
for (const item of curriculum.items) {
  assert.match(item.id, /^english-[a-z-]+$/);
  assert.ok(!ids.has(item.id), `duplicate ${item.id}`); ids.add(item.id);
  assert.ok(themes.has(item.theme));
  for (const key of ['word','meaning','sentence','translation']) assert.ok(item[key]?.trim(), `${item.id}: ${key}`);
  assert.doesNotMatch(item.sentence, /\ba scissors\b|\ba (?:milk|rice|honey|cheese)\b|This is (?:cat|dog|mouse|box)\./i);
  for (const type of ['word','sentence','meaning']) {
    const clip = audio[`${item.id}-${type}`];
    assert.ok(clip, `${item.id}: ${type} audio missing`);
    if (type !== 'meaning') assert.equal(clip.synthesisText, item[type] + (type === 'word' ? '.' : ''), `${item.id}: audio text mismatch`);
    assert.match(clip.voice, type === 'meaning' ? /^zh-CN-/ : /^en-(GB|US)-/);
  }
  const picture = art[item.id];
  assert.ok(picture, `${item.id}: illustration missing`);
  if (picture.kind === 'color') { assert.equal(item.theme,'colors'); assert.match(picture.color,/^#[a-f\d]{6}$/i); }
  else if (picture.kind === 'number') { assert.equal(item.theme,'numbers'); assert.ok(Number.isInteger(picture.count) && picture.count >= 1 && picture.count <= 10); assert.ok(art['english-apple']); }
  else {
    assert.match(picture.src, /^\/?images\/english\/[a-z\d_-]+\.(png|webp|jpg)$/i);
    assert.ok(picture.alt?.length, `${item.id}: accessible image description missing`);
    assert.ok(Number.isInteger(picture.index) && picture.index >= 0 && picture.index < picture.columns * picture.rows, `${item.id}: invalid sprite location`);
    const bytes = fs.readFileSync(path.join(root,picture.src.replace(/^\//,'')));
    assert.ok(bytes.length > 4000, `${item.id}: truncated image`);
    if (picture.src.endsWith('.png')) assert.equal(bytes.subarray(1,4).toString(),'PNG');
    else if (picture.src.endsWith('.webp')) assert.equal(bytes.subarray(8,12).toString(),'WEBP');
  }
}
assert.deepEqual(Object.keys(art).sort(), [...ids].sort());
for (const [key, clip] of Object.entries(audio)) {
  assert.match(clip.src, /^\/audio\/english\/[a-z-]+\.mp3$/);
  assert.ok(clip.synthetic === true && clip.synthesisText);
  const bytes = fs.readFileSync(path.join(root,clip.src.slice(1)));
  assert.equal(bytes.length,clip.bytes, `${key}: wrong byte length`);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),clip.sha256, `${key}: damaged recording`);
  assert.ok(clip.durationSeconds > 0.2 && clip.durationSeconds < 60);
}
const source = fs.readFileSync(path.join(root,'english.js'),'utf8');
const guides = [...source.matchAll(/["'](guide-[a-z-]+)["']/g)].map(m=>m[1]);
for (const guide of guides) assert.ok(audio[guide], `missing guide ${guide}`);
assert.doesNotMatch(source,/\b(?:localStorage|sessionStorage|indexedDB|speechSynthesis)\b/);
console.log(`PASS: ${ids.size} curriculum items, all illustrations, ${Object.keys(audio).length} audio files, hashes and guide coverage`);
