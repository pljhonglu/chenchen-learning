#!/usr/bin/env node
"use strict";

// Run the actual English module against a small DOM and the public app hooks.
// Scheduling, lesson transitions and persistence decisions stay in production code.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const source = fs.readFileSync(path.join(__dirname, "../public/english.js"), "utf8");
const curriculum = JSON.parse(fs.readFileSync(path.join(__dirname, "../public/data/english.json"), "utf8"));
const copy = value => JSON.parse(JSON.stringify(value));
const emptyState = () => ({ items: {}, activity: {}, hiddenCourses: {} });
const today = "2026-10-01";
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

function makeDOM() {
  let html = "", elements = [];
  const element = attrs => ({
    id: attrs.id || "", attrs, dataset: Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith("data-")).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), value])),
    disabled: Object.hasOwn(attrs, "disabled"), hidden: Object.hasOwn(attrs, "hidden"), textContent: "", onclick: null,
    classList: { add() {}, remove() {}, toggle() {} },
    querySelector() { return this.child || (this.child = { textContent: "" }); }
  });
  const root = {
    get innerHTML() { return html; },
    set innerHTML(value) {
      html = value;
      elements = [];
      for (const match of value.matchAll(/<[a-z][\w-]*\b([^>]*)>/g)) {
        const attrs = {};
        for (const attr of match[1].matchAll(/([:\w-]+)(?:="([^"]*)"|'([^']*)')?/g)) attrs[attr[1]] = attr[2] ?? attr[3] ?? "";
        elements.push(element(attrs));
      }
    },
    querySelector(selector) { return selector.startsWith("#") ? elements.find(el => el.id === selector.slice(1)) || null : null; },
    querySelectorAll(selector) {
      const attr = /^\[([^\]]+)\]$/.exec(selector);
      return attr ? elements.filter(el => Object.hasOwn(el.attrs, attr[1])) : [];
    }
  };
  return root;
}
function harness(options = {}) {
  const root = makeDOM(), database = { ...emptyState(), ...copy(options.state || {}) };
  const commits = [], reviews = [], plays = [], exits = [], syncs = [], scrolls = [];
  let active = true, pendingAudio = null, callbacks, audioStatus = "idle";
  const changeAudioState = value => { audioStatus = value; callbacks?.onState(value); };
  const audio = {
    preload: async () => true,
    stop() { if (pendingAudio) pendingAudio.resolve(false); pendingAudio = null; changeAudioState("idle"); },
    play(keys) { this.stop(); plays.push(copy(keys)); pendingAudio = deferred(); changeAudioState("speaking"); return pendingAudio.promise; },
    pause() { changeAudioState("paused"); }, resume() { changeAudioState("speaking"); }, getStatus: () => audioStatus,
    async complete(ok = true) {
      assert.ok(pendingAudio, "A recording should be pending");
      const pending = pendingAudio; pendingAudio = null;
      changeAudioState(ok ? "idle" : "error");
      if (!ok) callbacks.onError("audio-unavailable");
      pending.resolve(ok);
      await flush();
    },
    get pending() { return !!pendingAudio; }
  };
  const hooks = {
    loadState: () => database, todayStr: () => today, isActive: () => active,
    syncNow: async () => { syncs.push(true); return options.sync ? options.sync() : true; },
    newItem: (id, meta) => ({ id, ...meta, learned: true, stage: 0, nextReview: today }),
    reviewPatch: (item, result) => { reviews.push({ id: item.id, result }); return { nextReview: "2026-10-02", lastResult: result }; },
    commitOperations: operations => { commits.push(copy(operations)); return options.commit ? options.commit(operations, commits.length) : Promise.resolve(); },
    onExit: () => exits.push("exit"), onHome: () => exits.push("home"), onParent: () => exits.push("parent")
  };
  const context = {
    document: { getElementById: id => id === "english-content" ? root : null },
    ChenchenEnglishAudio: { create(config) { callbacks = config; return audio; } },
    scrollY: 0,
    scrollTo(position) { scrolls.push(copy(position)); context.scrollY = position.top; },
    AbortController, setTimeout, clearTimeout,
    fetch: async url => ({ ok: true, json: async () => url.endsWith("english.json") ? copy(curriculum) : {} })
  };
  vm.runInNewContext(source, context, { filename: "english.js" });
  const app = context.ChenchenEnglish.create(hooks);
  function button(id) { const result = root.querySelector("#" + id); assert.ok(result, `Missing button: ${id}`); return result; }
  function click(id) { const target = button(id); assert.equal(target.disabled, false, `${id} should be enabled`); return target.onclick(); }
  function clickData(attribute, value) {
    const target = root.querySelectorAll(`[${attribute}]`).find(el => el.attrs[attribute] === value);
    assert.ok(target, `Missing ${attribute}=${value}`);
    assert.equal(target.disabled, false);
    return target.onclick();
  }
  async function answer(id, wrong = false) {
    const choices = root.querySelectorAll("[data-english-choice]");
    const selected = choices.find(el => wrong ? el.dataset.englishChoice !== id : el.dataset.englishChoice === id);
    assert.ok(selected);
    assert.equal(selected.disabled, false);
    await selected.onclick();
    if (audio.pending) await audio.complete();
  }
  async function reachRecall(id = "english-cat", wrong = false) {
    await app.open({ itemId: id });
    await audio.complete();
    // Newly introduced extension cards start with a model before the listening task.
    if (!root.querySelectorAll("[data-english-choice]").length) { click("english-next"); await audio.complete(); }
    if (wrong) await answer(id, true);
    await answer(id);
    click("english-next");
    await audio.complete();
    if (!root.querySelector("#english-listen-only")) { click("english-next"); await audio.complete(); }
    if (!root.querySelector("#english-listen-only")) { click("english-next"); await audio.complete(); }
    assert.ok(root.querySelector("#english-listen-only"), "Lesson should reach its optional speaking step");
  }
  return { app, audio, root, database, commits, reviews, plays, exits, syncs, scrolls, button, click, clickData, answer, reachRecall,
    scrollTo: top => { context.scrollY = top; }, getScroll: () => context.scrollY,
    selectDaily: context.ChenchenEnglish.selectDaily, leave: () => { active = false; app.stop(); } };
}

