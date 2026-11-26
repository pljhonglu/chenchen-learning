const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sandbox = { window: {}, Intl, Date, setTimeout, clearTimeout };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/garden.js"), "utf8"), sandbox);
const { beijingDay, stageAt, summarize, daySummary, monthInfo } = sandbox.window.ChenchenGarden.helpers;
const plain = value => JSON.parse(JSON.stringify(value));

// The calendar must use the same midnight as the server regardless of the device.
assert.equal(beijingDay(new Date("2026-10-02T15:59:59Z")), "2026-10-02");
assert.equal(beijingDay(new Date("2026-10-02T16:00:00Z")), "2026-10-03");
assert.deepEqual(plain(monthInfo(2024, 2)), { days: 29, offset: 3 });
assert.deepEqual(plain(monthInfo(2026, 11)), { days: 30, offset: 6 });

// Leaves appear only after water is used, with ongoing adult-tree stages.
assert.equal(stageAt(11).index, 0);
assert.equal(stageAt(11).remaining, 1);
assert.equal(stageAt(12).index, 1);
assert.equal(stageAt(12).progress, 0);
assert.equal(stageAt(143).index, 11);
assert.equal(stageAt(144).index, 12);
assert.equal(stageAt(180).index, 15);
assert.equal(stageAt(192).index, 12);
assert.equal(stageAt(192).milestone, 16);
assert.equal(stageAt(192).nextTitle, "又有小花苞");

const state = { garden: { groups: {
  previous: { id: "previous", day: "2026-09-30", type: "poem", count: 5, waterAwarded: 1 },
  first: { id: "first", day: "2026-10-01", type: "write", count: 5, waterAwarded: 1 },
  second: { id: "second", day: "2026-10-01", type: "math", count: 10, waterAwarded: 1 },
  third: { id: "third", day: "2026-10-01", type: "english", count: 5, waterAwarded: 1 },
  cap: { id: "cap", day: "2026-10-01", type: "poem", count: 5, waterAwarded: 0 },
}, watering: {
  first: { id: "first", day: "2026-10-01", total: 1 },
  second: { id: "second", day: "2026-10-01", total: 2 },
}, gifts: { "1": { milestone: 1, day: "2026-09-30", waterTotal: 12 } } } };
let summary = summarize(state, "2026-10-01");
assert.equal(summary.balance, 2, "Stored water carries across month boundaries");
assert.equal(summary.earnedToday, 3, "A saved group with no reward does not add water");
assert.equal(summary.dayGroups.length, 4, "Unrewarded full groups remain in the calendar");
assert.equal(summary.wateredToday, 2);
assert.equal(summary.canWater, true);
assert.equal(summary.total, 2, "Growth comes from actual watering events, not rewards");
assert.equal(summarize(state, "2026-10-02").canWater, false, "Stored water cannot be used without a full group today");
state.garden.watering.third = { id: "third", day: "2026-10-01", total: 3 };
summary = summarize(state, "2026-10-01");
assert.equal(summary.balance, 1);
assert.equal(summary.canWater, false, "Three waterings is a hard daily ceiling even with stored water");
const previous = daySummary(summary, "2026-09-30");
assert.equal(previous.earned, 1);
assert.equal(previous.waterings.length, 0, "Calendar income and water used remain separate");
assert.equal(previous.gifts.length, 1);
assert.equal(daySummary(summary, "2026-10-02").groups.length, 0);
assert.equal(summarize({}, "2026-10-01").canWater, false, "Legacy state starts an empty garden");
assert.equal(summarize({}, "2026-10-01").stage.index, 0);

// A lost response must keep its request id even if the child leaves the garden.
// Reopening while that request is still pending must not leave a disabled button.
async function checkPendingWater() {
  const controls = new Map();
  const root = {
    isConnected: true, innerHTML: "",
    querySelector(selector) {
      if (!controls.has(selector)) controls.set(selector, { disabled: false, isConnected: true, addEventListener() {}, classList: { remove() {} }, remove() {} });
      return controls.get(selector);
    },
    querySelectorAll() { return []; },
  };
  let snapshot = { garden: { groups: { first: { id: "first", type: "poem", count: 5, day: "2026-10-01", waterAwarded: 1 } }, watering: {}, gifts: {} } };
  let request;
  const requestIds = [];
  const uiSandbox = { window: {}, document: { getElementById() { return null; } }, Intl, Date, setTimeout() { return 1; }, clearTimeout() {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/garden.js"), "utf8"), uiSandbox);
  const ui = uiSandbox.window.ChenchenGarden;
  const hooks = {
    root, loadState: () => snapshot, todayStr: () => "2026-10-01", isActive: () => true, reviewGroups: [],
    navigate() {}, queueServerTask: task => task(),
    acceptServerState(response) { snapshot = response.payload; },
    apiFetch(_, options) {
      requestIds.push(JSON.parse(options.body).id);
      return new Promise((resolve, reject) => { request = { resolve, reject }; });
    },
  };
  ui.renderHome(hooks);
  const firstAttempt = controls.get('[data-g-action="water"]').onclick();
  ui.stop();
  ui.renderHome(hooks);
  assert.match(root.innerHTML, /正在浇水/);
  request.reject(new Error("Connection lost"));
  await firstAttempt;
  assert.match(root.innerHTML, /重试这次浇水/, "Reopened garden refreshes a request that ended in the background");
  const retry = controls.get('[data-g-action="water"]').onclick();
  assert.equal(requestIds[1], requestIds[0], "Leaving and returning cannot generate a second water request id");
  const waterId = requestIds[0];
  snapshot.garden.watering[waterId] = { id: waterId, day: "2026-10-01", total: 1 };
  request.resolve({ ok: true, payload: snapshot });
  await retry;
  assert.match(root.innerHTML, /水滴用完啦，今天先休息/);
  assert.doesNotMatch(root.innerHTML, /正在浇水|重试这次浇水/);

  // Another device may use the third allowance between render and submit.
  snapshot = { garden: { groups: {
    first: { day: "2026-10-01", waterAwarded: 1 },
    second: { day: "2026-10-01", waterAwarded: 1 },
    third: { day: "2026-10-01", waterAwarded: 1 },
  }, watering: {
    first: { id: "one", day: "2026-10-01", total: 1 },
    second: { id: "two", day: "2026-10-01", total: 2 },
  }, gifts: {} } };
  ui.renderHome(hooks);
  const capped = controls.get('[data-g-action="water"]').onclick();
  snapshot.garden.watering.third = { id: "three", day: "2026-10-01", total: 3 };
  request.reject(Object.assign(new Error("daily_limit"), { status: 429, data: { payload: snapshot } }));
  await capped;
  assert.match(root.innerHTML, /小树今天喝好啦，明天再来照顾它吧/);
  assert.doesNotMatch(root.innerHTML, /重试这次浇水|还没确认浇水成功/);
  ui.stop();
}

checkPendingWater().then(() => {
  console.log("Garden calendar, limits, Beijing midnight, ongoing growth, retry after navigation, and 429 rest checks passed.");
}).catch(error => { console.error(error); process.exitCode = 1; });
