#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../public/learning-model.js"),"utf8"), context);
const model = context.ChenchenLearning;
const plain = value => JSON.parse(JSON.stringify(value));

function check(overrides = {}) {
  return model.createActivity({id:"poem-1",type:"poem",title:"咏鹅",skill:"poem-recitation",result:"independent",source:"parent",day:"2026-10-02",at:"2026-10-02T12:00:00+08:00",...overrides});
}
function summary(activities, options = {}, other = {}) {
  return model.summarize({activity:Object.fromEntries(activities.map((activity,index) => [String(index),activity])),...other},{today:"2026-10-02",...options});
}
function freeze(value) {
  if (!value || typeof value !== "object") return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

test("all subjects share the same three confirmation choices", () => {
  assert.deepEqual(plain(model.RATINGS),[
    {id:"independent",label:"自己完成",icon:"✓"},
    {id:"supported",label:"提示后完成",icon:"◐"},
    {id:"again",label:"还要练习",icon:"↻"},
  ]);
  assert.equal(model.resultLabel("practice"),"已练习");
  assert.equal(model.typeLabel("decomp"),"分解组合");
  assert.equal(model.skillLabel("hanzi-writing"),"书写");
});

test("createActivity preserves a title snapshot, normalizes the timestamp and copies details", () => {
  const details = {method:"paper",correct:4,total:5,symbols:["b","p"],nested:{value:true}};
  const activity = check({title:"  古诗·咏鹅  ", details});
  assert.equal(activity.schemaVersion,2);
  assert.equal(activity.title,"古诗·咏鹅");
  assert.equal(activity.at,"2026-10-02T04:00:00.000Z");
  assert.deepEqual(plain(activity.details),details);
  activity.details.symbols.push("m");
  assert.equal(details.symbols.length,2);
  assert.throws(() => model.createActivity({id:" "}),/content id/);
});

test("participation and unsupported sources cannot create confirmation evidence", () => {
  assert.equal(check({source:"practice"}).result,"practice");
  assert.equal(check({source:"unknown"}).result,"practice");
  assert.equal(check({result:"remember"}).result,"practice");
  const result = summary([check({source:"practice"}),check({source:"unknown"}),check({result:"remember"})]);
  assert.equal(result.overview.activityCount,3);
  assert.equal(result.overview.confirmationCount,0);
  assert.equal(result.overview.independentRate,null);
});

test("legacy results and old English listening observations never imply new confirmation", () => {
  const result = summary([
    {id:"old-poem",type:"poem",day:"2026-10-01",result:"remember"},
    {id:"english-cat",type:"english",day:"2026-10-02",listening:"independent",speaking:true},
    {id:"english-dog",type:"english",day:"2026-10-02",listening:"supported"},
  ]);
  assert.equal(result.overview.activityCount,3);
  assert.equal(result.overview.contentCount,3);
  assert.equal(result.overview.confirmationCount,0);
  const english = result.days[0].subjects[0];
  assert.equal(english.items[0].skills[0].result,"practice");
  assert.equal(english.items[0].skills[0].source,"legacy");
  assert.equal(english.items[0].skills[0].historyNote,"历史听音练习：自己完成");
});

test("repeated same-day practice keeps all activity records but only the first valid check", () => {
  const result = summary([
    check({source:"practice",at:"2026-10-02T01:00:00Z"}),
    check({result:"again",at:"2026-10-02T02:00:00Z"}),
    check({result:"independent",at:"2026-10-02T03:00:00Z"}),
    check({result:"independent",at:"2026-10-02T04:00:00Z"}),
  ]);
  assert.equal(result.overview.activityCount,4);
  assert.equal(result.overview.contentCount,1);
  assert.equal(result.overview.confirmationCount,1);
  assert.equal(result.overview.again,1);
  assert.equal(result.overview.independentRate,0);
  assert.equal(result.days[0].subjects[0].items[0].skills[0].result,"again");
  assert.equal(result.items[0].lastResult,"again");
});

test("first evidence uses real timestamps rather than object insertion order", () => {
  const result = summary([
    check({result:"independent",at:"2026-10-02T15:00:00Z"}),
    check({result:"supported",at:"2026-10-02T08:00:00Z"}),
    check({result:"again",at:"2026-10-02T12:00:00+08:00"}),
  ]);
  assert.equal(result.overview.again,1);
  assert.equal(result.overview.confirmationCount,1);
});

test("missing or invalid timestamps have a stable day-start fallback", () => {
  const first = {...check({result:"supported"}),at:"not-a-time"};
  const second = {...check({result:"independent"})};
  delete second.at;
  const state = {activity:{"earlier-key":first,"later-key":second}};
  const one = model.summarize(state,{today:"2026-10-02"});
  const two = model.summarize(state,{today:"2026-10-02"});
  assert.equal(one.overview.supported,1);
  assert.deepEqual(plain(one),plain(two));
});

test("reading and writing of one character are separate abilities but one content", () => {
  const result = summary([
    check({id:"write-木",type:"write",title:"木",skill:"hanzi-recognition",result:"independent"}),
    check({id:"write-木",type:"write",title:"木",skill:"hanzi-writing",result:"supported"}),
  ]);
  assert.equal(result.overview.contentCount,1);
  assert.equal(result.overview.confirmationCount,2);
  assert.equal(result.overview.independentRate,0.5);
  assert.equal(result.items.length,2);
  assert.equal(result.days[0].subjects[0].items[0].skills.length,2);
});

test("subject, skill, and content identities do not collide", () => {
  const result = summary([
    check({id:"same",type:"math",skill:"math-solving",source:"automatic"}),
    check({id:"same",type:"decomp",skill:"math-solving",source:"automatic",result:"supported"}),
    check({id:"same",type:"english",skill:"english-listening",source:"automatic",result:"again"}),
  ]);
  assert.equal(result.overview.contentCount,3);
  assert.equal(result.overview.confirmationCount,3);
  assert.deepEqual(plain(result.subjects.map(subject => subject.type)),["english","math","decomp"]);
  assert.equal(result.subjects.find(subject => subject.type === "math").independent,1);
});

test("date range boundaries are inclusive; future and malformed days are excluded", () => {
  const result = summary([
    check({day:"2026-09-29"}),check({day:"2026-09-30"}),check({day:"2026-10-01"}),check({day:"2026-10-02"}),check({day:"2026-10-03"}),
    {...check(),day:"2026-02-30"},{...check(),day:"2026-2-2"},{...check(),day:"invalid"},
  ],{from:"2026-09-30",to:"2026-10-02"});
  assert.equal(result.overview.activityCount,3);
  assert.equal(result.overview.learningDays,3);
  assert.deepEqual(plain(result.days.map(day => day.day)),["2026-10-02","2026-10-01","2026-09-30"]);
  assert.equal(result.trend.length,7);
  assert.equal(result.trend[0].day,"2026-09-26");
  assert.equal(result.trend[6].day,"2026-10-02");
  assert.equal(result.trend[2].contentCount,0);
});

test("leap dates and reversed date ranges are handled without inventing activity", () => {
  const result = summary([{...check(),day:"2024-02-29"},{...check(),day:"2023-02-29"}],{to:"2024-02-29"});
  assert.equal(result.overview.activityCount,1);
  assert.equal(result.trend[0].day,"2024-02-23");
  assert.equal(summary([check()],{from:"2026-10-03",to:"2026-10-01"}).overview.activityCount,0);
});

test("a single-day log filter does not erase the preceding days from the seven-day trend", () => {
  const result = summary([
    check({day:"2026-09-26"}),check({day:"2026-09-29"}),check({day:"2026-10-02"}),
  ],{from:"2026-10-02",to:"2026-10-02"});
  assert.equal(result.overview.activityCount,1);
  assert.equal(result.days.length,1);
  assert.equal(result.trend[0].contentCount,1);
  assert.equal(result.trend[3].contentCount,1);
  assert.equal(result.trend[6].contentCount,1);
});

test("cross-day independent checks expose evidence counts and the recorded gap", () => {
  const result = summary([
    check({day:"2026-09-20",result:"again"}),
    check({day:"2026-09-25",result:"independent"}),
    check({day:"2026-10-02",result:"independent"}),
  ]);
  assert.equal(result.items[0].confirmationCount,3);
  assert.equal(result.items[0].independentDays,2);
  assert.equal(result.items[0].delayedIndependentDays,2);
  assert.equal(result.items[0].maxSuccessfulGapDays,7);
  assert.equal(result.overview.delayedConfirmationCount,2);
  assert.equal(result.overview.delayedIndependent,2);
});

test("a single successful check is not evidence of delayed retention", () => {
  const result = summary([check()]);
  assert.equal(result.items[0].independentRate,1);
  assert.equal(result.items[0].confirmationCount,1);
  assert.equal(result.items[0].independentDays,1);
  assert.equal(result.items[0].delayedIndependentDays,0);
  assert.equal(result.items[0].maxSuccessfulGapDays,null);
  assert.equal(result.overview.delayedConfirmationCount,0);
});

test("practice-before-check flags preserve the result but exclude delayed evidence", () => {
  for (const flag of ["afterPractice","observedExposure","exposureFirst"]) {
    const result = summary([
      check({day:"2026-09-20"}),
      check({day:"2026-10-02",details:{[flag]:true}}),
    ]);
    assert.equal(result.overview.independent,2);
    assert.equal(result.overview.delayedIndependent,0);
    assert.equal(result.items[0].maxSuccessfulGapDays,null);
    assert.equal(result.items[0].lastResultAfterPractice,true);
    assert.equal(result.days[0].subjects[0].items[0].skills[0].afterPractice,true);
  }
});

test("practice earlier on the same day prevents a delayed-recall claim", () => {
  const result = summary([
    check({day:"2026-09-20"}),
    check({source:"practice",at:"2026-10-02T01:00:00Z"}),
    check({at:"2026-10-02T02:00:00Z"}),
  ]);
  assert.equal(result.overview.independent,2);
  assert.equal(result.overview.delayedIndependent,0);
  assert.equal(result.items[0].maxSuccessfulGapDays,null);
});

test("prior history may establish a gap even when it falls outside the displayed range", () => {
  const result = summary([
    check({day:"2026-09-25",source:"practice"}),check(),
  ],{from:"2026-10-01"});
  assert.equal(result.overview.activityCount,1);
  assert.equal(result.items[0].delayedIndependentDays,1);
  assert.equal(result.items[0].maxSuccessfulGapDays,7);
});

test("missing and empty state returns zero counters and a complete seven-day trend", () => {
  const result = model.summarize(null,{today:"2026-10-02"});
  assert.equal(result.overview.activityCount,0);
  assert.equal(result.overview.independentRate,null);
  assert.equal(result.trend.length,7);
  assert.equal(result.days.length,0);
  assert.equal(result.subjects.length,0);
  assert.equal(result.items.length,0);
  assert.equal(result.from,"2026-10-02");
});

test("deleted content retains its title snapshot, and legacy titles can use current metadata", () => {
  const result = summary([
    check({id:"deleted-poem",title:"已删除的诗"}),
    {id:"legacy-poem",type:"poem",day:"2026-10-01"},
  ],{}, {items:{"legacy-poem":{title:"静夜思"}}});
  assert.equal(result.days[0].subjects[0].items[0].title,"已删除的诗");
  assert.equal(result.days[1].subjects[0].items[0].title,"静夜思");
});

test("unknown types get a safe fallback label while unsafe text remains data for the UI to escape", () => {
  const title = '<img src=x onerror="alert(1)">';
  const result = summary([check({type:"__proto__",title,skill:"<b>自定义</b>"})]);
  assert.equal(result.subjects[0].type,"other");
  assert.equal(result.subjects[0].label,"其他");
  assert.equal(result.items[0].title,title);
  assert.equal(result.items[0].skillLabel,"<b>自定义</b>");
});

test("summarizing never mutates input records or nested details", () => {
  const state = freeze({items:{},activity:{a:plain(check({details:{symbols:["b","p"]}})),b:plain(check({result:"again"}))}});
  const before = JSON.stringify(state);
  model.summarize(state,{today:"2026-10-02"});
  assert.equal(JSON.stringify(state),before);
});

test("details omit functions, dangerous object keys, circular tails and nonfinite numbers", () => {
  const details = JSON.parse('{"__proto__":{"polluted":true},"constructor":{},"valid":"ok"}');
  details.bad = () => {};
  details.infinity = Infinity;
  details.loop = details;
  const activity = check({details});
  assert.equal(activity.details.valid,"ok");
  assert.equal(activity.details.infinity,null);
  assert.equal(Object.prototype.hasOwnProperty.call(activity.details,"__proto__"),false);
  assert.equal(Object.prototype.hasOwnProperty.call(activity.details,"bad"),false);
  assert.doesNotThrow(() => JSON.stringify(activity));
});