test("daily plan introduces classroom words only and reserves a place among overdue reviews", () => {
  const h = harness();
  const candidates = ["english-dog", "english-cat", "english-apple", "english-book", "english-water"].map(id => curriculum.items.find(item => item.id === id));
  const state = emptyState();
  const initial = h.selectDaily(candidates, state, today);
  assert.equal(initial.length, 3);
  assert.ok(initial.every(item => item.source === "classroom"));
  for (const [id, nextReview] of [["english-dog", "2026-09-30"], ["english-cat", "2026-09-29"], ["english-apple", "2026-09-28"], ["english-water", "2026-09-27"]]) state.items[id] = { learned: true, nextReview };
  assert.deepEqual(Array.from(h.selectDaily(candidates, state, today), item => item.id), ["english-water", "english-apple", "english-book"]);
});

test("daily plan honors hidden cards, future reviews and today's distinct completions", () => {
  const h = harness();
  const state = emptyState();
  const candidates = curriculum.items.slice(0, 5);
  state.hiddenCourses[candidates[0].id] = { removedAt: today };
  state.items[candidates[1].id] = { learned: true, nextReview: "2026-10-03" };
  state.activity.a = { id: candidates[2].id, type: "english", day: today };
  state.activity.b = { id: candidates[2].id, type: "english", day: today };
  state.activity.other = { id: "poem-01", type: "poem", day: today };
  assert.deepEqual(Array.from(h.selectDaily(candidates, state, today), item => item.id), [candidates[3].id, candidates[4].id]);
  state.activity.c = { id: candidates[3].id, type: "english", day: today };
  state.activity.d = { id: candidates[4].id, type: "english", day: today };
  assert.equal(h.selectDaily(curriculum.items, state, today).length, 0);
});

