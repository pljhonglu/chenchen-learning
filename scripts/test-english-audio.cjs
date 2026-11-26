#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../public/english-audio.js"), "utf8");

const clips = {
  "english-cat-word": { src: "/audio/english/english-cat-word.mp3" },
  "english-cat-sentence": { src: "/audio/english/english-cat-sentence.mp3" },
  "guide-listen": { src: "/audio/english/guide-listen.mp3" }
};
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
function harness(options = {}) {
  let now = 0, timerId = 0;
  const timers = new Map();
  const recordings = [], playbacks = [], requests = [], states = [], errors = [];
  class MockAudio {
    constructor() { this.playCalls = 0; this.pauseCalls = 0; this.loadCalls = 0; recordings.push(this); }
    play() {
      this.playCalls++;
      playbacks.push({recording:this,src:this.src});
      if (options.play) return options.play(this);
      if (this.onplaying) this.onplaying();
      return Promise.resolve();
    }
    pause() { this.pauseCalls++; }
    load() { this.loadCalls++; }
    removeAttribute(attribute) { if (attribute === "src") this.src = ""; }
    emit(event) { if (this["on" + event]) this["on" + event](); }
  }
  const context = {
    Audio: options.unsupported ? undefined : MockAudio,
    AbortController,
    fetch(url, init) {
      requests.push({ url, init });
      return options.fetch ? options.fetch(url, init, requests.length) : Promise.resolve({ ok: true, json: async () => options.manifest || clips });
    },
    setTimeout(callback, ms) { const id = ++timerId; timers.set(id, { at: now + ms, callback }); return id; },
    clearTimeout(id) { timers.delete(id); },
    Date: class extends Date { static now() { return now; } },
    speechSynthesis: { speak() { throw new Error("Device speech must never be used."); } }
  };
  vm.runInNewContext(source, context, { filename: "english-audio.js" });
  const makePlayer = callbacks => context.ChenchenEnglishAudio.create({
    onState: status => states.push(status), onError: code => errors.push(code), ...callbacks
  });
  const player = makePlayer();
  async function advance(ms) {
    const end = now + ms;
    await flush();
    while (true) {
      const scheduled = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!scheduled) break;
      const [id, timer] = scheduled;
      timers.delete(id);
      now = timer.at;
      timer.callback();
      await flush();
    }
    now = end;
    await flush();
  }
  return { player, makePlayer, recordings, playbacks, requests, states, errors, timers, advance };
}

test("plays all recordings in order with a gap and only completes after the final clip", async () => {
  const h = harness();
  let ended = 0, settled = false;
  const result = h.player.play(["guide-listen", "english-cat-word", "english-cat-sentence"], { onEnd: () => ended++ });
  result.then(() => { settled = true; });
  await flush();
  assert.equal(h.recordings[0].src, clips["guide-listen"].src);
  assert.equal(h.player.getStatus(), "speaking");
  h.recordings[0].emit("ended");
  assert.equal(h.recordings[0].src, "");
  await h.advance(399);
  assert.equal(h.playbacks.length, 1);
  assert.equal(settled, false);
  await h.advance(1);
  assert.equal(h.recordings[0].src, clips["english-cat-word"].src);
  h.recordings[0].emit("ended");
  await h.advance(400);
  assert.equal(h.recordings[0].src, clips["english-cat-sentence"].src);
  h.recordings[0].emit("ended");
  assert.equal(await result, true);
  assert.equal(ended, 1);
  assert.equal(h.player.getStatus(), "idle");
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.errors, []);
});

test("interrupting a sequence resolves it false and ignores its late media events and rejections", async () => {
  const oldPlayback = deferred();
  const h = harness({ play: recording => {
    recording.emit("playing");
    return recording.playCalls === 1 ? oldPlayback.promise : Promise.resolve();
  } });
  let oldEnded = 0, newEnded = 0;
  const first = h.player.play("english-cat-word", { onEnd: () => oldEnded++ });
  await flush();
  const staleEnd = h.recordings[0].onended;
  const staleError = h.recordings[0].onerror;
  const second = h.player.play("english-cat-sentence", { onEnd: () => newEnded++ });
  await flush();
  assert.equal(await first, false);
  staleEnd();
  staleError();
  oldPlayback.reject(new Error("aborted old media"));
  await flush();
  assert.equal(h.player.getStatus(), "speaking");
  assert.deepEqual(h.errors, []);
  assert.equal(oldEnded, 0);
  h.recordings[0].emit("ended");
  assert.equal(await second, true);
  assert.equal(newEnded, 1);
});

