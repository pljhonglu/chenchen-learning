#!/usr/bin/env node
"use strict";

// Exercise the real math event handlers and router with a small DOM and clock.
// The in-memory exports below avoid adding test hooks to the shipped app.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const sourcePath = path.join(__dirname, "../public/app.js");
const source = fs.readFileSync(sourcePath, "utf8");
const instrumented = source.replace(/\}\)\(\);\s*$/, `
globalThis.subject = {
  renderMath, renderBondPanel, checkBondSheet, showView,
  state: () => ({ mathMode, mathCompleted, mathScore, bondSheet, currentQ, currentView }),
  setBond: value => { bondSheet = value; renderBondPanel(); }
};
})();`);
assert.notEqual(instrumented, source, "App must still be an IIFE for in-memory exports");
const copy = value => JSON.parse(JSON.stringify(value));

// Only HTML parsing, selectors, attributes and click dispatch are simulated.
// All answers, feedback, scoring and transitions run from public/app.js.
function makeDOM() {
  const decode = value => value.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
  function matches(el, selector) {
    const parts = selector.trim().split(/\s+/);
    const simple = (node, part) => {
      const tag = /^[a-z][\w-]*/i.exec(part)?.[0];
      if (tag && node.tag !== tag) return false;
      for (const [, id] of part.matchAll(/#([\w-]+)/g)) if (node.id !== id) return false;
      for (const [, name] of part.matchAll(/\.([\w-]+)/g)) if (!node.className.split(/\s+/).includes(name)) return false;
      for (const [, key, value] of part.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
        if (!Object.hasOwn(node.attrs, key) || value !== undefined && node.attrs[key] !== value) return false;
      }
      return true;
    };
    if (!simple(el, parts.pop())) return false;
    let parent = el.parent;
    while (parts.length) {
      const part = parts.pop();
      while (parent && !simple(parent, part)) parent = parent.parent;
      if (!parent) return false;
      parent = parent.parent;
    }
    return true;
  }
  function element(tag, attrs = {}) {
    const el = {
      tag, attrs, children: [], parent: null, style: {},
      id: attrs.id || "", className: attrs.class || "", disabled: Object.hasOwn(attrs, "disabled"), hidden: Object.hasOwn(attrs, "hidden"),
      dataset: Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith("data-")).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value])),
      appendChild(child) { child.parent = this; this.children.push(child); },
      querySelectorAll(selector) {
        const descendants = [];
        const visit = node => { for (const child of node.children) { if (child.tag) { descendants.push(child); visit(child); } } };
        visit(this);
        return descendants.filter(node => matches(node, selector));
      },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
      setAttribute(key, value) { this.attrs[key] = String(value); },
      removeAttribute(key) { delete this.attrs[key]; },
      addEventListener() {},
      click() { if (!this.disabled) return this.onclick?.(); },
    };
    el.classList = {
      add(...names) { el.className = [...new Set([...el.className.split(/\s+/).filter(Boolean), ...names])].join(" "); },
      remove(...names) { el.className = el.className.split(/\s+/).filter(name => !names.includes(name)).join(" "); },
      toggle(name, active) { if (active) this.add(name); else this.remove(name); },
    };
    Object.defineProperties(el, {
      textContent: {
        get() { return this.children.map(child => child.textContent).join(""); },
        set(value) { this.children = [{ textContent: String(value) }]; },
      },
      innerHTML: {
        get() { return this.html || ""; },
        set(value) {
          this.html = value; this.children = [];
          const stack = [this];
          for (const match of value.matchAll(/<\/?[a-z][^>]*>|[^<]+/gi)) {
            const token = match[0];
            if (token.startsWith("</")) { if (stack.length > 1) stack.pop(); continue; }
            if (!token.startsWith("<")) { stack.at(-1).children.push({ textContent: decode(token) }); continue; }
            const tag = /^<([\w-]+)/.exec(token)[1];
            const attrs = {};
            for (const attr of token.slice(tag.length + 1, -1).matchAll(/([:\w-]+)(?:="([^"]*)"|'([^']*)')?/g)) attrs[attr[1]] = decode(attr[2] ?? attr[3] ?? "");
            const child = element(tag, attrs); stack.at(-1).appendChild(child);
            if (!token.endsWith("/>") && !["input", "br", "img", "hr", "meta", "link"].includes(tag)) stack.push(child);
          }
        },
      },
    });
    return el;
  }
  const body = element("body");
  body.innerHTML = '<main><section class="view" data-view="math"><div id="math-content"></div></section><section class="view" data-view="home"></section><div id="live-status"></div></main>';
  return { body, getElementById: id => body.querySelector("#" + id), querySelector: selector => body.querySelector(selector), querySelectorAll: selector => body.querySelectorAll(selector), createElement: tag => element(tag), addEventListener() {} };
}

