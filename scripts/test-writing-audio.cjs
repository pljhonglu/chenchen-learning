#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../public/writing-audio.js"), "utf8");

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function harness(options = {}) {
  let now = 0, nextTimer = 0;
  const timers = new Map();
  const recordings = [];
  class MockAudio {
    constructor() {
      this.listeners = new Map();
      this.playCalls = 0;
      this.pauseCalls = 0;
      this.loadCalls = 0;
      this.currentTime = 0;
      recordings.push(this);
    }
    addEventListener(name, listener) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name).add(listener);
    }
    removeEventListener(name, listener) { this.listeners.get(name)?.delete(listener); }
    emit(name) { for (const listener of [...(this.listeners.get(name) || [])]) listener(); }
    play() { this.playCalls++; return options.play ? options.play(this) : Promise.resolve(); }
    pause() { this.pauseCalls++; }
    load() { this.loadCalls++; }
    removeAttribute(attribute) { if (attribute === "src") this.src = ""; }
    listenerCount() { return [...this.listeners.values()].reduce((count, values) => count + values.size, 0); }
  }
  const context = {
    Audio: options.unsupported ? undefined : MockAudio,
    fetch() { throw new Error("Playback must not wait for a network manifest."); },
    setTimeout(callback, delay) {
      const id = ++nextTimer;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout(id) { timers.delete(id); }
  };
  vm.runInNewContext(source, context, { filename: "writing-audio.js" });
  const makePlayer = () => context.ChenchenWritingAudio.create();
  const player = makePlayer();
  async function advance(ms) {
    now += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now) { timers.delete(id); timer.callback(); }
    }
    await flush();
  }
  return { player, makePlayer, recordings, timers, advance };
}

class TrackedSignal {
  constructor() { this.aborted = false; this.listeners = new Set(); }
  addEventListener(name, listener) { assert.equal(name, "abort"); this.listeners.add(listener); }
  removeEventListener(name, listener) { assert.equal(name, "abort"); this.listeners.delete(listener); }
  abort() { this.aborted = true; for (const listener of [...this.listeners]) listener(); }
}

test("create preloads the first clip without playing, and playStroke calls play synchronously", async () => {
  const h = harness();
  const audio = h.recordings[0];
  assert.equal(h.recordings.length, 1);
  assert.equal(audio.src, "/audio/writing/stroke-01.mp3");
  assert.equal(audio.preload, "auto");
  assert.equal(audio.loadCalls, 1);
  assert.equal(audio.playCalls, 0);
  const result = h.player.playStroke(3);
  assert.equal(audio.src, "/audio/writing/stroke-03.mp3");
  assert.equal(audio.playCalls, 1);
  audio.emit("ended");
  await result;
});

test("only ended resolves a clip, and completion removes media, abort, and timer listeners", async () => {
  const h = harness();
  const signal = new TrackedSignal();
  let settled = false;
  const result = h.player.playStroke(1, signal).then(() => { settled = true; });
  await flush();
  assert.equal(settled, false, "play() success means playback started, not finished");
  assert.equal(signal.listeners.size, 1);
  h.recordings[0].emit("ended");
  await result;
  assert.equal(settled, true);
  assert.equal(h.recordings[0].listenerCount(), 0);
  assert.equal(signal.listeners.size, 0);
  assert.equal(h.timers.size, 0);
});

test("successive clips reuse the same Audio element including the twentieth stroke", async () => {
  const h = harness();
  const first = h.player.playStroke(1);
  h.recordings[0].emit("ended");
  await first;
  const last = h.player.playStroke(20);
  assert.equal(h.recordings.length, 1);
  assert.equal(h.recordings[0].src, "/audio/writing/stroke-20.mp3");
  h.recordings[0].emit("ended");
  await last;
  assert.equal(h.recordings[0].playCalls, 2);
});

test("abort rejects with AbortError, stops sound, and cleans up listeners", async () => {
  const h = harness();
  const signal = new TrackedSignal();
  const result = h.player.playStroke(2, signal);
  const rejection = assert.rejects(result, { name: "AbortError" });
  h.recordings[0].currentTime = 1;
  signal.abort();
  await rejection;
  assert.equal(h.recordings[0].currentTime, 0);
  assert.equal(h.recordings[0].pauseCalls, 2);
  assert.equal(h.recordings[0].listenerCount(), 0);
  assert.equal(signal.listeners.size, 0);
  assert.equal(h.timers.size, 0);
});

test("an already aborted signal never starts playback", async () => {
  const h = harness();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(h.player.playStroke(2, controller.signal), { name: "AbortError" });
  assert.equal(h.recordings[0].playCalls, 0);
  assert.equal(h.timers.size, 0);
});