test("pause during a gap preserves the remaining gap and never skips the next clip", async () => {
  const h = harness();
  const result = h.player.play(["english-cat-word", "english-cat-sentence"]);
  await flush();
  h.recordings[0].emit("ended");
  await h.advance(150);
  h.player.pause();
  assert.equal(h.player.getStatus(), "paused");
  await h.advance(50000);
  assert.equal(h.playbacks.length, 1);
  h.player.resume();
  await h.advance(249);
  assert.equal(h.playbacks.length, 1);
  await h.advance(1);
  assert.equal(h.playbacks.length, 2);
  h.recordings[0].emit("ended");
  assert.equal(await result, true);
});

test("pause during playback suppresses the interrupted play rejection and resumes the same clip", async () => {
  const pending = deferred();
  const h = harness({ play: recording => {
    if (recording.playCalls === 1) return pending.promise;
    recording.emit("playing");
    return Promise.resolve();
  } });
  const result = h.player.play("english-cat-word");
  await flush();
  h.player.pause();
  pending.reject(Object.assign(new Error("pause interrupted play"), { name: "AbortError" }));
  await h.advance(50000);
  assert.equal(h.player.getStatus(), "paused");
  assert.deepEqual(h.errors, []);
  h.player.resume();
  assert.equal(h.recordings.length, 1);
  assert.equal(h.recordings[0].playCalls, 2);
  assert.equal(h.player.getStatus(), "speaking");
  h.recordings[0].emit("ended");
  assert.equal(await result, true);
});

test("pause while the manifest loads prevents playback until resume", async () => {
  const request = deferred();
  const h = harness({ fetch: () => request.promise });
  const result = h.player.play("english-cat-word");
  h.player.pause();
  request.resolve({ ok: true, json: async () => clips });
  await flush();
  assert.equal(h.recordings.length, 0);
  assert.equal(h.player.getStatus(), "paused");
  h.player.resume();
  assert.equal(h.recordings.length, 1);
  h.recordings[0].emit("ended");
  assert.equal(await result, true);
});

test("switching views stops pending or active audio without completion or delayed playback", async () => {
  const request = deferred();
  const h = harness({ fetch: () => request.promise });
  let ended = 0;
  const result = h.player.play("english-cat-word", { onEnd: () => ended++ });
  h.player.stop();
  assert.equal(await result, false);
  request.resolve({ ok: true, json: async () => clips });
  await flush();
  assert.equal(h.recordings.length, 0);
  const next = h.player.play(["english-cat-word", "english-cat-sentence"], { onEnd: () => ended++ });
  await flush();
  h.recordings[0].emit("ended");
  h.player.stop();
  await h.advance(50000);
  assert.equal(await next, false);
  assert.equal(h.recordings.length, 1);
  assert.equal(ended, 0);
  assert.equal(h.player.getStatus(), "idle");
  assert.equal(h.timers.size, 0);
});

test("blocked playback fails once and waits for an explicit replay tap", async () => {
  let attempts = 0;
  const h = harness({ play: recording => {
    attempts++;
    if (attempts === 1) return Promise.reject(Object.assign(new Error("gesture required"), { name: "NotAllowedError" }));
    recording.emit("playing");
    return Promise.resolve();
  } });
  assert.equal(await h.player.play("english-cat-word"), false);
  assert.equal(h.player.getStatus(), "error");
  assert.deepEqual(h.errors, ["audio-playback-blocked"]);
  await h.advance(50000);
  assert.equal(attempts, 1);
  assert.equal(h.recordings[0].src, "");
  const retry = h.player.play("english-cat-word");
  await flush();
  h.recordings[0].emit("ended");
  assert.equal(await retry, true);
  assert.equal(attempts, 2);
});

test("manifest failure is bounded and can recover on a later explicit request", async () => {
  const h = harness({ fetch: (_url, _options, attempt) => attempt === 1
    ? Promise.reject(new Error("offline")) : Promise.resolve({ ok: true, json: async () => clips }) });
  assert.equal(await h.player.play("english-cat-word"), false);
  assert.deepEqual(h.errors, ["audio-manifest-unavailable"]);
  await h.advance(50000);
  assert.equal(h.requests.length, 1);
  assert.equal(await h.player.preload(), true);
  assert.equal(h.requests.length, 2);
  const retry = h.player.play("english-cat-word");
  await flush();
  assert.equal(h.requests.length, 2);
  h.recordings[0].emit("ended");
  assert.equal(await retry, true);
});

test("shared preloading deduplicates the manifest request across players", async () => {
  const h = harness();
  const other = h.makePlayer();
  assert.deepEqual(await Promise.all([h.player.preload(), other.preload()]), [true, true]);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, "/data/english-audio.json");
});