function harness(mode = "decomp") {
  const document = makeDOM(), timers = new Map(), spoken = [];
  const speech = { supported: () => true, stop() {}, speakPoem(poem) { spoken.push(poem.lines.join("")); } };
  let timerId = 0, randomSeed = 12345;
  const math = Object.create(Math);
  math.random = () => { randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) >>> 0; return randomSeed / 4294967296; };
  const context = {
    document, Math: math, console, AbortController,
    window: { scrollTo() {}, addEventListener() {}, ChenchenSpeech: speech },
    ChenchenSpeech: speech,
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch() { throw new Error("Math question interaction must not make a network request"); },
  };
  vm.runInNewContext(instrumented, context, { filename: sourcePath });
  const subject = context.subject;
  subject.showView("math"); subject.renderMath(mode);
  const find = selector => { const result = document.querySelector(selector); assert.ok(result, `Missing element: ${selector}`); return result; };
  const click = selector => { const target = find(selector); assert.equal(target.disabled, false, `${selector} should be enabled`); target.click(); return target; };
  function fixedBond({ mode = "decomp", blanks = { whole: false, left: false, right: true } } = {}) {
    subject.setBond({ item: { n: 7, left: 3, right: 4, mode, blanks, answers: { whole: null, left: null, right: null }, status: "open" }, qIndex: 1, activeSlot: ["whole", "left", "right"].find(slot => blanks[slot]), checked: false });
  }
  function runAuto() {
    assert.equal(timers.size, 1, "A correct answer should schedule exactly one automatic transition");
    const [id, timer] = [...timers][0];
    assert.ok(timer.delay > 0 && timer.delay <= 1500, "Give brief feedback before promptly continuing");
    timers.delete(id); timer.fn();
  }
  return { subject, document, timers, spoken, find, click, fixedBond, runAuto, state: () => subject.state(), score: () => copy(subject.state().mathScore) };
}

test("a complete number bond is checked on the final digit and automatically continues once", () => {
  const h = harness(); h.fixedBond();
  assert.equal(h.document.getElementById("nb-check"), null, "No extra submit button is needed");
  const digit = h.click('[data-n="4"]');
  assert.deepEqual(h.score(), { ok: 1, total: 1 });
  assert.equal(h.state().mathCompleted, 1);
  assert.equal(h.state().bondSheet.checked, true);
  assert.equal(h.find("#math-next").hidden, true);
  digit.onclick(); h.subject.checkBondSheet();
  assert.deepEqual(h.score(), { ok: 1, total: 1 }, "Rapid repeated taps must not count twice");
  h.runAuto();
  assert.equal(h.state().bondSheet.qIndex, 2);
  assert.equal(h.state().bondSheet.checked, false);
  assert.equal(h.timers.size, 0);
});

test("two blanks wait for both digits and accept a valid alternative partition including zero", () => {
  const h = harness(); h.fixedBond({ blanks: { whole: false, left: true, right: true } });
  h.click('[data-n="0"]');
  assert.equal(h.state().bondSheet.activeSlot, "right");
  assert.equal(h.state().mathCompleted, 0);
  assert.deepEqual(h.score(), { ok: 0, total: 0 });
  assert.equal(h.timers.size, 0);
  h.click('[data-n="7"]');
  assert.equal(h.state().bondSheet.item.status, "ok", "0 + 7 is valid even if the generated partition was 3 + 4");
  assert.deepEqual(h.score(), { ok: 1, total: 1 });
  h.runAuto();
});

test("a wrong number bond shows the correct relationship and waits for manual continuation", () => {
  const h = harness(); h.fixedBond();
  const digit = h.click('[data-n="5"]');
  assert.equal(h.state().bondSheet.checked, true);
  assert.equal(h.state().bondSheet.item.answers.right, 5, "Keep the child's attempt visible for comparison");
  assert.match(h.find("#math-fb").textContent, /7\s*=\s*3\s*\+\s*4/);
  assert.deepEqual(h.score(), { ok: 0, total: 1 });
  assert.equal(h.state().mathCompleted, 1);
  assert.equal(h.timers.size, 0, "An incorrect answer must never auto-advance");
  assert.equal(h.find("#math-next").hidden, false);
  assert.match(h.find("#math-next").textContent, /看懂/);
  assert.match(h.find("#math-read").textContent, /听答案/);
  h.click("#math-read");
  assert.match(h.spoken.at(-1), /7 等于 3 加 4/);
  digit.onclick(); h.subject.checkBondSheet();
  assert.deepEqual(h.score(), { ok: 0, total: 1 });
  assert.ok(h.document.querySelectorAll(".nb-box").every(button => button.disabled));
  h.click("#math-next");
  assert.equal(h.state().bondSheet.qIndex, 2);
  assert.equal(h.find("#math-next").hidden, true);
  assert.match(h.find("#math-read").textContent, /听题目/);
  h.click("#math-read");
  assert.doesNotMatch(h.spoken.at(-1), /正确答案/, "The next question must not read the previous correction");
});

