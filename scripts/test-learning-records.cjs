#!/usr/bin/env node
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../public/learning-records.js"), "utf8");

function dom() {
  let html = "", elements = [];
  return {
    get innerHTML() { return html; },
    set innerHTML(value) {
      html = value;
      elements = Array.from(value.matchAll(/<[a-z][\w-]*\b([^>]*)>/g), match => {
        const attrs = Object.fromEntries(Array.from(match[1].matchAll(/([:\w-]+)(?:="([^"]*)"|'([^']*)')?/g), attr => [attr[1], attr[2] ?? attr[3] ?? ""]));
        return {attrs, id:attrs.id, hidden:Object.hasOwn(attrs, "hidden"), value:attrs.value || "", textContent:"", dataset:Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith("data-")).map(([key,value]) => [key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), value]))};
      });
    },
    querySelector(selector) { return elements.find(element => element.id === selector.slice(1)) || null; },
    querySelectorAll(selector) { return elements.filter(element => Object.hasOwn(element.attrs, selector.slice(1, -1))); },
  };
}
const stats = extra => ({activityCount:0, contentCount:0, confirmationCount:0, independent:0, supported:0, again:0, learningDays:0, independentRate:null, ...extra});
function emptySummary(options) {
  const end = new Date(options.to + "T12:00:00Z");
  const trend = Array.from({length:7}, (_, i) => {
    const date = new Date(end); date.setUTCDate(date.getUTCDate() - 6 + i);
    return {day:date.toISOString().slice(0, 10), ...stats()};
  });
  return {overview:stats(), days:[], subjects:[], items:[], trend};
}
const labels = {independent:"自己完成", supported:"提示后完成", again:"还要练习", practice:"已练习"};
function harness(options = {}) {
  const root = dom(), calls = [], exits = [], loads = [], state = {activity:{}, items:{}};
  const context = {
    ChenchenLearning: {
      summarize(snapshot, range) { calls.push({snapshot, range:{...range}}); return options.summary ? options.summary(range) : emptySummary(range); },
      resultLabel: result => labels[result] || "已练习", typeLabel: type => ({english:"英语",poem:"古诗",write:"汉字",pinyin:"拼音",math:"数学",decomp:"分解组合"}[type] || "其他"), skillLabel: skill => ({"poem-recitation":"背诵", "english-listening":"听音辨认"}[skill] || skill),
    },
  };
  vm.createContext(context);
  if (options.realModel) vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/learning-model.js"), "utf8"), context, {filename:"learning-model.js"});
  vm.runInContext(source, context, {filename:"learning-records.js"});
  const page = context.ChenchenLearningRecords.create({root, loadState:() => { loads.push(true); return options.loadState ? options.loadState() : state; }, todayStr:() => options.today || "2026-10-02", onBack:() => exits.push(true)});
  const button = id => { const element = root.querySelector("#" + id); assert.ok(element, `Expected ${id}`); return element; };
  return {page, root, state, calls, exits, loads, button,
    clickRange(mode) { const element = root.querySelectorAll("[data-records-range]").find(item => item.dataset.recordsRange === mode); assert.ok(element); element.onclick(); },
    selectDate(value) { button("records-date").onchange({target:{value}}); },
  };
}

test("record page opens from the read-only snapshot and uses the selected date scope", async () => {
  const h = harness(); await h.page.open();
  assert.equal(h.calls[0].snapshot, h.state);
  assert.deepEqual(h.calls[0].range, {from:"2026-10-02", to:"2026-10-02", today:"2026-10-02"});
  assert.match(h.root.innerHTML, /暂无确认/);
  assert.doesNotMatch(h.root.innerHTML, /熟练度|>0%<|分钟/);
  assert.match(h.root.innerHTML, /这一天还没有练习记录/);
  h.clickRange("yesterday");
  assert.equal(h.calls.at(-1).range.from, "2026-10-01");
  h.clickRange("week");
  assert.equal(h.calls.at(-1).range.from, "2026-09-26");
  assert.match(h.root.innerHTML, /这几天还没有练习记录/);
  h.selectDate("2026-09-03");
  assert.deepEqual(h.calls.at(-1).range, {from:"2026-09-03", to:"2026-09-03", today:"2026-10-02"});
  assert.match(h.root.innerHTML, /value="2026-09-03"/);
  assert.equal(h.loads.length, 1, "Date filters do not request or write progress");
});

test("filters handle month/year boundaries and reject impossible or future dates", async () => {
  const h = harness({today:"2026-01-01"}); await h.page.open();
  h.clickRange("yesterday");
  assert.equal(h.calls.at(-1).range.from, "2025-12-31");
  assert.match(h.root.innerHTML, /2025年12月31日/);
  const before = h.calls.length;
  for (const value of ["", "2026-02-31", "2026-01-02", "not-a-date", '<img src=x onerror="alert(1)">']) {
    h.selectDate(value);
    assert.equal(h.calls.length, before);
    assert.equal(h.button("records-date-error").hidden, false);
  }
  h.selectDate("2024-02-29");
  assert.equal(h.calls.at(-1).range.from, "2024-02-29");
});