test("a hung manifest request times out and aborts without automatic retries", async () => {
  const h = harness({ fetch: () => new Promise(() => {}) });
  const result = h.player.play("english-cat-word");
  await h.advance(20000);
  assert.equal(await result, false);
  assert.equal(h.requests[0].init.signal.aborted, true);
  assert.deepEqual(h.errors, ["audio-manifest-unavailable"]);
  assert.equal(h.requests.length, 1);
  assert.equal(h.timers.size, 0);
});

test("media loading and buffering failures time out and release audio", async () => {
  const h = harness({ play: () => new Promise(() => {}) });
  const result = h.player.play("english-cat-word");
  await flush();
  await h.advance(20000);
  assert.equal(await result, false);
  assert.deepEqual(h.errors, ["audio-load-timeout"]);
  assert.equal(h.recordings[0].src, "");
  assert.equal(h.timers.size, 0);

  const retry = h.player.play("english-cat-word");
  await flush();
  h.recordings[0].emit("playing");
  h.recordings[0].emit("waiting");
  await h.advance(20000);
  assert.equal(await retry, false);
  assert.deepEqual(h.errors, ["audio-load-timeout", "audio-load-timeout"]);
});

test("all requested keys are checked before playing any partial sequence", async () => {
  const h = harness();
  assert.equal(await h.player.play(["english-cat-word", "missing-guide"]), false);
  assert.equal(h.recordings.length, 0);
  assert.deepEqual(h.errors, ["audio-not-found"]);
});

test("malformed or remote recording paths cannot be loaded", async () => {
  for (const src of ["https://external.example/cat.mp3", "//external.example/cat.mp3", "/audio/english/../cat.mp3", "/audio/english/%2e%2e/cat.mp3", "/audio/english//cat.mp3", "/audio/poems/cat.mp3", "/audio/english/cat.mp3?redirect=elsewhere"]) {
    const h = harness({ manifest: { "english-cat-word": { src } } });
    assert.equal(await h.player.play("english-cat-word"), false, src);
    assert.deepEqual(h.errors, ["audio-manifest-invalid"], src);
    assert.equal(h.recordings.length, 0, src);
  }
});

test("media errors and unsupported devices do not use system speech", async () => {
  const h = harness();
  const result = h.player.play("english-cat-word");
  await flush();
  h.recordings[0].emit("error");
  assert.equal(await result, false);
  assert.deepEqual(h.errors, ["audio-unavailable"]);
  const unsupported = harness({ unsupported: true });
  assert.equal(await unsupported.player.play("english-cat-word"), false);
  assert.deepEqual(unsupported.errors, ["audio-unsupported"]);
  assert.equal(unsupported.requests.length, 0);
});

test("a replay tap uses its direct activation and later clips reuse the permitted media element", async () => {
  let gesture = false;
  const allowed = new Set();
  const h = harness({ play: recording => {
    if (gesture) allowed.add(recording);
    if (!allowed.has(recording)) return Promise.reject(Object.assign(new Error("gesture required"), { name: "NotAllowedError" }));
    recording.emit("playing");
    return Promise.resolve();
  } });
  assert.equal(await h.player.preload(), true);
  // Opening a lesson asynchronously may be blocked on Safari. A replay tap
  // must call media.play synchronously, then preserve permission for the queue.
  assert.equal(await h.player.play("english-cat-word"), false);
  gesture = true;
  const result = h.player.play(["guide-listen", "english-cat-word"]);
  gesture = false;
  await flush();
  assert.equal(h.player.getStatus(), "speaking");
  h.recordings[0].emit("ended");
  await h.advance(400);
  assert.equal(h.player.getStatus(), "speaking");
  assert.equal(h.recordings.length, 1);
  assert.equal(h.playbacks.length, 3);
  h.recordings[0].emit("ended");
  assert.equal(await result, true);
  assert.deepEqual(h.errors, ["audio-playback-blocked"]);
});

test("reusing the media element ignores a stale event from its previous clip", async () => {
  const h = harness();
  let ended = 0;
  const result = h.player.play(["guide-listen", "english-cat-word"], { onEnd: () => ended++ });
  await flush();
  const previousEnded = h.recordings[0].onended;
  const previousError = h.recordings[0].onerror;
  h.recordings[0].emit("ended");
  await h.advance(400);
  previousEnded();
  previousError();
  assert.equal(ended, 0);
  assert.equal(h.player.getStatus(), "speaking");
  assert.deepEqual(h.errors, []);
  h.recordings[0].emit("ended");
  assert.equal(await result, true);
  assert.equal(ended, 1);
});
