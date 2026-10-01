/* Verify bundled poem playback, cancellation, failure behavior, and short guides. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

const source = fs.readFileSync(path.join(__dirname, "../public/speech.js"), "utf8");

function createHarness({ noSynthesis = false, noAudio = false } = {}) {
  let clock = 0;
  let timerId = 0;
  const timers = new Map();
  const waiting = [];
  const spoken = [];
  let active = null;
  const recordings = [];
  class FakeAudio {
    constructor() {
      this.currentTime = 0;
      this.playCount = 0;
      this.pauseCount = 0;
      this.rejections = [];
      recordings.push(this);
    }
    play() {
      this.playCount++;
      this.paused = false;
      return { catch: callback => this.rejections.push(callback) };
    }
    pause() { this.pauseCount++; this.paused = true; }
    load() { this.currentTime = 0; }
    removeAttribute(name) { delete this[name]; }
    emit(name) { if (this["on" + name]) this["on" + name](); }
  }
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
    window: { ...(noSynthesis ? {} : { speechSynthesis: engine }), ...(noAudio ? {} : { Audio: FakeAudio }) },
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
    recordings,
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

{
  const h = createHarness({ noSynthesis: true });
  const states = [];
  assert.equal(h.api.supported({ id: "poem-01" }), true, "Poem audio must work without speechSynthesis");
  assert.equal(h.api.speakPoem({ id: "poem-01" }, { onState: state => states.push(state) }), true);
  const audio = h.recordings[0];
  assert.equal(audio.src, "/audio/poems/poem-01.mp3");
  assert.equal(h.api.getStatus(), "loading");
  audio.emit("playing");
  audio.currentTime = 4.5;
  h.api.pause();
  assert.equal(h.api.getStatus(), "paused");
  h.advance(30000);
  assert.equal(h.api.getStatus(), "paused", "Pausing also cancels the loading timeout");
  h.api.resume();
  assert.equal(audio.currentTime, 4.5, "Resume must retain the recording position");
  assert.equal(audio.playCount, 2);
  audio.emit("playing");
  audio.emit("ended");
  assert.equal(h.api.getStatus(), "idle");
  assert.equal(audio.src, undefined, "Completed audio should release its media request");
  assert.deepEqual(h.spoken, []);
  assert.deepEqual(states, ["loading", "speaking", "paused", "loading", "speaking", "idle"]);
  console.log("PASS: poem playback, pause, resume, and completion without system speech");
}

{
  const h = createHarness();
  const errors = [];
  h.api.speakPoem({ id: "poem-01" }, { onError: e => errors.push(e) });
  const oldAudio = h.recordings[0];
  const oldPlaying = oldAudio.onplaying;
  const oldEnded = oldAudio.onended;
  h.api.speakPoem({ id: "poem-10" }, { onError: e => errors.push(e) });
  const newAudio = h.recordings[1];
  oldAudio.rejections[0]({ name: "AbortError" });
  oldPlaying(); oldEnded();
  assert.equal(h.api.getStatus(), "loading", "Late events from a stopped poem must not change the new poem");
  assert.equal(oldAudio.paused, true);
  assert.equal(oldAudio.src, undefined);
  newAudio.emit("playing");
  h.api.stop();
  assert.equal(newAudio.paused, true);
  assert.equal(h.api.getStatus(), "idle");
  h.advance(30000);
  assert.deepEqual(errors, []);
  assert.deepEqual(h.spoken, []);
  console.log("PASS: switching and stopping cancel old audio and ignore stale events");
}

{
  const h = createHarness();
  const errors = [];
  h.api.speakPoem({ id: "poem-15" }, { onError: e => errors.push(e) });
  const audio = h.recordings[0];
  h.api.pause();
  h.api.resume();
  audio.rejections[0]({ name: "AbortError" });
  assert.equal(h.api.getStatus(), "loading", "An aborted earlier play() must not cancel resume()");
  audio.emit("playing");
  assert.deepEqual(errors, []);
  audio.emit("error");
  assert.equal(h.api.getStatus(), "idle");
  assert.deepEqual(errors, ["audio-unavailable"]);
  assert.deepEqual(h.spoken, [], "Failed poem audio must never fall back to system speech");
  console.log("PASS: pause during loading and explicit audio failure without system fallback");
}

{
  const h = createHarness();
  const errors = [];
  h.api.speakPoem({ id: "poem-20" }, { onError: e => errors.push(e) });
  h.advance(20001);
  assert.equal(h.api.getStatus(), "idle");
  assert.deepEqual(errors, ["audio-load-timeout"]);
  h.api.speakPoem({ id: "poem-20" }, { onError: e => errors.push(e) });
  h.recordings[1].rejections[0]({ name: "NotAllowedError" });
  assert.equal(h.api.getStatus(), "idle");
  assert.deepEqual(errors, ["audio-load-timeout", "audio-playback-blocked"]);
  assert.deepEqual(h.spoken, []);
  console.log("PASS: loading timeout and browser playback rejection return to idle");
}

{
  const h = createHarness({ noAudio: true });
  let unsupported = 0;
  assert.equal(h.api.supported({ id: "poem-01" }), false);
  assert.equal(h.api.speakPoem({ id: "poem-01" }, { onUnsupported: () => unsupported++ }), false);
  assert.equal(unsupported, 1);
  assert.deepEqual(h.spoken, []);
  h.api.speakPoem({ lines: ["一起读一读"] });
  h.advance(60);
  h.api.pause();
  h.api.speakPoem({ lines: ["准备好了吗"] });
  h.advance(60);
  assert.deepEqual(h.spoken, ["一起读一读", "准备好了吗"], "A new guide must unpause a previously paused native engine");
  console.log("PASS: no poem fallback on unsupported devices; system guidance still works");
}

{
  const publicDir = path.join(__dirname, "../public");
  const poems = JSON.parse(fs.readFileSync(path.join(publicDir, "data/poems.json"), "utf8"));
  const manifest = JSON.parse(fs.readFileSync(path.join(publicDir, "data/poem-audio.json"), "utf8"));
  assert.equal(Object.keys(manifest).length, poems.length);
  for (const poem of poems) {
    const entry = manifest[poem.id];
    assert.ok(entry, `Missing audio for ${poem.title}`);
    assert.equal(entry.src, `/audio/poems/${poem.id}.mp3`);
    assert.equal(entry.synthetic, true, "Generated speech must be labeled honestly");
    const bytes = fs.readFileSync(path.join(publicDir, entry.src));
    assert.equal(bytes.length, entry.bytes);
    assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), entry.sha256);
    assert.ok(entry.durationSeconds > 3 && entry.durationSeconds < 100);
  }
  const pronunciation = (id, c, p) => manifest[id].pronunciationCorrections.some(x => x.character === c && x.pinyin === p);
  for (const [id, character, pinyin] of [["poem-01", "朝", "zhāo"], ["poem-01", "还", "huán"], ["poem-01", "重", "chóng"], ["poem-09", "查", "zhā"], ["poem-10", "行", "háng"], ["poem-15", "见", "xiàn"], ["poem-20", "应", "yìng"]]) {
    assert.ok(pronunciation(id, character, pinyin), `Missing pronunciation correction: ${character} ${pinyin}`);
  }
  console.log(`PASS: all ${poems.length} bundled recordings are complete, fingerprinted, and contain key pronunciation corrections`);
}
