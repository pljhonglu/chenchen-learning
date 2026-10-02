/* One read-only, date-led view of practice and recall evidence across subjects. */
(function (global) {
  "use strict";

  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const count = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
  const typeClass = type => ["poem", "english", "write", "pinyin", "math", "decomp"].includes(type) ? type : "other";
  function validDate(day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "")) return false;
    const date = new Date(day + "T12:00:00Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
  }
  function offsetDate(day, offset) {
    const date = new Date(day + "T12:00:00Z");
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  }
  function shortDate(day) {
    const parts = day.split("-");
    return `${Number(parts[1])}月${Number(parts[2])}日`;
  }

  function create(hooks) {
    const root = hooks.root;
    let active = false, generation = 0, mode = "today", selectedDate = "", today = "", snapshot;
    const model = () => global.ChenchenLearning;
    const resultLabel = result => model().resultLabel(result);
    function range() {
      if (mode === "yesterday") { const day = offsetDate(today, -1); return {from:day, to:day}; }
      if (mode === "week") return {from:offsetDate(today, -6), to:today};
      if (mode === "date") return {from:selectedDate, to:selectedDate};
      return {from:today, to:today};
    }
    function dateLabel(day) {
      const name = day === today ? "今天" : day === offsetDate(today, -1) ? "昨天" : "";
      const year = day.slice(0, 4) === today.slice(0, 4) ? "" : `${day.slice(0, 4)}年`;
      return `${name ? name + " · " : ""}${year}${shortDate(day)}`;
    }
    function resultSummary(stats) {
      if (!count(stats.confirmationCount)) return '<span class="records-practiced">已练习 · 暂无确认</span>';
      return ["independent", "supported", "again"].filter(key => count(stats[key])).map(key => `<span class="records-result records-result-${key}">${escape(resultLabel(key))} ${count(stats[key])}</span>`).join("");
    }
    function overview(stats) {
      const confirmations = count(stats.confirmationCount), independent = count(stats.independent);
      return `<div class="records-overview" aria-label="所选日期的学习统计"><div class="records-stat"><span>学习天数</span><strong>${count(stats.learningDays)}<small> 天</small></strong></div><div class="records-stat"><span>不同内容</span><strong>${count(stats.contentCount)}<small> 项</small></strong></div><div class="records-stat records-stat-confirm"><span>独立完成</span>${confirmations ? `<strong>${independent}<small> / ${confirmations}</small></strong><small>已确认 ${confirmations} 次</small>` : '<strong class="records-no-confirm">暂无确认</strong>'}</div></div>`;
    }
    function trendChart(summary) {
      const days = summary.trend || [], highest = Math.max(1, ...days.map(day => count(day.contentCount)));
      const dates = days.length ? `${shortDate(days[0].day)}—${shortDate(days[days.length - 1].day)}` : "";
      return `<section class="records-panel records-trend"><div class="records-section-heading"><h2>近 7 天练习</h2><span>${escape(dates)}</span></div><p class="records-caption">每天练过的不同内容</p><div class="records-bars" role="img" aria-label="${escape(days.map(day => `${day.day}：${count(day.contentCount)} 项`).join("；"))}">${days.map(day => {
        const total = count(day.contentCount), height = total ? Math.max(5, total / highest * 100) : 0;
        return `<div class="records-bar-column${day.day === today ? " is-today" : ""}"><span class="records-bar-value">${total}</span><div class="records-bar-track"><span style="height:${height}%"></span></div><span class="records-bar-date">${day.day === today ? "今天" : `${Number(day.day.slice(5, 7))}/${Number(day.day.slice(8, 10))}`}</span></div>`;
      }).join("")}</div></section>`;
    }
    function subjectOverview(summary) {
      const subjects = summary.subjects || [];
      if (!subjects.length) return "";
      const maximum = Math.max(1, ...subjects.map(subject => count(subject.contentCount)));
      return `<section class="records-panel records-subjects"><div class="records-section-heading"><h2>练了哪些内容</h2></div><div class="records-subject-list">${subjects.map(subject => {
        const skills = new Map();
        for (const item of summary.items || []) {
          if (item.type !== subject.type || !item.skill) continue;
          const skill = skills.get(item.skill) || {label:item.skillLabel || model().skillLabel(item.skill), confirmationCount:0, independent:0, maxSuccessfulGapDays:0};
          skill.confirmationCount += count(item.confirmationCount);
          skill.independent += count(item.independent);
          skill.maxSuccessfulGapDays = Math.max(skill.maxSuccessfulGapDays, count(item.maxSuccessfulGapDays));
          skills.set(item.skill, skill);
        }
        const confirmations = Array.from(skills.values()).filter(skill => skill.confirmationCount);
        return `<div class="records-subject records-type-${typeClass(subject.type)}"><div class="records-subject-title"><h3>${escape(subject.label || model().typeLabel(subject.type))}</h3><span>${count(subject.contentCount)} 项</span></div><div class="records-subject-track" aria-hidden="true"><span style="width:${count(subject.contentCount) / maximum * 100}%"></span></div><div class="records-skill-summary">${confirmations.length ? confirmations.map(skill => `<span>${escape(skill.label)}：独立 ${skill.independent} / ${skill.confirmationCount} 次</span>${skill.maxSuccessfulGapDays ? `<span>最长间隔 ${skill.maxSuccessfulGapDays} 天仍独立完成</span>` : ""}`).join("") : '<span>已练习 · 暂无确认</span>'}</div></div>`;
      }).join("")}</div></section>`;
    }
    function itemChip(item) {
      const skills = item.skills || [], confirmed = skills.filter(skill => count(skill.confirmationCount));
      const note = confirmed.length ? confirmed.map(skill => `${skill.label || model().skillLabel(skill.skill)}：${skill.resultLabel || resultLabel(skill.result)}`).join("；") : "已练习";
      const caption = !confirmed.length ? "已练习" : confirmed.every(skill => skill.afterPractice) ? "练后确认" : "";
      return `<span class="records-content-chip" title="${escape(note)}"><span>${escape(item.title || "学习内容")}</span>${caption ? `<small>${caption}</small>` : ""}</span>`;
    }
    function dayLog(summary) {
      const days = summary.days || [];
      return `<section class="records-history"><div class="records-section-heading"><h2>每天的小记录</h2></div>${days.length ? days.map((day, index) => `<details class="records-day"${mode !== "week" || index === 0 ? " open" : ""}><summary><span><strong>${escape(dateLabel(day.day))}</strong><small>${count(day.contentCount)} 项内容</small></span><span class="records-day-caret" aria-hidden="true">⌄</span></summary><div class="records-day-body">${(day.subjects || []).map(subject => {
        const sources = new Set((subject.items || []).flatMap(item => (item.skills || []).filter(skill => count(skill.confirmationCount)).map(skill => skill.source)));
        const sourceText = [sources.has("automatic") ? "程序判断" : "", sources.has("parent") ? "家长确认" : ""].filter(Boolean).join(" · ");
        const groupText = ["math", "decomp"].includes(subject.type) ? `${count(subject.activityCount)} 组` : "";
        return `<div class="records-day-subject records-type-${typeClass(subject.type)}"><div class="records-day-subject-heading"><h3>${escape(subject.label || model().typeLabel(subject.type))}${groupText ? ` · ${groupText}` : ""}</h3>${sourceText ? `<small>${sourceText}</small>` : ""}</div><div class="records-content-list">${(subject.items || []).map(itemChip).join("")}</div><div class="records-result-summary">${resultSummary(subject)}</div></div>`;
      }).join("")}</div></details>`).join("") : `<div class="records-empty"><span aria-hidden="true">♧</span><p>${mode === "week" ? "这几天" : "这一天"}还没有练习记录</p></div>`}</section>`;
    }
    function render() {
      if (!active) return;
      const dates = range(), summary = model().summarize(snapshot, {...dates, today});
      const period = dates.from === dates.to ? dateLabel(dates.to) : `${shortDate(dates.from)}—${shortDate(dates.to)}`;
      root.innerHTML = `<div class="learning-records"><button class="back-btn" id="records-back">← 返回</button><div class="records-heading"><div><h1>练习记录</h1><p>${escape(period)}</p></div><span class="records-heading-flower" aria-hidden="true">✿</span></div><div class="records-filters"><div class="records-presets" aria-label="记录日期">${[["today","今天"],["yesterday","昨天"],["week","近 7 天"]].map(([key, label]) => `<button data-records-range="${key}" class="${mode === key ? "active" : ""}" aria-pressed="${mode === key}">${label}</button>`).join("")}</div><label class="records-date-picker"><span>查看日期</span><input type="date" id="records-date" aria-label="选择练习记录日期" max="${today}" value="${mode === "date" ? selectedDate : ""}"></label></div><p class="records-date-error" id="records-date-error" role="status" hidden></p>${overview(summary.overview || {})}<div class="records-insights">${trendChart(summary)}${subjectOverview(summary)}</div>${dayLog(summary)}</div>`;
      root.querySelector("#records-back").onclick = () => { if (active) hooks.onBack(); };
      root.querySelectorAll("[data-records-range]").forEach(button => {
        button.onclick = () => { if (!active) return; mode = button.dataset.recordsRange; render(); };
      });
      root.querySelector("#records-date").onchange = event => {
        if (!active) return;
        const value = event.target.value;
        if (!validDate(value) || value > today) {
          const error = root.querySelector("#records-date-error");
          error.textContent = "请选择今天或更早的日期"; error.hidden = false; return;
        }
        selectedDate = value; mode = "date"; render();
      };
    }
    async function open() {
      active = true;
      const token = ++generation;
      try {
        today = hooks.todayStr();
        if (!validDate(today) || !model()?.summarize) throw new Error("Records are not ready");
        if (selectedDate > today) { mode = "today"; selectedDate = ""; }
        const state = await hooks.loadState();
        if (!active || token !== generation) return;
        snapshot = state;
        render();
      } catch (_) {
        if (!active || token !== generation) return;
        root.innerHTML = '<div class="learning-records"><button class="back-btn" id="records-back">← 返回</button><div class="records-empty"><p>练习记录暂时没有打开</p><button class="btn btn-ghost" id="records-retry">重试</button></div></div>';
        root.querySelector("#records-back").onclick = () => { if (active) hooks.onBack(); };
        root.querySelector("#records-retry").onclick = open;
      }
    }
    function stop() { active = false; generation++; }
    return {open, stop};
  }
  global.ChenchenLearningRecords = {create};
})(typeof window !== "undefined" ? window : globalThis);