test("English opens the complete unified library without starting audio or a daily lesson", async () => {
  const h = harness();
  await h.app.open();
  const cards = h.root.querySelectorAll("[data-english-card]");
  assert.equal(cards.length, 87);
  assert.deepEqual(cards.map(card => card.dataset.englishCard), curriculum.items.map(item => item.id));
  assert.equal(h.root.querySelectorAll("[data-english-mode]").length, 0);
  assert.equal(h.root.querySelector("#english-daily"), null);
  assert.equal(h.root.querySelector("#english-picture"), null);
  assert.equal(h.plays.length, 0);
  assert.equal(h.syncs.length, 0);
  assert.equal(h.commits.length, 0);
});

test("theme filtering includes both vocabulary sources and returning from a card restores its list position", async () => {
  const h = harness();
  await h.app.open();
  await h.clickData("data-english-theme", "food");
  const expected = curriculum.items.filter(item => item.theme === "food");
  assert.equal(new Set(expected.map(item => item.source)).size, 2, "Fixture should cover both old groups");
  assert.deepEqual(h.root.querySelectorAll("[data-english-card]").map(card => card.dataset.englishCard), expected.map(item => item.id));
  h.scrollTo(640);
  await h.clickData("data-english-card", "english-water");
  assert.equal(h.getScroll(), 0, "Card detail should start at the top");
  assert.equal(h.root.querySelectorAll("[data-english-card]").length, 0);
  assert.ok(h.root.querySelector("#english-word-play"));
  assert.equal(h.audio.pending, true);
  await h.click("english-back");
  await flush();
  assert.equal(h.getScroll(), 640);
  assert.equal(h.audio.pending, false, "Returning to the list should stop detail audio");
  assert.deepEqual(h.root.querySelectorAll("[data-english-card]").map(card => card.dataset.englishCard), expected.map(item => item.id));
  await h.clickData("data-english-theme", "all");
  assert.equal(h.root.querySelectorAll("[data-english-card]").length, 87);
  assert.equal(h.commits.length, 0, "Browsing and listening must not count as practice completion");
});

test("reading the homepage daily summary does not interrupt a live lesson", async () => {
  const h = harness();
  await h.app.open({ itemId: "english-cat" });
  const before = h.root.innerHTML, plays = h.plays.length, syncs = h.syncs.length;
  const summary = await h.app.getDailySummary();
  assert.deepEqual(copy(summary), { remaining: 3, count: 0 });
  assert.equal(h.root.innerHTML, before);
  assert.equal(h.plays.length, plays);
  assert.equal(h.syncs.length, syncs);
  assert.equal(h.audio.pending, true);
  await h.audio.complete();
  assert.ok(h.root.querySelectorAll("[data-english-choice]").every(choice => !choice.disabled), "Summary must not invalidate active audio callbacks");
  assert.equal(h.commits.length, 0);
  h.leave();
});

test("listening choices remain locked until audio succeeds, including after retry", async () => {
  const h = harness();
  await h.app.open({ itemId: "english-cat" });
  assert.ok(h.root.querySelectorAll("[data-english-choice]").every(el => el.disabled));
  await h.audio.complete(false);
  assert.equal(h.button("english-audio-error").hidden, false);
  assert.ok(h.root.querySelectorAll("[data-english-choice]").every(el => el.disabled));
  const retry = h.click("english-audio-retry");
  await h.audio.complete();
  await retry;
  assert.ok(h.root.querySelectorAll("[data-english-choice]").every(el => !el.disabled));
  assert.equal(h.button("english-next").disabled, true);
  assert.equal(h.commits.length, 0);
});

test("today's task is recomputed after syncing another device's completed round", async () => {
  let h;
  h = harness({sync:async () => {
    for (const [index,id] of ["english-dog","english-cat","english-mouse"].entries()) h.database.activity[index] = {id,type:"english",day:today};
    return true;
  }});
  assert.deepEqual(copy(await h.app.getDailySummary()), { remaining: 3, count: 0 });
  await h.app.open({ daily: true });
  assert.equal(h.syncs.length, 1);
  assert.ok(h.root.querySelector("#english-daily-home"));
  assert.ok(h.root.querySelector("#english-daily-library"));
  assert.equal(h.root.querySelector("#english-next"), null);
  assert.deepEqual(copy(await h.app.getDailySummary()), { remaining: 0, count: 3 });
  assert.equal(h.plays.length,0);
  assert.equal(h.commits.length,0);
  await h.click("english-daily-library");
  assert.equal(h.root.querySelectorAll("[data-english-card]").length, 87);
});

