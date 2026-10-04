#!/usr/bin/env node
"use strict";

// Run the actual English module against a small DOM and the public app hooks.
// Scheduling, lesson transitions and persistence decisions stay in production code.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const source = fs.readFileSync(path.join(__dirname, "../public/english.js"), "utf8").replace("return {open,stop,catalog:","return {inspect:()=>round,open,stop,catalog:");
const learningSource = fs.readFileSync(path.join(__dirname, "../public/learning-model.js"), "utf8");
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
    querySelector(selector) { return selector.startsWith("#") ? elements.find(el => el.id === selector.slice(1)) || null : this.querySelectorAll(selector)[0] || null; },
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
  let active = true, pendingAudio = null, callbacks, audioStatus = "idle", currentDay = today;
  const changeAudioState = value => { audioStatus = value; callbacks?.onState(value); };
  const audio = {
    preload: async () => true,
    stop() { if (pendingAudio) pendingAudio.resolve(false); pendingAudio = null; changeAudioState("idle"); },
    play(keys) { this.stop(); plays.push(copy(keys)); pendingAudio = deferred(); changeAudioState(options.delayAudioStart ? "loading" : "speaking"); return pendingAudio.promise; },
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
    loadState: () => database, todayStr: () => currentDay, isActive: () => active,
    groupStartHtml:()=>'<button data-start-study="english">开始学习</button>',
    startStudy:()=>exits.push("start-group"),
    completeGroup:entries=>{commits.push(copy(entries));return options.commit ? options.commit(entries,commits.length) : Promise.resolve();},
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
  vm.runInNewContext(learningSource, context, { filename: "learning-model.js" });
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
  async function reachRecall(id = "english-cat", wrong = false, alreadyStarted = false) {
    if (!alreadyStarted) await openGroup(id);
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
  const makeGroup=(id="english-cat",mode="learn")=>({id:"english-test-group",type:"english",mode,count:5,items:[curriculum.items.find(item=>item.id===id),...curriculum.items.filter(item=>item.id!==id&&item.source==="classroom").slice(0,4)]});
  const openGroup=(id,mode)=>app.open({group:makeGroup(id,mode)});
  async function finishRest() {
    while(app.inspect()?.index < 5) {
      const item=app.inspect().items[app.inspect().index];
      await reachRecall(item.id,false,true);
      await click("english-next");
    }
  }
  return {openGroup,makeGroup,finishRest, app, audio, root, database, commits, reviews, plays, exits, syncs, scrolls, button, click, clickData, answer, reachRecall,
    at: day => {currentDay=day;},
    scrollTo: top => { context.scrollY = top; }, getScroll: () => context.scrollY,
    leave: () => { active = false; app.stop(); } };
}

test("English opens the complete unified library without starting audio or a daily lesson", async () => {
  const h = harness();
  await h.app.open();
  const cards = h.root.querySelectorAll("[data-english-card]");
  assert.equal(cards.length, 87);
  assert.deepEqual(cards.map(card => card.dataset.englishCard), curriculum.items.map(item => item.id));
  assert.equal(h.root.querySelectorAll("[data-english-mode]").length, 0);
  assert.equal(h.root.querySelector("#english-daily"), null);
  assert.equal(h.root.querySelector("#english-picture"), null);
  assert.equal(h.root.querySelector("#english-report"), null, "Records have one shared homepage entry");
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


test("listening choices remain locked until audio succeeds, including after retry", async () => {
  const h = harness();
  await h.openGroup("english-cat");
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


test("learn and sentence playback can recover through retry or a relevant replay button", async () => {
  const h = harness();
  await h.openGroup("english-cat");
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


test("leaving before completion does not save and pending audio cannot restore the lesson", async () => {
  const h = harness();
  await h.openGroup("english-cat");
  h.leave();
  h.root.innerHTML = "<p>another view</p>";
  await flush();
  assert.equal(h.audio.pending, false);
  assert.equal(h.commits.length, 0);
  assert.equal(h.root.innerHTML, "<p>another view</p>");
});


test("automatic English feedback uses the same completion labels as other subjects", async () => {
  const h = harness();
  await h.openGroup("english-cat");
  await h.audio.complete();
  await h.answer("english-cat");
  assert.match(h.button("english-feedback").textContent, /^自己完成 ✓/);
  await h.openGroup("english-cat");
  await h.audio.complete();
  await h.answer("english-cat", true);
  await h.answer("english-cat");
  assert.match(h.button("english-feedback").textContent, /^提示后完成 ✓/);
  h.leave();
});


test("the English library start button delegates fixed group creation to the shared app", async () => {
  const h=harness();await h.app.open();
  await h.clickData("data-start-study","english");
  assert.deepEqual(h.exits,["start-group"]);assert.equal(h.commits.length,0);
});

test("catalog lookup is complete and cannot interrupt the active group's audio", async () => {
  const h=harness();await h.openGroup();const before=h.root.innerHTML,plays=h.plays.length;
  const catalog=await h.app.catalog();
  assert.equal(catalog.length,87);assert.ok(catalog.every(item=>item.type==="english"));
  assert.equal(h.root.innerHTML,before);assert.equal(h.plays.length,plays);
  await h.audio.complete();assert.ok(h.root.querySelectorAll("[data-english-choice]").every(choice=>!choice.disabled));h.leave();
});

test("five words are fixed in a group and only the fifth completion calls the shared save hook", async () => {
  const h=harness();await h.openGroup();const group=h.app.inspect();const ids=group.items.map(item=>item.id);
  assert.equal(ids.length,5);assert.equal(new Set(ids).size,5);
  for(let i=0;i<5;i++) {
    await h.reachRecall(ids[i],false,true);await h.click("english-next");
    assert.equal(h.commits.length,i===4?1:0);
  }
  assert.deepEqual(h.commits[0].map(entry=>entry.id),ids);
  assert.ok(h.commits[0].every(entry=>entry.type==="english"&&entry.skill==="english-listening"));
  await h.click("english-next");assert.equal(h.commits.length,1,"Repeated completion cannot resubmit the group");h.leave();
});

test("new extension exposure remains supported and speaking is never graded", async () => {
  const h=harness();await h.reachRecall("english-water");await h.click("english-listen-only");
  const entry=h.app.inspect().entries[0];assert.equal(h.commits.length,0);
  assert.equal(entry.result,"supported");assert.equal(entry.source,"automatic");
  assert.equal(entry.details.exposureFirst,true);assert.equal(entry.details.firstTryCorrect,true);
  assert.equal(entry.details.speaking,"listened");assert.equal(entry.details.speakingAssessed,false);
  h.leave();assert.equal(h.commits.length,0);
});

test("a wrong first choice remains supported after correcting and speaking", async () => {
  const h=harness();await h.reachRecall("english-cat",true);await h.click("english-next");
  const entry=h.app.inspect().entries[0];assert.equal(entry.result,"supported");
  assert.equal(entry.details.firstTryCorrect,false);assert.equal(entry.details.attempts,2);assert.equal(entry.details.assisted,true);
  assert.equal(entry.details.speaking,"attempted");assert.equal(entry.details.speakingAssessed,false);assert.equal(h.commits.length,0);h.leave();
});

test("speaking hints stay separate from successful first-try listening", async () => {
  const h=harness();await h.reachRecall();const hint=h.click("english-word-hint");await h.audio.complete();await hint;await h.click("english-next");
  const entry=h.app.inspect().entries[0];
  assert.equal(entry.id,"english-cat");assert.equal(entry.title,"cat · 猫");assert.equal(entry.result,"independent");
  assert.equal(entry.details.speaking,"attempted");assert.equal(entry.details.usedHint,true);
  assert.equal(entry.details.speakingAssessed,false);assert.equal(entry.details.sentencePracticed,true);h.leave();
});

test("free word cards offer audio only and cannot start a single-word recording flow", async () => {
  const h=harness();await h.app.open({itemId:"english-cat"});
  assert.ok(h.root.querySelector("#english-word-play"));assert.equal(h.root.querySelector("#english-single"),null);
  assert.equal(h.app.inspect(),null);assert.match(h.root.innerHTML,/不记录学习/);
  await h.audio.complete();const clip=h.click("english-sentence-play");await h.audio.complete();await clip;
  assert.equal(h.commits.length,0);h.leave();
});

test("partially heard free cards remain same-day exposure across navigation into a group", async () => {
  const h=harness();await h.app.open({itemId:"english-cat"});
  assert.equal(h.audio.pending,true);await h.click("english-back");h.app.stop();
  assert.equal(h.commits.length,0);await h.openGroup("english-cat","review");
  await h.reachRecall("english-cat",false,true);await h.click("english-next");
  const entry=h.app.inspect().entries[0];
  assert.equal(entry.result,"supported");assert.equal(entry.details.firstTryCorrect,true);
  assert.equal(entry.details.observedExposure,true);assert.equal(entry.details.exposureFirst,true);
  assert.equal(h.commits.length,0);h.leave();
});

test("free-card exposure expires on the next Beijing day and never changes the first listening answer", async () => {
  const h=harness();await h.app.open({itemId:"english-cat"});h.app.stop();h.at("2026-10-02");
  await h.openGroup("english-cat","review");await h.reachRecall("english-cat",false,true);await h.click("english-next");
  const entry=h.app.inspect().entries[0];
  assert.equal(entry.result,"independent");assert.equal(entry.details.observedExposure,false);
  assert.equal(entry.details.exposureFirst,false);assert.equal(h.commits.length,0);h.leave();
});

test("free audio that failed before playing is not remembered as an exposure", async () => {
  const h=harness({delayAudioStart:true});await h.app.open({itemId:"english-cat"});await h.audio.complete(false);h.app.stop();
  await h.openGroup("english-cat","review");await h.reachRecall("english-cat",false,true);await h.click("english-next");
  const entry=h.app.inspect().entries[0];assert.equal(entry.result,"independent");assert.equal(entry.details.observedExposure,false);
  assert.equal(h.commits.length,0);h.leave();
});

test("leaving after four completed words discards the whole partial group", async () => {
  const h=harness();await h.openGroup();const ids=h.app.inspect().items.map(item=>item.id);
  for(let i=0;i<4;i++){await h.reachRecall(ids[i],false,true);await h.click("english-next");}
  assert.equal(h.app.inspect().entries.length,4);assert.equal(h.commits.length,0);
  h.app.stop();await h.app.open();assert.equal(h.app.inspect(),null);assert.equal(h.commits.length,0);
  await h.openGroup();assert.equal(h.app.inspect().index,0);assert.equal(h.app.inspect().entries.length,0);h.leave();
});