test("wrong two-part answers get a valid correction that preserves a usable first part", () => {
  const h = harness(); h.fixedBond({ blanks: { whole: false, left: true, right: true } });
  h.click('[data-n="2"]'); h.click('[data-n="4"]');
  assert.match(h.find("#math-fb").textContent, /7\s*=\s*2\s*\+\s*5/);
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.score(), { ok: 0, total: 1 });
});

test("a first part larger than the whole gets a valid correction without a negative number", () => {
  const h = harness(); h.fixedBond({ blanks: { whole: false, left: true, right: true } });
  h.click('[data-n="9"]'); h.click('[data-n="4"]');
  assert.match(h.find("#math-fb").textContent, /7\s*=\s*3\s*\+\s*4/);
  assert.doesNotMatch(h.find("#math-fb").textContent, /-\d/);
  assert.equal(h.timers.size, 0);
});

test("composition also checks its only blank immediately and explains an incorrect whole", () => {
  const h = harness(); h.fixedBond({ mode: "compose", blanks: { whole: true, left: false, right: false } });
  h.click('[data-n="8"]');
  assert.match(h.find("#math-fb").textContent, /7\s*=\s*3\s*\+\s*4/);
  assert.equal(h.state().mathCompleted, 1);
  assert.equal(h.timers.size, 0);
  h.click("#math-next");
  assert.equal(h.state().bondSheet.qIndex, 2);
});

test("a correct addition or subtraction choice automatically advances without extra clicks", () => {
  const h = harness("addsub"), question = h.state().currentQ;
  const answer = h.click(`[data-v="${question.answer}"]`);
  answer.onclick();
  assert.deepEqual(h.score(), { ok: 1, total: 1 });
  assert.equal(h.find("#math-next").hidden, true);
  h.runAuto();
  assert.notEqual(h.state().currentQ, question);
  assert.equal(h.state().mathCompleted, 1);
});

test("a wrong arithmetic choice shows the answer and advances only after the child is ready", () => {
  const h = harness("addsub"), question = h.state().currentQ;
  const wrong = h.document.querySelectorAll(".math-opts button").find(button => Number(button.dataset.v) !== question.answer);
  wrong.click();
  assert.match(h.find("#math-fb").textContent, new RegExp(`答案是 ${question.answer}`));
  assert.equal(h.timers.size, 0);
  assert.equal(h.state().currentQ, question);
  assert.deepEqual(h.score(), { ok: 0, total: 1 });
  assert.ok(h.document.querySelectorAll(".math-opts button").every(button => button.disabled));
  h.click("#math-next");
  assert.notEqual(h.state().currentQ, question);
});

test("changing math mode cancels the old transition even if its callback was already queued", () => {
  const h = harness(); h.fixedBond(); h.click('[data-n="4"]');
  const stale = [...h.timers.values()][0].fn;
  h.click('[data-m="addsub"]');
  const next = h.state().currentQ;
  assert.equal(h.timers.size, 0);
  stale();
  assert.equal(h.state().currentQ, next);
  assert.equal(h.state().mathCompleted, 0);
  assert.deepEqual(h.score(), { ok: 0, total: 0 });
});

test("leaving math cancels automatic navigation and old callbacks cannot affect a new round", () => {
  const h = harness(); h.fixedBond(); h.click('[data-n="4"]');
  const stale = [...h.timers.values()][0].fn;
  h.subject.showView("home");
  assert.equal(h.timers.size, 0);
  stale();
  assert.equal(h.state().currentView, "home");
  h.subject.showView("math"); h.subject.renderMath("decomp");
  const next = h.state().bondSheet;
  stale();
  assert.equal(h.state().bondSheet, next);
  assert.equal(h.state().mathCompleted, 0);
});

test("three correct arithmetic answers automatically reach the finish screen with no fourth question", () => {
  const h = harness("addsub");
  for (let count = 1; count <= 3; count++) {
    h.click(`[data-v="${h.state().currentQ.answer}"]`);
    assert.equal(h.state().mathCompleted, count);
    h.runAuto();
  }
  assert.ok(h.find("#finish-math"));
  assert.match(h.find("#math-panel").textContent, /3 道题/);
  assert.equal(h.find("#math-content .practice-controls").hidden, true);
  assert.deepEqual(h.score(), { ok: 3, total: 3 });
  assert.equal(h.timers.size, 0);
});

test("a wrong third answer stays visible until manual finish and remains an incorrect attempt", () => {
  const h = harness("addsub");
  for (let count = 0; count < 2; count++) { h.click(`[data-v="${h.state().currentQ.answer}"]`); h.runAuto(); }
  const answer = h.state().currentQ.answer;
  h.document.querySelectorAll(".math-opts button").find(button => Number(button.dataset.v) !== answer).click();
  assert.equal(h.document.getElementById("finish-math"), null);
  assert.equal(h.timers.size, 0);
  assert.match(h.find("#math-fb").textContent, new RegExp(`答案是 ${answer}`));
  h.click("#math-next");
  assert.ok(h.find("#finish-math"));
  assert.deepEqual(h.score(), { ok: 2, total: 3 });
});
