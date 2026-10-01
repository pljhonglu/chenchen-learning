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
  function fixedBond({ n = 7, left = 3, right = n - left, mode = "decomp", blanks = { whole: false, left: false, right: true } } = {}) {
    subject.setBond({ item: { n, left, right, mode, blanks, answers: { whole: null, left: null, right: null }, status: "open" }, qIndex: 1, activeSlot: ["whole", "left", "right"].find(slot => blanks[slot]), checked: false });
  }
  return { subject, document, timers, spoken, find, click, fixedBond, state: () => subject.state(), score: () => copy(subject.state().mathScore) };
}

// The correction must be inside the diagram or equation, beside the actual
// attempted number. A sentence elsewhere on the page does not satisfy this.
function assertVisualAnswer(h, { slot, expected, attempted = expected }) {
  const selector = slot ? `.nb-bond .math-answer-result[data-slot="${slot}"]` : ".math-q .math-answer-result";
  const result = h.find(selector);
  const correct = attempted === expected;
  assert.match(result.className, correct ? /\bis-correct\b/ : /\bis-wrong\b/);
  assert.equal(result.querySelector(".math-answer-correct .math-answer-value")?.textContent, String(expected));
  assert.equal(result.querySelector(".math-answer-correct .math-answer-mark")?.textContent, "✓");
  if (correct) {
    assert.equal(result.querySelector(".math-answer-attempt"), null, "A valid answer must not display a crossed-out attempt");
    assert.equal(result.querySelector(".math-answer-arrow"), null);
  } else {
    assert.equal(result.querySelector(".math-answer-attempt .math-answer-value")?.textContent, String(attempted));
    assert.equal(result.querySelector(".math-answer-attempt .math-answer-mark")?.textContent, "×");
    assert.equal(result.querySelector(".math-answer-arrow")?.textContent, "→");
  }
}

test("a complete number bond is checked on the final digit and waits for manual continuation", () => {
  const h = harness(); h.fixedBond();
  assert.equal(h.document.getElementById("nb-check"), null, "No extra submit button is needed");
  const digit = h.click('[data-n="4"]');
  assert.deepEqual(h.score(), { ok: 1, total: 1 });
  assert.equal(h.state().mathCompleted, 1);
  assert.equal(h.state().bondSheet.checked, true);
  assert.match(h.find("#math-fb").textContent, /答对/);
  assertVisualAnswer(h, { slot: "right", expected: 4 });
  assert.match(h.find(".nb-card .math-verdict.is-correct").textContent, /✓/);
  assert.equal(h.document.querySelectorAll(".nb-box").length, 0, "Answered blanks are static feedback, not disabled inputs");
  assert.equal(h.find("#math-next").hidden, false);
  assert.equal(h.find("#math-next").disabled, false);
  assert.match(h.find("#math-next").textContent, /下一题/);
  assert.equal(h.timers.size, 0, "Correct answers must not schedule automatic navigation");
  digit.onclick(); h.subject.checkBondSheet();
  assert.deepEqual(h.score(), { ok: 1, total: 1 }, "Rapid repeated taps must not count twice");
  assert.equal(h.state().bondSheet.qIndex, 1, "Keep the completed question visible until Next is clicked");
  assert.equal(h.state().bondSheet.item.status, "ok");
  h.click("#math-next");
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
  assert.equal(h.document.querySelectorAll(".math-answer-result").length, 0, "Do not mark either blank until the pair is complete");
  assert.equal(h.timers.size, 0);
  h.click('[data-n="7"]');
  assert.equal(h.state().bondSheet.item.status, "ok", "0 + 7 is valid even if the generated partition was 3 + 4");
  assertVisualAnswer(h, { slot: "left", expected: 0 });
  assertVisualAnswer(h, { slot: "right", expected: 7 });
  assert.equal(h.document.querySelectorAll(".math-answer-result.is-wrong").length, 0);
  assert.deepEqual(h.score(), { ok: 1, total: 1 });
  assert.equal(h.state().bondSheet.qIndex, 1);
  assert.equal(h.timers.size, 0);
  h.click("#math-next");
  assert.equal(h.state().bondSheet.qIndex, 2);
});

test("a wrong number bond shows the correct relationship and waits for manual continuation", () => {
  const h = harness(); h.fixedBond();
  const digit = h.click('[data-n="5"]');
  assert.equal(h.state().bondSheet.checked, true);
  assert.equal(h.state().bondSheet.item.answers.right, 5, "Keep the child's attempt visible for comparison");
  assert.match(h.find("#math-fb").textContent, /7\s*=\s*3\s*\+\s*4/);
  assertVisualAnswer(h, { slot: "right", expected: 4, attempted: 5 });
  assert.match(h.find(".nb-card .math-verdict.is-wrong").textContent, /×/);
  assert.equal(h.document.querySelectorAll(".nb-bond .math-answer-result").length, 1, "Given numbers are not marked as attempted answers");
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
  assert.equal(h.document.querySelectorAll(".nb-box").length, 0);
  h.click("#math-next");
  assert.equal(h.state().bondSheet.qIndex, 2);
  assert.equal(h.find("#math-next").hidden, true);
  assert.equal(h.document.querySelectorAll(".math-answer-result").length, 0, "Do not carry the previous diagram's correction into the next question");
  assert.match(h.find("#math-read").textContent, /听题目/);
  h.click("#math-read");
  assert.doesNotMatch(h.spoken.at(-1), /正确答案/, "The next question must not read the previous correction");
});

