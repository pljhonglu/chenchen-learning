/* 辰辰的小树：服务器账本的只读展示，以及幂等浇水。 */
(function () {
  "use strict";

  const TYPES = {
    poem: { title: "古诗", count: 5, unit: "首", icon: "诗", view: "poems" },
    math: { title: "数学", count: 10, unit: "题", icon: "+", view: "math" },
    decomp: { title: "分解组合", count: 10, unit: "题", icon: "+", view: "math" },
    pinyin: { title: "拼音", count: 10, unit: "个", icon: "a", view: "pinyin" },
    write: { title: "汉字", count: 5, unit: "个", icon: "字", view: "write" },
    english: { title: "英语", count: 5, unit: "个", icon: "Aa", view: "english" },
  };
  const STAGES = ["一株小树苗", "长出新叶子", "小树长高了", "长出第一根侧枝", "树冠更丰满了", "出现小花苞", "第一次开花", "结出小果子", "果子成熟了", "蝴蝶来做客", "小鸟来做客", "枝头有了鸟窝", "长出新的嫩叶", "又有小花苞", "花儿又开了", "又结出果子"];
  let active = null;
  let pendingWaterId = null;
  let watering = false;
  const celebrated = new Set();
  const timers = new Set();

  function esc(value) { return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
  function values(value) { return value && typeof value === "object" && !Array.isArray(value) ? Object.values(value).filter(item => item && typeof item === "object") : []; }
  function beijingDay(date) {
    const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date || new Date());
    return ["year", "month", "day"].map(type => parts.find(part => part.type === type).value).join("-");
  }
  function stageAt(total) {
    const milestone = Math.floor(Math.max(0, total) / 12);
    const index = milestone <= 12 ? milestone : 12 + (milestone - 12) % 4;
    const nextIndex = milestone + 1 <= 12 ? milestone + 1 : 12 + (milestone + 1 - 12) % 4;
    return { milestone, index, title: STAGES[index], nextTitle: STAGES[nextIndex], progress: total % 12, remaining: 12 - total % 12 };
  }
  function summarize(state, day) {
    const garden = state?.garden || {};
    const groups = values(garden.groups);
    const waterings = values(garden.watering);
    const gifts = values(garden.gifts);
    const dayGroups = groups.filter(group => group.day === day);
    const dayWaterings = waterings.filter(water => water.day === day);
    const earned = groups.reduce((sum, group) => sum + (Number(group.waterAwarded) || 0), 0);
    return {
      groups, waterings, gifts, dayGroups, total: waterings.length,
      balance: Math.max(0, earned - waterings.length),
      earnedToday: dayGroups.reduce((sum, group) => sum + (Number(group.waterAwarded) || 0), 0),
      wateredToday: dayWaterings.length,
      canWater: dayGroups.length > 0 && dayWaterings.length < 3 && earned > waterings.length,
      stage: stageAt(waterings.length),
    };
  }
  function daySummary(summary, day) {
    const groups = summary.groups.filter(group => group.day === day);
    const waterings = summary.waterings.filter(water => water.day === day);
    const gifts = summary.gifts.filter(gift => gift.day === day);
    return { groups, waterings, gifts, earned: groups.reduce((sum, group) => sum + (Number(group.waterAwarded) || 0), 0) };
  }
  function monthInfo(year, month) {
    return { days: new Date(Date.UTC(year, month, 0)).getUTCDate(), offset: (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7 };
  }
  function timer(callback, ms) { const id = setTimeout(() => { timers.delete(id); callback(); }, ms); timers.add(id); }
  function stop() {
    timers.forEach(clearTimeout); timers.clear();
    const context = active; active = null;
    context?.scene?.destroy();
    if (context) { context.scene = null; context.performing = false; }
  }
  function current(context) { return active === context && context.hooks.isActive?.() !== false && context.root.isConnected; }
  function dayLabel(day) { const [, month, date] = day.split("-"); return `${Number(month)} 月 ${Number(date)} 日`; }
  function giftNumber(gift) { return Number(gift.milestone) || Math.floor((Number(gift.waterTotal) || 0) / 12); }
  function announce(text) { const element = document.getElementById("live-status"); if (element) element.textContent = text; }

  function renderHome(hooks) {
    stop();
    const context = { hooks, root: hooks.root || document.getElementById("home-content"), pane: "home", error: "", celebration: null, scene: null, performing: false };
    active = context;
    paintHome(context);
  }

  function paintHome(context) {
    if (!current(context)) return;
    const hooks = context.hooks;
    const day = hooks.todayStr?.() || beijingDay();
    const data = summarize(hooks.loadState(), day);
    const stage = data.stage;
    const resting = data.wateredToday >= 3 && !context.performing;
    const reviewGroups = Array.isArray(hooks.reviewGroups) ? hooks.reviewGroups : [];
    const waterLabel = watering ? "正在浇水…" : context.performing ? "小树正在喝水…" : pendingWaterId ? "重试这次浇水" : resting ? "小树今天喝好啦" : !data.dayGroups.length ? "学完一组，再来浇水" : !data.balance ? "水滴用完啦，今天先休息" : "给小树浇水";
    const help = resting ? "今天照顾好啦，明天再来看小树。" : data.wateredToday ? "今天已经照顾过小树啦，可以休息了。" : data.dayGroups.length ? "轻轻浇一滴，小树就长大一点点。" : "学完一组，带一滴水回来。";
    const markup = `<div class="g-home ${resting ? "g-resting" : ""} ${context.performing ? "g-performing" : ""}">
      <div class="g-welcome"><div><p class="g-kicker">每天一点点 · 长成小花园</p><h1>辰辰的小花园</h1></div><button type="button" class="g-calendar-link" data-g-action="calendar"><span class="g-calendar-icon" aria-hidden="true">▦</span><span>成长日历<small>${dayLabel(day)}</small></span><span aria-hidden="true">↗</span></button></div>
      <section class="g-garden" aria-label="我的成长小花园">
        <div class="g-world">
          <div class="g-scene-heading"><span class="g-scene-tag">我的成长伙伴</span><h2>${esc(stage.title)}</h2><p>我们已经一起浇下 <strong>${data.total}</strong> 滴水</p></div>
          <div class="g-scene-host" role="img" aria-label="${esc(stage.title)}，在小花园里一点点长大"><svg class="g-scene-svg" viewBox="0 0 720 440" aria-hidden="true"><ellipse cx="365" cy="348" rx="150" ry="35" fill="#dbe2bc"/><path d="M365 348Q350 302 365 258" fill="none" stroke="#839960" stroke-width="5"/><path d="M365 258Q299 259 306 205Q362 205 365 258Q369 210 420 211Q427 256 365 258" fill="#a6c38b"/></svg></div>
          <div class="g-gift-slot">${context.celebration ? celebrationHtml(context.celebration) : ""}</div>
          <div class="g-earth-label"><span aria-hidden="true">✿</span> 这是我们一直照顾的那棵树</div>
        </div>
        <aside class="g-care" aria-labelledby="g-care-title">
          <p class="g-kicker">今天的小小照顾</p><div class="g-water-balance"><span class="g-drop" aria-hidden="true"></span><div><strong>${data.balance}</strong><span>滴水可以用</span></div></div>
          <h2 id="g-care-title">${resting ? "今天，照顾好啦" : "浇一浇，长大一点"}</h2><p class="g-care-description">${help}</p>
          <button type="button" class="g-water-button" data-g-action="water" ${watering || context.performing || !data.canWater && !pendingWaterId ? "disabled" : ""}><span aria-hidden="true">${resting ? "✓" : "♧"}</span>${waterLabel}</button>
          <p class="g-water-error" role="alert">${esc(context.error)}</p>
          <div class="g-next-growth"><div class="g-progress-heading"><span>下一次：${esc(stage.nextTitle)}</span><span>${stage.progress}<small> / 12</small></span></div><div class="g-growth-track" role="progressbar" aria-label="本阶段累计浇水" aria-valuemin="0" aria-valuemax="12" aria-valuenow="${stage.progress}"><span style="width:${stage.progress / 12 * 100}%"></span></div><p>再浇 <strong>${stage.remaining}</strong> 滴水，就有新变化和 <span aria-label="一份礼物">🎁</span></p></div>
          <div class="g-today-note"><span>今天获得 <b>${data.earnedToday}</b> 滴水</span><span>已经浇水 <b>${data.wateredToday}</b> 次</span></div><p class="g-limit-note">每天最多 3 滴、浇水 3 次，不用做满。</p>
        </aside>
      </section>
      <section class="g-review-section" aria-labelledby="g-review-title"><div class="g-section-heading"><div><p class="g-kicker">把学过的，再想起来</p><h2 id="g-review-title">今天的复习</h2></div><button type="button" class="g-text-button" data-g-action="records">练习记录 <span aria-hidden="true">↗</span></button></div>
        <p class="g-review-description">${data.earnedToday >= 3 ? "今天的水滴已经领好啦。继续完成整组仍会记录学习，可以先休息。" : "按到期时间复习，有几项就练几项。休息后可以接着完成。"}</p>
        ${reviewGroups.length ? `<div class="g-review-grid">${reviewGroups.map(group => reviewCard(group)).join("")}</div>` : '<div class="g-review-empty"><span class="g-empty-leaf" aria-hidden="true">❧</span><div><h3>今天，慢慢来就好</h3><p>今天没有到期内容啦。可以休息，也可以到学科学一点新的。</p></div></div>'}
      </section>
      <section class="g-subject-section" aria-label="去学科开始学习"><p>按今天的安排，去学科练一练</p><div class="g-subject-links">${["poem", "math", "pinyin", "write", "english"].map(type => `<button type="button" data-g-subject="${type}"><span aria-hidden="true">${TYPES[type].icon}</span>${TYPES[type].title}<small>每次最多 ${TYPES[type].count} ${TYPES[type].unit}</small><i aria-hidden="true">→</i></button>`).join("")}</div></section>
    </div>`;
    // Updating balances must not replace the cast while it is performing.
    const focusedAction = document.activeElement?.getAttribute?.("data-g-action");
    if (context.scene && context.root.querySelector(".g-home")) {
      const draft = document.createElement("template"); draft.innerHTML = markup;
      context.root.querySelector(".g-home").className = draft.content.querySelector(".g-home").className;
      [".g-welcome", ".g-care", ".g-review-section", ".g-subject-section", ".g-scene-heading", ".g-gift-slot"].forEach(selector => {
        context.root.querySelector(selector).replaceWith(draft.content.querySelector(selector));
      });
    } else {
      context.root.innerHTML = markup;
      context.scene = window.ChenchenGardenScene?.mount(context.root.querySelector(".g-scene-host"), { stage, resting });
    }
    context.scene?.setSnapshot(stage, resting);
    context.root.querySelector('[data-g-action="calendar"]').onclick = () => openCalendar(context);
    context.root.querySelector('[data-g-action="water"]').onclick = () => water(context);
    context.root.querySelector('[data-g-action="records"]').onclick = () => leave(context, () => hooks.navigate("records"));
    context.root.querySelectorAll("[data-g-review]").forEach(button => button.onclick = () => {
      button.disabled = true;
      Promise.resolve(hooks.startReview(button.dataset.gReview)).catch(() => { if (current(context)) hooks.toast?.("这一组暂时没打开，请重试。"); }).finally(() => { if (current(context) && button.isConnected) button.disabled = false; });
    });
    context.root.querySelectorAll("[data-g-subject]").forEach(button => button.onclick = () => leave(context, () => hooks.navigate(TYPES[button.dataset.gSubject].view)));
    context.root.querySelector('[data-g-action="dismiss-gift"]')?.addEventListener("click", () => { context.celebration = null; context.root.querySelector(".g-gift-celebration")?.remove(); });
    if (focusedAction) context.root.querySelector(`[data-g-action="${focusedAction}"]`)?.focus();
  }

  function leave(context, action) { if (current(context)) { stop(); action(); } }
  function reviewCard(group) {
    const type = TYPES[group.type] || TYPES.poem;
    return `<article class="g-review-card g-subject-${esc(group.type)}"><span class="g-review-icon" aria-hidden="true">${type.icon}</span><div><h3>${esc(group.title || type.title)}</h3><p>${Number(group.count) || type.count} ${esc(group.unit || type.unit)} <span>· ${group.resumed ? `已保存 ${group.entries?.length || 0} 项` : `${Number(group.dueCount) || 0} 项到期`}</span></p></div><button type="button" data-g-review="${esc(group.type)}" aria-label="${group.resumed ? "继续" : "开始"}${esc(group.title || type.title)}复习">${group.resumed ? "继续上次" : "开始复习"} <span aria-hidden="true">→</span></button></article>`;
  }
  function celebrationHtml(gift) {
    return `<div class="g-gift-celebration" role="status"><div class="g-gift-rays" aria-hidden="true"></div><div class="g-gift-art" aria-hidden="true"></div><span class="sr-only">🎁</span><p>第 ${giftNumber(gift)} 份成长礼物</p><strong>${esc(stageAt(Number(gift.waterTotal) || giftNumber(gift) * 12).title)}</strong><button type="button" data-g-action="dismiss-gift">收好啦 <span aria-hidden="true">✓</span></button></div>`;
  }
  async function water(context) {
    if (!current(context) || watering || context.performing || context.pane !== "home") return;
    const hooks = context.hooks;
    const day = hooks.todayStr?.() || beijingDay();
    const before = summarize(hooks.loadState(), day);
    if (!before.canWater && !pendingWaterId) return;
    if (!pendingWaterId) pendingWaterId = `water-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    const requestId = pendingWaterId;
    watering = true;
    let feedback = null;
    context.celebration = null;
    context.error = "";
    paintHome(context);
    try {
      const task = async () => {
        const response = await hooks.apiFetch("/api/garden/water", { method: "POST", body: JSON.stringify({ id: requestId }) });
        hooks.acceptServerState(response);
        return response;
      };
      await (hooks.queueServerTask ? hooks.queueServerTask(task) : task());
      pendingWaterId = null;
      const after = summarize(hooks.loadState(), hooks.todayStr?.() || beijingDay());
      const saved = after.waterings.find(entry => entry.id === requestId);
      if (saved) {
        const savedTotal = Number(saved.total) || 0;
        const milestone = savedTotal > 0 && savedTotal % 12 === 0 ? savedTotal / 12 : 0;
        const gift = milestone ? after.gifts.find(entry => giftNumber(entry) === milestone) : null;
        if (current(context) && context.pane === "home") {
          feedback = { before: before.stage, after: after.stage, resting: after.wateredToday >= 3, gift: gift && !celebrated.has(milestone) ? gift : null, scene: context.scene };
          context.performing = true;
        }
        announce(gift ? `浇水成功，${stageAt(Number(gift.waterTotal) || milestone * 12).title}，获得第 ${milestone} 份礼物。` : "小树收到一滴水。今天已经照顾过小树啦。");
      }
    } catch (error) {
      // A confirmed rule rejection cannot have committed this action. Network failures
      // keep the id, allowing the same request to recover a lost success response.
      if (error.status && error.status >= 400 && error.status < 500) pendingWaterId = null;
      if (error.data?.payload) hooks.acceptServerState(error.data);
      context.error = error.status === 429 ? "小树今天喝好啦，明天再来照顾它吧。" : error.status === 409 ? "小树的进度更新了，请稍后再试。" : error.status === 400 || error.status === 422 ? "今天暂时不能再浇水，先休息一下吧。" : "还没确认浇水成功，请重试这一次。";
      announce(context.error);
    } finally {
      watering = false;
      // The child may have left and reopened the garden while the request was in
      // flight. Refresh that new view too, so its button cannot stay stuck busy.
      const visible = current(context) ? context : active && current(active) ? active : null;
      if (visible) {
        if (visible !== context) visible.error = context.error;
        if (visible.pane === "home") paintHome(visible);
        else { visible.celebration = null; paintCalendar(visible); }
      }
    }
    if (feedback) {
      // A rendering failure must never turn a committed request into a retry.
      try { await feedback.scene?.playWater(feedback.before, feedback.after, feedback.resting); }
      catch (error) { feedback.scene?.finish(); console.warn("花园动画已跳过", error); }
      if (!current(context) || context.pane !== "home" || context.scene !== feedback.scene) return;
      context.performing = false;
      context.celebration = feedback.gift;
      if (feedback.gift) celebrated.add(giftNumber(feedback.gift));
      paintHome(context);
      if (feedback.gift) timer(() => {
        if (current(context) && context.celebration === feedback.gift) {
          context.celebration = null;
          context.root.querySelector(".g-gift-celebration")?.remove();
        }
      }, 6500);
    }
  }

  function openCalendar(context) {
    if (!context || !current(context)) return;
    const day = context.hooks.todayStr?.() || beijingDay();
    const [year, month] = day.split("-").map(Number);
    context.scene?.destroy(); context.scene = null; context.performing = false;
    context.pane = "calendar";
    context.calendar = { year, month, selected: day };
    context.celebration = null;
    paintCalendar(context);
    announce("成长日历已打开");
  }

  function paintCalendar(context) {
    if (!current(context)) return;
    const day = context.hooks.todayStr?.() || beijingDay();
    const data = summarize(context.hooks.loadState(), day);
    const { year, month, selected } = context.calendar;
    const monthKey = `${year}-${String(month).padStart(2, "0")}`;
    const monthData = {
      groups: data.groups.filter(group => group.day?.startsWith(monthKey)).length,
      earned: data.groups.filter(group => group.day?.startsWith(monthKey)).reduce((sum, group) => sum + (Number(group.waterAwarded) || 0), 0),
      watered: data.waterings.filter(water => water.day?.startsWith(monthKey)).length,
      gifts: data.gifts.filter(gift => gift.day?.startsWith(monthKey)).length,
    };
    const info = monthInfo(year, month);
    const futureMonth = monthKey >= day.slice(0, 7);
    const cells = Array.from({ length: info.offset }, () => '<div class="g-date-blank" aria-hidden="true"></div>');
    for (let date = 1; date <= info.days; date++) {
      const key = `${monthKey}-${String(date).padStart(2, "0")}`;
      const stats = daySummary(data, key);
      const future = key > day;
      cells.push(`<button type="button" class="g-date ${key === day ? "g-date-today" : ""} ${key === selected ? "g-date-selected" : ""} ${stats.groups.length ? "g-date-active" : ""}" data-g-date="${key}" ${future ? "disabled" : ""} aria-pressed="${key === selected}" aria-label="${month} 月 ${date} 日${key === day ? '，今天' : ''}${stats.earned ? `，获得 ${stats.earned} 滴水` : ''}${stats.gifts.length ? `，获得 ${stats.gifts.length} 份礼物` : ''}"><span class="g-date-number">${date}${key === day ? '<small>今天</small>' : ''}</span><span class="g-date-events">${stats.earned ? `<span class="g-date-water"><i aria-hidden="true"></i>${stats.earned}</span>` : ''}${stats.gifts.length ? '<span class="g-date-gift" aria-hidden="true">🎁</span>' : ''}</span></button>`);
    }
    context.root.innerHTML = `<div class="g-calendar-page"><div class="g-calendar-heading"><div><button type="button" class="g-text-button" data-g-action="back">← 回到小树</button><p class="g-kicker">把每一点成长，轻轻收好</p><h1>成长日历</h1></div><div class="g-calendar-heading-art" aria-hidden="true"></div></div>
      <div class="g-month-summary">${[[monthData.groups, "完整学习组", "组"], [monthData.earned, "获得水滴", "滴"], [monthData.watered, "实际浇水", "次"], [monthData.gifts, "成长礼物", "份"]].map(([value, label, unit]) => `<div><span>${label}</span><strong>${value}<small>${unit}</small></strong></div>`).join("")}</div>
      <div class="g-calendar-book"><section class="g-month-page" aria-label="月历"><div class="g-month-controls"><button type="button" data-g-month="-1" aria-label="上个月">‹</button><div><h2>${year} 年 ${month} 月</h2><span>每一次照顾，都留在这里</span></div><button type="button" data-g-month="1" aria-label="下个月" ${futureMonth ? 'disabled' : ''}>›</button></div><div class="g-weekdays" aria-hidden="true">${["一", "二", "三", "四", "五", "六", "日"].map(value => `<span>${value}</span>`).join("")}</div><div class="g-calendar-grid">${cells.join("")}</div><p class="g-calendar-legend"><span><i class="g-legend-drop" aria-hidden="true"></i> 当天获得水滴</span><span>🎁 成长礼物</span><span>休息的日子，也很好</span></p></section><aside class="g-day-page" aria-label="${dayLabel(selected)}的成长记录">${dayDetail(data, selected)}</aside></div>
      <p class="g-calendar-footnote">水壶里的水可以留着以后用，所以获得水滴和浇水次数会分别记录。礼物盒只记录成长收获。</p></div>`;
    context.root.querySelector('[data-g-action="back"]').onclick = () => { context.pane = "home"; paintHome(context); };
    context.root.querySelectorAll("[data-g-month]").forEach(button => button.onclick = () => {
      const next = new Date(Date.UTC(year, month - 1 + Number(button.dataset.gMonth), 1));
      const nextYear = next.getUTCFullYear();
      const nextMonth = next.getUTCMonth() + 1;
      const nextKey = `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
      if (nextKey > day.slice(0, 7) || nextYear < 2020) return;
      context.calendar = { year: nextYear, month: nextMonth, selected: nextKey === day.slice(0, 7) ? day : `${nextKey}-01` };
      paintCalendar(context);
    });
    context.root.querySelectorAll("[data-g-date]").forEach(button => button.onclick = () => {
      context.calendar.selected = button.dataset.gDate;
      paintCalendar(context);
      context.root.querySelector(`[data-g-date="${context.calendar.selected}"]`)?.focus({ preventScroll: true });
      if (window.innerWidth <= 900) context.root.querySelector(".g-day-page")?.scrollIntoView({ block: "start", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      announce(`${dayLabel(context.calendar.selected)}的成长记录`);
    });
  }

  function dayDetail(data, day) {
    const stats = daySummary(data, day);
    const hasActivity = stats.groups.length || stats.waterings.length || stats.gifts.length;
    return `<p class="g-kicker">这一天的小小收获</p><h2>${dayLabel(day)}</h2>${hasActivity ? `<div class="g-day-stats"><div><span class="g-mini-drop" aria-hidden="true"></span><strong>${stats.earned}</strong><span>获得水滴</span></div><div><span aria-hidden="true">♧</span><strong>${stats.waterings.length}</strong><span>实际浇水</span></div></div><h3 class="g-detail-label">完成的学习组</h3><ul class="g-day-groups">${stats.groups.map(group => { const type = TYPES[group.type] || { title: "学习", unit: "项" }; return `<li><span class="g-group-check" aria-hidden="true">✓</span><div><strong>${esc(type.title)}<small>${group.mode === "review" ? "复习" : "学习"}</small></strong><span>${Number(group.count) || 0} ${type.unit} · 完整完成</span></div><span>${Number(group.waterAwarded) ? "💧 +1" : "已记录"}</span></li>`; }).join("") || '<li class="g-plain-note">这天没有新增学习组。</li>'}</ul>${stats.gifts.map(gift => `<div class="g-day-gift"><div class="g-gift-art" aria-hidden="true"></div><p>🎁 第 ${giftNumber(gift)} 份成长礼物</p><strong>${esc(stageAt(Number(gift.waterTotal) || giftNumber(gift) * 12).title)}</strong><small>这份成长，已经好好收起来了。</small></div>`).join("")}` : '<div class="g-empty-day"><span aria-hidden="true">❧</span><p>这一天，静静地留白。</p><small>休息也很好，小树一直都在。</small></div>'}`;
  }

  window.ChenchenGarden = { renderHome, stop, openCalendar: () => active && openCalendar(active), helpers: { beijingDay, stageAt, summarize, daySummary, monthInfo } };
})();
