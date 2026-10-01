/* Offline asset contracts: the displayed curriculum, stroke drawings and narration agree. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');

const root = path.join(__dirname, '../public');
const text = file => fs.readFileSync(path.join(root, file), 'utf8');
const json = file => JSON.parse(text(file));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const app = text('app.js');
const literal = app.match(/\bconst WRITE_CHARS\s*=\s*(\[[\s\S]*?\n\s*\]);/);
assert.ok(literal, 'Writing curriculum array is missing');
// Evaluate only the data literal, never the app or its startup side effects.
const curriculum = vm.runInNewContext(`(${literal[1]})`, Object.create(null), { timeout: 1000 });
const strokes = json('data/writing-strokes.json').characters;
const audio = json('data/writing-audio.json');
const characters = new Set(curriculum.map(item => item.c));

assert.equal(curriculum.length, 60, 'Expected 60 selectable characters');
assert.equal(characters.size, 60, 'Duplicate characters in writing curriculum');
assert.equal(curriculum.filter(item => item.level === 'starter').length, 24, 'Starter collection size');
assert.equal(curriculum.filter(item => item.level === 'explore').length, 36, 'Explore collection size');
for (const c of '人大小口日月水火山石田木') assert.ok(characters.has(c), `Original character ${c} was lost`);
for (const item of curriculum) {
  assert.equal(Array.from(item.c).length, 1, `Not a single character: ${item.c}`);
  for (const key of ['group', 'example', 'tip']) assert.ok(item[key]?.trim(), `${item.c}: missing ${key}`);
  assert.ok(strokes[item.c], `${item.c}: missing bundled stroke data`);
  assert.match(item.strokes, /^\d+\s*画/, `${item.c}: missing readable stroke count`);
  assert.equal(Number.parseInt(item.strokes, 10), strokes[item.c].strokeCount, `${item.c}: displayed stroke count disagrees with drawing`);
}

const drawingData = new Map();
let maxStrokes = 0;
for (const [c, entry] of Object.entries(strokes)) {
  const expectedPath = `/data/strokes/${c.codePointAt(0).toString(16)}.json`;
  assert.equal(entry.src, expectedPath, `${c}: stroke path must be local and match its character`);
  const bytes = fs.readFileSync(path.join(root, entry.src.slice(1)));
  assert.equal(sha256(bytes), entry.sha256, `${c}: stroke data hash mismatch`);
  const data = JSON.parse(bytes);
  assert.ok(Number.isInteger(entry.strokeCount) && entry.strokeCount > 0, `${c}: invalid stroke count`);
  assert.equal(data.strokes?.length, entry.strokeCount, `${c}: wrong number of stroke paths`);
  assert.equal(data.medians?.length, entry.strokeCount, `${c}: wrong number of animation paths`);
  data.strokes.forEach((outline, index) => {
    assert.ok(typeof outline === 'string' && /^M\s/i.test(outline) && /[zZ]\s*$/.test(outline), `${c}, stroke ${index + 1}: invalid closed SVG outline`);
    const points = data.medians[index];
    assert.ok(Array.isArray(points) && points.length >= 2, `${c}, stroke ${index + 1}: animation path is empty`);
    for (const point of points) assert.ok(Array.isArray(point) && point.length === 2 && point.every(Number.isFinite), `${c}, stroke ${index + 1}: invalid animation coordinate`);
  });
  drawingData.set(entry.src, data);
  maxStrokes = Math.max(maxStrokes, entry.strokeCount);
}
for (const c of '辰春明') assert.ok(strokes[c], `Missing bundled classroom/name example ${c}`);

const ordinals = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十'];
for (let number = 1; number <= maxStrokes; number++) {
  assert.ok(audio[`stroke-${String(number).padStart(2, '0')}`], `No narration for stroke ${number}`);
}
for (const [id, clip] of Object.entries(audio)) {
  assert.match(clip.src, /^\/audio\/writing\/[a-z0-9-]+\.mp3$/, `${id}: narration must be a local MP3`);
  const bytes = fs.readFileSync(path.join(root, clip.src.slice(1)));
  assert.ok(bytes.length > 1000, `${id}: recording is too short or empty`);
  assert.equal(bytes.length, clip.bytes, `${id}: recording byte count mismatch`);
  assert.equal(sha256(bytes), clip.sha256, `${id}: recording hash mismatch`);
  assert.ok(clip.durationSeconds > 0.25 && clip.durationSeconds < 15, `${id}: invalid recording duration`);
  assert.equal(clip.language, 'zh-CN', `${id}: narration language`);
  assert.equal(clip.synthetic, true, `${id}: missing synthetic voice disclosure`);
  if (clip.kind === 'stroke') {
    const number = Number(id.replace(/^stroke-/, ''));
    assert.ok(Number.isInteger(number) && number >= 1 && number <= ordinals.length, `${id}: invalid stroke number`);
    assert.equal(clip.strokeNumber, number, `${id}: mismatched number metadata`);
    assert.equal(clip.text, `第${ordinals[number - 1]}画`, `${id}: incorrect spoken ordinal`);
    assert.equal(clip.synthesisText, `${clip.text}。`, `${id}: synthesis text differs from label`);
  } else {
    assert.equal(clip.kind, 'guide', `${id}: unknown recording kind`);
    assert.ok(clip.text?.trim(), `${id}: missing guide text`);
    assert.equal(clip.synthesisText, clip.text, `${id}: synthesis text differs from guide`);
  }
}

assert.match(text('data/strokes/ARPHICPL.TXT'), /ARPHIC PUBLIC LICENSE/, 'Stroke data license missing');
assert.match(text('vendor/hanzi-writer-LICENSE.txt'), /MIT License/, 'Renderer license missing');
const scriptTags = [...text('index.html').matchAll(/<script\b([^>]*)\bsrc=["']([^"']+)["'][^>]*>/gi)];
const scripts = scriptTags.map(match => match[2].replace(/^\//, ''));
for (const match of scriptTags) {
  assert.doesNotMatch(match[2], /^(?:[a-z]+:|\/\/)/i, `Runtime script must be bundled: ${match[2]}`);
  assert.ok(fs.existsSync(path.join(root, match[2].replace(/^\//, ''))), `Missing runtime script ${match[2]}`);
}
const renderer = scripts.findIndex(src => /^vendor\/hanzi-writer-.*\.js$/.test(src));
const player = scripts.indexOf('writing-strokes.js');
const voice = scripts.indexOf('writing-audio.js');
const appIndex = scripts.indexOf('app.js');
assert.ok(renderer >= 0 && player > renderer && appIndex > player && voice >= 0 && appIndex > voice, 'Writing scripts must load their dependencies before app.js');
for (const index of [renderer, player, voice, appIndex]) assert.doesNotMatch(scriptTags[index][0], /\sasync(?:\s|=|>)/i, 'Dependent writing scripts cannot use unordered async loading');

// Observe actual loader configuration with local files. This catches accidental
// fallback to Hanzi Writer's built-in CDN without coupling to source formatting.
async function verifyLocalLoader() {
  const requests = [];
  let loadedByWriter;
  const doc = { createElementNS: () => ({ ownerDocument: doc, style: {}, setAttribute() {}, appendChild() {}, remove() {} }) };
  class RendererProbe {
    constructor(_target, options) { this.options = options; }
    async setCharacter(c) {
      assert.equal(typeof this.options.charDataLoader, 'function', `${c}: local charDataLoader was not supplied`);
      loadedByWriter = await this.options.charDataLoader(c);
    }
    hideCharacter() { return Promise.resolve(); }
    static getScalingTransform() { return { transform: '' }; }
  }
  const window = {
    document: doc, AbortController, HanziWriter: RendererProbe,
    async fetch(url) {
      requests.push(url);
      assert.ok(drawingData.has(url), `Unexpected/nonlocal drawing request: ${url}`);
      return { ok: true, json: async () => drawingData.get(url) };
    },
  };
  vm.runInNewContext(text('writing-strokes.js'), { window, setTimeout, clearTimeout });
  for (const [c, entry] of Object.entries(strokes)) {
    const viewer = window.ChenchenWritingStrokes.create({ target: doc.createElementNS(), character: c });
    assert.equal(await viewer.ready, true, `${c}: bundled drawing failed to initialize`);
    assert.equal(requests.at(-1), entry.src, `${c}: loader requested the wrong file`);
    assert.equal(loadedByWriter, drawingData.get(entry.src), `${c}: renderer did not receive local drawing data`);
    viewer.destroy();
  }
  assert.equal(requests.length, Object.keys(strokes).length, 'Unexpected extra data requests');
}

verifyLocalLoader().then(() => {
  console.log(`PASS: ${characters.size} curriculum characters (24 starter / 36 explore), ${drawingData.size} local drawings, ${Object.keys(audio).length} narration files, hashes, counts, licenses and load order`);
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