test("wrong two-part answers get a valid correction that preserves a usable first part", () => {
  const h = harness(); h.fixedBond({ blanks: { whole: false, left: true, right: true } });
  h.click('[data-n="2"]'); h.click('[data-n="4"]');
  assert.match(h.find("#math-fb").textContent, /7\s*=\s*2\s*\+\s*5/);
  assertVisualAnswer(h, { slot: "left", expected: 2 });
  assertVisualAnswer(h, { slot: "right", expected: 5, attempted: 4 });
  assert.equal(h.document.querySelectorAll(".math-answer-result.is-wrong").length, 1, "Keep the usable first part marked correct");
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.score(), { ok: 0, total: 1 });
});

test("a first part larger than the whole gets a valid correction without a negative number", () => {
  const h = harness(); h.fixedBond({ blanks: { whole: false, left: true, right: true } });
  h.click('[data-n="9"]'); h.click('[data-n="4"]');
  assert.match(h.find("#math-fb").textContent, /7\s*=\s*3\s*\+\s*4/);
  assertVisualAnswer(h, { slot: "left", expected: 3, attempted: 9 });
  assertVisualAnswer(h, { slot: "right", expected: 4 });
  assert.doesNotMatch(h.find("#math-fb").textContent, /-\d/);
  assert.equal(h.timers.size, 0);
});

test("composition also checks its only blank immediately and explains an incorrect whole", () => {
  const h = harness(); h.fixedBond({ mode: "compose", blanks: { whole: true, left: false, right: false } });
  h.click('[data-n="8"]');
  assert.match(h.find("#math-fb").textContent, /7\s*=\s*3\s*\+\s*4/);
  assertVisualAnswer(h, { slot: "whole", expected: 7, attempted: 8 });
  assert.equal(h.state().mathCompleted, 1);
  assert.equal(h.timers.size, 0);
  h.click("#math-next");
  assert.equal(h.state().bondSheet.qIndex, 2);
});

test("an unusable first part preserves a valid alternative second part in the diagram and audio", () => {
  const h = harness(); h.fixedBond({ blanks: { whole: false, left: true, right: true } });
  h.click('[data-n="9"]'); h.click('[data-n="2"]');
  assertVisualAnswer(h, { slot: "left", expected: 5, attempted: 9 });
  assertVisualAnswer(h, { slot: "right", expected: 2 });
  assert.match(h.find("#math-fb").textContent, /7\s*=\s*5\s*\+\s*2/);
  h.click("#math-read");
  assert.match(h.spoken.at(-1), /7 等于 5 加 2/);
  assert.deepEqual(h.score(), { ok: 0, total: 1 });
  assert.equal(h.timers.size, 0);
});

test("two unusable parts receive a complete valid correction with both attempts crossed out", () => {
  const h = harness(); h.fixedBond({ blanks: { whole: false, left: true, right: true } });
  h.click('[data-n="9"]'); h.click('[data-n="10"]');
  assertVisualAnswer(h, { slot: "left", expected: 3, attempted: 9 });
  assertVisualAnswer(h, { slot: "right", expected: 4, attempted: 10 });
  assert.equal(h.document.querySelectorAll(".math-answer-result.is-wrong").length, 2);
  assert.deepEqual(h.score(), { ok: 0, total: 1 });
  assert.equal(h.timers.size, 0);
});

test("a wrong single left blank is corrected in place without changing either given number", () => {
  const h = harness(); h.fixedBond({ blanks: { whole: false, left: true, right: false } });
  h.click('[data-n="0"]');
  assertVisualAnswer(h, { slot: "left", expected: 3, attempted: 0 });
  assert.deepEqual(h.document.querySelectorAll(".nb-bond .nb-num").map(node => node.textContent), ["7", "4"]);
  assert.equal(h.document.querySelectorAll(".math-answer-result").length, 1);
  assert.equal(h.timers.size, 0);
});

test("zero and ten remain explicit numbers in correct and incorrect answer feedback", () => {
  for (const { n, left, answer, expected } of [
    { n: 10, left: 10, answer: 0, expected: 0 },
    { n: 10, left: 10, answer: 1, expected: 0 },
    { n: 10, left: 0, answer: 10, expected: 10 },
    { n: 10, left: 0, answer: 0, expected: 10 },
  ]) {
    const h = harness(); h.fixedBond({ n, left });
    h.click(`[data-n="${answer}"]`);
    assertVisualAnswer(h, { slot: "right", expected, attempted: answer });
    assert.equal(h.state().bondSheet.qIndex, 1);
    assert.equal(h.find("#math-next").hidden, false);
    assert.equal(h.timers.size, 0);
  }
});