test("daily route selects the remaining cards only after successful synchronization", async () => {
  const syncing = deferred(), syncStarted = deferred();
  const h = harness({ sync: () => { syncStarted.resolve(); return syncing.promise; } });
  const opening = h.app.open({ daily: true });
  await syncStarted.promise;
  assert.equal(h.syncs.length, 1);
  assert.equal(h.plays.length, 0);
  h.database.activity.remote = { id: "english-dog", type: "english", day: today };
  const expected = h.selectDaily(curriculum.items, h.database, today);
  syncing.resolve(true);
  await opening;
  assert.match(h.root.innerHTML, /小小练习 1 \/ 2/);
  assert.ok(h.plays[0].includes(expected[0].id + "-word"));
  assert.equal(h.commits.length, 0);
  h.leave();
});

test("a delayed daily start cannot replace a library opened in the meantime", async () => {
  const syncing = deferred(), syncStarted = deferred();
  const h = harness({ sync: () => { syncStarted.resolve(); return syncing.promise; } });
  const opening = h.app.open({ daily: true });
  await syncStarted.promise;
  await h.app.open();
  await h.clickData("data-english-theme", "fruit");
  const library = h.root.innerHTML;
  syncing.resolve(true);
  await opening;
  assert.equal(h.root.innerHTML, library);
  assert.equal(h.plays.length, 0);
  assert.equal(h.commits.length, 0);
});

test("daily route rests when nothing is due even if no words were practiced today", async () => {
  const h = harness();
  for (const item of curriculum.items) h.database.items[item.id] = { id: item.id, learned: true, nextReview: "2026-10-07" };
  assert.deepEqual(copy(await h.app.getDailySummary()), { remaining: 0, count: 0 });
  await h.app.open({ daily: true });
  assert.ok(h.root.querySelector("#english-daily-home"));
  assert.equal(h.root.querySelector("#english-next"), null);
  assert.equal(h.plays.length, 0);
  assert.equal(h.commits.length, 0);
  await h.click("english-daily-home");
  assert.deepEqual(h.exits, ["home"]);
});

test("learn and sentence playback can recover through retry or a relevant replay button", async () => {
  const h = harness();
  await h.app.open({ itemId: "english-cat" });
  await h.audio.complete(); await h.answer("english-cat"); h.click("english-next");
  await h.audio.complete(false);
  assert.equal(h.button("english-next").disabled, true);
  const retry = h.click("english-audio-retry");
  await h.audio.complete(); await retry;
  assert.equal(h.button("english-next").disabled, false);
  h.click("english-next");
  assert.equal(h.button("english-next").disabled, true);
  // This tap interrupts the automatic sequence. Its complete sentence still counts.
  const replay = h.click("english-sentence-hint");
  await h.audio.complete(); await replay;
  assert.equal(h.button("english-next").disabled, false);
  h.leave();
});

test("new extension exposure is kept separate from independent listening, and speaking is not assessed", async () => {
  const h = harness();
  await h.reachRecall("english-water");
  await h.click("english-listen-only");
  assert.equal(h.commits.length, 1);
  const value = h.commits[0].find(op => op.op === "merge").value;
  assert.equal(value.englishListening.exposureFirst, true);
  assert.equal(value.englishListening.firstTryCorrect, true);
  assert.equal(value.englishListening.independent, false);
  assert.equal(value.englishSpeaking.status, "listened");
  assert.equal(value.englishSpeaking.assessed, false);
  assert.deepEqual(h.reviews, [{ id: "english-water", result: "fuzzy" }]);
  h.leave();
});