function mixedSummary(range) {
  const summary = emptySummary(range);
  const english = {...stats({contentCount:2, activityCount:2, confirmationCount:1, independent:1, learningDays:1}),type:"english",label:"英语",items:[
    {id:"english-cat", title:"cat · 猫", skills:[{skill:"english-listening", label:"听音辨认", result:"independent", resultLabel:"自己完成", source:"automatic", confirmationCount:1, independent:1, afterPractice:true}]},
    {id:"removed-english-word",title:'旧词 <script>alert("bad")</script>',skills:[{skill:"english-listening", result:"practice", source:"legacy", confirmationCount:0}]},
  ]};
  const poem = {...stats({contentCount:1, activityCount:1, confirmationCount:1, supported:1, learningDays:1}),type:"poem",label:"古诗",items:[{id:"deleted-poem",title:"咏鹅",skills:[{skill:"poem-recitation",label:"背诵",result:"supported",resultLabel:"提示后完成",source:"parent",confirmationCount:1,supported:1}]}]};
  const math = {...stats({contentCount:1, activityCount:2, confirmationCount:1, again:1, learningDays:1}),type:"math",label:"数学",items:[{id:"math-add-sub",title:"加减法",skills:[{skill:"math-solving",result:"again",source:"automatic",confirmationCount:1,again:1}]}]};
  summary.overview = stats({activityCount:5,contentCount:4,confirmationCount:3,independent:1,supported:1,again:1,learningDays:1});
  summary.subjects = [english,poem,math];
  summary.days = [{day:range.to,...summary.overview,subjects:[english,poem,math]}];
  summary.items = [
    {id:"english-cat",type:"english",title:"cat · 猫",skill:"english-listening",skillLabel:"听音辨认",confirmationCount:1,independent:1,maxSuccessfulGapDays:7},
    {id:"deleted-poem",type:"poem",title:"咏鹅",skill:"poem-recitation",skillLabel:"背诵",confirmationCount:1,independent:0,maxSuccessfulGapDays:null},
  ];
  summary.trend[6].contentCount = 4;
  return summary;
}
test("all subjects share one dated log, with genuine counts and snapshot titles", async () => {
  const h = harness({summary:mixedSummary}); await h.page.open();
  const html = h.root.innerHTML;
  assert.match(html, /已确认 3 次/);
  assert.match(html, /最长间隔 7 天仍独立完成/);
  assert.match(html, /听音辨认：独立 1 \/ 1 次/);
  assert.match(html, /cat · 猫/);
  assert.match(html, /咏鹅/);
  assert.match(html, /旧词 &lt;script&gt;alert\(&quot;bad&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>|<table>|保存/);
  assert.match(html, /程序判断/);
  assert.match(html, /家长确认/);
  assert.match(html, /练后确认/);
  assert.match(html, /数学 · 2 组/);
  assert.match(html, /提示后完成 1/);
  assert.match(html, /还要练习 1/);
  assert.match(html, /2026-10-02：4 项/);
  assert.match(html, /height:0%/);
  h.button("records-back").onclick();
  assert.equal(h.exits.length, 1);
});

test("week view expands only the newest day and the date view expands its record", async () => {
  const h = harness({summary:range => {
    const summary = mixedSummary(range);
    summary.days.push({...summary.days[0], day:"2026-10-01"});
    return summary;
  }});
  await h.page.open();
  h.clickRange("week");
  assert.equal((h.root.innerHTML.match(/<details class="records-day" open>/g) || []).length, 1);
  assert.equal((h.root.innerHTML.match(/<details class="records-day"/g) || []).length, 2);
});

test("the production model keeps earlier trend data and separates legacy practice from confirmation", async () => {
  const h = harness({realModel:true});
  const activity = (day, id, result, details = {}) => ({schemaVersion:2,id,type:"poem",title:"咏鹅",skill:"poem-recitation",result,source:"parent",day,at:day+"T08:00:00Z",details});
  h.state.activity = {
    older:activity("2026-09-25", "poem-goose", "independent"),
    today:activity("2026-10-02", "poem-goose", "independent"),
    legacy:{id:"english-pear",type:"english",title:"pear · 梨",day:"2026-10-01",listening:"independent"},
  };
  await h.page.open();
  assert.match(h.root.innerHTML, /最长间隔 7 天仍独立完成/);
  assert.match(h.root.innerHTML, /2026-10-01：1 项/);
  assert.match(h.root.innerHTML, /已确认 1 次/);
  h.clickRange("yesterday");
  assert.match(h.root.innerHTML, /pear · 梨/);
  assert.match(h.root.innerHTML, /暂无确认/);
  assert.doesNotMatch(h.root.innerHTML, /已确认 1 次|最长间隔/);
});

test("failed loading can retry without fabricating empty data", async () => {
  let attempts = 0;
  const h = harness({loadState:() => { if (!attempts++) throw new Error("offline"); return {activity:{}}; }});
  await h.page.open();
  assert.match(h.root.innerHTML, /练习记录暂时没有打开/);
  assert.doesNotMatch(h.root.innerHTML, /这一天还没有练习记录/);
  await h.button("records-retry").onclick();
  assert.match(h.root.innerHTML, /练习记录<\/h1>/);
});

test("leaving the page invalidates pending loads and detached controls", async () => {
  let resolve;
  const h = harness({loadState:() => new Promise(yes => { resolve = yes; })});
  h.root.innerHTML = "original";
  const pending = h.page.open(); h.page.stop(); resolve({activity:{}}); await pending;
  assert.equal(h.root.innerHTML, "original");
  assert.equal(h.calls.length, 0);
  const loaded = harness(); await loaded.page.open();
  const date = loaded.button("records-date"), back = loaded.button("records-back");
  loaded.page.stop(); date.onchange({target:{value:"2026-09-01"}}); back.onclick();
  assert.equal(loaded.calls.length, 1);
  assert.equal(loaded.exits.length, 0);
});
