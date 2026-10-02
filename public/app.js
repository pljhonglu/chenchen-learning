/* 辰辰幼小衔接 — 应用逻辑 */
(function () {
  "use strict";

  const INTERVALS = [1, 2, 4, 7, 15, 30]; // days
  const Learning = window.ChenchenLearning;
  const REVIEW_RESULT = {independent:"remember",supported:"fuzzy",again:"forgot",practice:"fuzzy"};
  const ASSESSMENT_RESULT = {remember:"independent",fuzzy:"supported",forgot:"again"};

  function assessmentButtons(prefix, title) {
    return `<div class="learning-assessment" role="group" aria-label="${escapeHtml(title)}"><p class="assessment-title">${escapeHtml(title)}</p><div class="assessment-options">${Learning.RATINGS.map(r=>`<button type="button" class="assessment-option assessment-${r.id}" id="${prefix}-${r.id}" data-assessment="${r.id}"><span aria-hidden="true">${r.icon}</span>${r.label}</button>`).join("")}</div><p class="assessment-error" id="${prefix}-error" role="alert"></p></div>`;
  }

  function assessmentBadge(result) {
    const rating = Learning.RATINGS.find(r=>r.id===result);
    return rating ? `<span class="assessment-badge assessment-${rating.id}"><span aria-hidden="true">${rating.icon}</span> ${rating.label}</span>` : "";
  }

  function bindAssessment(prefix, id, onChoose) {
    const buttons = Learning.RATINGS.map(r=>document.getElementById(`${prefix}-${r.id}`));
    const error = document.getElementById(`${prefix}-error`);
    const updateRetry = () => {
      const pending = pendingPracticeAttempt?.id===id && pendingPracticeAttempt.operations ? pendingPracticeAttempt : null;
      buttons.forEach((button,index)=>{
        const chosen = ASSESSMENT_RESULT[pending?.result] === Learning.RATINGS[index].id;
        button.disabled = !!pending && !chosen;
        if (pending && chosen) button.textContent = `重试保存 · ${Learning.RATINGS[index].label}`;
      });
      error.textContent = pending ? "还没保存成功，请重试。" : "";
    };
    buttons.forEach((button,index)=>button.onclick=async()=>{
      buttons.forEach(b=>b.disabled=true);
      try { await onChoose(Learning.RATINGS[index].id); }
      finally { updateRetry(); }
    });
    updateRetry();
  }
  // Same-origin /api/* (Docker SQLite). Override only if API is on another host.
  const API_BASE = "";


  // ---------- Poems data (loaded from public/data/poems.json) ----------
  let POEMS = [];
  let BUILTIN_POEMS = [];
  let POEM_ILLUSTRATIONS = {};
  let poemsLoadPromise = null;

  async function loadPoemIllustrations() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch("data/poem-illustrations.json", { cache:"no-cache", signal:controller.signal });
      if (!response.ok) return {};
      const data = await response.json();
      return isRecord(data) ? data : {};
    } catch (_) { return {}; }
    finally { clearTimeout(timeout); }
  }

  function ensurePoems() {
    if (!poemsLoadPromise) {
      poemsLoadPromise = Promise.all([
        fetch("data/poems.json", { cache: "no-cache" }).then(r => {
          if (!r.ok) throw new Error("poems_load_failed");
          return r.json();
        }),
        loadPoemIllustrations(),
      ])
        .then(([data, illustrations]) => {
          POEM_ILLUSTRATIONS = illustrations;
          BUILTIN_POEMS = Array.isArray(data) ? data : [];
          POEMS = BUILTIN_POEMS;
          return POEMS;
        })
        .catch((e) => {
          console.warn("诗卡暂时没有打开，请刷新再试一次", e);
          POEMS = [];
          throw e;
        });
    }
    return poemsLoadPromise.then(() => {
      POEMS = [...BUILTIN_POEMS, ...Object.values(loadState().customPoems || {})];
      return POEMS;
    });
  }

  // SQLite is the sole persistent source. This object is only the current page's
  // response snapshot; closing/reloading the page always reads the server again.
  let serverState = { items: {}, activity: {}, customPoems: {}, customCharacters: {}, hiddenCourses: {} };
  let stateReady = false;
  let serverQueue = Promise.resolve();
  let lastServerContact = null;
  let syncStatus = { text: "正在连接服务器…", kind: "busy" };

  function loadState() { return serverState; }

  function setSyncStatus(text, kind) {
    syncStatus = { text, kind: kind || "muted" };
    const el = document.getElementById("sync-status");
    if (el) { el.textContent = text; el.dataset.kind = syncStatus.kind; }
  }

  async function apiFetch(path, opts) {
    const res = await fetch(API_BASE + path, {
      ...opts,
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...(opts && opts.headers) },
    });
    let data;
    try { data = await res.json(); }
    catch (_) { throw new Error("服务器响应不是有效的 JSON，请稍后重试"); }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("服务器返回了无效的进度数据");
    if (!res.ok) {
      const error = new Error(data.error || "server_unavailable");
      error.status = res.status;
      error.data = data;
      throw error;
    }
    const method = (opts?.method || "GET").toUpperCase();
    const hasPayload = validPayload(data.payload);
    if (method === "GET" && !(data.found === true && hasPayload || data.found === false && (data.payload === null || data.payload === undefined))) {
      throw new Error("服务器进度格式不正确，请稍后重试");
    }
    if (method === "PATCH" && !(data.ok === true && hasPayload)) throw new Error("服务器尚未确认保存，请重试");
    return data;
  }

  function isRecord(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
  function validPayload(value) {
    return isRecord(value) && isRecord(value.items) && ["activity", "customPoems", "customCharacters", "hiddenCourses"].every(key=>value[key] === undefined || isRecord(value[key]));
  }

  function acceptServerState(data) {
    const empty = data.found === false && (data.payload === null || data.payload === undefined);
    if (!empty && !validPayload(data.payload)) throw new Error("服务器进度格式不正确");
    const payload = empty ? {} : data.payload;
    serverState = { items: {}, activity: {}, customPoems: {}, customCharacters: {}, hiddenCourses: {}, ...payload };
    stateReady = true;
    lastServerContact = Date.now();
    POEMS = [...BUILTIN_POEMS, ...Object.values(serverState.customPoems)];
    setSyncStatus("已保存到服务器 · " + new Date().toLocaleTimeString("zh-CN", {hour:"2-digit",minute:"2-digit"}), "ok");
    return serverState;
  }

  function queueServerTask(task) {
    const next = serverQueue.catch(() => {}).then(task);
    serverQueue = next;
    return next;
  }

  function commitOperations(operations) {
    return queueServerTask(async () => {
      if (!stateReady) throw new Error("尚未连接学习服务器");
      setSyncStatus("正在保存到服务器…", "busy");
      try {
        const response = await apiFetch("/api/progress", {method:"PATCH", body:JSON.stringify({operations})});
        return acceptServerState(response);
      } catch (error) {
        setSyncStatus("保存未完成，请保持页面打开并重试", "err");
        if (error.status === 409) {
          if (validPayload(error.data?.payload)) acceptServerState(error.data);
          else {
            const response = await apiFetch("/api/progress", {method:"GET"}).catch(() => null);
            if (response) acceptServerState(response);
          }
          toast("这项内容已在另一台设备删除，请回首页刷新。");
        } else toast("还没保存成功，请检查网络后再点一次。");
        throw error;
      }
    });
  }

  async function syncNow() {
    try {
      await queueServerTask(async () => {
        setSyncStatus("正在读取服务器进度…", "busy");
        acceptServerState(await apiFetch("/api/progress", {method:"GET"}));
      });
      if (currentView === "home" && !showingCelebration) renderHome();
      return true;
    } catch (error) {
      setSyncStatus("暂时无法连接服务器，请检查网络后重试", "err");
      return false;
    }
  }

  function syncPanelHtml() {
    const last = lastServerContact ? new Date(lastServerContact).toLocaleString("zh-CN", {month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}) : "尚未连接";
    return `<div class="card sync-card" id="sync-card"><h2>💾 服务器进度</h2><p class="sync-desc">课堂内容与复习进度仅保存在服务器 SQLite 中。手机、平板访问同一地址，就能接着复习。需要连接服务器才能保存练习。</p><div class="btn-row sync-actions"><button type="button" class="btn btn-learn" id="sync-now">刷新服务器进度</button></div><div class="sync-status" id="sync-status" data-kind="${escapeHtml(syncStatus.kind)}">${escapeHtml(syncStatus.text)}</div><div class="sync-meta">上次连接：${escapeHtml(last)}</div></div>`;
  }

  function bindSyncPanel(root) {
    const btn = (root || document).querySelector("#sync-now");
    if(btn) btn.onclick = async () => {
      btn.disabled = true;
      const ok = await syncNow();
      btn.disabled = false;
      if (ok && document.getElementById("parent-dialog").open) openParent();
    };
  }

  function todayStr() {
    return localDate(new Date());
  }
  function localDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function addDays(dateStr, days) {
    const d = new Date(dateStr + "T12:00:00");
    d.setDate(d.getDate() + days);
    return localDate(d);
  }

  function getItem(id) {
    const s = loadState();
    return s.items[id] || null;
  }

  function newClassroomItem(id, meta) {
    return { id, ...meta, learned: true, stage: 0, nextReview: todayStr(), lastResult:"enrolled", createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
  }

  function reviewPatch(cur, result) {
    const startingStage = cur.reviewDay === todayStr() ? (cur.reviewStartStage || 0) : (cur.stage || 0);
    const days = result === "remember" ? INTERVALS[Math.min(startingStage, INTERVALS.length - 1)] : 1;
    const stage = result === "remember" ? Math.min(startingStage + 1, INTERVALS.length - 1) : 0;
    return { stage, lastResult:result, reviewDay:todayStr(), reviewStartStage:startingStage, nextReview:addDays(todayStr(),days), updatedAt:new Date().toISOString() };
  }

  async function markLearned(id, meta, extraOperations = []) {
    const existing = getItem(id);
    const operations = extraOperations.slice();
    if (loadState().hiddenCourses[id]) operations.unshift({op:"delete",collection:"hiddenCourses",key:id});
    if (existing && !existing.learned) {
      const value = {learned:true,updatedAt:new Date().toISOString()};
      if (!existing.nextReview) value.nextReview = todayStr();
      operations.push({op:"merge",collection:"items",key:id,value});
    } else if (!existing) {
      operations.push({op:"create",collection:"items",key:id,value:newClassroomItem(id,meta)});
    }
    if (operations.length) await commitOperations(operations);
    return getItem(id);
  }

  async function removeClassroomItem(id) {
    const state = loadState();
    const operations = [{op:"delete",collection:"items",key:id}];
    if (BUILTIN_POEMS.some(poem=>poem.id===id) || id.startsWith("english-")) operations.push({op:"set",collection:"hiddenCourses",key:id,value:{removedAt:new Date().toISOString()}});
    if(state.customPoems[id]) operations.push({op:"delete",collection:"customPoems",key:id});
    if(state.customCharacters[id]) operations.push({op:"delete",collection:"customCharacters",key:id});
    await commitOperations(operations);
  }

  function dueItems() {
    const s = loadState();
    const today = todayStr();
    return Object.values(s.items).filter(
      (it) => it.learned && it.nextReview && it.nextReview <= today
    ).sort((a, b) => a.nextReview.localeCompare(b.nextReview) || (a.createdAt || "").localeCompare(b.createdAt || ""));
  }

  function allLearned() {
    const s = loadState();
    return Object.values(s.items).filter((it) => it.learned);
  }

  // ---------- Ruby helpers ----------
  function rubyChars(chars) {
    return chars
      .map(
        (ch) =>
          `<span class="ruby-char"><span class="py">${escapeHtml(
            ch.p
          )}</span><span class="hz">${escapeHtml(ch.c)}</span></span>`
      )
      .join("");
  }

  function titleToChars(title, pyArr) {
    // Strip subtitle markers for display chars
    const clean = title.replace(/（[^）]*）/g, "");
    const chars = [...clean];
    return chars.map((c, i) => ({ c, p: pyArr[i] || "" }));
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---------- Router ----------
  let currentView = "home";
  let practiceGeneration = 0;
  let showingCelebration = false;
  let poemFilter = "all";
  let poemQuery = "";
  let selectedPoemId = null;
  let poemListScroll = 0;
  let poemDetailGeneration = 0;
  let englishModule = null;
  let recordsModule = null;

  function getEnglishModule() {
    if (!englishModule) englishModule = window.ChenchenEnglish.create({
      loadState, commitOperations, reviewPatch, todayStr, syncNow,
      newItem:newClassroomItem,
      isActive:() => currentView === "english",
      onHome:() => navigate("home"),
      onExit:() => navigate("english"),
      onParent:openParent,
    });
    return englishModule;
  }


  function stopSpeechSafe() {
    try {
      if (window.ChenchenSpeech) ChenchenSpeech.stop();
    } catch (_) {}
  }

  function updateSpeakButton(state) {
    const play = document.getElementById("btn-speak");
    if (!play) return;
    const playing = state === "speaking" || state === "loading";
    const loading = state === "loading";
    play.classList.toggle("is-active", playing);
    play.textContent = playing ? "Ⅱ 暂停" : state === "paused" ? "▶ 继续" : "▶ 朗读";
    play.setAttribute("aria-label", playing ? "暂停朗读" : state === "paused" ? "继续朗读" : "朗读古诗");
    play.setAttribute("aria-busy", String(loading));
  }

  const views = ["home", "poems", "poem-detail", "math", "pinyin", "write", "write-detail", "english", "records"];

  function resetPracticeAttempt() {
    // A new page is a new attempt. An older request may still save, but its
    // response must never update or lock the next page's controls.
    practiceGeneration++;
    pendingPracticeAttempt = null;
    completingPractice = null;
  }

  function showView(name) {
    resetPracticeAttempt();
    if (name !== "write-detail") stopWritingDemo();
    if (name !== "pinyin") stopPinyinAudio(true);
    if (name !== "english") englishModule?.stop();
    if (name !== "records") recordsModule?.stop();
    if (name !== "poem-detail") stopSpeechSafe();
    currentView = name;
    document.querySelectorAll(".view").forEach((el) => {
      el.classList.toggle("active", el.dataset.view === name);
    });
    document.querySelectorAll(".nav button").forEach((btn) => {
      const map = {
        home: "home",
        poems: "poems",
        "poem-detail": "poems",
        math: "math",
        pinyin: "pinyin",
        write: "write",
        "write-detail": "write",
        english: "english",
        records: "home",
      };
      btn.classList.toggle("active", btn.dataset.nav === map[name]);
      if (btn.dataset.nav === map[name]) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });
    window.scrollTo({ top: 0, behavior: ["write", "write-detail", "poems", "poem-detail", "english"].includes(name) ? "instant" : "smooth" });
  }

  // ---------- Home / Review ----------
  function typeIcon(type) {
    return (
      { poem: "📜", math: "➕", decomp: "🔢", pinyin: "🔤", write: "✍️", english:"🔊" }[type] ||
      "📌"
    );
  }
  function typeLabel(type) {
    return (
      {
        poem: "古诗",
        math: "加减法",
        decomp: "分解组合",
        pinyin: "拼音",
        write: "写字",
        english: "英语",
      }[type] || type
    );
  }

  let reviewSession = null;
  let pySelected = "a";
  let pyPracticed = new Set();
  let pyAssessments = new Map();
  let pyExposures = new Set();

  function rabbitArt() {
    return `<svg class="rabbit-art" viewBox="0 0 420 310" aria-hidden="true">
      <ellipse cx="226" cy="272" rx="161" ry="21" fill="#dbe6bd"/>
      <path d="M44 225Q116 157 191 220Q311 139 398 237L398 270H44Z" fill="#e4eccd"/>
      <path d="M71 82h80q17 0 17 17v24q0 17-17 17h-24l-15 14 1-14H71q-17 0-17-17V99q0-17 17-17" fill="#fffef9"/>
      <text x="112" y="108" text-anchor="middle" fill="#65835b" font-size="13" font-family="sans-serif">今天也要</text><text x="112" y="127" text-anchor="middle" fill="#65835b" font-size="13" font-family="sans-serif">开心长大呀</text>
      <path d="M183 153Q154 83 178 57Q202 45 214 147" fill="#fffdf3" stroke="#dcdaca" stroke-width="2"/>
      <path d="M235 148Q233 46 259 48Q288 54 265 157" fill="#fffdf3" stroke="#dcdaca" stroke-width="2"/>
      <path d="M185 128Q173 77 182 72Q194 65 202 133M247 130Q249 71 257 64Q268 64 257 134" fill="#efc9be"/>
      <ellipse cx="225" cy="229" rx="55" ry="50" fill="#82a36d"/>
      <ellipse cx="225" cy="169" rx="64" ry="55" fill="#fffdf3" stroke="#dcdaca" stroke-width="2"/>
      <ellipse cx="183" cy="182" rx="12" ry="7" fill="#f2c9ba"/><ellipse cx="267" cy="182" rx="12" ry="7" fill="#f2c9ba"/>
      <path d="M201 166v6M247 166v6" stroke="#435342" stroke-width="5" stroke-linecap="round"/>
      <path d="M221 181q4-4 8 0l-4 4Z" fill="#c98f7e"/><path d="M225 185q-8 10-13 1m13-1q8 10 13 1" fill="none" stroke="#6c6f53" stroke-width="2" stroke-linecap="round"/>
      <ellipse cx="184" cy="266" rx="24" ry="10" fill="#fffdf3"/><ellipse cx="264" cy="266" rx="24" ry="10" fill="#fffdf3"/>
      <path d="M171 224q28-6 55 9 28-15 60-9l-7 48q-28-6-53 6-25-12-49-6Z" fill="#f8cf78" stroke="#c4a464" stroke-width="2"/>
      <path d="M226 236v36m-42-35 30 8m-31 1 30 8m27-9 28-8m-28 17 27-8" stroke="#d5af67" stroke-width="2"/>
      <ellipse cx="176" cy="229" rx="13" ry="19" transform="rotate(-25 176 229)" fill="#fffdf3"/><ellipse cx="278" cy="229" rx="13" ry="19" transform="rotate(25 278 229)" fill="#fffdf3"/>
      <path d="M333 223v-40m0 22q-28-4-23-23 23 0 23 23m0-9q23-8 22-28-26 4-22 28" fill="#7c9e69" stroke="#6e8c5e" stroke-width="3"/>
      <path d="M310 221h47l-7 47h-33Z" fill="#dba282"/><path d="M308 221h51v10h-51Z" fill="#e6b192"/>
      <path d="M73 252v-31m0 14q-19-2-19-15 18-1 19 15m0-8q15-3 16-18-16 1-16 18" fill="#96ae75" stroke="#96ae75" stroke-width="3"/>
      <path d="m334 74 4 9 10 1-8 7 3 10-9-5-8 5 2-10-8-7 11-1Z" fill="#f4ce76"/>
      <circle cx="303" cy="122" r="4" fill="#ecc0a9"/><circle cx="131" cy="195" r="4" fill="#e0b771"/>
      <path d="m111 46 0 12m-6-6h12" stroke="#a9bb8b" stroke-width="3" stroke-linecap="round"/>
    </svg>`;
  }

  function speakGuide(text) {
    const live = document.getElementById("live-status");
    if (live) live.textContent = text;
    if (!window.ChenchenSpeech || !ChenchenSpeech.supported()) {
      toast(text);
      return;
    }
    ChenchenSpeech.speakPoem({ lines: [text] }, {
      onUnsupported: () => toast(text),
      onError: () => toast("暂时没有声音，可以看文字，和爸爸妈妈一起读。"),
    });
  }

  async function recordPractice(id, type, result, attempt, meta = {}) {
    const activityId = attempt?.activityId || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    if (attempt?.operations) return commitOperations(attempt.operations);
    const item = getItem(id);
    if ((reviewSession || attempt?.requireClassroom) && !item?.learned) {
      const error = new Error("这项课堂内容已经删除");
      error.status = 409;
      toast("这项课堂内容已经删除，请回到小花园。");
      throw error;
    }
    const at = attempt?.at || new Date().toISOString();
    const entries = meta.entries || [{id,type,title:meta.title || item?.title || id,skill:meta.skill || "general",
      result:ASSESSMENT_RESULT[result] || result,source:meta.source || "parent",details:meta.details || {}}];
    const operations = [];
    for (const [index, entry] of entries.entries()) {
      const existing = getItem(entry.id);
      const event = Learning.createActivity({...entry,day:todayStr(),at});
      operations.push({op:"set",collection:"activity",key:meta.entries ? `${activityId}-${index}` : activityId,value:event});
      const rehearsed = [event.details.afterPractice,event.details.observedExposure,event.details.exposureFirst].some(value=>value===true);
      const reviewResult = event.result === "independent" && rehearsed ? "fuzzy" : REVIEW_RESULT[event.result] || "fuzzy";
      const sameDayChecked = Object.values(loadState().activity).some(a=>a.schemaVersion===2 && a.day===todayStr() && a.id===entry.id && a.skill===entry.skill && ["independent","supported","again"].includes(a.result));
      const previous = existing || newClassroomItem(entry.id,{type:entry.type,title:entry.title});
      const lastAssessment = {result:event.result,source:event.source,skill:event.skill,at};
      if (existing?.learned) {
        const value = !sameDayChecked && existing.nextReview <= todayStr() ? reviewPatch(existing,reviewResult) : {};
        operations.unshift({op:"merge",collection:"items",key:entry.id,value:{...value,lastAssessment}});
      } else if (meta.enroll && !existing) {
        operations.unshift({op:"create",collection:"items",key:entry.id,value:{...previous,...reviewPatch(previous,reviewResult),lastAssessment}});
      }
    }
    // Legacy whole-subject tasks become the specific content actually checked.
    const retiredGroup = meta.retirePinyinGroup ? "pinyin-basic" : meta.retireWritingGroup ? "write-basic" : null;
    if (retiredGroup && getItem(retiredGroup)?.learned) {
      operations.push({op:"merge",collection:"items",key:retiredGroup,value:{learned:false,replacedBy:retiredGroup === "pinyin-basic" ? "individual-pinyin" : "individual-characters",updatedAt:at}});
    }
    if (attempt) attempt.operations = operations;
    await commitOperations(operations);
  }

  function sessionBanner() {
    if (!reviewSession) return "";
    return `<div class="session-banner"><span>小小复习 · ${reviewSession.index + 1} / ${reviewSession.items.length}</span><span>${reviewSession.items.map((_, i) => `<i class="${i < reviewSession.index ? "done" : i === reviewSession.index ? "now" : ""}"></i>`).join("")}</span><button class="text-btn" id="session-exit">先休息</button></div>`;
  }

  function bindSessionExit() {
    const btn = document.getElementById("session-exit");
    if (btn) btn.onclick = () => { reviewSession = null; showView("home"); renderHome(); };
  }

  let completingPractice = null;
  let pendingPracticeAttempt = null;
  async function completePractice(id, result, meta) {
    if (reviewSession && reviewSession.items[reviewSession.index]?.id !== id) return true;
    if (completingPractice) return true;
    if (pendingPracticeAttempt?.id === id && pendingPracticeAttempt.operations && pendingPracticeAttempt.result !== result) {
      toast("上一次还没保存成功，请先重试原来的选项。");
      return true;
    }
    const sessionAtStart = reviewSession;
    const viewAtStart = currentView;
    const generationAtStart = practiceGeneration;
    if (!pendingPracticeAttempt || pendingPracticeAttempt.id !== id || pendingPracticeAttempt.result !== result) {
      pendingPracticeAttempt = {id,result,activityId:`${Date.now()}-${Math.random().toString(36).slice(2,10)}`,at:new Date().toISOString(),requireClassroom:!!getItem(id)?.learned || !!meta.requireClassroom};
    }
    const attemptAtStart = pendingPracticeAttempt;
    completingPractice = attemptAtStart;
    try {
      await recordPractice(id, meta.type, result, attemptAtStart, meta);
    } catch (error) {
      if (completingPractice === attemptAtStart) completingPractice = null;
      if (error.status === 409 && practiceGeneration === generationAtStart && reviewSession === sessionAtStart && currentView === viewAtStart) navigate("home");
      return true;
    }
    if (completingPractice === attemptAtStart) completingPractice = null;
    if (pendingPracticeAttempt === attemptAtStart) pendingPracticeAttempt = null;
    if (practiceGeneration !== generationAtStart || reviewSession !== sessionAtStart || currentView !== viewAtStart) return true;
    return advanceReviewItem(id);
  }

  function advanceReviewItem(id) {
    if (!reviewSession || reviewSession.items[reviewSession.index]?.id !== id) { toast("一朵小花送给认真练习的你！"); return false; }
    reviewSession.index++;
    if (reviewSession.index < reviewSession.items.length) {
      const next = reviewSession.items[reviewSession.index];
      toast("完成啦！我们去看看下一个小伙伴。");
      openReviewItem(next.id, next.type);
    } else {
      const count = reviewSession.items.length;
      reviewSession = null;
      showingCelebration = true;
      showView("home");
      const el = document.getElementById("home-content");
      el.innerHTML = `<div class="celebration card"><div class="flower-reward" aria-hidden="true">✿</div><p class="eyebrow">今天的小小收获</p><h1>你的小花开啦！</h1><p>认真复习了 ${count} 个内容，给自己一个抱抱。</p><p class="muted">休息一下，看看远处的绿色吧。</p><button class="btn btn-primary" id="done-home">回到小花园　⌂</button></div>`;
      document.getElementById("done-home").onclick = () => navigate("home");
      speakGuide("你的小花开啦！认真复习完了，休息一下吧。");
    }
    return true;
  }

  async function startReview() {
    if (!await syncNow()) { toast("暂时连不上服务器，请重试。"); return; }
    await ensurePoems().catch(() => {});
    const learned = allLearned();
    const due = dueItems();
    if (!learned.length) { openParent(); return; }
    if (!due.length) { toast("今天的复习都完成啦，明天再来和小兔见面。"); return; }
    const items = due.slice(0, 3);
    reviewSession = { items, index: 0 };
    openReviewItem(items[0].id, items[0].type);
  }

  async function renderHome() {
    try { await ensurePoems(); } catch (_) {}
    const due = dueItems();
    const learned = allLearned();
    const state = loadState();
    const practiced = Object.values(state.activity || {}).filter(it => it.day === todayStr()).length;
    const todayList = due.slice(0, 3);
    const nextDate = learned.map(it=>it.nextReview).filter(Boolean).sort()[0];
    const el = document.getElementById("home-content");
    el.innerHTML = `
      <div class="welcome-line"><span>你好，辰辰 <span aria-hidden="true">☀</span></span><span>${formatDateCN(todayStr())} · 美好的一天</span></div>
      <div class="home-top">
        <section class="hero">
          <div class="hero-copy"><p class="eyebrow"><span></span> 把学过的，再想起来</p><h1>每天一点点，<br>记忆开出小花。</h1><p class="hero-description">${learned.length && !due.length ? "今天没有到期复习，安心休息一下吧。" : "和小兔一起，复习课上的小本领。"}</p><button class="btn btn-primary start-btn" id="start-review" ${learned.length && !due.length ? "disabled" : ""}><span aria-hidden="true">▶</span> ${learned.length && !due.length ? "今天复习好啦" : "开始复习"} <span aria-hidden="true">→</span></button><p class="hero-note">${due.length ? `今天有 ${due.length} 项到期 · 一次最多 3 个小练习` : learned.length ? `下次复习：${formatDateCN(nextDate || todayStr())}` : "请家长记录课上学过的内容，复习会自动安排"}</p></div>
          <div class="hero-illustration">${rabbitArt()}<span class="art-caption">小兔陪你，一起长大</span></div>
        </section>
        <aside class="growth-card"><div class="growth-heading"><span class="tiny-sprout" aria-hidden="true">♧</span><span>我的小小收获</span></div><h2>${practiced ? "小花正在长大" : "今天也来浇浇水"}</h2><p>${practiced ? `今天完成了 ${practiced} 次练习` : "每认真练习一次，就收获一朵小花"}</p><div class="flower-row" aria-label="今天完成 ${practiced} 次练习">${[0,1,2].map(i => `<span class="flower ${i < practiced ? "bloomed" : ""}" aria-hidden="true">✿<i></i></span>`).join("")}</div><div class="growth-bottom"><span>${Math.min(practiced,3)} / 3 朵小花</span><span>一点点，就是进步</span></div><div class="growth-track"><span style="width:${Math.min(practiced/3,1)*100}%"></span></div><button class="text-btn home-records" id="home-records">练习记录 →</button></aside>
      </div>
      <div class="section-heading"><div><h2>我的小本领</h2><p>也可以自由看一看，课后复习由小兔安排</p></div><button class="listen-guide" id="home-guide" aria-label="听听怎么玩">◖)) <span>听听怎么玩</span></button></div>
      <div class="subject-grid">
        <button class="subject-card subject-poems" data-go="poems"><span class="subject-drawing poem-drawing" aria-hidden="true"><i>诗</i><span>⌁</span></span><span class="subject-text"><strong>读古诗</strong><small>听一听 · 背一背</small></span><span class="subject-arrow">↗</span></button>
        <button class="subject-card subject-math" data-go="math"><span class="subject-drawing math-drawing" aria-hidden="true"><i>2</i><i>＋</i><i>3</i></span><span class="subject-text"><strong>玩数学</strong><small>数一数 · 想一想</small></span><span class="subject-arrow">↗</span></button>
        <button class="subject-card subject-pinyin" data-go="pinyin"><span class="subject-drawing pinyin-drawing" aria-hidden="true"><i>a</i><i>o</i><i>e</i></span><span class="subject-text"><strong>读拼音</strong><small>张开嘴 · 读一读</small></span><span class="subject-arrow">↗</span></button>
        <button class="subject-card subject-write" data-go="write"><span class="subject-drawing write-drawing" aria-hidden="true"><i>大</i><span>✎</span></span><span class="subject-text"><strong>写汉字</strong><small>看一看 · 描一描</small></span><span class="subject-arrow">↗</span></button>
        <button class="subject-card subject-english" id="home-english-daily" disabled><span class="subject-drawing english-drawing" aria-hidden="true"><i>Aa</i><span>◖))</span></span><span class="subject-text"><strong>复习今日英语</strong><small id="home-english-status">准备今日词卡…</small></span><span class="subject-arrow" aria-hidden="true">↗</span></button>
      </div>
      <section class="today-card"><div class="today-intro"><span class="today-tag">TODAY'S LITTLE STEPS</span><h2>今天，和它们见个面</h2><p>${due.length ? "小兔按记忆间隔，找到了今天的复习内容" : learned.length ? "今天没有到期内容，休息也是成长" : "请爸爸妈妈把课上学过的内容记下来"}</p></div><div class="today-items">${todayList.length ? todayList.map((it,i) => `<button class="today-item" data-review="${escapeHtml(it.id)}" data-type="${escapeHtml(it.type)}"><span class="step-number">0${i+1}</span><span><strong>${escapeHtml(it.title)}</strong><small>${typeLabel(it.type)} · 再想一想</small></span><span class="step-go">→</span></button>`).join("") : learned.length ? `<div class="empty-setup"><span aria-hidden="true">✓</span><strong>今天不用再复习啦</strong><small>下次 ${formatDateCN(nextDate || todayStr())}，小兔会等你</small></div>` : `<button class="empty-setup" id="home-setup"><span aria-hidden="true">＋</span><strong>记录课上学过的内容</strong><small>新增古诗、汉字后，自动安排复习</small></button>`}</div></section>`;
    document.getElementById("start-review").onclick = startReview;
    document.getElementById("home-records").onclick = () => navigate("records");
    const dailyEnglish = document.getElementById("home-english-daily");
    dailyEnglish.onclick = startDailyEnglish;
    void updateHomeEnglishDaily(dailyEnglish);
    document.getElementById("home-guide").onclick = () => speakGuide("小兔会帮你安排今天到期的复习。点开始复习，把课上学过的再想一想。复习完就休息，慢慢来。");
    document.getElementById("home-setup")?.addEventListener("click", openParent);
    el.querySelectorAll("[data-go]").forEach(btn => btn.onclick = () => navigate(btn.dataset.go));
    el.querySelectorAll("[data-review]").forEach(btn => btn.onclick = () => { reviewSession = {items:[getItem(btn.dataset.review)],index:0}; openReviewItem(btn.dataset.review,btn.dataset.type); });
  }

  async function updateHomeEnglishDaily(button) {
    const active = () => currentView === "home" && document.getElementById("home-english-daily") === button;
    try {
      const {remaining, count} = await getEnglishModule().getDailySummary();
      if (!active()) return;
      button.disabled = !remaining;
      document.getElementById("home-english-status").textContent = remaining ? `今日 ${remaining} 个词` : count ? "今日已完成 ✓" : "今天没有待复习";
    } catch (_) {
      if (!active()) return;
      button.disabled = false;
      document.getElementById("home-english-status").textContent = "听一听 · 找一找 · 说一说";
    }
  }

  function startDailyEnglish() {
    if (!stateReady) return;
    showingCelebration = false;
    reviewSession = null;
    showView("english");
    return getEnglishModule().open({daily:true});
  }

  function customPoemFromForm(form) {
    const body = form.elements.body.value.trim();
    const texts = body.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
    if (!texts.length) throw new Error("请写下古诗正文，每句一行。");
    if (texts.length > 32 || texts.some(line=>[...line].length>50)) throw new Error("每句请控制在 50 个字以内，最多 32 句。");
    const rawPinyin = form.elements.pinyin.value;
    const pinyinLines = rawPinyin.trim() ? rawPinyin.split(/\r?\n/).map(line=>line.trim()) : [];
    while (pinyinLines.length > texts.length && !pinyinLines[pinyinLines.length-1]) pinyinLines.pop();
    if (pinyinLines.length && pinyinLines.length !== texts.length) throw new Error("拼音行数需要和正文相同；不填写也可以。");
    const lines = texts.map((text, index)=>{
      const syllables = pinyinLines[index] ? pinyinLines[index].split(/\s+/).filter(Boolean) : [];
      const characters = [...text];
      const spokenCount = characters.filter(c=>/[^\s，。！？、；：,.!?;:“”‘’「」『』（）()—…《》]/u.test(c)).length;
      if (syllables.length && syllables.length !== spokenCount) throw new Error(`第 ${index+1} 句拼音有 ${syllables.length} 个音节，正文有 ${spokenCount} 个字，请用空格隔开每个音节。`);
      let at = 0;
      return {text,chars:characters.map(c=>({c,p:/[^\s，。！？、；：,.!?;:“”‘’「」『』（）()—…《》]/u.test(c) ? (syllables[at++] || "") : ""}))};
    });
    return {id:`custom-poem-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, title:form.elements.title.value.trim() || texts[0].slice(0,18), author:form.elements.author.value.trim(), dynasty:"",titlePy:[],authorPy:[],dynastyPy:[],lines};
  }

  async function openParent() {
    if (!stateReady) { toast("先连接服务器，才能管理课堂内容。"); return; }
    if (currentView === "english") englishModule?.pause();
    if (currentView === "write-detail") {writingDemo?.stop();writingVoice?.stop();}
    if (currentView === "pinyin") stopPinyinAudio();
    await ensurePoems().catch(() => {});
    const dialog = document.getElementById("parent-dialog");
    const scroll = dialog.open ? dialog.scrollTop : 0;
    const courses = [
      {id:"math-addsub-10", type:"math", title:"10以内加减法"},
      {id:"math-decomp-10", type:"decomp", title:"10以内分解组合"},
    ];
    const learned = allLearned();
    const removedPoems = BUILTIN_POEMS.filter(poem=>loadState().hiddenCourses[poem.id]);
    dialog.innerHTML = `
      <div class="dialog-heading"><div><p class="eyebrow">记录课堂，复习交给小兔</p><h2 id="parent-title">课堂内容管理</h2></div><button class="close-btn" id="close-parent" aria-label="关闭课堂内容管理">×</button></div>
      <p class="parent-description">已有古诗都是课上学过的，已自动安排复习。其他新学的内容可以在这里补充，小兔按记忆间隔挑出当天到期内容。</p>
      <div class="memory-schedule"><span>今天巩固</span><i>→</i><span>1 天</span><i>→</i><span>2 天</span><i>→</i><span>4 天</span><i>→</i><span>7 天</span><i>→</i><span>15 天</span><i>→</i><span>30 天</span></div>
      <p class="form-help">自己完成时逐步拉开间隔；提示后完成或还要练习时，明天再巩固。同一天多练不会连续跳级。</p>
      <h3>古诗 · 自动安排复习</h3>
      <p class="form-help">已有诗卡无需逐首加入；新录入的古诗也会直接开始复习。</p>
      ${removedPoems.length ? `<div class="parent-add"><select id="parent-poem" aria-label="选择要恢复复习的古诗"><option value="">已移除的诗卡…</option>${removedPoems.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.title)}</option>`).join("")}</select><button class="btn btn-primary" id="restore-class-poem">恢复复习</button></div>` : ""}
      <details class="classroom-section"><summary>＋ 诗库里没有？新增一首古诗</summary><form id="custom-poem-form" class="classroom-form">
        <div class="form-two"><label>标题 <small>可选</small><input name="title" maxlength="50" placeholder="留空时使用第一句" /></label><label>作者 <small>可选</small><input name="author" maxlength="30" placeholder="如：李白" /></label></div>
        <label>古诗正文 <textarea name="body" rows="5" maxlength="4000" required placeholder="每句一行，例如：&#10;床前明月光，&#10;疑是地上霜。"></textarea></label>
        <label>逐行拼音 <small>可选，不自动猜读音</small><textarea name="pinyin" rows="4" maxlength="4000" placeholder="每字一个音节，以空格隔开；标点不用填写。&#10;chuáng qián míng yuè guāng&#10;yí shì dì shàng shuāng"></textarea></label>
        <p class="form-help">拼音逐行对应正文。不填的行保留空行，也可以全部留空，仅显示汉字。</p><p class="form-error" id="poem-form-error" role="alert"></p><button class="btn btn-primary" type="submit">保存古诗，自动安排复习</button>
      </form></details>
      <h3>汉字 · 一个字一张复习卡</h3>
      <form id="custom-character-form" class="classroom-form"><div class="form-two"><label>今天学的汉字<input name="character" maxlength="2" required placeholder="如：春" /></label><label>笔画 / 笔顺 <small>可选</small><input name="strokes" maxlength="120" placeholder="如：9 画" /></label></div><label>记忆或书写提示 <small>可选</small><input name="tip" maxlength="160" placeholder="写下老师教过的小提示" /></label><p class="form-error" id="character-form-error" role="alert"></p><button class="btn btn-learn" type="submit">记录这个汉字</button></form>
      <h3>数学 · 记录已学内容</h3><div class="parent-courses">${courses.map(c=>`<button class="parent-course ${getItem(c.id)?.learned ? "selected" : ""}" data-course="${c.id}" ${getItem(c.id)?.learned ? "disabled" : ""}><span>${escapeHtml(c.title)}</span><span>${getItem(c.id)?.learned ? "✓ 已记录" : "+ 记录"}</span></button>`).join("")}</div>
      <h3>英语 · 程序带着听和说</h3><p class="form-help">39 项课堂词汇与 48 项生活拓展，单词、句子和中文引导都能播放。完成小练习后加入间隔复习；生活拓展不会一次全部加入。家长无需示范发音。</p><button class="btn btn-ghost" id="parent-open-english">打开英语小花园 →</button>
      <h3>课堂记录 <span class="muted">${learned.length} 项</span></h3><div class="parent-enrolled">${learned.length ? learned.map(it=>`<div><span>${escapeHtml(it.title)}<small>${it.nextReview <= todayStr() ? "今天到期" : "下次 "+escapeHtml(it.nextReview)} · 自动安排</small></span><button class="text-btn delete-course" data-remove="${escapeHtml(it.id)}" aria-label="删除课堂内容 ${escapeHtml(it.title)}">删除</button></div>`).join("") : '<p class="muted">还没有课堂记录。先添加今天学过的一两项就好。</p>'}</div>
      <p class="parent-tip">陪练建议：古诗先回想再听示范；拼音先听范音再跟读；写字以纸笔为主，屏幕描红用来熟悉字形。</p>${syncPanelHtml()}<button class="btn btn-primary parent-done" id="parent-done">记录好啦，回小花园</button>`;
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = scroll;
    const close = () => {dialog.close(); if(currentView === "home" && !showingCelebration) renderHome();};
    document.getElementById("close-parent").onclick = close;
    document.getElementById("parent-done").onclick = () => {dialog.close();navigate("home");};
    document.getElementById("parent-open-english").onclick = () => {dialog.close();navigate("english");};
    const restorePoem = document.getElementById("restore-class-poem");
    if (restorePoem) restorePoem.onclick = async (event) => {
      const poem = POEMS.find(p=>p.id===document.getElementById("parent-poem").value);
      if (!poem) {toast("先选择要恢复的诗卡。");return;}
      const button = event.currentTarget;
      button.disabled = true;
      try {await markLearned(poem.id,{type:"poem",title:poem.title});await openParent();toast("已恢复复习，今天先一起巩固。");}
      catch (_) {button.disabled = false;}
    };
    document.getElementById("custom-poem-form").onsubmit = async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const error = document.getElementById("poem-form-error");
      const button = form.querySelector('[type="submit"]');
      error.textContent = "";
      try {
        const poem = customPoemFromForm(form);
        form.pendingPoemId = form.pendingPoemId || poem.id;
        poem.id = form.pendingPoemId;
        button.disabled = true;
        await markLearned(poem.id,{type:"poem",title:poem.title},[{op:"set",collection:"customPoems",key:poem.id,value:poem}]);
        await openParent(); toast("新诗卡保存好啦，今天先一起巩固。");
      } catch (failure) {error.textContent = failure.status ? "没有保存成功，请检查连接后再试。" : failure.message;button.disabled = false;}
    };
    document.getElementById("custom-character-form").onsubmit = async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const error = document.getElementById("character-form-error");
      const button = form.querySelector('[type="submit"]');
      const c = form.elements.character.value.trim();
      error.textContent = "";
      if ([...c].length !== 1 || !/\p{Script=Han}/u.test(c)) {error.textContent = "请只填写一个汉字，例如「春」。";return;}
      const id = `write-char-${c.codePointAt(0).toString(16)}`;
      const builtin = WRITE_CHARS.find(ch=>ch.c===c);
      const ch = {id,c,strokes:form.elements.strokes.value.trim() || builtin?.strokes || "",tip:form.elements.tip.value.trim() || builtin?.tip || ""};
      button.disabled = true;
      try {
        // Store the parent's optional hints even for a character in the starter library.
        await markLearned(id,{type:"write",title:`汉字·${c}`},[{op:"set",collection:"customCharacters",key:id,value:ch}]);
        await openParent();toast(`「${c}」已经记下啦，会单独安排复习。`);
      } catch (_) {error.textContent = "没有保存成功，请检查连接后再试。";button.disabled = false;}
    };
    dialog.querySelectorAll("[data-course]").forEach(button=>button.onclick=async()=>{
      button.disabled = true;
      const course = courses.find(it=>it.id===button.dataset.course);
      try {await markLearned(course.id,course);await openParent();}
      catch (_) {button.disabled = false;}
    });
    dialog.querySelectorAll("[data-remove]").forEach(button=>button.onclick=async()=>{
      button.disabled = true;
      try {
        const removedId = button.dataset.remove;
        await removeClassroomItem(removedId);
        if (currentView === "poem-detail" && selectedPoemId === removedId || currentView === "write-detail" && selectedWriteId === removedId || currentView === "english" || reviewSession?.items.some(item=>item.id===removedId)) navigate("home");
        await openParent();toast("课堂内容已删除，后续不再安排复习。");
      }
      catch (_) {button.disabled = false;}
    });
    bindSyncPanel(dialog);
  }

  function openReviewItem(id, type) {
    if (type === "english") {
      const session = reviewSession;
      showView("english");
      getEnglishModule().open({itemId:id,onDone:() => {
        if (currentView === "english" && reviewSession === session) advanceReviewItem(id);
      }});
    } else if (type === "poem") {
      selectedPoemId = id;
      poemListScroll = 0;
      showView("poem-detail");
      renderPoemDetail(id);
    } else if (type === "math" || type === "decomp") {
      showView("math");
      renderMath(type === "decomp" ? "decomp" : "addsub");
    } else if (type === "pinyin") {
      showView("pinyin");
      pyPracticed = new Set();
      pyAssessments = new Map();
      pyExposures = new Set();
      const symbol = id.startsWith("pinyin-") ? id.slice(7).replace(/v/g,"ü") : "";
      if (INITIALS.includes(symbol) || FINALS.includes(symbol)) {
        pySelected = symbol;
        pyTab = INITIALS.includes(symbol) ? "initials" : "finals";
      }
      renderPinyin();
    } else if (type === "write") {
      selectedWriteId = id;
      writingListScroll = 0;
      showView("write-detail");
      renderWriteDetail();
    }
  }

  function formatDateCN(iso) {
    const [y, m, d] = iso.split("-");
    return `${y}年${Number(m)}月${Number(d)}日`;
  }

  // ---------- Poems ----------
  function poemIllustration(poem, detail = false) {
    const art = POEM_ILLUSTRATIONS[poem.id];
    if (!art || !/^images\/poems\/[a-zA-Z0-9_-]+\.(png|webp|jpg)$/.test(art.src)) return "";
    const image = `<img src="${escapeHtml(art.src)}" alt="${escapeHtml(art.alt || poem.title)}" loading="${detail ? "eager" : "lazy"}" decoding="async" />`;
    return detail
      ? `<figure class="poem-picture">${image}</figure>`
      : `<span class="poem-thumbnail">${image}</span>`;
  }

  function poemStatus(id) {
    const it = getItem(id);
    if (!it || !it.learned) return { label: "已暂停复习", cls: "" };
    const today = todayStr();
    if (it.nextReview && it.nextReview <= today)
      return { label: "再想一想", cls: "due" };
    return { label: "下次 " + (it.nextReview || "稍后"), cls: "learned" };
  }

  async function renderPoems({restoreScroll = false} = {}) {
    const el = document.getElementById("poems-content");
    if (!POEMS.length) {
      el.innerHTML = '<div class="card"><div class="empty">小兔正在拿诗卡…</div></div>';
      try { await ensurePoems(); } catch (_) {
        el.innerHTML = '<div class="card"><div class="empty">诗卡暂时没有打开，请刷新再试一次</div></div>';
        return;
      }
    }
    let list = POEMS.filter(poem=>!loadState().hiddenCourses[poem.id]);
    if (poemQuery) {
      const q = poemQuery.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.title.includes(q) ||
          (p.author || "").includes(q) ||
          (p.dynasty || "").includes(q) ||
          p.lines.some((l) => l.text.includes(q))
      );
    }
    if (poemFilter === "due") {
      const today = todayStr();
      list = list.filter((p) => {
        const it = getItem(p.id);
        return it?.learned && it.nextReview <= today;
      });
    }

    el.innerHTML = `
      <div class="card">
        <h2>读古诗 <span class="heading-flower">✿</span></h2>
        <div class="toolbar">
          <input type="search" id="poem-search" placeholder="搜索题目 / 作者 / 诗句…" value="${escapeHtml(
            poemQuery
          )}" />
          <div class="filter-btns">
            <button data-f="all" class="${poemFilter === "all" ? "active" : ""}">全部诗卡</button>
            <button data-f="due" class="${poemFilter === "due" ? "active" : ""}">今天复习</button>
          </div>
        </div>
        <div class="poem-grid">
          ${
            list.length
              ? list
                  .map((p) => {
                    const st = poemStatus(p.id);
                    const display = p.titleDisplay || p.title;
                    return `<button type="button" class="poem-card" data-id="${p.id}">
                      ${poemIllustration(p)}
                      <div class="ptitle">${escapeHtml(display)}${
                      p.subtitle ? `<span style="font-size:0.7em;color:var(--muted)"> · ${p.subtitle}</span>` : ""
                    }</div>
                      <div class="pmeta">${escapeHtml([p.dynasty, p.author].filter(Boolean).join(" · "))}</div>
                      <div class="status"><span class="chip ${st.cls}">${st.label}</span></div>
                    </button>`;
                  })
                  .join("")
              : `<div class="empty" style="grid-column:1/-1">${poemQuery ? "没有找到这首诗，换个词试试吧。" : poemFilter === "due" ? "今天的古诗都复习好啦，也可以点「全部诗卡」看看。" : "这里暂时没有诗卡，可以请家长添加或恢复。"}</div>`
          }
        </div>
      </div>`;

    el.querySelector("#poem-search").addEventListener("input", (e) => {
      poemQuery = e.target.value;
      renderPoems();
      const inp = document.getElementById("poem-search");
      if (inp) {
        inp.focus();
        const len = inp.value.length;
        inp.setSelectionRange(len, len);
      }
    });
    el.querySelectorAll(".filter-btns button").forEach((b) =>
      b.addEventListener("click", () => {
        poemFilter = b.dataset.f;
        renderPoems();
      })
    );
    el.querySelectorAll(".poem-card").forEach((c) =>
      c.addEventListener("click", () => openPoemFromList(c.dataset.id))
    );
    if (restoreScroll && currentView === "poems") window.scrollTo({top:poemListScroll,behavior:"instant"});
  }

  function openPoemFromList(id) {
    poemListScroll = window.scrollY || 0;
    selectedPoemId = id;
    showView("poem-detail");
    return renderPoemDetail(id);
  }

  async function renderPoemDetail(id) {
    stopSpeechSafe();
    selectedPoemId = id;
    const generation = ++poemDetailGeneration;
    const active = () => currentView === "poem-detail" && selectedPoemId === id && generation === poemDetailGeneration;
    try { await ensurePoems(); } catch (_) {}
    if (!active()) return;
    const poem = POEMS.find((p) => p.id === id);
    const el = document.getElementById("poem-detail-content");
    if (!poem) {
      el.innerHTML = `<div class="card"><p>未找到古诗</p></div>`;
      return;
    }
    const displayTitle = poem.titleDisplay || poem.title;
    const titleChars = titleToChars(displayTitle, poem.titlePy || []);
    const dynastyChars = (poem.dynastyPy || []).map((p, i) => ({
      c: [...poem.dynasty][i],
      p,
    }));
    const authorChars = (poem.authorPy || []).map((p, i) => ({
      c: [...poem.author][i],
      p,
    }));

    const body = poem.lines
      .map((line) => `<div class="ruby-line">${rubyChars(line.chars)}</div>`)
      .join("");

    const it = getItem(id);
    const enrolled = !!it?.learned;
    let poemExposure = false;

    el.innerHTML = `
      ${sessionBanner()}<div class="poem-detail card">
        <div class="watercolor"></div>
        <button class="back-btn" id="back-poems">← 古诗小卡片</button>
        <div class="ruby-line title-line ${titleChars.length > 7 ? "long-title" : ""}">${rubyChars(titleChars)}${
          poem.subtitle
            ? `<span class="ruby-char"><span class="py">&nbsp;</span><span class="hz" style="font-size:0.45em;color:#888">（${escapeHtml(
                poem.subtitle
              )}）</span></span>`
            : ""
        }</div>
        <div class="ruby-line author-line">
          ${rubyChars(dynastyChars)}
          ${poem.dynasty && poem.author ? `<span class="dot-sep">·</span>` : ""}
          ${authorChars.length ? rubyChars(authorChars) : `<span class="plain-author">${escapeHtml(poem.author || "")}</span>`}
        </div>
        <div class="poem-reading${POEM_ILLUSTRATIONS[id] ? " has-picture" : ""}">
          ${poemIllustration(poem, true)}
          <div class="poem-body" id="poem-body">${body}</div>
        </div>
        <div class="speak-bar">
          <button type="button" class="btn btn-speak" id="btn-speak">▶ 朗读</button>
        </div>
        ${enrolled ? `<div class="actions-bar">${assessmentButtons("poem-check","家长确认 · 背诵")}</div>` : ""}
      </div>`;

    document.getElementById("back-poems").onclick = () => navigate("poems");
    if (enrolled) bindAssessment("poem-check",id,async result => {
      const r = REVIEW_RESULT[result];
      if (await completePractice(id,r,{type:"poem",title:displayTitle + (poem.subtitle ? "·" + poem.subtitle : ""),requireClassroom:enrolled,
        source:"parent",skill:"poem-recitation",details:{observedExposure:poemExposure}})) return;
      if (!active()) return;
      toast("记下来啦，每一次练习都有收获。");
      renderPoemDetail(id);
    });

    bindSessionExit();
    const btnSpeak = document.getElementById("btn-speak");
    updateSpeakButton("idle");
    if (btnSpeak) {
      btnSpeak.onclick = () => {
        poemExposure = true;
        if (!window.ChenchenSpeech || !ChenchenSpeech.supported(poem)) {
          toast("暂时无法播放朗读。");
          return;
        }
        const st = ChenchenSpeech.getStatus();
        if (st === "speaking" || st === "loading") { ChenchenSpeech.pause(); return; }
        if (st === "paused") { ChenchenSpeech.resume(); return; }
        const ok = ChenchenSpeech.speakPoem(
          {
            id: poem.id,
            title: displayTitle,
            dynasty: poem.dynasty,
            author: poem.author,
            lines: poem.lines.map((ln) => ln.text),
          },
          {
            onState: state => { if (active()) updateSpeakButton(state); },
            onError: () => { if (active()) toast("朗读暂时打不开，请再试一次。"); },
            onUnsupported: () => { if (active()) toast("这首诗暂未配音。"); },
          }
        );
        if (ok) updateSpeakButton(ChenchenSpeech.getStatus());
      };
    }
  }

  // ---------- Math ----------
  const MATH_ROUND_SIZE = 5;
  let mathMode = "addsub";
  let mathScore = { ok: 0, total: 0 };
  let currentQ = null;
  let mathQuestionAnswered = false;
  let mathExplanation = "";

  function randInt(a, b) {
    return a + Math.floor(Math.random() * (b - a + 1));
  }

  function genAddSub() {
    const op = Math.random() < 0.5 ? "+" : "-";
    let a, b, ans;
    if (op === "+") {
      a = randInt(0, 10);
      b = randInt(0, 10 - a);
      ans = a + b;
    } else {
      a = randInt(0, 10);
      b = randInt(0, a);
      ans = a - b;
    }
    return { text: `${a} ${op} ${b} = ?`, answer: ans, meta: { a, b, op } };
  }

  const NB_CIRCLES = ["①","②","③","④","⑤","⑥","⑦","⑧","⑨","⑩","⑪","⑫"];
  let bondSheet = null; // { item, qIndex, activeSlot, checked }
  let bondQIndex = 0;

  function genDecomp() {
    // legacy helper kept for compatibility
    const n = randInt(2, 10);
    const left = randInt(0, n);
    const right = n - left;
    return { text: `${n} 可以分成 ？ 和 ${right}`, answer: left, meta: { n, left, right }, kind: "decomp" };
  }

  function genBondItem() {
    const n = randInt(2, 10);
    const left = randInt(0, n);
    const right = n - left;
    const mode = Math.random() < 0.5 ? "decomp" : "compose";
    let blanks;
    const r = Math.random();
    if (mode === "decomp") {
      if (r < 0.4) blanks = { whole: false, left: false, right: true };
      else if (r < 0.75) blanks = { whole: false, left: true, right: false };
      else blanks = { whole: false, left: true, right: true };
    } else {
      if (r < 0.5) blanks = { whole: true, left: false, right: false };
      else if (r < 0.75) blanks = { whole: false, left: true, right: false };
      else blanks = { whole: false, left: false, right: true };
    }
    return {
      n,
      left,
      right,
      mode,
      blanks,
      answers: { whole: null, left: null, right: null },
      status: "open",
    };
  }

  function firstBlankSlot(item) {
    const order = item.mode === "decomp" ? ["whole", "left", "right"] : ["left", "right", "whole"];
    for (const s of order) {
      if (item.blanks[s] && (item.answers[s] === null || item.answers[s] === undefined)) return s;
    }
    return null;
  }

  function nextBlankSlot(item, fromSlot) {
    const order = item.mode === "decomp" ? ["whole", "left", "right"] : ["left", "right", "whole"];
    const start = order.indexOf(fromSlot);
    for (let k = 1; k < order.length; k++) {
      const s = order[(start + k) % order.length];
      if (item.blanks[s] && (item.answers[s] === null || item.answers[s] === undefined)) return s;
    }
    return null;
  }

  function genBondSheet() {
    bondQIndex += 1;
    const item = genBondItem();
    return {
      item,
      qIndex: bondQIndex,
      activeSlot: firstBlankSlot(item),
      checked: false,
    };
  }

  function mathVerdictHtml(correct) {
    return `<div class="math-verdict ${correct ? "is-correct" : "is-wrong"}"><span aria-hidden="true">${correct ? "✓" : "×"}</span><strong>${correct ? "答对啦！" : "这次不对哦"}</strong></div>`;
  }

  function mathAnswerHtml(value, answer, slot = "") {
    const correct = value === answer;
    const label = correct ? `${value}，答对了` : `填了 ${value}，正确答案是 ${answer}`;
    return `<span class="math-answer-result ${correct ? "is-correct" : "is-wrong"}"${slot ? ` data-slot="${slot}"` : ""} role="img" aria-label="${label}">${correct ? "" : `<span class="math-answer-attempt" aria-hidden="true"><span class="math-answer-value">${value}</span><span class="math-answer-mark">×</span></span><span class="math-answer-arrow" aria-hidden="true">→</span>`}<span class="math-answer-correct" aria-hidden="true"><span class="math-answer-value">${answer}</span><span class="math-answer-mark">✓</span></span></span>`;
  }

  function nbCellHtml(item, slot) {
    const isBlank = item.blanks[slot];
    const truth = item[slot === "whole" ? "n" : slot];
    const filled = item.answers[slot];
    const isActive = bondSheet && bondSheet.activeSlot === slot;
    if (!isBlank) {
      return `<span class="nb-num">${truth}</span>`;
    }
    if (item.solution) return mathAnswerHtml(filled, item.solution[slot], slot);
    const val = filled === null || filled === undefined ? "" : String(filled);
    let cls = "nb-box";
    if (isActive) cls += " is-active";
    return `<button type="button" class="${cls}" data-slot="${slot}" aria-label="填写"${bondSheet?.checked ? " disabled" : ""}>${val || "&nbsp;"}</button>`;
  }

  function nbCardHtml(item, qIndex) {
    const no = NB_CIRCLES[(qIndex - 1) % NB_CIRCLES.length] || String(qIndex);
    const modeLabel = item.mode === "decomp" ? "分解" : "组成";
    const fork =
      item.mode === "decomp"
        ? `<svg class="nb-fork" viewBox="0 0 120 36" aria-hidden="true"><line x1="60" y1="2" x2="28" y2="34"/><line x1="60" y1="2" x2="92" y2="34"/></svg>`
        : `<svg class="nb-fork" viewBox="0 0 120 36" aria-hidden="true"><line x1="28" y1="2" x2="60" y2="34"/><line x1="92" y1="2" x2="60" y2="34"/></svg>`;
    let body;
    if (item.mode === "decomp") {
      body = `
        <div class="nb-top">${nbCellHtml(item, "whole")}</div>
        ${fork}
        <div class="nb-bot">
          ${nbCellHtml(item, "left")}
          ${nbCellHtml(item, "right")}
        </div>`;
    } else {
      body = `
        <div class="nb-bot nb-parts">
          ${nbCellHtml(item, "left")}
          ${nbCellHtml(item, "right")}
        </div>
        ${fork}
        <div class="nb-top">${nbCellHtml(item, "whole")}</div>`;
    }
    return `<div class="nb-card nb-single status-${item.status}">
      <span class="nb-no">${no}</span>
      <span class="nb-mode-tag">${modeLabel}</span>
      ${item.status === "open" ? "" : mathVerdictHtml(item.status === "ok")}
      <div class="nb-bond nb-${item.mode}">${body}</div>
    </div>`;
  }

  function bindBondSheet(panel) {
    panel.querySelectorAll(".nb-box").forEach((btn) => {
      btn.onclick = () => {
        if (!bondSheet || bondSheet.checked) return;
        bondSheet.activeSlot = btn.dataset.slot;
        renderBondPanel();
      };
    });
    panel.querySelectorAll(".nb-pad button[data-n]").forEach((btn) => {
      btn.onclick = () => {
        if (!bondSheet || !bondSheet.activeSlot || bondSheet.checked) return;
        const item = bondSheet.item;
        const slot = bondSheet.activeSlot;
        if (!item?.blanks[slot]) return;
        item.answers[slot] = Number(btn.dataset.n);
        item.status = "open";
        bondSheet.activeSlot = nextBlankSlot(item, slot);
        if (firstBlankSlot(item)) renderBondPanel();
        else checkBondSheet();
      };
    });
    const clearBtn = panel.querySelector("#nb-clear");
    if (clearBtn) {
      clearBtn.onclick = () => {
        if (!bondSheet?.activeSlot || bondSheet.checked) return;
        const slot = bondSheet.activeSlot;
        bondSheet.item.answers[slot] = null;
        bondSheet.item.status = "open";
        renderBondPanel();
      };
    }
  }

  function checkBondSheet() {
    if (!bondSheet || bondSheet.checked) return;
    const item = bondSheet.item;
    const need = ["whole", "left", "right"].filter(s=>item.blanks[s]);
    if (!need.every(s=>item.answers[s] !== null && item.answers[s] !== undefined)) {
      toast("点一下空格，再点数字填进去。");
      bondSheet.activeSlot = firstBlankSlot(item);
      renderBondPanel(); return;
    }
    const left = item.blanks.left ? Number(item.answers.left) : item.left;
    const right = item.blanks.right ? Number(item.answers.right) : item.right;
    const whole = item.blanks.whole ? Number(item.answers.whole) : item.n;
    const good = left >= 0 && right >= 0 && whole <= 10 && left + right === whole;
    mathScore.total++;
    bondSheet.checked = true;
    bondSheet.activeSlot = null;
    if(good) {
      item.status = "ok";
      item.solution = {whole,left,right};
      mathScore.ok++;
      renderBondPanel();
      document.getElementById("math-fb").textContent = "答对啦！✿";
    } else {
      item.status = "bad";
      // Keep a usable part in open-ended questions, then correct only its partner.
      let answerLeft = item.left;
      if (item.blanks.left && item.blanks.right) {
        if (left >= 0 && left <= item.n) answerLeft = left;
        else if (right >= 0 && right <= item.n) answerLeft = item.n - right;
      }
      const answerRight = item.n - answerLeft;
      item.solution = {whole:item.n,left:answerLeft,right:answerRight};
      renderBondPanel();
      mathExplanation = `正确答案：${item.n} 等于 ${answerLeft} 加 ${answerRight}。${item.n} 可以分成 ${answerLeft} 和 ${answerRight}。看懂了，再点下一题。`;
      document.getElementById("math-fb").textContent = `正确答案：${item.n} = ${answerLeft} + ${answerRight}。${item.n} 可以分成 ${answerLeft} 和 ${answerRight}。`;
    }
    finishMathQuestion(good);
  }

  function renderBondPanel() {
    const panel = document.getElementById("math-panel");
    if (!panel || !bondSheet) return;
    const item = bondSheet.item;
    const pad = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
      .map((n) => `<button type="button" data-n="${n}">${n}</button>`)
      .join("");
    const modeHint = item.mode === "decomp" ? "一个数，分成两部分" : "两个数，合在一起";
    panel.innerHTML = `
      <div class="nb-sheet-head">
        <div class="nb-sheet-title">10以内 · 一题一练</div>
        <div class="nb-sheet-hint">${modeHint}${bondSheet.checked ? "" : " · 点空格，再点数字"}</div>
      </div>
      <div class="nb-single-wrap">
        ${nbCardHtml(item, bondSheet.qIndex)}
      </div>
      <div class="nb-pad" id="nb-pad"${bondSheet.checked ? " hidden" : ""}>
        ${pad}
        <button type="button" class="nb-pad-clear" id="nb-clear">清除</button>
      </div>
      <div class="${bondSheet.checked ? "sr-only" : "feedback"}" id="math-fb" role="status" aria-live="polite"></div>`;
    bindBondSheet(panel);
  }

  function choicesFor(ans) {
    const set = new Set([ans]);
    while (set.size < 4) {
      const c = randInt(0, 10);
      set.add(c);
    }
    return [...set].sort(() => Math.random() - 0.5);
  }

  let mathCompleted = 0;
  function renderMath(forceMode) {
    resetPracticeAttempt();
    stopSpeechSafe();
    if (forceMode) mathMode = forceMode;
    mathScore = { ok: 0, total: 0 };
    mathCompleted = 0;
    bondQIndex = 0;
    const el = document.getElementById("math-content");
    el.innerHTML = `${sessionBanner()}<div class="card practice-card"><div class="practice-heading"><div><p class="eyebrow">数一数，想一想</p><h2>玩数学 <span class="heading-flower">＋</span></h2></div><span class="practice-count" id="math-progress">0 / ${MATH_ROUND_SIZE} 题</span></div>
      ${reviewSession ? "" : `<div class="tabs-mini"><button data-m="addsub" class="${mathMode === "addsub" ? "active" : ""}">10以内加减法</button><button data-m="decomp" class="${mathMode === "decomp" ? "active" : ""}">分解组合</button></div>`}
      <p class="practice-instruction">做 ${MATH_ROUND_SIZE} 道小题就休息。填完就能知道对错，看完再点下一题。</p><div class="math-panel" id="math-panel"></div>
      <div class="btn-row practice-controls"><button class="btn btn-ghost" id="math-read">◖)) 听题目</button><button class="btn btn-primary" id="math-next" hidden disabled>我看懂了，下一题 →</button></div><div id="math-review-bar"></div></div>`;
    el.querySelectorAll("[data-m]").forEach(btn=>btn.onclick=()=>renderMath(btn.dataset.m));
    document.getElementById("math-next").onclick = advanceMathQuestion;
    document.getElementById("math-read").onclick = () => {
      if (mathExplanation) speakGuide(mathExplanation);
      else if (mathMode === "decomp") {
        const it = bondSheet.item;
        speakGuide(it.mode === "decomp" ? `把 ${it.n} 分成两部分，点空格，再点数字。` : "两部分合起来是多少？点空格，再点数字。");
      } else speakGuide(`${currentQ.meta.a} ${currentQ.meta.op === "+" ? "加" : "减"} ${currentQ.meta.b} 等于几？点一点击答案。`);
    };
    nextMathQ();
    bindSessionExit();
  }

  function advanceMathQuestion() {
    if (!mathQuestionAnswered || currentView !== "math") return;
    mathQuestionAnswered = false;
    if (mathCompleted >= MATH_ROUND_SIZE) renderMathFinish();
    else nextMathQ();
  }

  function finishMathQuestion(correct) {
    if (mathQuestionAnswered) return;
    mathQuestionAnswered = true;
    mathCompleted++;
    const progress = document.getElementById("math-progress");
    if(progress) progress.textContent = `${mathCompleted} / ${MATH_ROUND_SIZE} 题`;
    const next = document.getElementById("math-next");
    if(next) {
      next.hidden = false;
      next.disabled = false;
      next.textContent = (correct ? "" : "我看懂了，") + (mathCompleted >= MATH_ROUND_SIZE ? "完成啦 ✿" : "下一题 →");
    }
    if (!correct) {
      document.getElementById("math-read").textContent = "◖)) 听答案";
    }
  }

  function renderMathFinish() {
    stopSpeechSafe();
    const id = mathMode === "decomp" ? "math-decomp-10" : "math-addsub-10";
    const result = mathScore.ok >= MATH_ROUND_SIZE ? "independent" : mathScore.ok > 0 ? "supported" : "again";
    const meta = {type:mathMode === "decomp" ? "decomp" : "math", title:mathMode === "decomp" ? "10以内分解组合" : "10以内加减法",
      enroll:true,source:"automatic",skill:"math-solving",details:{correct:mathScore.ok,total:MATH_ROUND_SIZE,mode:mathMode}};
    const panel = document.getElementById("math-panel");
    panel.innerHTML = `<div class="mini-success"><span aria-hidden="true">✿</span><h3>认真想了 ${MATH_ROUND_SIZE} 道题，真棒！</h3><p>${assessmentBadge(result)}</p><p>首次答对 ${mathScore.ok} / ${MATH_ROUND_SIZE} 题</p><button class="btn btn-primary" id="finish-math">${reviewSession ? "收下小花，继续 →" : "收下小花，休息一下"}</button></div>`;
    document.querySelector("#math-content .practice-controls").hidden = true;
    document.getElementById("finish-math").onclick = async () => {
      const advanced = await completePractice(id, REVIEW_RESULT[result], meta);
      if (!advanced) navigate("home");
    };
  }

  function nextMathQ() {
    stopSpeechSafe();
    mathQuestionAnswered = false;
    mathExplanation = "";
    const next = document.getElementById("math-next");
    if (next) { next.disabled = true; next.hidden = true; }
    const read = document.getElementById("math-read");
    if (read) read.textContent = "◖)) 听题目";
    if (mathMode === "decomp") {
      bondSheet = genBondSheet();
      renderBondPanel();
      return;
    }
    currentQ = genAddSub();
    const panel = document.getElementById("math-panel");
    if (!panel) return;
    const opts = choicesFor(currentQ.answer);
    panel.innerHTML = `
      <div class="counting-aid" aria-label="用小圆点数一数"><span>${Array.from({length:currentQ.meta.a},()=>'<i></i>').join("") || '<b>0</b>'}</span><b>${currentQ.meta.op}</b><span class="second-dots">${Array.from({length:currentQ.meta.b},()=>'<i></i>').join("") || '<b>0</b>'}</span></div>
      <div class="math-q">${escapeHtml(currentQ.text)}</div>
      <div class="math-opts">
        ${opts
          .map((o) => `<button data-v="${o}">${o}</button>`)
          .join("")}
      </div>
      <div class="feedback" id="math-fb" role="status" aria-live="polite"></div>`;

    panel.querySelectorAll(".math-opts button").forEach((btn) => {
      btn.onclick = () => {
        if (btn.disabled || mathQuestionAnswered) return;
        const v = Number(btn.dataset.v);
        const correct = v === currentQ.answer;
        mathScore.total++;
        const fb = document.getElementById("math-fb");
        panel.querySelectorAll(".math-opts button").forEach((b) => {
          b.disabled = true;
          if (Number(b.dataset.v) === currentQ.answer) {
            b.classList.add("correct");
            b.innerHTML = `<span>${b.dataset.v}</span><span class="math-option-mark" aria-hidden="true">✓</span>`;
            b.setAttribute("aria-label", `${b.dataset.v}，正确答案`);
          }
        });
        const {a,b,op} = currentQ.meta;
        const equation = panel.querySelector(".math-q");
        equation.classList.add("is-answered");
        equation.innerHTML = `<span>${a} ${op} ${b} =</span>${mathAnswerHtml(v,currentQ.answer)}`;
        if (correct) {
          mathScore.ok++;
          fb.innerHTML = mathVerdictHtml(true);
        } else {
          btn.classList.add("wrong");
          btn.innerHTML = `<span>${v}</span><span class="math-option-mark" aria-hidden="true">×</span>`;
          btn.setAttribute("aria-label", `${v}，这次不对`);
          fb.innerHTML = `${mathVerdictHtml(false)}<span class="sr-only">正确答案是 ${currentQ.answer}：${a} ${op} ${b} = ${currentQ.answer}。看懂了，再点下一题。</span>`;
          mathExplanation = `正确答案是 ${currentQ.answer}。${a} ${op === "+" ? "加" : "减"} ${b} 等于 ${currentQ.answer}。看懂了，再点下一题。`;
        }
        fb.className = "feedback math-feedback-visual";
        finishMathQuestion(correct);
      };
    });
  }

  // ---------- Pinyin ----------
  const INITIALS = [
    "b","p","m","f","d","t","n","l","g","k","h",
    "j","q","x","zh","ch","sh","r","z","c","s","y","w",
  ];
  const FINALS = [
    "a","o","e","i","u","ü","ai","ei","ui","ao","ou","iu",
    "ie","üe","er","an","en","in","un","ün","ang","eng","ing","ong",
  ];
  const PINYIN_DATA = window.ChenchenPinyinData;
  let pyTab = "initials";
  let pyVoice = null;
  let pyAudioRequest = 0;
  let pyAudioButton = null;

  function stopPinyinAudio(destroy = false) {
    pyAudioRequest++;
    pyVoice?.stop();
    if (destroy) { pyVoice?.destroy(); pyVoice = null; }
    pyAudioButton?.classList.remove("is-reading");
    pyAudioButton?.removeAttribute("aria-busy");
    pyAudioButton = null;
  }

  async function playPinyin(kind, value, button) {
    pyExposures.add(kind === "sound" ? value : pySelected);
    stopSpeechSafe();
    stopPinyinAudio();
    const request = pyAudioRequest;
    const status = document.getElementById("py-assessment")?.hidden === false ? document.getElementById("py-check-error") : document.getElementById("py-audio-status");
    status.textContent = "";
    pyAudioButton = button;
    button.classList.add("is-reading");
    button.setAttribute("aria-busy", "true");
    try {
      pyVoice ||= window.ChenchenPinyinAudio.create();
      // Start in this click's call stack so phones can unlock media playback.
      await (kind === "sound" ? pyVoice.playSound(value) : pyVoice.playExample(value));
    } catch (error) {
      if (request === pyAudioRequest && currentView === "pinyin" && error.name !== "AbortError") {
        status.textContent = "声音没播放，再点一下。";
      }
    } finally {
      if (request === pyAudioRequest) {
        button.classList.remove("is-reading");
        button.removeAttribute("aria-busy");
        pyAudioButton = null;
      }
    }
  }

  function pinyinId(symbol) { return `pinyin-${symbol.replace(/ü/g,"v")}`; }

  function renderPinyin() {
    stopPinyinAudio();
    const generation = practiceGeneration;
    const el = document.getElementById("pinyin-content");
    const list = pyTab === "initials" ? INITIALS : FINALS;
    if (!list.includes(pySelected)) pySelected = list[0];
    const targetId = reviewSession?.items[reviewSession.index]?.type === "pinyin" ? reviewSession.items[reviewSession.index].id : null;
    const target = [...INITIALS,...FINALS].find(symbol=>pinyinId(symbol)===targetId);
    const canFinish = pyPracticed.size && (!target || pyPracticed.has(target));
    const examples = PINYIN_DATA[pyTab].find(item => item.id === pySelected).examples;
    el.innerHTML = `${sessionBanner()}<div class="card practice-card pinyin-practice"><div class="practice-heading"><div><p class="eyebrow">张开小嘴，读一读</p><h2>拼音小卡片 <span class="heading-flower">a</span></h2></div><span class="practice-count">${target ? "先试着自己读" : "读 3 张就休息"}</span></div><div class="tabs-mini"><button data-pt="initials" class="${pyTab === "initials" ? "active" : ""}">声母</button><button data-pt="finals" class="${pyTab === "finals" ? "active" : ""}">韵母</button></div><div class="pinyin-sample" id="py-sample"><button class="big-letter" id="py-listen" aria-label="听拼音 ${escapeHtml(pySelected)}"><span>${escapeHtml(pySelected)}</span><span class="pinyin-speaker" aria-hidden="true">◖))</span></button><div class="pinyin-examples" aria-label="点汉字听读音">${examples.map(example=>`<button class="pinyin-example" data-py-example="${escapeHtml(example.c)}" aria-label="听汉字${escapeHtml(example.c)}的读音">${writingRuby(example.c,example.pinyin)}</button>`).join("")}</div><div class="pinyin-audio-status" id="py-audio-status" role="status" aria-live="polite"></div><button class="btn btn-primary" id="py-read">练好啦 ✓</button></div><div class="pinyin-assessment" id="py-assessment" hidden><span class="assessment-pinyin">${escapeHtml(pySelected)}</span>${assessmentButtons("py-check","家长确认 · 能自己读吗？")}<button class="text-btn" id="py-check-hint">◖)) 听提示</button><button class="text-btn" id="py-check-back">回去练一练</button></div><div class="pinyin-grid">${list.map(p=>`<button class="pinyin-chip ${p === pySelected ? "active" : ""} ${pyPracticed.has(p) ? "practiced" : ""}" data-p="${p}" aria-label="听拼音 ${p}" aria-pressed="${p === pySelected}">${p}${pyPracticed.has(p) ? '<span aria-label="已练习">✓</span>' : ""}</button>`).join("")}</div><div class="recall-footer"><span>已练习 ${pyPracticed.size} 张小卡片</span><button class="btn btn-learn" id="py-finish" ${canFinish ? "" : "disabled"}>${reviewSession ? "读好啦，继续 →" : "读好啦，收下小花"}</button></div></div>`;
    let afterPractice = true;
    const beginCheck = rehearsed => {
      stopPinyinAudio();
      afterPractice = rehearsed;
      document.getElementById("py-assessment").hidden = false;
      el.querySelector(".pinyin-practice").classList.add("is-assessing");
    };
    el.querySelectorAll("[data-pt]").forEach(btn=>btn.onclick=()=>{pyTab=btn.dataset.pt;renderPinyin();});
    el.querySelectorAll("[data-p]").forEach(btn=>btn.onclick=()=>{
      pySelected=btn.dataset.p;
      renderPinyin();
      playPinyin("sound",pySelected,document.getElementById("py-listen"));
      document.getElementById("py-sample").scrollIntoView?.({block:"nearest",behavior:"smooth"});
    });
    document.getElementById("py-listen").onclick = event => playPinyin("sound",pySelected,event.currentTarget);
    el.querySelectorAll("[data-py-example]").forEach(btn=>btn.onclick=()=>playPinyin("example",btn.dataset.pyExample,btn));
    document.getElementById("py-read").onclick = () => beginCheck(true);
    document.getElementById("py-check-hint").onclick = event => {afterPractice=true;return playPinyin("sound",pySelected,event.currentTarget);};
    document.getElementById("py-check-back").onclick = () => {
      stopPinyinAudio();
      document.getElementById("py-assessment").hidden = true;
      el.querySelector(".pinyin-practice").classList.remove("is-assessing");
    };
    el.querySelectorAll("[data-assessment]").forEach(button=>button.onclick=()=>{
      stopPinyinAudio();
      // Keep the first check in this round, even if the child practises again.
      if (!pyAssessments.has(pySelected)) pyAssessments.set(pySelected,{result:button.dataset.assessment,afterPractice:afterPractice || pyExposures.has(pySelected)});
      pyPracticed.add(pySelected);
      if (!target && pyPracticed.size < 3) pySelected = list.find(p=>!pyPracticed.has(p)) || pySelected;
      renderPinyin();
      toast(target || pyPracticed.size >= 3 ? "练习好啦，收下小花休息吧！" : "记下来啦，试试下一张。");
    });
    document.getElementById("py-finish").onclick = async () => {
      if(!canFinish) return;
      const entries = Array.from(pyAssessments,([symbol,check])=>({id:pinyinId(symbol),type:"pinyin",title:`拼音·${symbol}`,skill:"pinyin-reading",source:"parent",result:check.result,details:{symbol,afterPractice:check.afterPractice}}));
      const result = entries.some(e=>e.result==="again") ? "forgot" : entries.some(e=>e.result==="supported") ? "fuzzy" : "remember";
      const button = document.getElementById("py-finish");
      button.disabled=true;
      const advanced = await completePractice(targetId || "pinyin-basic",result,{type:"pinyin",title:"声母韵母认读",entries,enroll:true,retirePinyinGroup:true});
      if (!advanced) navigate("home");
      else if (generation === practiceGeneration && currentView === "pinyin" && pendingPracticeAttempt) {
        el.querySelectorAll("button").forEach(b=>b.disabled=true);
        button.disabled=false;button.textContent="重试保存";
      }
    };
    if (target === pySelected && !pyPracticed.has(target)) beginCheck(false);
    bindSessionExit();
  }

  // ---------- Writing ----------
  const WRITE_CHARS = [
    {"c":"一","level":"starter","group":"数字","example":"一只","strokes":"1画","tip":"一条横线放中间。"},
    {"c":"二","level":"starter","group":"数字","example":"二月","strokes":"2画","tip":"上面的横短，下面的横长。"},
    {"c":"三","level":"starter","group":"数字","example":"三只","strokes":"3画","tip":"三条横线，下面一条最长。"},
    {"c":"四","level":"starter","group":"数字","example":"四个","strokes":"5画","tip":"外面像个小方框。"},
    {"c":"五","level":"starter","group":"数字","example":"五个","strokes":"4画","tip":"看看上下两条横的位置。"},
    {"c":"十","level":"starter","group":"数字","example":"十个","strokes":"2画","tip":"横和竖在中间相遇。"},
    {"c":"人","level":"starter","group":"人和身体","example":"大人","strokes":"2画","tip":"两边像站稳的两条腿。"},
    {"c":"大","level":"starter","group":"人和身体","example":"大小","strokes":"3画","tip":"像一个张开双臂的人。"},
    {"c":"小","level":"starter","group":"人和身体","example":"小手","strokes":"3画","tip":"中间长，两边短。"},
    {"c":"口","level":"starter","group":"人和身体","example":"门口","strokes":"3画","tip":"像一个小小的方框。"},
    {"c":"子","level":"starter","group":"人和身体","example":"孩子","strokes":"3画","tip":"中间的钩弯弯的。"},
    {"c":"女","level":"starter","group":"人和身体","example":"女孩","strokes":"3画","tip":"几条线在中间相交。"},
    {"c":"日","level":"starter","group":"自然","example":"日出","strokes":"4画","tip":"长方框里有一条横。"},
    {"c":"月","level":"starter","group":"自然","example":"月亮","strokes":"4画","tip":"里面两条短横留点空隙。"},
    {"c":"水","level":"starter","group":"自然","example":"喝水","strokes":"4画","tip":"中间长，两边舒展开。"},
    {"c":"火","level":"starter","group":"自然","example":"火苗","strokes":"4画","tip":"两边的小笔画像火花。"},
    {"c":"山","level":"starter","group":"自然","example":"大山","strokes":"3画","tip":"中间的山峰最高。"},
    {"c":"石","level":"starter","group":"自然","example":"石头","strokes":"5画","tip":"小方框放在右下边。"},
    {"c":"田","level":"starter","group":"植物粮食","example":"田地","strokes":"5画","tip":"里面分成四个小格子。"},
    {"c":"木","level":"starter","group":"植物粮食","example":"木头","strokes":"4画","tip":"中间像树干，两边像树枝。"},
    {"c":"上","level":"starter","group":"方向动作","example":"上面","strokes":"3画","tip":"长横托住上面的线。"},
    {"c":"下","level":"starter","group":"方向动作","example":"下面","strokes":"3画","tip":"长横下面挂着小笔画。"},
    {"c":"土","level":"starter","group":"自然","example":"泥土","strokes":"3画","tip":"下面的横比上面长。"},
    {"c":"天","level":"starter","group":"自然","example":"天空","strokes":"4画","tip":"上面两横，下面舒展开。"},
    {"c":"六","level":"explore","group":"数字","example":"六个","strokes":"4画","tip":"上面小点，下面两边分开。"},
    {"c":"七","level":"explore","group":"数字","example":"七个","strokes":"2画","tip":"下面有个弯弯的小钩。"},
    {"c":"八","level":"explore","group":"数字","example":"八个","strokes":"2画","tip":"两边分开，不碰在一起。"},
    {"c":"九","level":"explore","group":"数字","example":"九个","strokes":"2画","tip":"右边有个大大的弯钩。"},
    {"c":"百","level":"explore","group":"数字","example":"一百","strokes":"6画","tip":"长横下面放一个白字。"},
    {"c":"左","level":"explore","group":"方向动作","example":"左手","strokes":"5画","tip":"下面藏着一个工字。"},
    {"c":"右","level":"explore","group":"方向动作","example":"右手","strokes":"5画","tip":"下面藏着一个口字。"},
    {"c":"中","level":"explore","group":"方向动作","example":"中间","strokes":"4画","tip":"一条竖穿过小方框。"},
    {"c":"入","level":"explore","group":"方向动作","example":"入口","strokes":"2画","tip":"两条线靠在一起。"},
    {"c":"出","level":"explore","group":"方向动作","example":"出门","strokes":"5画","tip":"上下两个口朝上，中间一条竖。"},
    {"c":"回","level":"explore","group":"方向动作","example":"回家","strokes":"6画","tip":"大方框里面有个小方框。"},
    {"c":"目","level":"explore","group":"人和身体","example":"目光","strokes":"5画","tip":"长方框里有两条短横。"},
    {"c":"耳","level":"explore","group":"人和身体","example":"耳朵","strokes":"6画","tip":"里面短横要留出空隙。"},
    {"c":"手","level":"explore","group":"人和身体","example":"小手","strokes":"4画","tip":"中间的长钩向下伸。"},
    {"c":"足","level":"explore","group":"人和身体","example":"足球","strokes":"7画","tip":"上面一个口，下面舒展开。"},
    {"c":"牙","level":"explore","group":"人和身体","example":"牙齿","strokes":"4画","tip":"右边的长钩向下伸。"},
    {"c":"心","level":"explore","group":"人和身体","example":"开心","strokes":"4画","tip":"弯钩旁边有小点。"},
    {"c":"米","level":"explore","group":"植物粮食","example":"大米","strokes":"6画","tip":"几条线向四周散开。"},
    {"c":"禾","level":"explore","group":"植物粮食","example":"禾苗","strokes":"5画","tip":"木字上面多一小撇。"},
    {"c":"竹","level":"explore","group":"植物粮食","example":"竹子","strokes":"6画","tip":"左右两边像两棵小竹子。"},
    {"c":"花","level":"explore","group":"植物粮食","example":"小花","strokes":"7画","tip":"草字头在上面。"},
    {"c":"草","level":"explore","group":"植物粮食","example":"小草","strokes":"9画","tip":"草字头下面有日和十。"},
    {"c":"牛","level":"explore","group":"动物","example":"小牛","strokes":"4画","tip":"中间一条竖，上下两条横。"},
    {"c":"羊","level":"explore","group":"动物","example":"小羊","strokes":"6画","tip":"上面像羊角，中间一条竖。"},
    {"c":"马","level":"explore","group":"动物","example":"小马","strokes":"3画","tip":"里面的短横不要伸太长。"},
    {"c":"鸟","level":"explore","group":"动物","example":"小鸟","strokes":"5画","tip":"上面的小点像鸟的眼睛。"},
    {"c":"虫","level":"explore","group":"动物","example":"小虫","strokes":"6画","tip":"小方框放在上半边。"},
    {"c":"鱼","level":"explore","group":"动物","example":"小鱼","strokes":"8画","tip":"中间像田，下面一条长横。"},
    {"c":"白","level":"explore","group":"自然","example":"白云","strokes":"5画","tip":"日字上面多一小撇。"},
    {"c":"云","level":"explore","group":"自然","example":"白云","strokes":"4画","tip":"上面两条横，下面弯弯的。"},
    {"c":"雨","level":"explore","group":"自然","example":"下雨","strokes":"8画","tip":"里面的小点像雨滴。"},
    {"c":"风","level":"explore","group":"自然","example":"大风","strokes":"4画","tip":"外面有个大弯，里面两线相交。"},
    {"c":"门","level":"explore","group":"身边物品","example":"大门","strokes":"3画","tip":"像一扇敞开的大门。"},
    {"c":"车","level":"explore","group":"身边物品","example":"汽车","strokes":"4画","tip":"中间的竖稳稳站住。"},
    {"c":"书","level":"explore","group":"身边物品","example":"看书","strokes":"4画","tip":"右上边有一个小点。"},
    {"c":"本","level":"explore","group":"身边物品","example":"书本","strokes":"5画","tip":"木字下面多一条短横。"},
    {"c":"妈","level":"everyday","group":"家人与朋友","example":"妈妈","strokes":"6画","tip":"女字旁在左，马字在右。"},
    {"c":"爸","level":"everyday","group":"家人与朋友","example":"爸爸","strokes":"8画","tip":"上面宽，下面的弯钩向右伸。"},
    {"c":"爷","level":"everyday","group":"家人与朋友","example":"爷爷","strokes":"6画","tip":"上半边舒展，下半边窄一点。"},
    {"c":"奶","level":"everyday","group":"家人与朋友","example":"奶奶","strokes":"5画","tip":"女字旁瘦一点，右边留出空间。"},
    {"c":"哥","level":"everyday","group":"家人与朋友","example":"哥哥","strokes":"10画","tip":"上下各藏着一个小口。"},
    {"c":"姐","level":"everyday","group":"家人与朋友","example":"姐姐","strokes":"8画","tip":"右边的小框里，短横留出空隙。"},
    {"c":"弟","level":"everyday","group":"家人与朋友","example":"弟弟","strokes":"7画","tip":"上面两点，下面有弯弯的钩。"},
    {"c":"妹","level":"everyday","group":"家人与朋友","example":"妹妹","strokes":"8画","tip":"女字旁在左，右边两横一长一短。"},
    {"c":"我","level":"everyday","group":"家人与朋友","example":"我们","strokes":"7画","tip":"右边的斜钩舒展开。"},
    {"c":"你","level":"everyday","group":"家人与朋友","example":"你好","strokes":"7画","tip":"左边窄，右边宽一点。"},
    {"c":"他","level":"everyday","group":"家人与朋友","example":"他们","strokes":"5画","tip":"左边单人旁，右边弯钩伸展开。"},
    {"c":"她","level":"everyday","group":"家人与朋友","example":"她们","strokes":"6画","tip":"女字旁在左，右边弯钩伸展开。"},
    {"c":"好","level":"everyday","group":"家人与朋友","example":"你好","strokes":"6画","tip":"女字在左，子字在右。"},
    {"c":"爱","level":"everyday","group":"家人与朋友","example":"爱心","strokes":"10画","tip":"中间的小盖子下面留出空间。"},
    {"c":"家","level":"everyday","group":"家人与朋友","example":"回家","strokes":"10画","tip":"宝盖头在上，下面舒展开。"},
    {"c":"朋","level":"everyday","group":"家人与朋友","example":"朋友","strokes":"8画","tip":"两个月字并排站。"},
    {"c":"友","level":"everyday","group":"家人与朋友","example":"朋友","strokes":"4画","tip":"下半边藏着一个又字。"},
    {"c":"学","level":"everyday","group":"校园生活","example":"学校","strokes":"8画","tip":"子字放在下半边。"},
    {"c":"文","level":"everyday","group":"校园生活","example":"中文","strokes":"4画","tip":"小点在上，下面撇捺舒展开。"},
    {"c":"字","level":"everyday","group":"校园生活","example":"写字","strokes":"6画","tip":"宝盖头下面藏着一个子字。"},
    {"c":"写","level":"everyday","group":"校园生活","example":"写字","strokes":"5画","tip":"上面小盖子，下面一条横。"},
    {"c":"画","level":"everyday","group":"校园生活","example":"画画","strokes":"8画","tip":"中间是田，下面像小托盘。"},
    {"c":"读","level":"everyday","group":"校园生活","example":"读书","strokes":"10画","tip":"言字旁在左，右边宽一点。"},
    {"c":"课","level":"everyday","group":"校园生活","example":"上课","strokes":"10画","tip":"言字旁在左，果字在右。"},
    {"c":"校","level":"everyday","group":"校园生活","example":"学校","strokes":"10画","tip":"木字旁窄一点，右边舒展开。"},
    {"c":"师","level":"everyday","group":"校园生活","example":"老师","strokes":"6画","tip":"左边窄，右边的小框留出空间。"},
    {"c":"生","level":"everyday","group":"校园生活","example":"生日","strokes":"5画","tip":"中间一竖，把几条横连起来。"},
    {"c":"同","level":"everyday","group":"校园生活","example":"同学","strokes":"6画","tip":"外框里面有一横和一个口。"},
    {"c":"桌","level":"everyday","group":"校园生活","example":"桌子","strokes":"10画","tip":"木字托住上面的部分。"},
    {"c":"笔","level":"everyday","group":"校园生活","example":"铅笔","strokes":"10画","tip":"竹字头在上，弯钩向右伸。"},
    {"c":"尺","level":"everyday","group":"校园生活","example":"尺子","strokes":"4画","tip":"上面小折角，下面两边展开。"},
    {"c":"包","level":"everyday","group":"校园生活","example":"书包","strokes":"5画","tip":"外面包着，里面有弯钩。"},
    {"c":"开","level":"everyday","group":"日常动作","example":"开门","strokes":"4画","tip":"上面两条横，下面两边分开。"},
    {"c":"关","level":"everyday","group":"日常动作","example":"关门","strokes":"6画","tip":"上面两点，下面像天字。"},
    {"c":"来","level":"everyday","group":"日常动作","example":"回来","strokes":"7画","tip":"中间一竖，左右舒展开。"},
    {"c":"去","level":"everyday","group":"日常动作","example":"出去","strokes":"5画","tip":"上面土字，下面有小折角。"},
    {"c":"走","level":"everyday","group":"日常动作","example":"走路","strokes":"7画","tip":"上面像土，下面向右展开。"},
    {"c":"跑","level":"everyday","group":"日常动作","example":"跑步","strokes":"12画","tip":"足字旁在左，包字在右。"},
    {"c":"坐","level":"everyday","group":"日常动作","example":"坐下","strokes":"7画","tip":"两个人坐在土字上面。"},
    {"c":"立","level":"everyday","group":"日常动作","example":"立正","strokes":"5画","tip":"小点在上，长横在下面托住。"},
    {"c":"看","level":"everyday","group":"日常动作","example":"看书","strokes":"9画","tip":"下半边是目，上面舒展开。"},
    {"c":"听","level":"everyday","group":"日常动作","example":"听话","strokes":"7画","tip":"小口在左，右边留出空间。"},
    {"c":"说","level":"everyday","group":"日常动作","example":"说话","strokes":"9画","tip":"言字旁窄一点，右边宽一点。"},
    {"c":"笑","level":"everyday","group":"日常动作","example":"微笑","strokes":"10画","tip":"竹字头在上，下面撇捺舒展开。"},
    {"c":"吃","level":"everyday","group":"日常动作","example":"吃饭","strokes":"6画","tip":"小口在左，右边有个弯钩。"},
    {"c":"喝","level":"everyday","group":"日常动作","example":"喝水","strokes":"12画","tip":"左边小口，右边宽一点。"},
    {"c":"玩","level":"everyday","group":"日常动作","example":"玩具","strokes":"8画","tip":"王字旁在左，元字在右。"},
    {"c":"洗","level":"everyday","group":"日常动作","example":"洗手","strokes":"9画","tip":"三点水在左，右边弯钩伸展开。"},
    {"c":"东","level":"everyday","group":"方向与比较","example":"东边","strokes":"5画","tip":"中间长钩，左右小笔画。"},
    {"c":"西","level":"everyday","group":"方向与比较","example":"西边","strokes":"6画","tip":"里面的小笔画不要挤在一起。"},
    {"c":"南","level":"everyday","group":"方向与比较","example":"南边","strokes":"9画","tip":"外框里面的短横留出空隙。"},
    {"c":"北","level":"everyday","group":"方向与比较","example":"北边","strokes":"5画","tip":"左边窄，右边的弯钩伸开。"},
    {"c":"前","level":"everyday","group":"方向与比较","example":"前面","strokes":"9画","tip":"右边的竖钩站直一点。"},
    {"c":"后","level":"everyday","group":"方向与比较","example":"后面","strokes":"6画","tip":"小口放在右下方。"},
    {"c":"里","level":"everyday","group":"方向与比较","example":"里面","strokes":"7画","tip":"上面像田，下面一条长横。"},
    {"c":"外","level":"everyday","group":"方向与比较","example":"外面","strokes":"5画","tip":"左边夕字，右边一竖一点。"},
    {"c":"多","level":"everyday","group":"方向与比较","example":"多少","strokes":"6画","tip":"上下两个夕字错开一点。"},
    {"c":"少","level":"everyday","group":"方向与比较","example":"多少","strokes":"4画","tip":"上半边像小，下面一撇伸展开。"},
    {"c":"长","level":"everyday","group":"方向与比较","example":"长短","strokes":"4画","tip":"右下方的笔画舒展开。"},
    {"c":"短","level":"everyday","group":"方向与比较","example":"长短","strokes":"12画","tip":"右边是豆，左右靠近一点。"},
    {"c":"高","level":"everyday","group":"方向与比较","example":"高山","strokes":"10画","tip":"上下各藏着一个小口。"},
    {"c":"低","level":"everyday","group":"方向与比较","example":"低头","strokes":"7画","tip":"左边单人旁，右下角有个小点。"},
    {"c":"早","level":"everyday","group":"方向与比较","example":"早上","strokes":"6画","tip":"上面日字，下面十字。"},
    {"c":"晚","level":"everyday","group":"方向与比较","example":"晚上","strokes":"11画","tip":"日字在左，右边弯钩伸展开。"},
    {"c":"春","level":"everyday","group":"四季与自然","example":"春天","strokes":"9画","tip":"上面几条横，日字在下面。"},
    {"c":"夏","level":"everyday","group":"四季与自然","example":"夏天","strokes":"10画","tip":"中间像目，下面两边舒展开。"},
    {"c":"秋","level":"everyday","group":"四季与自然","example":"秋天","strokes":"9画","tip":"禾字在左，火字在右。"},
    {"c":"冬","level":"everyday","group":"四季与自然","example":"冬天","strokes":"5画","tip":"下面两个小点分开一点。"},
    {"c":"星","level":"everyday","group":"四季与自然","example":"星星","strokes":"9画","tip":"日字在上，生字在下。"},
    {"c":"光","level":"everyday","group":"四季与自然","example":"阳光","strokes":"6画","tip":"上面小笔画，下面两边展开。"},
    {"c":"电","level":"everyday","group":"四季与自然","example":"电灯","strokes":"5画","tip":"中间长钩穿过小方框。"},
    {"c":"雪","level":"everyday","group":"四季与自然","example":"雪花","strokes":"11画","tip":"雨字头在上，下面短横留出空隙。"},
    {"c":"河","level":"everyday","group":"四季与自然","example":"小河","strokes":"8画","tip":"三点水在左，右边小口留出空间。"},
    {"c":"海","level":"everyday","group":"四季与自然","example":"大海","strokes":"10画","tip":"三点水在左，右边宽一点。"},
    {"c":"林","level":"everyday","group":"四季与自然","example":"树林","strokes":"8画","tip":"两个木字并排，左边窄一点。"},
    {"c":"叶","level":"everyday","group":"四季与自然","example":"树叶","strokes":"5画","tip":"口字在左，十字在右。"},
    {"c":"果","level":"everyday","group":"四季与自然","example":"水果","strokes":"8画","tip":"田字在上，木字在下。"},
    {"c":"红","level":"everyday","group":"颜色","example":"红花","strokes":"6画","tip":"绞丝旁在左，工字在右。"},
    {"c":"黄","level":"everyday","group":"颜色","example":"黄色","strokes":"11画","tip":"下面两点分开一点。"},
    {"c":"蓝","level":"everyday","group":"颜色","example":"蓝天","strokes":"13画","tip":"草字头在上，下面的皿稳稳托住。"},
    {"c":"绿","level":"everyday","group":"颜色","example":"绿叶","strokes":"11画","tip":"绞丝旁在左，右下边舒展开。"},
    {"c":"黑","level":"everyday","group":"颜色","example":"黑色","strokes":"12画","tip":"下面四点留出小空隙。"},
    {"c":"瓜","level":"everyday","group":"食物","example":"西瓜","strokes":"5画","tip":"外面两边伸开，里面留出空间。"},
    {"c":"豆","level":"everyday","group":"食物","example":"豆子","strokes":"7画","tip":"小口在中间，下面长横托住。"},
    {"c":"茶","level":"everyday","group":"食物","example":"茶杯","strokes":"9画","tip":"草字头下面，两边舒展开。"},
    {"c":"蛋","level":"everyday","group":"食物","example":"鸡蛋","strokes":"11画","tip":"虫字放在下半边。"},
    {"c":"饭","level":"everyday","group":"食物","example":"吃饭","strokes":"7画","tip":"食字旁在左，右边舒展开。"},
    {"c":"肉","level":"everyday","group":"食物","example":"吃肉","strokes":"6画","tip":"外框里面，两个人上下叠着。"},
    {"c":"面","level":"everyday","group":"食物","example":"面条","strokes":"9画","tip":"外面方框，里面短横留出空隙。"},
    {"c":"衣","level":"everyday","group":"身边物品","example":"衣服","strokes":"6画","tip":"小点在上，下面撇捺舒展开。"},
  ];
  let selectedWriteId = null;
  let writingListScroll = 0;
  let writingDemo = null;
  let writingVoice = null;
  let writingGeneration = 0;

  function stopWritingDemo() {
    writingGeneration++;
    writingDemo?.destroy();
    writingVoice?.destroy();
    writingDemo = null;
    writingVoice = null;
  }

  function writingCharacters() {
    const vocabulary = new Map((window.ChenchenWritingVocabulary || []).map(item=>[item.c,item]));
    const characters = new Map(WRITE_CHARS.map(ch => {
      const item = {...ch,...vocabulary.get(ch.c),id:`write-char-${ch.c.codePointAt(0).toString(16)}`};
      return [item.id,item];
    }));
    Object.values(loadState().customCharacters || {}).forEach(ch=>{
      const builtin = WRITE_CHARS.find(item=>item.c === ch.c);
      characters.set(ch.id,{...builtin,...vocabulary.get(ch.c),...characters.get(ch.id),...ch});
    });
    const count = ch => Number.parseInt(ch.strokes,10) || Number.MAX_SAFE_INTEGER;
    return [...characters.values()].sort((a,b)=>count(a)-count(b));
  }

  function writingRuby(text,pinyin) {
    return Array.from(text).map((c,index)=>`<ruby>${escapeHtml(c)}<rt>${escapeHtml((pinyin || "").split(" ")[index] || "")}</rt></ruby>`).join("");
  }

  function renderWrite() {
    stopWritingDemo();
    stopSpeechSafe();
    const el = document.getElementById("write-content");
    const all = writingCharacters();
    el.innerHTML = `<div class="card practice-card write-library-page"><div class="practice-heading"><div><p class="eyebrow">先选一个字</p><h2>写汉字</h2></div><span class="practice-count">${all.length} 个字</span></div><p class="practice-instruction">简单的在前面，点一个字开始读写。</p><div class="write-list write-library" aria-label="从简单到复杂的汉字">${all.map(w=>`<button class="${w.id === selectedWriteId ? "active" : ""}" data-write-id="${escapeHtml(w.id)}" aria-label="选择汉字 ${escapeHtml(w.c)}" aria-pressed="${w.id === selectedWriteId}">${writingRuby(w.c,w.pinyin)}</button>`).join("")}</div></div>`;
    el.querySelectorAll("[data-write-id]").forEach(btn=>btn.onclick=()=>openWriteCharacter(btn.dataset.writeId));
  }

  function openWriteCharacter(id) {
    if (!writingCharacters().some(ch=>ch.id === id)) return;
    writingListScroll = window.scrollY || 0;
    selectedWriteId = id;
    showView("write-detail");
    renderWriteDetail();
  }

  function returnToWriteLibrary() {
    navigate("write");
    window.scrollTo({top:writingListScroll,behavior:"instant"});
  }

  function renderWriteDetail() {
    stopWritingDemo();
    stopSpeechSafe();
    const token = writingGeneration;
    const el = document.getElementById("write-detail-content");
    const all = writingCharacters();
    const ch = all.find(it=>it.id===selectedWriteId) || all[0];
    selectedWriteId = ch.id;
    const words = ch.words || [];
    el.innerHTML = `${sessionBanner()}<button class="back-btn" id="write-back">← 全部汉字</button><div class="card practice-card write-practice"><div class="practice-heading"><div><p class="eyebrow">听一听，描一描</p><h2>汉字描一描</h2></div><span class="practice-count">今天描 1 个就好</span></div><button class="write-pronounce" id="write-pronounce" aria-label="听汉字${escapeHtml(ch.c)}的读音" ${ch.pinyin ? "" : "disabled"}><span class="write-pinyin">${escapeHtml(ch.pinyin || ch.c)}</span><span class="write-listen-cue">◖)) ${ch.pinyin ? "点一下，听读音" : "照着字形描一描"}</span></button><div class="tianzige write-stage" id="write-stage" aria-busy="true"><div class="write-shape-loading" id="write-shape-loading">字形准备中…</div><div class="char" id="write-font-outline" hidden>${escapeHtml(ch.c)}</div><div id="write-stroke-layer" class="write-stroke-layer" hidden aria-label="${escapeHtml(ch.c)} 字笔顺示范"></div><canvas id="write-canvas" hidden width="600" height="600" aria-label="${escapeHtml(ch.c)} 字描红画布"></canvas><button id="write-clear" class="write-erase" hidden aria-label="擦掉，重新描">↶ 擦掉</button></div>${words.length ? `<div class="write-words" aria-label="点词语听读音">${words.map((word,index)=>`<button class="write-word" data-write-word="${index}" aria-label="听词语${escapeHtml(word.text)}">${writingRuby(word.text,word.pinyin)}</button>`).join("")}</div><p class="write-word-cue">点词语，也能听读音</p>` : ""}<div class="write-stroke-status" id="write-stroke-status" role="status" aria-live="polite">笔顺准备中…</div><div class="btn-row write-main-controls"><button class="btn btn-learn" id="write-strokes-play" disabled>▶ 看笔顺</button><button class="btn btn-primary" id="write-finish">写好啦 ✓</button></div><div class="write-paper-confirm" id="write-paper-confirm" hidden><p>已经在纸上写过这个字了吗？</p><div class="btn-row"><button class="btn btn-primary" id="write-paper">在纸上写好啦 ✓</button><button class="text-btn" id="write-keep-drawing">我再描一描</button></div></div><div class="write-assessment" id="write-assessment" hidden><p class="assessment-prompt">不看范字，试着在纸上写一写</p><button class="btn btn-ghost" id="write-check-prompt">◖)) 听字音</button>${assessmentButtons("write-check","家长确认 · 独立书写")}<button class="text-btn" id="write-check-back">回去练一练</button></div></div>`;
    document.getElementById("write-back").onclick = returnToWriteLibrary;
    const canvas = document.getElementById("write-canvas");
    const ctx = canvas.getContext("2d");
    ctx.strokeStyle = "#668753"; ctx.lineWidth = 14; ctx.lineCap = "round"; ctx.lineJoin = "round";
    let drawing = false, moved = false, watching = false, glyphMode = "loading", demoStatus = "loading", readingRequest = 0;
    const status = document.getElementById("write-stroke-status");
    const playButton = document.getElementById("write-strokes-play");
    const pronounceButton = document.getElementById("write-pronounce");
    const finishButton = document.getElementById("write-finish");
    const eraseButton = document.getElementById("write-clear");
    const paperConfirm = document.getElementById("write-paper-confirm");
    const layer = document.getElementById("write-stroke-layer");
    const stage = document.getElementById("write-stage");
    const shapeLoading = document.getElementById("write-shape-loading");
    const fontOutline = document.getElementById("write-font-outline");
    const showGlyph = mode => {
      glyphMode = mode;
      shapeLoading.hidden = mode !== "loading";
      fontOutline.hidden = mode !== "fallback";
      layer.hidden = mode !== "svg";
      canvas.hidden = mode === "loading" || watching;
      eraseButton.hidden = mode === "loading" || watching || !moved;
      if (mode === "loading") drawing = false;
      stage.setAttribute("aria-busy",String(mode === "loading"));
    };
    const active = () => token === writingGeneration && currentView === "write-detail";
    const readingButtons = [pronounceButton,...el.querySelectorAll("[data-write-word]")];
    writingVoice = window.ChenchenWritingAudio?.create() || null;
    const voice = writingVoice;
    const stopReading = () => {
      readingRequest++; voice?.stop();
      readingButtons.forEach(button=>button.classList.remove("is-reading"));
    };
    const trace = (reset = true) => {
      watching = false; drawing = false; canvas.hidden = glyphMode === "loading"; finishButton.disabled = false; eraseButton.hidden = !moved;
      if (reset) { writingDemo?.restart(); layer.classList.remove("is-copy-guide"); }
      else layer.classList.add("is-copy-guide");
    };
    const watch = () => {
      stopSpeechSafe(); stopReading(); drawing = false; watching = true; canvas.hidden = true; finishButton.disabled = true; eraseButton.hidden = true; paperConfirm.hidden = true; layer.classList.remove("is-copy-guide");
    };
    const setupDemo = () => {
      writingDemo?.destroy();
      showGlyph("loading");
      layer.classList.remove("is-copy-guide");
      const unavailable = () => {
        demoStatus = "error"; showGlyph("fallback"); trace(false);
        playButton.disabled = false; playButton.textContent = "↻ 重试笔顺";
        status.textContent = "笔顺暂时没有打开，仍可以照着描一描。";
      };
      if (!window.ChenchenWritingStrokes || !voice) {
        unavailable(); return;
      }
      try { writingDemo = window.ChenchenWritingStrokes.create({
        target:layer, character:ch.c,
        playStroke:(index,signal)=>voice.playStroke(index,signal),
        onState(state) {
          if (!active() || state.status === "destroyed") return;
          demoStatus = state.status;
          const busy = state.status === "playing", loading = state.status === "loading";
          playButton.disabled = loading;
          playButton.textContent = busy ? "■ 停下" : state.status === "error" ? "↻ 重试笔顺" : state.completed ? "▶ 再看一遍" : "▶ 看笔顺";
          if (["ready","playing","paused","complete"].includes(state.status)) showGlyph("svg");
          status.classList.toggle("is-playing",busy);
          if (busy) status.textContent = `第 ${state.stroke || state.completed + 1} 画 / 共 ${state.total} 画`;
          else if (state.status === "complete") {
            if (watching) trace(false);
            status.textContent = "轮到你啦，照着字形描一描。";
          } else if (state.status === "ready" || state.status === "paused") status.textContent = `${ch.c} · ${state.total} 画，跟着笔顺描一描。`;
          else if (loading) status.textContent = "笔顺准备中…";
        },
        onError(code) {
          if (!active()) return;
          showGlyph(code === "stroke-data-unavailable" ? "fallback" : "svg");
          trace(false); status.classList.remove("is-playing");
          status.textContent = code === "stroke-playback-unavailable" ? "声音或笔顺没有打开，再点一次试试。" : "这个字的笔顺暂时没有打开，仍可以照着描。";
          playButton.disabled = false;
        },
      }); } catch (_) { unavailable(); }
    };
    setupDemo();
    playButton.onclick = () => {
      if (demoStatus === "playing") {writingDemo.stop();trace();return;}
      if (demoStatus === "error" && glyphMode !== "svg") {stopReading();setupDemo();return;}
      watch(); writingDemo?.play();
    };
    const read = async (id,text,button) => {
      stopSpeechSafe();
      if (watching) {writingDemo?.stop();trace();}
      stopReading();
      const request = readingRequest;
      const readStatus = document.getElementById("write-assessment").hidden === false ? document.getElementById("write-check-error") : status;
      button.classList.add("is-reading");
      readStatus.textContent = readStatus === status ? `听一听：${text}` : "";
      try {
        if (!voice?.playReading) throw new Error("Reading unavailable");
        await voice.playReading(id);
        if (active() && request === readingRequest) readStatus.textContent = readStatus === status ? "跟着读一读，再描一描。" : "";
      } catch (error) {
        if (active() && request === readingRequest) readStatus.textContent = error.name === "AbortError" ? "" : "声音没有打开，再点一下试试。";
      } finally { if (active() && request === readingRequest) button.classList.remove("is-reading"); }
    };
    pronounceButton.onclick = () => {if(ch.pinyin) return read(`char-${ch.c.codePointAt(0).toString(16)}`,ch.c,pronounceButton);};
    el.querySelectorAll("[data-write-word]").forEach(button=>button.onclick=()=>{
      const word = words[Number(button.dataset.writeWord)];
      return read(`word-${Array.from(word.text).map(c=>c.codePointAt(0).toString(16)).join("-")}`,word.text,button);
    });
    const position = event => { const r=canvas.getBoundingClientRect(); return [(event.clientX-r.left)*600/r.width,(event.clientY-r.top)*600/r.height]; };
    canvas.onpointerdown = event => { if(watching || glyphMode === "loading")return;event.preventDefault();drawing=true;canvas.setPointerCapture(event.pointerId);ctx.beginPath();ctx.moveTo(...position(event));paperConfirm.hidden=true; };
    canvas.onpointermove = event => { if(!drawing || watching || glyphMode === "loading")return;event.preventDefault();ctx.lineTo(...position(event));ctx.stroke();moved=true;eraseButton.hidden=false; };
    canvas.onpointerup = canvas.onpointercancel = () => { drawing=false; };
    eraseButton.onclick = () => {ctx.clearRect(0,0,600,600);moved=false;trace();paperConfirm.hidden=true;};
    let writingAfterPractice = true;
    let writingMethod = "trace";
    const beginWritingCheck = (method, afterPractice = true) => {
      writingDemo?.stop(); stopReading();
      writingMethod = method;
      writingAfterPractice = afterPractice;
      paperConfirm.hidden = true;
      document.getElementById("write-assessment").hidden = false;
      el.querySelector(".write-practice").classList.add("is-assessing");
      document.getElementById("write-check-prompt").hidden = !ch.pinyin;
    };
    const finish = async result => {
      writingDemo?.stop(); stopReading();
      const id = reviewSession?.items[reviewSession.index]?.id || ch.id;
      const entry = {id:ch.id,type:"write",title:`汉字·${ch.c}`,source:"parent",skill:"hanzi-writing",result,details:{character:ch.c,method:writingMethod,afterPractice:writingAfterPractice}};
      const meta = {...entry,enroll:true};
      if (id === "write-basic") {meta.entries=[entry];meta.retireWritingGroup=true;}
      if(!await completePractice(id,REVIEW_RESULT[result],meta) && active()) returnToWriteLibrary();
    };
    finishButton.onclick = () => {
      if (watching) return;
      if (moved) return beginWritingCheck("trace");
      paperConfirm.hidden = false;
      paperConfirm.scrollIntoView?.({block:"nearest"});
    };
    document.getElementById("write-keep-drawing").onclick = () => {paperConfirm.hidden=true;};
    document.getElementById("write-paper").onclick = () => {if(!paperConfirm.hidden) beginWritingCheck("paper");};
    document.getElementById("write-check-back").onclick = () => {
      stopReading();
      writingAfterPractice = true;
      document.getElementById("write-assessment").hidden = true;
      el.querySelector(".write-practice").classList.remove("is-assessing");
    };
    document.getElementById("write-check-prompt").onclick = () => read(`char-${ch.c.codePointAt(0).toString(16)}`,ch.c,document.getElementById("write-check-prompt"));
    bindAssessment("write-check",reviewSession?.items[reviewSession.index]?.id || ch.id,finish);
    if (ch.pinyin && reviewSession?.items[reviewSession.index]?.type === "write") beginWritingCheck("paper",false);

    bindSessionExit();
  }

  // ---------- Toast ----------
  function toast(msg) {
    let t = document.getElementById("toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "toast";
      t.setAttribute("role", "status");
      t.style.cssText =
        "position:fixed;left:50%;bottom:90px;transform:translateX(-50%);background:#333;color:#fff;padding:10px 18px;border-radius:999px;font-size:0.9rem;z-index:100;opacity:0;transition:0.25s;max-width:90%;text-align:center";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = "1";
    clearTimeout(t._timer);
    t._timer = setTimeout(() => {
      t.style.opacity = "0";
    }, 2200);
  }

  // ---------- Init ----------
  function navigate(v) {
    if (!stateReady) { toast("先连接服务器，再开始复习。"); return; }
    const restorePoemScroll = v === "poems" && currentView === "poem-detail";
    showingCelebration = false;
    reviewSession = null;
    showView(v);
    if (v === "home") renderHome();
    if (v === "poems") renderPoems({restoreScroll:restorePoemScroll});
    if (v === "math") renderMath();
    if (v === "pinyin") {pyPracticed = new Set();pyAssessments = new Map();pyExposures = new Set();renderPinyin();}
    if (v === "write") renderWrite();
    if (v === "english") getEnglishModule().open();
    if (v === "records") {
      recordsModule ||= window.ChenchenLearningRecords.create({root:document.getElementById("records-content"),loadState:async()=>{
        if (!await syncNow()) throw new Error("Records could not be refreshed");
        return loadState();
      },todayStr,onBack:()=>navigate("home")});
      recordsModule.open();
    }
  }
  function bindNav() {
    document.querySelectorAll(".nav button").forEach(btn=>btn.onclick=()=>navigate(btn.dataset.nav));
    document.getElementById("brand-home").onclick = event => {event.preventDefault();navigate("home");};
    document.getElementById("open-parent").onclick = openParent;
    document.getElementById("parent-dialog").addEventListener("click",event=>{if(event.target===event.currentTarget){event.currentTarget.close();if(currentView==="home" && !showingCelebration)renderHome();}});
  }

  async function initializePage() {
    const el = document.getElementById("home-content");
    el.innerHTML = '<div class="card"><div class="empty">小兔正在打开学习花园…</div></div>';
    await ensurePoems().catch(() => {});
    if (!await syncNow()) {
      el.innerHTML = '<div class="card"><div class="empty"><span class="big">☁</span>暂时连不上学习花园。<br>检查网络后，再试一次吧。</div><div class="btn-row" style="justify-content:center"><button class="btn btn-primary" id="retry-connection">重新连接</button></div></div>';
      document.getElementById("retry-connection").onclick = initializePage;
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    bindNav();
    showView("home");
    initializePage();
  });
})();