test("a correct addition or subtraction choice shows feedback and waits for the Next button", () => {
  const h = harness("addsub"), question = h.state().currentQ;
  const answer = h.click(`[data-v="${question.answer}"]`);
  answer.onclick();
  assert.deepEqual(h.score(), { ok: 1, total: 1 });
  assert.match(h.find("#math-fb").textContent, /答对/);
  assertVisualAnswer(h, { expected: question.answer });
  assert.match(answer.textContent, /✓/);
  assert.equal(h.find("#math-next").hidden, false);
  assert.equal(h.find("#math-next").disabled, false);
  assert.match(h.find("#math-next").textContent, /下一题/);
  assert.equal(h.timers.size, 0);
  assert.equal(h.state().currentQ, question, "Do not replace a correct question without a click");
  assert.ok(h.document.querySelectorAll(".math-opts button").every(button => button.disabled));
  h.click("#math-next");
  assert.notEqual(h.state().currentQ, question);
  assert.equal(h.state().mathCompleted, 1);
});

test("a wrong arithmetic choice shows the answer and advances only after the child is ready", () => {
  const h = harness("addsub"), question = h.state().currentQ;
  const wrong = h.document.querySelectorAll(".math-opts button").find(button => Number(button.dataset.v) !== question.answer);
  wrong.click();
  assert.match(h.find("#math-fb").textContent, new RegExp(`答案是 ${question.answer}`));
  assertVisualAnswer(h, { expected: question.answer, attempted: Number(wrong.dataset.v) });
  assert.match(wrong.textContent, /×/);
  assert.match(h.find(`[data-v="${question.answer}"]`).textContent, /✓/);
  assert.equal(h.timers.size, 0);
  assert.equal(h.state().currentQ, question);
  assert.deepEqual(h.score(), { ok: 0, total: 1 });
  assert.ok(h.document.querySelectorAll(".math-opts button").every(button => button.disabled));
  h.click("#math-next");
  assert.notEqual(h.state().currentQ, question);
});

test("changing math mode after an answer starts a fresh round without automatic navigation", () => {
  const h = harness(); h.fixedBond(); h.click('[data-n="4"]');
  assert.equal(h.timers.size, 0);
  h.click('[data-m="addsub"]');
  assert.equal(h.state().mathMode, "addsub");
  assert.ok(h.state().currentQ);
  assert.equal(h.timers.size, 0);
  assert.equal(h.state().mathCompleted, 0);
  assert.deepEqual(h.score(), { ok: 0, total: 0 });
  assert.equal(h.find("#math-next").hidden, true);
});

test("leaving math after an answer keeps the selected page and returning starts a fresh round", () => {
  const h = harness(); h.fixedBond(); h.click('[data-n="4"]');
  h.subject.showView("home");
  assert.equal(h.timers.size, 0);
  assert.equal(h.state().currentView, "home");
  h.subject.showView("math"); h.subject.renderMath("decomp");
  assert.equal(h.state().currentView, "math");
  assert.equal(h.state().bondSheet.qIndex, 1);
  assert.equal(h.state().bondSheet.checked, false);
  assert.equal(h.state().mathCompleted, 0);
  assert.deepEqual(h.score(), { ok: 0, total: 0 });
  assert.equal(h.find("#math-next").hidden, true);
  assert.equal(h.timers.size, 0);
});

test("every correct arithmetic answer waits for a button, including the third answer before finishing", () => {
  const h = harness("addsub");
  for (let count = 1; count <= 3; count++) {
    const question = h.state().currentQ;
    h.click(`[data-v="${question.answer}"]`);
    assert.equal(h.state().mathCompleted, count);
    assert.equal(h.state().currentQ, question);
    assert.equal(h.document.getElementById("finish-math"), null, "Even the last correct answer stays visible until acknowledged");
    assert.equal(h.timers.size, 0);
    assert.match(h.find("#math-next").textContent, count === 3 ? /完成啦/ : /下一题/);
    h.click("#math-next");
  }
  assert.ok(h.find("#finish-math"));
  assert.match(h.find("#math-panel").textContent, /3 道题/);
  assert.equal(h.find("#math-content .practice-controls").hidden, true);
  assert.deepEqual(h.score(), { ok: 3, total: 3 });
  assert.equal(h.timers.size, 0);
});

test("a wrong third answer stays visible until manual finish and remains an incorrect attempt", () => {
  const h = harness("addsub");
  for (let count = 0; count < 2; count++) { h.click(`[data-v="${h.state().currentQ.answer}"]`); h.click("#math-next"); }
  const answer = h.state().currentQ.answer;
  h.document.querySelectorAll(".math-opts button").find(button => Number(button.dataset.v) !== answer).click();
  assert.equal(h.document.getElementById("finish-math"), null);
  assert.equal(h.timers.size, 0);
  assert.match(h.find("#math-fb").textContent, new RegExp(`答案是 ${answer}`));
  h.click("#math-next");
  assert.ok(h.find("#finish-math"));
  assert.deepEqual(h.score(), { ok: 2, total: 3 });
});
