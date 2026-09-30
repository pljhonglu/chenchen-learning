/* Exercise the public speech API against a paused native synthesis engine. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../public/speech.js"), "utf8");

function createHarness() {
  let clock = 0;
  let timerId = 0;
  const timers = new Map();
  const waiting = [];
  const spoken = [];
  let active = null;
  const engine = {
    paused: false,
    getVoices: () => [],
    speak(utterance) {
      waiting.push(utterance);
      startNext();
    },
    pause() { this.paused = true; },
    resume() {
      this.paused = false;
      startNext();
    },
    cancel() {
      active = null;
      waiting.length = 0;
    },
  };
  function startNext() {
    if (engine.paused || active || !waiting.length) return;
    active = waiting.shift();
    spoken.push(active.text);
  }
  const context = {
    window: { speechSynthesis: engine },
    SpeechSynthesisUtterance: class {
      constructor(text) { this.text = text; }
    },
    setTimeout(callback, delay) {
      const id = ++timerId;
      timers.set(id, { callback, at: clock + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  };
  vm.runInNewContext(source, context, { filename: "speech.js" });
  return {
    api: context.window.ChenchenSpeech,
    engine,
    spoken,
    advance(ms) {
      const until = clock + ms;
      while (true) {
        const ready = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!ready || ready[1].at > until) break;
        timers.delete(ready[0]);
        clock = ready[1].at;
        ready[1].callback();
      }
      clock = until;
    },
    finish() {
      assert.ok(active, "An utterance must be speaking before it finishes");
      assert.equal(engine.paused, false, "A paused utterance cannot finish");
      const ended = active;
      active = null;
      ended.onend();
    },
  };
}

{
  const h = createHarness();
  h.api.speakPoem({ lines: ["第一句", "第二句"] });
  h.advance(60);
  assert.deepEqual(h.spoken, ["第一句"]);
  h.finish();
  h.advance(100);
  h.api.pause();
  assert.equal(h.api.getStatus(), "paused");
  assert.equal(h.engine.paused, true);
  h.advance(1000);
  assert.deepEqual(h.spoken, ["第一句"], "The sentence gap timer must stay stopped while paused");
  h.api.resume();
  assert.equal(h.engine.paused, false, "Resume must unpause the native engine between sentences");
  assert.deepEqual(h.spoken, ["第一句", "第二句"], "The next sentence must actually begin after resuming");
  assert.equal(h.api.getStatus(), "speaking");
  h.finish();
  h.advance(420);
  assert.equal(h.api.getStatus(), "idle");
  console.log("PASS: pause and resume between sentences");
}

{
  const h = createHarness();
  h.api.speakPoem({ lines: ["第一句", "第二句"] });
  h.advance(60);
  h.api.pause();
  assert.equal(h.engine.paused, true);
  assert.equal(h.api.getStatus(), "paused");
  h.advance(1000);
  assert.deepEqual(h.spoken, ["第一句"]);
  h.api.resume();
  assert.equal(h.engine.paused, false);
  assert.equal(h.api.getStatus(), "speaking");
  assert.deepEqual(h.spoken, ["第一句"], "Resuming the active sentence must not enqueue another sentence");
  h.finish();
  h.advance(420);
  assert.deepEqual(h.spoken, ["第一句", "第二句"]);
  h.finish();
  h.advance(420);
  assert.equal(h.api.getStatus(), "idle");
  console.log("PASS: pause and resume an active sentence");
}
