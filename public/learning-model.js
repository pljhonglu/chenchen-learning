/* Shared learning evidence. Practice is participation; only explicit checks are evidence. */
(function (root) {
  "use strict";

  const RATINGS = Object.freeze([
    Object.freeze({id:"independent", label:"自己完成", icon:"✓"}),
    Object.freeze({id:"supported", label:"提示后完成", icon:"◐"}),
    Object.freeze({id:"again", label:"还要练习", icon:"↻"}),
  ]);
  const TYPE_LABELS = Object.freeze({poem:"古诗", english:"英语", write:"汉字", pinyin:"拼音", math:"数学", decomp:"分解组合", other:"其他"});
  const SKILL_LABELS = Object.freeze({
    "poem-recitation":"背诵", "english-listening":"听音辨认", "english-speaking":"开口表达",
    "hanzi-recognition":"认字", "hanzi-writing":"书写", "pinyin-reading":"拼音认读", "math-solving":"解题",
    general:"综合练习", practice:"练习", legacy:"历史练习",
  });
  const RESULTS = new Set(RATINGS.map(rating => rating.id));
  const SOURCES = new Set(["parent", "automatic", "practice"]);
  const DAY_MS = 86400000;
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const record = value => !!value && typeof value === "object" && !Array.isArray(value);
  const text = value => typeof value === "string" ? value.trim() : "";
  const typeOf = value => own(TYPE_LABELS, value) ? value : "other";
  const typeLabel = value => TYPE_LABELS[typeOf(value)];
  const skillLabel = value => own(SKILL_LABELS, value) ? SKILL_LABELS[value] : (text(value) || SKILL_LABELS.general);
  const resultLabel = value => RATINGS.find(rating => rating.id === value)?.label || "已练习";

  function validDay(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(value + "T00:00:00.000Z");
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }
  function localDay(date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
  }
  function dayNumber(day) { return Date.parse(day + "T00:00:00.000Z") / DAY_MS; }
  function addDays(day, delta) { return new Date((dayNumber(day) + delta) * DAY_MS).toISOString().slice(0, 10); }
  function timestamp(value) {
    if (typeof value === "number") return Number.isFinite(value) && Number.isFinite(new Date(value).getTime()) ? value : null;
    if (typeof value !== "string" || !value.trim()) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  // Clone JSON-shaped details, omitting prototypes, functions and excessively deep data.
  function copyDetails(value, depth) {
    if (depth > 8) return undefined;
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (Array.isArray(value)) return value.slice(0, 1000).map(entry => copyDetails(entry, depth + 1)).filter(entry => entry !== undefined);
    if (!record(value)) return undefined;
    const copied = {};
    for (const [key, entry] of Object.entries(value).slice(0, 1000)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) continue;
      const next = copyDetails(entry, depth + 1);
      if (next !== undefined) copied[key] = next;
    }
    return copied;
  }

  function createActivity(input = {}) {
    const id = text(input.id);
    if (!id) throw new TypeError("An activity needs a content id");
    const now = new Date();
    const suppliedAt = timestamp(input.at);
    const at = new Date(suppliedAt === null ? now.getTime() : suppliedAt);
    const source = SOURCES.has(input.source) ? input.source : "practice";
    return {
      schemaVersion:2, id, type:typeOf(input.type), title:text(input.title) || id,
      skill:text(input.skill) || "general",
      result:source !== "practice" && RESULTS.has(input.result) ? input.result : "practice",
      source, day:validDay(input.day) ? input.day : localDay(at), at:at.toISOString(),
      details:record(input.details) ? copyDetails(input.details, 0) : {},
    };
  }

  function normalize(state) {
    const entries = record(state?.activity) ? Object.entries(state.activity) : [];
    const activities = [];
    for (const [key, raw] of entries) {
      if (!record(raw) || !validDay(raw.day) || !text(raw.id)) continue;
      const id = text(raw.id), type = typeOf(raw.type);
      const modern = raw.schemaVersion === 2;
      const source = modern && SOURCES.has(raw.source) ? raw.source : (modern ? "practice" : "legacy");
      const confirmed = modern && source !== "practice" && RESULTS.has(raw.result);
      const at = timestamp(raw.at);
      const item = record(state?.items) && own(state.items, id) ? state.items[id] : null;
      const customPoem = record(state?.customPoems) && own(state.customPoems, id) ? state.customPoems[id] : null;
      const title = text(raw.title) || text(item?.title) || text(customPoem?.title) || id;
      const historyNote = !modern && type === "english" && ["independent", "supported"].includes(raw.listening)
        ? `历史听音练习：${resultLabel(raw.listening)}` : "";
      const details = record(raw.details) ? copyDetails(raw.details, 0) : {};
      activities.push({
        key, index:activities.length, id, type, title, day:raw.day,
        at:at === null ? null : new Date(at).toISOString(), sortAt:at === null ? dayNumber(raw.day)*DAY_MS : at,
        skill:modern ? (text(raw.skill) || "general") : "legacy",
        source, result:confirmed ? raw.result : "practice", confirmed, countedConfirmation:false,
        details, historyNote, afterPractice:[details.afterPractice,details.observedExposure,details.exposureFirst].some(value => value === true),
        delayedEligible:false, gapDays:null,
      });
    }
    activities.sort((a,b) => a.day.localeCompare(b.day) || a.sortAt-b.sortAt || a.index-b.index);
    const checked = new Set(), previous = new Map();
    for (const activity of activities) {
      const key = JSON.stringify([activity.day, activity.type, activity.id, activity.skill]);
      const contentKey = JSON.stringify([activity.type,activity.id,activity.skill]);
      const earlier = previous.get(contentKey);
      if (activity.confirmed && !checked.has(key)) {
        activity.countedConfirmation = true;
        checked.add(key);
        if (earlier && earlier.day < activity.day) {
          activity.gapDays = dayNumber(activity.day)-dayNumber(earlier.day);
          activity.delayedEligible = !activity.afterPractice;
        }
      }
      previous.set(contentKey,activity);
    }
    return activities;
  }

  function counts(activities) {
    const evidence = activities.filter(activity => activity.countedConfirmation);
    const independent = evidence.filter(activity => activity.result === "independent").length;
    return {
      activityCount:activities.length,
      contentCount:new Set(activities.map(activity => JSON.stringify([activity.type,activity.id]))).size,
      confirmationCount:evidence.length, independent,
      supported:evidence.filter(activity => activity.result === "supported").length,
      again:evidence.filter(activity => activity.result === "again").length,
      independentRate:evidence.length ? independent / evidence.length : null,
      delayedConfirmationCount:evidence.filter(activity => activity.delayedEligible).length,
      delayedIndependent:evidence.filter(activity => activity.delayedEligible && activity.result === "independent").length,
      learningDays:new Set(activities.map(activity => activity.day)).size,
    };
  }

  function group(activities, getKey) {
    const groups = new Map();
    for (const activity of activities) {
      const key = getKey(activity);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(activity);
    }
    return [...groups.values()];
  }

  function lastResult(activities) {
    const lastDay = activities[activities.length - 1].day;
    const lastDayActivities = activities.filter(activity => activity.day === lastDay);
    return lastDayActivities.find(activity => activity.countedConfirmation) || lastDayActivities[lastDayActivities.length - 1];
  }

  function itemEvidence(activities) {
    const last = activities[activities.length - 1], selected = lastResult(activities);
    // Gaps refer to recorded activities; offline practice remains unknown.
    const delayedIndependent = activities.filter(activity => activity.delayedEligible && activity.result === "independent");
    const maxSuccessfulGapDays = delayedIndependent.length ? Math.max(...delayedIndependent.map(activity => activity.gapDays)) : null;
    return {
      id:last.id, type:last.type, title:last.title, skill:last.skill, skillLabel:skillLabel(last.skill),
      ...counts(activities),
      independentDays:new Set(activities.filter(activity => activity.countedConfirmation && activity.result === "independent").map(activity => activity.day)).size,
      delayedIndependentDays:new Set(delayedIndependent.map(activity => activity.day)).size,
      maxSuccessfulGapDays, lastResult:selected.result, lastResultAfterPractice:selected.afterPractice, lastDay:last.day,
    };
  }

  function contentItems(activities) {
    return group(activities, activity => JSON.stringify([activity.type,activity.id])).map(content => {
      const last = content[content.length - 1];
      return {
        id:last.id, type:last.type, title:last.title, ...counts(content),
        skills:group(content, activity => activity.skill).map(skill => {
          const result = lastResult(skill);
          return {
            skill:result.skill, label:skillLabel(result.skill), result:result.result, resultLabel:resultLabel(result.result),
            source:result.source, historyNote:result.historyNote, afterPractice:result.afterPractice, ...counts(skill),
          };
        }),
      };
    });
  }

  function subjects(activities) {
    return group(activities, activity => activity.type)
      .map(subject => ({type:subject[0].type, label:typeLabel(subject[0].type), ...counts(subject), items:contentItems(subject)}))
      .sort((a,b) => Object.keys(TYPE_LABELS).indexOf(a.type) - Object.keys(TYPE_LABELS).indexOf(b.type));
  }

  function summarize(state = {}, options = {}) {
    const today = validDay(options.today) ? options.today : localDay(new Date());
    const to = validDay(options.to) ? options.to : today;
    const all = normalize(state);
    const from = validDay(options.from) ? options.from : (all.find(activity => activity.day <= to)?.day || to);
    const activities = all.filter(activity => activity.day >= from && activity.day <= to);
    const days = group(activities, activity => activity.day)
      .map(day => ({day:day[0].day, ...counts(day), subjects:subjects(day)})).reverse();
    const trend = Array.from({length:7}, (_,index) => {
      const day = addDays(to,index-6);
      return {day, ...counts(all.filter(activity => activity.day === day))};
    });
    return {
      from, to, today, overview:counts(activities), days, subjects:subjects(activities), trend,
      items:group(activities, activity => JSON.stringify([activity.type,activity.id,activity.skill])).map(itemEvidence),
    };
  }

  root.ChenchenLearning = Object.freeze({RATINGS, TYPE_LABELS, SKILL_LABELS, typeLabel, skillLabel, resultLabel, createActivity, summarize});
})(typeof window !== "undefined" ? window : globalThis);
