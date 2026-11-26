#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../public/pinyin-audio.js"), "utf8");

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function flush() { for (let i = 0; i < 5; i++) await Promise.resolve(); }

function harness(options = {}) {
  let now = 0, nextTimer = 0;
  const timers = new Map(), recordings = [];
  class MockAudio {
    constructor() {
      this.listeners = new Map();
      this.playCalls = this.pauseCalls = this.loadCalls = this.currentTime = 0;
      recordings.push(this);
    }
    addEventListener(name, listener) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name).add(listener);
    }
    removeEventListener(name, listener) { this.listeners.get(name)?.delete(listener); }
    emit(name) {
      this[`on${name}`]?.();
      for (const listener of [...(this.listeners.get(name) || [])]) listener();
    }
    play() { this.playCalls++; return options.play ? options.play(this) : Promise.resolve(); }
    pause() { this.pauseCalls++; }
    load() { this.loadCalls++; }
    removeAttribute(attribute) { if (attribute === "src") this.src = ""; }
    listenerCount() { return [...this.listeners.values()].reduce((count, values) => count + values.size, 0); }
  }
  const context = {
    Audio: options.unsupported ? undefined : MockAudio,
    fetch() { throw new Error("Playback must not fetch a manifest or request speech synthesis."); },
    setTimeout(callback, delay) {
      const id = ++nextTimer;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  };
  vm.runInNewContext(source, context, { filename: "pinyin-audio.js" });
  const makePlayer = () => context.ChenchenPinyinAudio.create();
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

test("construction does not fetch or play; a tap starts local sound synchronously", async () => {
  const h = harness(), audio = h.recordings[0];
  assert.equal(audio.src, undefined);
  assert.equal(audio.loadCalls, 0);
  assert.equal(audio.playCalls, 0);
  const result = h.player.playSound("b");
  assert.equal(audio.playCalls, 1);
  assert.equal(audio.src, "/audio/pinyin/sound-b.mp3");
  audio.emit("ended");
  await result;
});

test("all 47 sounds use their own paths, including u/ü, un/ün and the shortened finals", async () => {
  const h = harness(), audio = h.recordings[0];
  const sounds = "b p m f d t n l g k h j q x zh ch sh r z c s y w a o e i u ü ai ei ui ao ou iu ie üe er an en in un ün ang eng ing ong".split(" ");
  assert.equal(sounds.length, 47);
  const paths = new Set();
  for (const id of sounds) {
    const result = h.player.playSound(id);
    assert.equal(audio.src, `/audio/pinyin/sound-${id.replace(/ü/g, "v")}.mp3`);
    paths.add(audio.src);
    audio.emit("ended");
    await result;
  }
  assert.equal(paths.size, 47);
  assert.equal(h.recordings.length, 1);
});

test("example character starts synchronously and uses its Unicode codepoint", async () => {
  const h = harness(), audio = h.recordings[0];
  for (const [character, hex] of [["八", "516b"], ["鱼", "9c7c"], ["𠀀", "20000"]]) {
    const count = audio.playCalls;
    const result = h.player.playExample(character);
    assert.equal(audio.playCalls, count + 1);
    assert.equal(audio.src, `/audio/pinyin/examples/char-${hex}.mp3`);
    audio.emit("ended");
    await result;
  }
});

test("only ended resolves; playing cancels the load timer; completion cleans up", async () => {
  const h = harness(), signal = new TrackedSignal(), audio = h.recordings[0];
  let settled = false;
  const result = h.player.playSound("b", signal).then(() => { settled = true; });
  await flush();
  assert.equal(settled, false);
  audio.emit("playing");
  await h.advance(30000);
  assert.equal(settled, false);
  assert.equal(h.timers.size, 0);
  audio.emit("ended");
  await result;
  assert.equal(signal.listeners.size, 0);
  assert.equal(audio.listenerCount(), 0);
});

test("abort and stop cancel playback, and a new tap can play", async () => {
  const h = harness(), audio = h.recordings[0], signal = new TrackedSignal();
  const aborted = assert.rejects(h.player.playSound("m", signal), { name: "AbortError" });
  signal.abort();
  await aborted;
  assert.equal(signal.listeners.size, 0);
  assert.equal(audio.listenerCount(), 0);
  const stopped = assert.rejects(h.player.playExample("妈"), { name: "AbortError" });
  h.player.stop();
  await stopped;
  const next = h.player.playSound("a");
  audio.emit("ended");
  await next;
  assert.equal(h.recordings.length, 1);
  assert.equal(h.timers.size, 0);
});

test("an already aborted signal does not interrupt existing narration", async () => {
  const h = harness(), controller = new AbortController();
  const playing = h.player.playSound("a");
  controller.abort();
  await assert.rejects(h.player.playSound("b", controller.signal), { name: "AbortError" });
  assert.equal(h.recordings[0].playCalls, 1);
  h.recordings[0].emit("ended");
  await playing;
});

test("rapid switching ignores all stale events, timers, aborts, and play rejection", async () => {
  const oldPlayback = deferred();
  const h = harness({ play: audio => audio.playCalls === 1 ? oldPlayback.promise : Promise.resolve() });
  const signal = new TrackedSignal(), audio = h.recordings[0];
  const first = assert.rejects(h.player.playSound("b", signal), { name: "AbortError" });
  const stale = [...audio.listeners.values()].flatMap(list => [...list]);
  const staleAbort = [...signal.listeners][0], staleTimer = [...h.timers.values()][0].callback;
  let settled = false;
  const second = h.player.playExample("八").then(() => { settled = true; });
  await first;
  const pauses = audio.pauseCalls;
  stale.forEach(handler => handler());
  staleAbort();
  staleTimer();
  oldPlayback.reject(new Error("Late rejection"));
  await flush();
  assert.equal(settled, false);
  assert.equal(audio.pauseCalls, pauses, "old playing must not pause the new recording");
  assert.equal(audio.src, "/audio/pinyin/examples/char-516b.mp3");
  assert.equal(h.timers.size, 1);
  audio.emit("ended");
  await second;
});

test("late playing and play resolution after stopping cannot restart narration", async () => {
  const delayed = deferred(), h = harness({ play: () => delayed.promise }), audio = h.recordings[0];
  const result = assert.rejects(h.player.playSound("a"), { name: "AbortError" });
  h.player.stop();
  await result;
  const pauses = audio.pauseCalls;
  audio.emit("playing");
  assert.equal(audio.pauseCalls, pauses + 1);
  delayed.resolve();
  await flush();
  assert.equal(audio.pauseCalls, pauses + 2);
  assert.equal(audio.listenerCount(), 0);
  assert.equal(h.timers.size, 0);
});

test("load and later buffering each time out after 20 seconds", async () => {
  const h = harness({ play: () => new Promise(() => {}) }), audio = h.recordings[0];
  const timeout = assert.rejects(h.player.playSound("u"), { name: "TimeoutError" });
  await h.advance(19999);
  assert.equal(h.timers.size, 1);
  audio.emit("stalled");
  await h.advance(1);
  await timeout;
  const stalled = assert.rejects(h.player.playSound("ü"), { name: "TimeoutError" });
  audio.emit("playing");
  assert.equal(h.timers.size, 0);
  audio.emit("waiting");
  await h.advance(10000);
  audio.emit("stalled");
  await h.advance(10000);
  await stalled;
  assert.equal(audio.listenerCount(), 0);
  assert.equal(h.timers.size, 0);
});

test("browser refusal, thrown play, and media errors reject and allow a retry", async () => {
  const blocked = Object.assign(new Error("Tap required"), { name: "NotAllowedError" });
  const h = harness({ play: audio => {
    if (audio.playCalls === 1) return Promise.reject(blocked);
    if (audio.playCalls === 2) throw new Error("Output missing");
    return Promise.resolve();
  } });
  await assert.rejects(h.player.playSound("b"), { name: "NotAllowedError" });
  await assert.rejects(h.player.playSound("b"), /Output missing/);
  const broken = assert.rejects(h.player.playSound("b"), { name: "AudioError" });
  h.recordings[0].emit("error");
  await broken;
  assert.equal(h.recordings[0].listenerCount(), 0);
  const retry = h.player.playSound("b");
  h.recordings[0].emit("ended");
  await retry;
});

test("invalid sound and character inputs reject without media or path traversal", async () => {
  const h = harness();
  for (const invalid of [null, undefined, 1, "", "v", "iu.mp3", "üe?x=1", "a/../b", "https://x/a", "ā", "B"]) {
    await assert.rejects(h.player.playSound(invalid), { name: "RangeError" });
  }
  for (const invalid of [null, undefined, 1, "", "妈妈", "a", "🐈", "../八", "八?x=1", " 八", "八\n", "https://x/八"]) {
    await assert.rejects(h.player.playExample(invalid), { name: "RangeError" });
  }
  assert.equal(h.recordings[0].playCalls, 0);
  assert.equal(h.timers.size, 0);
});

test("destroy cancels, releases the source, and permanently disables the player", async () => {
  const h = harness(), audio = h.recordings[0];
  const result = assert.rejects(h.player.playExample("八"), { name: "AbortError" });
  h.player.destroy();
  h.player.destroy();
  await result;
  await assert.rejects(h.player.playSound("b"), { name: "InvalidStateError" });
  await assert.rejects(h.player.playExample("八"), { name: "InvalidStateError" });
  assert.equal(audio.src, "");
  assert.equal(audio.loadCalls, 1);
  assert.equal(audio.listenerCount(), 0);
  assert.equal(h.timers.size, 0);
});

test("missing Audio support rejects without throwing or leaving timers", async () => {
  const h = harness({ unsupported: true });
  await assert.rejects(h.player.playSound("b"));
  h.player.stop();
  h.player.destroy();
  assert.equal(h.timers.size, 0);
});