test("stop rejects pending work and allows another explicit playback", async () => {
  const h = harness();
  const rejection = assert.rejects(h.player.playStroke(1), { name: "AbortError" });
  h.player.stop();
  await rejection;
  assert.equal(h.recordings[0].listenerCount(), 0);
  const result = h.player.playStroke(2);
  h.recordings[0].emit("ended");
  await result;
  assert.equal(h.timers.size, 0);
});

test("superseding playback ignores old completion, error, timeout, abort, and play rejection", async () => {
  const oldPlayback = deferred();
  const h = harness({ play: audio => audio.playCalls === 1 ? oldPlayback.promise : Promise.resolve() });
  const signal = new TrackedSignal();
  const firstRejection = assert.rejects(h.player.playStroke(1, signal), { name: "AbortError" });
  const audio = h.recordings[0];
  const staleEnd = [...audio.listeners.get("ended")][0];
  const staleError = [...audio.listeners.get("error")][0];
  const staleAbort = [...signal.listeners][0];
  const staleTimeout = [...h.timers.values()][0].callback;
  let settled = false;
  const second = h.player.playStroke(2).then(() => { settled = true; });
  await firstRejection;
  staleEnd();
  staleError();
  staleAbort();
  staleTimeout();
  oldPlayback.reject(new Error("Late rejection from previous clip"));
  await flush();
  assert.equal(settled, false);
  assert.equal(audio.src, "/audio/writing/stroke-02.mp3");
  assert.equal(audio.listenerCount(), 2);
  assert.equal(h.timers.size, 1);
  audio.emit("ended");
  await second;
});

test("NotAllowedError is reported and a later user tap can retry", async () => {
  const blocked = Object.assign(new Error("Playback requires a tap"), { name: "NotAllowedError" });
  const h = harness({ play: audio => audio.playCalls === 1 ? Promise.reject(blocked) : Promise.resolve() });
  await assert.rejects(h.player.playStroke(1), error => error === blocked);
  assert.equal(h.timers.size, 0);
  assert.equal(h.recordings[0].listenerCount(), 0);
  const second = h.player.playStroke(1);
  h.recordings[0].emit("ended");
  await second;
});

test("synchronous play errors and media error events reject without leaking listeners", async () => {
  const thrown = new Error("Audio output unavailable");
  const h = harness({ play: audio => { if (audio.playCalls === 1) throw thrown; return Promise.resolve(); } });
  await assert.rejects(h.player.playStroke(1), error => error === thrown);
  const rejection = assert.rejects(h.player.playStroke(2), { name: "AudioError" });
  h.recordings[0].emit("error");
  await rejection;
  assert.equal(h.recordings[0].listenerCount(), 0);
  assert.equal(h.timers.size, 0);
});

test("a stalled or never-ending playback times out and stops", async () => {
  const h = harness({ play: () => new Promise(() => {}) });
  const rejection = assert.rejects(h.player.playStroke(1), { name: "TimeoutError" });
  await h.advance(19999);
  assert.equal(h.recordings[0].listenerCount(), 2);
  await h.advance(1);
  await rejection;
  assert.equal(h.recordings[0].listenerCount(), 0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.recordings[0].pauseCalls, 2);
});

test("destroy cancels current playback and permanently rejects further use", async () => {
  const h = harness();
  const rejection = assert.rejects(h.player.playStroke(1), { name: "AbortError" });
  h.player.destroy();
  h.player.destroy();
  await rejection;
  await assert.rejects(h.player.playStroke(2), { name: "InvalidStateError" });
  assert.equal(h.recordings[0].src, "");
  assert.equal(h.recordings[0].playCalls, 1);
  assert.equal(h.recordings[0].listenerCount(), 0);
  assert.equal(h.timers.size, 0);
});

test("separate players have separate elements and independent lifetimes", async () => {
  const h = harness();
  const other = h.makePlayer();
  const rejection = assert.rejects(h.player.playStroke(1), { name: "AbortError" });
  let otherFinished = false;
  const second = other.playStroke(2).then(() => { otherFinished = true; });
  h.player.destroy();
  await rejection;
  await flush();
  assert.equal(h.recordings.length, 2);
  assert.equal(otherFinished, false);
  assert.equal(h.recordings[1].src, "/audio/writing/stroke-02.mp3");
  h.recordings[1].emit("ended");
  await second;
});

test("invalid stroke numbers reject without starting media", async () => {
  const h = harness();
  for (const invalid of [0, 21, -1, 1.5, NaN, Infinity, "1", null, undefined]) {
    await assert.rejects(h.player.playStroke(invalid), { name: "RangeError" });
  }
  assert.equal(h.recordings[0].playCalls, 0);
  assert.equal(h.timers.size, 0);
});

test("missing browser Audio support reports a rejected Promise and can be destroyed", async () => {
  const h = harness({ unsupported: true });
  await assert.rejects(h.player.playStroke(1));
  h.player.stop();
  h.player.destroy();
  assert.equal(h.timers.size, 0);
});
