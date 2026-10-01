/* Every taught poem must ship its own usable, described illustration. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.join(__dirname, "../public");
const poems = JSON.parse(fs.readFileSync(path.join(root, "data/poems.json"), "utf8"));
const illustrations = JSON.parse(fs.readFileSync(path.join(root, "data/poem-illustrations.json"), "utf8"));
const seen = new Set();
for (const poem of poems) {
  const art = illustrations[poem.id];
  assert.ok(art, `${poem.title}: missing illustration`);
  assert.match(art.src, /^images\/poems\/poem-\d{2}\.webp$/);
  assert.equal(path.basename(art.src), `${poem.id}.webp`);
  assert.ok(typeof art.alt === "string" && art.alt.length > 5, `${poem.title}: missing alt description`);
  assert.ok(typeof art.hint === "string" && art.hint.length > 5, `${poem.title}: missing recall prompt`);
  const data = fs.readFileSync(path.join(root, art.src));
  assert.equal(data.subarray(0, 4).toString(), "RIFF", `${poem.title}: invalid WebP`);
  assert.equal(data.subarray(8, 12).toString(), "WEBP", `${poem.title}: invalid WebP`);
  assert.equal(data.readUInt32LE(4), data.length - 8, `${poem.title}: truncated image`);
  assert.ok(data.length > 4000 && data.length < 300_000, `${poem.title}: unexpected image size`);
  const hash = crypto.createHash("sha256").update(data).digest("hex");
  assert.ok(!seen.has(hash), `${poem.title}: another poem uses the same picture`);
  seen.add(hash);
}
assert.deepEqual(Object.keys(illustrations).sort(), poems.map(p => p.id).sort());
console.log(`PASS: ${poems.length} unique WebP illustrations, file integrity, alt text and recall prompts`);
