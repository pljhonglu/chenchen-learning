/* Recorded pinyin inventory and attribution checks. No npm dependencies. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const directory = path.join(root, "public/audio/pinyin");
const manifest = JSON.parse(fs.readFileSync(path.join(directory, "sound-manifest.json"), "utf8"));
const expected = {
  b: "bo1", p: "po1", m: "mo1", f: "fo1", d: "de1", t: "te1", n: "ne1", l: "le1",
  g: "ge1", k: "ke1", h: "he1", j: "ji1", q: "qi1", x: "xi1", zh: "zhi1", ch: "chi1",
  sh: "shi1", r: "ri1", z: "zi1", c: "ci1", s: "si1", y: "yi1", w: "wu1",
  a: "a1", o: "o1", e: "e1", i: "yi1", u: "wu1", "ü": "yu1", ai: "ai1", ei: "ei1",
  ui: "wei1", ao: "ao1", ou: "ou1", iu: "you1", ie: "ye1", "üe": "yue1", er: "er1",
  an: "an1", en: "en1", in: "yin1", un: "wen1", "ün": "yun1", ang: "ang1", eng: "eng1",
  ing: "ying1", ong: "dong1",
};
const digest = buffer => crypto.createHash("sha256").update(buffer).digest("hex");
const synchsafe = (b, offset) => ((b[offset] & 127) << 21) | ((b[offset + 1] & 127) << 14) | ((b[offset + 2] & 127) << 7) | (b[offset + 3] & 127);
function recordingTags(buffer) {
  assert.equal(buffer.toString("ascii", 0, 3), "ID3", "recording must retain ID3 attribution");
  const version = buffer[3];
  assert.ok(version === 3 || version === 4, "supported ID3 version");
  const end = 10 + synchsafe(buffer, 6);
  assert.ok(end < buffer.length - 2000, "MP3 must contain an audio payload");
  const tags = {};
  for (let offset = 10; offset + 10 <= end;) {
    const name = buffer.toString("ascii", offset, offset + 4);
    if (!/^[A-Z0-9]{4}$/.test(name)) break;
    const size = version === 4 ? synchsafe(buffer, offset + 4) : buffer.readUInt32BE(offset + 4);
    assert.ok(size > 0 && offset + 10 + size <= end, "valid ID3 frame size");
    const value = buffer.subarray(offset + 10, offset + 10 + size);
    if (name === "TXXX") {
      assert.ok(value[0] === 3 || value[0] === 0, "expected UTF-8/Latin-1 source tags");
      const text = value.subarray(1).toString(value[0] === 3 ? "utf8" : "latin1").replace(/\0+$/, "");
      const separator = text.indexOf("\0");
      tags[text.slice(0, separator)] = text.slice(separator + 1);
    }
    offset += 10 + size;
  }
  assert.ok(buffer[end] === 0xff && (buffer[end + 1] & 0xe0) === 0xe0, "valid MPEG audio frame after ID3");
  return tags;
}
assert.equal(manifest.sourceRevision, "ff9ed3d0c631195bd2c06f39450f3264c7124040");
assert.equal(manifest.license, "CC-BY-SA-3.0");
assert.equal(manifest.licenseUrl, "https://creativecommons.org/licenses/by-sa/3.0/");
assert.equal(manifest.items.length, 47);
assert.deepEqual(manifest.items.map(item => item.symbol).sort(), Object.keys(expected).sort());
assert.equal(fs.readdirSync(directory).filter(name => /^sound-.*\.mp3$/.test(name)).length, 47);
for (const item of manifest.items) {
  assert.equal(item.sourceSyllable, expected[item.symbol], `${item.symbol}: correct phonetic source`);
  assert.equal(item.file, `/audio/pinyin/sound-${item.symbol.replaceAll("ü", "v")}.mp3`);
  assert.equal(item.sourceUrl, `https://raw.githubusercontent.com/hugolpz/audio-cmn/${manifest.sourceRevision}/64k/syllabs/cmn-${item.sourceSyllable}.mp3`);
  const buffer = fs.readFileSync(path.join(root, "public", item.file));
  assert.equal(buffer.length, item.bytes);
  assert.ok(buffer.length > 4000 && buffer.length < 50000, `${item.symbol}: plausible recording size`);
  assert.equal(digest(buffer), item.sha256, `${item.symbol}: file integrity`);
  assert.ok(item.duration > 0.4 && item.duration < 2, `${item.symbol}: usable recording duration`);
  const tags = recordingTags(buffer);
  assert.equal(tags.SWAC_COLL_LICENSE, "CC-BY-SA-3.0", `${item.symbol}: recording-level license`);
  assert.equal(item.license, tags.SWAC_COLL_LICENSE);
  assert.equal(tags.SWAC_SPEAK_NAME, "Chen Wang 王琛");
  assert.equal(tags.SWAC_COLL_AUTHORS, "Wang Chen, Lopez Hugo, Vion Nicolas");
  assert.equal(tags.SWAC_COLL_COPYRIGHT, "Copyright© 2013 Wang Chen, Lopez Hugo, Vion Nicolas");
  assert.equal(tags.SWAC_TEXT, item.sourceSyllable);
  for (const [name, value] of Object.entries(item.sourceId3)) assert.equal(tags[name], value, `${item.symbol}: preserve source tag ${name}`);
  if (item.symbol === "ong") {
    const original = fs.readFileSync(path.join(directory, "sources/cmn-dong1.mp3"));
    assert.equal(digest(original), item.sourceSha256);
    assert.notEqual(item.sha256, item.sourceSha256, "ong must omit the source consonant");
    assert.equal(recordingTags(original).SWAC_TEXT, "dong1");
    assert.equal(item.modification.source, "cmn-dong1.mp3");
    assert.equal(item.modification.startSeconds, 0.370);
    assert.equal(item.modification.fadeInSeconds, 0.008);
    assert.equal(item.modification.leadingSilenceSeconds, 0.120);
    assert.deepEqual(JSON.parse(tags.CHENCHEN_ADAPTATION), item.modification);
  } else {
    assert.equal(item.sha256, item.sourceSha256, `${item.symbol}: unchanged recording`);
  }
}
assert.match(fs.readFileSync(path.join(directory, "SOUND-LICENSE.md"), "utf8"), /CC BY-SA 3\.0/);
assert.match(fs.readFileSync(path.join(directory, "CC-BY-SA-3.0.txt"), "utf8"), /Attribution-ShareAlike 3\.0 Unported/);
assert.match(fs.readFileSync(path.join(directory, "sources/audio-cmn-README.md"), "utf8"), /Chen Wang/);
console.log("PASS 47 recorded pinyin sounds: inventory, phonetic mapping, hashes, MP3 payload, recording licenses, attribution and documented ong excerpt");
