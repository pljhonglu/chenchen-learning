/* Playback ordering and cancellation checks; real SVG rendering is verified in the browser. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../public/writing-strokes.js"), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function harness({ fetchResult, fetchGate, strokeCount = 3, audioGate, audioError } = {}) {
  const events = [], urls = [], writers = [], states = [], errors = [];
  const doc = { createElementNS: (_ns, name) => new Element(name) };
  class Element {
    constructor(name) { this.name = name; this.children = []; this.attrs = {}; this.style = {}; this.ownerDocument = doc; }
    appendChild(child) { child.parent = this; this.children.push(child); return child; }
    replaceChildren(...children) { this.children = children; }
    setAttribute(key, value) { this.attrs[key] = value; }
    getBoundingClientRect() { return { width: 300, height: 300 }; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  }
  const data = { strokes: Array.from({ length: strokeCount }, (_, n) => `M ${n} 0 L 1 1 Z`), medians: Array.from({ length: strokeCount }, () => [[0, 0], [1, 1]]) };
  class FakeWriter {
    constructor(target, options) { this.target = target; this.options = options; this.pending = null; writers.push(this); }
    static getScalingTransform() { return { transform: "scale(1)" }; }
    async setCharacter(character) { this.character = character; this.options.charDataLoader(); }
    hideCharacter() { events.push("hide"); if (this.pending) { this.pending.resolve({ canceled: true }); this.pending = null; } return Promise.resolve(); }
    animateStroke(index) { events.push(`draw:${index + 1}`); this.pending = deferred(); return this.pending.promise; }
    finish() { const active = this.pending; assert.ok(active); this.pending = null; active.resolve({ canceled: false }); }
  }
  const target = new Element("div");
  const window = {
    document: doc, AbortController, HanziWriter: FakeWriter,
    async fetch(url, options) { urls.push(url); if (fetchGate) await fetchGate.promise; if (options.signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" }); return fetchResult || { ok: true, json: async () => data }; },
  };
  vm.runInNewContext(source, { window, setTimeout, clearTimeout }, { filename: "writing-strokes.js" });
  let signal;
  const player = window.ChenchenWritingStrokes.create({
    target, character: "大", onState: state => states.push(state), onError: (code, error) => errors.push({ code, error }),
    playStroke(index, nextSignal) { signal = nextSignal; events.push(`say:${index}`); if (audioError) return Promise.reject(new Error("Cannot play audio")); return audioGate ? audioGate.promise : Promise.resolve(); },
  });
  return { player, target, events, urls, writers, states, errors, get signal() { return signal; } };
}

(async () => {
  let passed = 0;
  {
    const h = harness();
    assert.equal(await h.player.ready, true);
    assert.deepEqual(h.urls, ["/data/strokes/5927.json"]);
    const step = h.player.next();
    assert.equal(h.events.at(-1), "say:1", "First step narration starts synchronously in the tap handler");
    await tick();
    assert.ok(h.events.indexOf("say:1") < h.events.indexOf("draw:1"));
    assert.equal(h.player.getState().status, "playing");
    h.writers[0].finish();
    assert.equal(await step, true);
    assert.equal(h.player.getState().completed, 1);
    assert.equal(h.player.getState().status, "paused");
    assert.equal(h.target.children[0].children.at(-1).children.length, 1);
    const second = h.player.next(); await tick(); h.writers[0].finish(); await second;
    assert.equal(h.player.getState().completed, 2);
    assert.equal(h.events.filter(value => value === "say:1").length, 1);
    h.player.destroy(); passed++;
  }
  {
    const h = harness({ strokeCount: 2 });
    await h.player.ready;
    const playback = h.player.play();
    assert.equal(h.events.at(-1), "say:1", "Full playback narration starts synchronously in the tap handler");
    await tick(); h.writers[0].finish();
    await new Promise(resolve => setTimeout(resolve, 320));
    assert.equal(h.events.at(-1), "draw:2");
    h.writers[0].finish();
    assert.equal(await playback, true);
    assert.equal(h.player.getState().status, "complete");
    assert.equal(h.player.getState().completed, 2);
    const replay = h.player.play(); await tick();
    assert.equal(h.player.getState().completed, 0);
    assert.equal(h.events.at(-1), "draw:1");
    h.player.stop(); assert.equal(await replay, false);
    h.player.destroy(); passed++;
  }
  {
    const h = harness(); await h.player.ready;
    const first = h.player.next(); await tick(); h.writers[0].finish(); await first;
    const second = h.player.next(); await tick();
    h.player.stop();
    assert.equal(await second, false);
    assert.equal(h.player.getState().completed, 1, "A half-finished stroke is not counted");
    assert.equal(h.target.children[0].children.at(-1).children.length, 1, "Finished stroke survives stopping");
    const retry = h.player.next(); await tick();
    assert.equal(h.events.at(-1), "draw:2", "Stopped stroke must be repeated");
    h.writers[0].finish(); await retry;
    h.player.restart();
    assert.equal(h.player.getState().completed, 0);
    assert.equal(h.target.children[0].children.at(-1).children.length, 0);
    h.player.destroy(); passed++;
  }
  {
    const audioGate = deferred();
    const h = harness({ audioGate }); await h.player.ready;
    const playback = h.player.play(); await tick();
    assert.equal(h.events.some(value => value.startsWith("draw")), false, "Wait for spoken number before drawing");
    h.player.destroy();
    assert.equal(h.signal.aborted, true, "Cancel audio on navigation");
    assert.equal(await playback, false);
    audioGate.resolve(); await tick();
    assert.equal(h.events.some(value => value.startsWith("draw")), false, "Late audio must not start old animation");
    assert.equal(h.target.children.length, 0);
    assert.equal(h.player.getState().status, "destroyed");
    passed++;
  }
  {
    const fetchGate = deferred();
    const h = harness({ fetchGate });
    assert.equal(await h.player.play(), false, "Do not start while loading");
    h.player.destroy(); fetchGate.resolve();
    assert.equal(await h.player.ready, false);
    assert.equal(h.writers.length, 0, "No renderer after navigation during loading");
    assert.equal(h.errors.length, 0);
    passed++;
  }
  {
    const h = harness({ audioError: true }); await h.player.ready;
    assert.equal(await h.player.play(), false);
    assert.equal(h.player.getState().status, "error");
    assert.equal(h.player.getState().completed, 0);
    assert.equal(h.errors[0].code, "stroke-playback-unavailable");
    assert.equal(h.events.some(value => value.startsWith("draw")), false);
    h.player.destroy(); passed++;
  }
  {
    const h = harness({ fetchResult: { ok: false, status: 404 } });
    assert.equal(await h.player.ready, false);
    assert.equal(h.errors[0].code, "stroke-data-unavailable");
    assert.equal(await h.player.next(), false);
    h.player.destroy(); passed++;
  }
  {
    const h = harness({ strokeCount: 21 });
    assert.equal(await h.player.ready, false);
    assert.equal(h.writers.length, 0, "Reject unsupported malformed/oversized data");
    h.player.destroy(); passed++;
  }
  {
    const h = harness(); await h.player.ready;
    const first = h.player.next(); await tick();
    assert.equal(await h.player.next(), false, "Ignore duplicate taps while playing");
    assert.equal(h.events.filter(value => value.startsWith("say")).length, 1);
    h.writers[0].finish(); await first;
    h.player.destroy(); passed++;
  }
  console.log(`Writing stroke player: ${passed} checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