test("a wrong first choice stays supported even after a correct answer and confident speaking", async () => {
  const h = harness();
  await h.reachRecall("english-cat", true);
  await h.click("english-next");
  const value = h.commits[0].find(op => op.op === "merge").value;
  assert.equal(value.englishListening.firstTryCorrect, false);
  assert.equal(value.englishListening.attempts, 2);
  assert.equal(value.englishListening.independent, false);
  assert.equal(value.englishSpeaking.status, "attempted");
  assert.equal(value.englishSpeaking.assessed, false);
  assert.deepEqual(h.reviews, [{ id: "english-cat", result: "fuzzy" }]);
  h.leave();
});

test("failed save can be retried with identical operations and the same activity key", async () => {
  const h = harness({ commit: (_operations, attempt) => attempt === 1 ? Promise.reject(new Error("offline")) : Promise.resolve() });
  await h.reachRecall();
  await h.click("english-next");
  assert.match(h.button("english-save-error").textContent, /还没有保存成功/);
  assert.equal(h.button("english-next").disabled, false);
  await h.click("english-next");
  assert.equal(h.commits.length, 2);
  assert.deepEqual(h.commits[1], h.commits[0]);
  assert.equal(h.reviews.length, 1);
  assert.match(h.root.innerHTML, /英语小花开啦/);
  h.leave();
});

test("leaving before completion does not save and pending audio cannot restore the lesson", async () => {
  const h = harness();
  await h.app.open({ itemId: "english-cat" });
  h.leave();
  h.root.innerHTML = "<p>another view</p>";
  await flush();
  assert.equal(h.audio.pending, false);
  assert.equal(h.commits.length, 0);
  assert.equal(h.root.innerHTML, "<p>another view</p>");
});

test("leaving during a save prevents a late response from navigating or celebrating", async () => {
  const pending = deferred();
  const h = harness({ commit: () => pending.promise });
  await h.reachRecall();
  const save = h.click("english-next");
  assert.equal(h.commits.length, 1);
  h.leave();
  h.root.innerHTML = "<p>another view</p>";
  pending.resolve();
  await save;
  assert.equal(h.root.innerHTML, "<p>another view</p>");
  assert.deepEqual(h.exits, []);
  assert.equal(h.audio.pending, false);
});

test("server sync failure blocks lesson start and allows retry", async () => {
  let online = false;
  const h = harness({ sync: () => online });
  await h.app.open({ itemId: "english-cat" });
  assert.match(h.root.innerHTML, /暂时连不上服务器/);
  assert.equal(h.plays.length, 0);
  online = true;
  await h.click("english-reconnect");
  assert.equal(h.plays.length, 1);
  assert.ok(h.root.querySelectorAll("[data-english-choice]").length);
  h.leave();
});

test("free practice before a scheduled review records participation without changing the interval", async () => {
  const h = harness({ state: { items: { "english-cat": { id: "english-cat", learned: true, stage: 3, nextReview: "2026-10-07" } } } });
  await h.reachRecall();
  const hint = h.click("english-word-hint");
  await h.audio.complete(); await hint;
  await h.click("english-next");
  assert.equal(h.reviews.length, 0);
  const operations = h.commits[0];
  assert.equal(operations.some(op => op.op === "create"), false);
  const value = operations.find(op => op.op === "merge").value;
  assert.equal(Object.hasOwn(value, "nextReview"), false);
  assert.equal(Object.hasOwn(value, "stage"), false);
  assert.equal(value.englishSpeaking.usedHint, true);
  assert.equal(value.englishSpeaking.assessed, false);
  h.leave();
});

test("a deleted-on-another-device conflict does not celebrate or allow a blind save retry", async () => {
  const h = harness({ commit: () => Promise.reject(Object.assign(new Error("deleted"), { status: 409 })) });
  await h.reachRecall();
  await h.click("english-next");
  assert.equal(h.commits.length, 1);
  assert.equal(h.button("english-next").disabled, true);
  assert.match(h.button("english-save-error").textContent, /另一台设备移除/);
  assert.doesNotMatch(h.root.innerHTML, /英语小花开啦/);
  h.leave();
});
