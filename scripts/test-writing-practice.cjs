/* Exercise the real bundled matcher through Pointer Events, not a mocked verdict. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const publicDir = path.join(__dirname, "../public");
const engineSource = fs.readFileSync(path.join(publicDir, "vendor/hanzi-writer-3.7.3.min.js"), "utf8");
const practiceSource = fs.readFileSync(path.join(publicDir, "writing-practice.js"), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

function harness({ character = "大", showOutline = true, fetchGate, fetchFailure, rect = { left: 0, top: 0, width: 300, height: 300 } } = {}) {
  const states = [], mistakes = [], correct = [], completions = [], errors = [], urls = [];
  const frames = new Map();
  let frameId = 0, clock = 0, documentListeners = 0;
  const doc = {
    createElementNS: (_ns, name) => new Element(name),
    addEventListener() { documentListeners++; }, removeEventListener() { documentListeners--; },
  };
  class Element {
    constructor(name) {
      this.nodeName = name; this.children = []; this.attrs = {}; this.ownerDocument = doc; this.listeners = new Map();
      this.style = { removeProperty(key) { delete this[key]; } };
    }
    appendChild(child) { if (child.parentNode) child.parentNode.removeChild(child); child.parentNode = this; this.children.push(child); return child; }
    removeChild(child) { this.children = this.children.filter(value => value !== child); child.parentNode = null; }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    setAttributeNS(_ns, key, value) { this.setAttribute(key, value); }
    getBoundingClientRect() { return rect; }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
    removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
    setPointerCapture(id) { this.captured = id; }
    releasePointerCapture(id) { if (this.captured === id) this.captured = null; }
    emit(name, values = {}) {
      const event = { pointerId: 1, isPrimary: true, button: 0, timeStamp: ++clock, preventDefault() {}, ...values };
      for (const fn of this.listeners.get(name) || []) fn(event);
    }
  }
  const data = JSON.parse(fs.readFileSync(path.join(publicDir, "data/strokes/" + character.codePointAt(0).toString(16) + ".json"), "utf8"));
  const window = {
    document: doc, AbortController, performance: { now: () => clock },
    requestAnimationFrame(fn) { const id = ++frameId; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    async fetch(url, options) {
      urls.push(url);
      if (fetchGate) await fetchGate.promise;
      if (options.signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      if (fetchFailure) return { ok: false, status: 404 };
      return { ok: true, json: async () => data };
    },
  };
  const context = vm.createContext({ window, document: doc, performance: window.performance, setTimeout, clearTimeout });
  vm.runInContext(engineSource, context, { filename: "hanzi-writer-3.7.3.min.js" });
  window.HanziWriter = context.HanziWriter;
  vm.runInContext(practiceSource, context, { filename: "writing-practice.js" });
  const target = new Element("div");
  const player = window.ChenchenWritingPractice.create({
    target, character, showOutline,
    onState: state => states.push(state), onMistake: stroke => mistakes.push(stroke),
    onCorrectStroke: stroke => correct.push(stroke), onComplete: result => completions.push(result),
    onError: (code, cause) => errors.push({ code, cause }),
  });
  const svg = target.children[0];
  const transform = window.HanziWriter.getScalingTransform(300, 300, 26);
  function screen(point) {
    const scale = Math.min(rect.width, rect.height) / 300;
    return {
      clientX: rect.left + (rect.width - 300 * scale) / 2 + (transform.x + point[0] * transform.scale) * scale,
      clientY: rect.top + (rect.height - 300 * scale) / 2 + (300 - transform.y - point[1] * transform.scale) * scale,
    };
  }
  function stroke(points, extra = {}) {
    svg.emit("pointerdown", { ...screen(points[0]), ...extra });
    points.slice(1).forEach(point => svg.emit("pointermove", { ...screen(point), ...extra }));
    svg.emit("pointerup", { ...screen(points.at(-1)), ...extra });
  }
  async function flushFrames() {
    for (let count = 0; count < 20; count++) {
      await tick();
      if (!frames.size) return;
      clock += 10000;
      const pending = [...frames.entries()]; frames.clear();
      pending.forEach(([, fn]) => fn(clock));
    }
    throw new Error("Animations failed to settle");
  }
  return { player, target, svg, data, states, mistakes, correct, completions, errors, urls, screen, stroke, flushFrames, frames, get documentListeners() { return documentListeners; } };
}

(async () => {
  let passed = 0;
  {
    const h = harness();
    assert.equal(await h.player.ready, true);
    assert.equal(h.player.getState().status, "active");
    assert.deepEqual(h.urls, ["/data/strokes/5927.json"]);
    assert.equal(h.documentListeners, 0, "No permanent global mouse/touch listeners");
    for (const median of h.data.medians) { h.stroke(median); await tick(); }
    assert.equal(h.player.getState().completed, 3);
    assert.equal(h.player.getState().status, "complete");
    assert.equal(h.completions.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(h.completions[0])), { totalStrokes: 3, completedStrokes: 3, totalMistakes: 0, hintsUsed: 0, outlineShown: true, engine: "hanzi-writer-3.7.3", method: "stroke-quiz" });
    assert.ok(h.player.getAttempts()[0].drawnPath.pathString.startsWith("M"));
    assert.equal(h.player.getAttempts()[0].rawPoints.length, h.data.medians[0].length);
    const copy = h.player.getAttempts(); copy[0].rawPoints.length = 0;
    assert.ok(h.player.getAttempts()[0].rawPoints.length > 0, "Callers cannot alter stored input evidence");
    h.stroke(h.data.medians[0]);
    assert.equal(h.completions.length, 1, "Completed quizzes are closed to additional input");
    h.player.destroy(); await tick(); passed++;
  }
  {
    const h = harness(); await h.player.ready;
    h.stroke([...h.data.medians[0]].reverse());
    assert.equal(h.mistakes.length, 1);
    assert.equal(h.mistakes[0].isBackwards, true, "Reject a reversed but otherwise perfect stroke");
    h.stroke(h.data.medians[1]);
    assert.equal(h.mistakes.length, 2, "Reject the correct shape in the wrong order");
    const first = h.data.medians[0][0];
    h.stroke([first, [first[0] + 5, first[1]]]);
    assert.equal(h.mistakes.length, 3, "Reject a tiny mark");
    assert.equal(h.player.getState().hintsUsed, 1, "Three mistakes trigger a counted hint");
    await h.flushFrames();
    for (let index = 0; index < 8; index++) h.stroke([...h.data.medians[0]].reverse());
    assert.equal(h.player.getState().completed, 0, "Repeated misses must never force acceptance");
    assert.equal(h.player.getState().totalMistakes, 11);
    h.stroke(h.data.medians[0]);
    assert.equal(h.player.getState().completed, 1);
    h.player.destroy(); await tick(); passed++;
  }
  {
    const h = harness({ character: "口" }); await h.player.ready;
    h.stroke(h.data.medians[0]); await tick();
    const fold = h.data.medians[1];
    h.stroke([fold[0], fold.at(-1)]);
    assert.equal(h.player.getState().completed, 1, "A straight diagonal cannot replace the horizontal turn");
    assert.equal(h.mistakes.length, 1);
    h.stroke(fold); await tick();
    assert.equal(h.player.getState().completed, 2);
    h.player.destroy(); await tick(); passed++;
  }
  {
    const h = harness(); await h.player.ready;
    const median = h.data.medians[0];
    h.svg.emit("pointerdown", h.screen(median[0]));
    h.svg.emit("pointermove", h.screen(median[1]));
    h.svg.emit("pointercancel");
    h.svg.emit("pointerup", h.screen(median.at(-1)));
    assert.equal(h.player.getAttempts().length, 0, "Canceled gestures never count as an attempt");
    h.svg.emit("pointerdown", h.screen(median[0]));
    h.stroke(h.data.medians[1], { pointerId: 2, isPrimary: false });
    median.slice(1).forEach(point => h.svg.emit("pointermove", h.screen(point)));
    h.svg.emit("pointerup", h.screen(median.at(-1)));
    assert.equal(h.player.getState().completed, 1, "A second finger cannot corrupt the active stroke");
    assert.equal(h.player.getAttempts().length, 1);
    h.player.destroy(); await tick(); passed++;
  }
  {
    const h = harness(); await h.player.ready;
    h.stroke(h.data.medians[0]); await tick();
    h.svg.emit("pointerdown", h.screen(h.data.medians[1][0]));
    h.svg.emit("pointermove", h.screen(h.data.medians[1][1]));
    assert.equal(h.player.pause(), true);
    assert.equal(h.player.getState().status, "paused");
    h.svg.emit("pointerup", h.screen(h.data.medians[1].at(-1)));
    h.stroke(h.data.medians[1]);
    assert.equal(h.player.getState().completed, 1);
    assert.equal(h.player.getState().totalMistakes, 0, "Pausing discards only the unfinished gesture");
    assert.equal(h.player.resume(), true);
    h.stroke(h.data.medians[1]);
    assert.equal(h.player.getState().completed, 2, "Resume preserves progress");
    h.player.destroy(); await tick(); passed++;
  }
  {
    const h = harness(); await h.player.ready;
    const median = h.data.medians[0];
    h.svg.emit("pointerdown", h.screen(median[0]));
    h.svg.emit("pointermove", h.screen(median[1]));
    const hint = h.player.showHint(); await h.flushFrames(); assert.equal(await hint, true);
    h.svg.emit("pointerup", h.screen(median.at(-1)));
    assert.equal(h.player.getAttempts().length, 0, "Requesting a hint discards the unfinished gesture");
    h.stroke(h.data.medians[0]);
    assert.equal(h.player.getState().hintsUsed, 1);
    h.player.pause();
    assert.equal(await h.player.restart({ showOutline: false }), true);
    assert.equal(h.player.getState().status, "active", "Restart resumes input after watching a demonstration");
    assert.equal(h.player.getState().completed, 0);
    assert.equal(h.player.getState().hintsUsed, 0);
    assert.equal(h.player.getState().outlineShown, false);
    assert.equal(h.player.getAttempts().length, 0);
    for (const median of h.data.medians) { h.stroke(median); await tick(); }
    assert.equal(h.completions[0].outlineShown, false);
    h.player.destroy(); await tick(); passed++;
  }
  {
    const h = harness({ rect: { left: 20, top: 40, width: 420, height: 240 } }); await h.player.ready;
    for (const median of h.data.medians) { h.stroke(median); await tick(); }
    assert.equal(h.player.getState().status, "complete", "Pointer coordinates follow CSS resize and SVG letterboxing");
    h.player.destroy(); await tick(); passed++;
  }
  {
    const fetchGate = deferred(); const h = harness({ fetchGate });
    h.player.destroy(); const stateCount = h.states.length;
    fetchGate.resolve(); assert.equal(await h.player.ready, false);
    assert.equal(h.states.length, stateCount, "Loading completion cannot notify after unmount");
    assert.equal(h.errors.length, 0);
    assert.equal(h.target.children.length, 0);
    assert.equal(h.player.getState().status, "destroyed");
    assert.equal([...h.svg.listeners.values()].reduce((sum, set) => sum + set.size, 0), 0);
    passed++;
  }
  {
    const h = harness(); await h.player.ready;
    const hint = h.player.showHint();
    await tick(); h.player.destroy(); await tick();
    const stateCount = h.states.length;
    await h.flushFrames();
    h.stroke(h.data.medians[0]);
    assert.equal(h.states.length, stateCount);
    assert.equal(h.correct.length, 0);
    assert.equal(h.frames.size, 0, "Unmount removes pointer listeners and stops animation frames");
    assert.equal(h.player.resume(), false);
    assert.equal(await h.player.restart(), false);
    assert.equal(await hint, false, "Unmount settles the outstanding hint promise");
    passed++;
  }
  {
    const h = harness({ fetchFailure: true });
    assert.equal(await h.player.ready, false);
    assert.equal(h.player.getState().status, "error");
    assert.equal(h.errors[0].code, "writing-data-unavailable");
    h.stroke(h.data.medians[0]);
    assert.equal(h.completions.length, 0);
    h.player.destroy(); passed++;
  }
  {
    const files = fs.readdirSync(path.join(publicDir, "data/strokes")).filter(name => /^[a-f0-9]+\.json$/.test(name));
    for (const file of files) {
      const character = String.fromCodePoint(parseInt(file, 16));
      const h = harness({ character });
      assert.equal(await h.player.ready, true, `${character}: local data loads`);
      for (let index = 0; index < h.data.medians.length; index++) {
        h.stroke(h.data.medians[index]); await tick();
        assert.equal(h.player.getState().completed, index + 1, `${character}: standard stroke ${index + 1} is accepted`);
      }
      assert.equal(h.completions.length, 1, `${character}: completes once`);
      h.player.destroy(); await tick();
    }
    assert.ok(files.length >= 150, "Exercise the full local writing curriculum");
    passed++;
  }
  console.log(`Writing practice: ${passed} real-matcher and lifecycle checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
