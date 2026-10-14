/* 辰辰幼小衔接 — 应用逻辑 */
(function () {
  "use strict";

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

  function loadState() { return serverState; }

  async function apiFetch(path, opts) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(API_BASE + path, {
        ...opts,
        cache: "no-store",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", ...(opts && opts.headers) },
      });
      let data;
      try { data = await res.json(); }
      catch (error) {
        if (controller.signal.aborted) throw error;
        throw new Error("服务器响应不是有效的 JSON，请稍后重试");
      }
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("服务器返回了无效的进度数据");
      if (!res.ok) {
        const error = new Error(data.message || data.error || "server_unavailable");
        error.status = res.status;
        error.data = data;
        throw error;
      }
      const method = (opts?.method || "GET").toUpperCase();
      const hasPayload = validPayload(data.payload);
      if (method === "GET" && !(data.found === true && hasPayload || data.found === false && (data.payload === null || data.payload === undefined))) {
        throw new Error("服务器进度格式不正确，请稍后重试");
      }
      if (["PATCH", "POST", "DELETE"].includes(method) && !(data.ok === true && hasPayload)) throw new Error("服务器尚未确认保存，请重试");
      return data;
    } catch (error) {
      if (controller.signal.aborted) {
        // Aborting a request does not undo a server commit. Keep this an
        // unknown outcome so the group or watering action retries its same ID.
        const timeout = new Error("服务器确认超时，请重试确认；不会重复记录或扣水。");
        timeout.name = "TimeoutError";
        throw timeout;
      }
      throw error;
    } finally { clearTimeout(timer); }
  }

  function isRecord(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
  function validPayload(value) {
    return isRecord(value) && isRecord(value.items) && ["activity", "customPoems", "customCharacters", "hiddenCourses", "studySessions"].every(key=>value[key] === undefined || isRecord(value[key]));
  }

  function acceptServerState(data) {
    const empty = data.found === false && (data.payload === null || data.payload === undefined);
    if (!empty && !validPayload(data.payload)) throw new Error("服务器进度格式不正确");
    const payload = empty ? {} : data.payload;
    serverState = { items: {}, activity: {}, customPoems: {}, customCharacters: {}, hiddenCourses: {}, ...payload };
    stateReady = true;
    POEMS = [...BUILTIN_POEMS, ...Object.values(serverState.customPoems)];
    return serverState;
  }

  function queueServerTask(task) {
    const next = serverQueue.catch(() => {}).then(task);
    serverQueue = next;
    return next;
  }

  async function syncNow() {
    try {
      await queueServerTask(async () => {
        acceptServerState(await apiFetch("/api/progress", {method:"GET"}));
      });
      if (currentView === "home" && !showingCelebration) renderHome();
      return true;
    } catch (error) {
      return false;
    }
  }

  function todayStr() {
    return window.ChenchenStudyGroups.day();
  }
  // Ephemeral evidence only: free browsing still makes no learning record.
  // Keep actual exposure across page/group changes, but never across days.
  let exposureDay = "";
  const dailyExposures = new Set();
  function observedExposure(type, id, remember = false) {
    const day = todayStr();
    if (exposureDay !== day) { exposureDay = day; dailyExposures.clear(); }
    const key = `${type}:${id}`;
    if (remember) dailyExposures.add(key);
    return dailyExposures.has(key);
  }
  function getItem(id) {
    const s = loadState();
    return s.items[id] || null;
  }

  function dueItems() {
    const s = loadState();
    const today = todayStr();
    return Object.values(s.items).filter(
      (it) => (it.type === "poem" || it.learned) && it.nextReview && it.nextReview <= today
    ).sort((a, b) => a.nextReview.localeCompare(b.nextReview) || (a.createdAt || "").localeCompare(b.createdAt || ""));
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
      loadState, todayStr, syncNow,
      startStudy:() => startStudyGroup("english", "learn"),
      groupStartHtml:() => groupStartHtml("english"),
      completeGroup:entries => completeEnglishGroup(entries),
      checkpointEnglishGroup,
      groupSaving:() => !!(reviewSession?.saving || reviewSession?.draftSaving),
      isActive:() => currentView === "english",
      onHome:() => navigate("home"),
      onExit:() => navigate("english"),
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
    if (name !== "home") window.ChenchenGarden?.stop();
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

  let writingCatalogPromise = null;
  function availableWritingCharacters() {
    if (!writingCatalogPromise) writingCatalogPromise = fetch("/data/writing-strokes.json").then(async response=>{
      if (!response.ok) throw new Error("汉字笔画目录暂时没有打开，请重试。");
      const manifest = await response.json();
      if (!isRecord(manifest.characters) || !Object.keys(manifest.characters).length) throw new Error("汉字笔画目录暂时没有打开，请重试。");
      return new Set(Object.keys(manifest.characters));
    }).catch(error=>{writingCatalogPromise=null;throw error;});
    return writingCatalogPromise;
  }

  async function studyCatalog() {
    const catalogs = await Promise.allSettled([ensurePoems(),getEnglishModule().catalog(),availableWritingCharacters()]);
    const english = catalogs[1].status === "fulfilled" ? catalogs[1].value : [];
    const writable = catalogs[2].status === "fulfilled" ? catalogs[2].value : new Set();
    return [
      ...POEMS.map(item=>({id:item.id,type:"poem",title:item.title})),
      {id:"math-addsub-10",type:"math",title:"10以内加减法"},
      {id:"math-decomp-10",type:"decomp",title:"10以内分解组合"},
      ...[...INITIALS,...FINALS].map(symbol=>({id:pinyinId(symbol),type:"pinyin",title:`拼音·${symbol}`})),
      ...writingCharacters().filter(item=>writable.has(item.c)).map(item=>({id:item.id,type:"write",title:`汉字·${item.c}`})),
      ...english,
    ];
  }

  function waterEarnedToday() {
    return Object.values(loadState().garden?.groups || {}).filter(group=>group.day===todayStr() && group.waterAwarded).length;
  }


  function currentStudyPhase() {
    return reviewSession?.items[reviewSession.index]?.phase || reviewSession?.mode || "learn";
  }

  function groupStartHtml(type) {
    const config = window.ChenchenStudyGroups.CONFIG[type];
    const draft = window.ChenchenStudyGroups.pending(loadState(),type);
    const amount = ["math","decomp"].includes(type) ? "最多 10 题，复习容易出错的知识点" : `每次最多 ${config.count} ${config.unit}，到期内容优先`;
    return `<section class="study-start-card"><div><p class="eyebrow">每天一点点，记得更久</p><h3>${amount}</h3><p>${type==="poem" ? "学过的古诗，按每首的复习日期再想一想。" : "先复习今天到期的内容，再学一点新的。"}</p><small>${draft ? "上次的进度已保存，可以接着完成。" : "完成的项目会保存进度，休息后可以继续。"}</small></div><button class="btn btn-primary study-start-button" data-start-study="${type}">▶ ${draft ? "继续上次学习" : type==="poem" ? "开始复习" : "开始学习"}</button></section>`;
  }

  function bindStudyStart(root) {
    root.querySelectorAll("[data-start-study]").forEach(button=>button.onclick=()=>startStudyGroup(button.dataset.startStudy,"learn"));
  }

  async function persistStudyDraft(group) {
    const items = group.items.map(({id,type,title,phase,source,afterPractice})=>({id,type,title,phase,source,afterPractice}));
    const body = JSON.stringify({id:group.id,type:group.type,mode:group.mode,items,entries:group.entries,
      progress:{openedDay:todayStr(),...(group.practice ? {practice:group.practice,questionResults:group.practice.questionResults || []} : {})}});
    group.draftSaving = true;
    try {
      await queueServerTask(async()=>{
        const response = await apiFetch("/api/study-sessions",{method:"POST",body});
        acceptServerState(response);
      });
      group.draftFailed = false;
      group.draftConflict = false;
      return true;
    } catch(error) {
      group.draftFailed = true;
      group.draftConflict = error.status===409;
      if (validPayload(error.data?.payload)) acceptServerState(error.data);
      throw error;
    } finally {group.draftSaving=false;}
  }

  function openStudyPosition(group) {
    if (reviewSession!==group) return;
    showingCelebration = false;
    if (group.index>=group.items.length) return saveStudyGroup(group);
    if (group.resumed && group.resumeExposure!==false) {
      observedExposure(group.type,group.items[group.index].id,true);
    }
    if (group.type==="english") {
      showView("english");
      return getEnglishModule().open({group});
    }
    openReviewItem(group.items[group.index].id,group.type);
  }


  async function discardStudyDraft(group) {
    const response=await apiFetch("/api/study-sessions?id="+encodeURIComponent(group.id),{method:"DELETE"});
    acceptServerState(response);
    reviewSession=null;
    navigate("home");
  }

  function showCheckpointRetry(group, retry, message) {
    showingCelebration=true;
    showView("home");
    const root=document.getElementById("home-content");
    root.innerHTML=`<div class="card celebration"><h2>${group.draftConflict ? "学习进度已更新" : "正在记住这次进度"}</h2><p role="status">${escapeHtml(message || "还没确认保存，请重试；已经完成的答案不会重复记录。")}</p><button class="btn btn-primary" id="study-checkpoint-retry">${group.draftConflict ? "继续服务器已保存的进度" : "重试保存进度"}</button>${group.draftConflict ? '<p>如果计划里的内容已被移除，可以放弃这份未完成计划后重新安排。</p><button class="text-btn" id="study-draft-discard">放弃这份未完成计划</button>' : ""}</div>`;
    document.getElementById("study-checkpoint-retry").onclick=async event=>{
      event.currentTarget.disabled=true;
      if(group.draftConflict) {
        reviewSession=null;showingCelebration=false;
        return startStudyGroup(group.type,group.mode);
      }
      try {await retry();}
      catch(error) {showCheckpointRetry(group,retry,error.message);}
    };
    const discard=document.getElementById("study-draft-discard");
    if(group.draftConflict && discard) discard.onclick=async()=>{
      discard.disabled=true;
      try {await discardStudyDraft(group);}
      catch(error){showCheckpointRetry(group,retry,error.message);}
    };
  }

  let studyStarting = false;
  async function startStudyGroup(type, mode = "learn") {
    if (studyStarting || reviewSession?.saving || reviewSession?.draftSaving) return;
    studyStarting = true;
    const generation = practiceGeneration;
    try {
      if (!await syncNow()) throw new Error("暂时连不上服务器，请重试。");
      if (type === "write") await availableWritingCharacters();
      const catalog = await studyCatalog();
      if (generation !== practiceGeneration) return;
      const plan = type ? window.ChenchenStudyGroups.select(catalog,loadState(),type,mode,todayStr()) : window.ChenchenStudyGroups.reviews(catalog,loadState(),todayStr())[0];
      if (!plan) {toast("今天安排的内容已经完成啦，可以休息，也可以自由看看卡片。");return;}
      const group = reviewSession = {...plan,id:plan.id || globalThis.crypto?.randomUUID?.() || `group-${Date.now()}-${Math.random().toString(36).slice(2)}`,index:plan.index || 0,entries:plan.entries || [],saving:false};
      const begin=async()=>{await persistStudyDraft(group);return openStudyPosition(group);};
      try {await begin();}
      catch(error) {
        if (error.data?.error==="study_session_exists") {
          reviewSession=null;
          toast("另一处已开始这一学科，进度已同步，请点继续学习。");
        } else showCheckpointRetry(group,begin,error.message);
      }
    } catch(error) {toast(error.message || "学习组暂时没有打开，请再试一次。");}
    finally {studyStarting=false;}
  }

  function sessionBanner() {
    if (!reviewSession) return "";
    const phase=currentStudyPhase();
    return `<div class="session-banner study-session-banner"><div><strong>${reviewSession.title} · ${["math","decomp"].includes(reviewSession.type) ? `${reviewSession.count} 题` : `${reviewSession.index+1} / ${reviewSession.count}`}</strong><small>${phase==="review" ? "到期复习 · 先自己想一想" : "新内容 · 先学一学"} · 休息后可继续</small></div><button class="text-btn" id="session-exit">先休息</button></div>`;
  }

  function bindSessionExit() {
    const btn = document.getElementById("session-exit");
    if (btn) btn.onclick = () => navigate("home");
  }

  let completingPractice = null;
  let pendingPracticeAttempt = null;
  async function completePractice(id, result, meta) {
    const group = reviewSession;
    if (!group || group.saving || group.draftSaving || group.draftFailed || group.items[group.index]?.id !== id) return true;
    const selected = group.items[group.index];
    const entries = meta.entries || [{id,type:meta.type,title:meta.title || selected.title,skill:meta.skill || "general",result:ASSESSMENT_RESULT[result] || result,source:meta.source || "parent",details:meta.details || {}}];
    group.entries.push(...entries.map(entry=>({...entry,details:{...entry.details,...(selected.afterPractice ? {afterPractice:true} : {})}})));
    const nextIndex=group.index+1;
    const advance=async()=>{
      await persistStudyDraft(group);
      group.index=nextIndex;
      group.resumed=false;
      return openStudyPosition(group);
    };
    try {await advance();}
    catch(error) {showCheckpointRetry(group,advance,error.message);}
    return true;
  }

  async function checkpointEnglishGroup(entries, nextIndex) {
    const group=reviewSession;
    if (!group || group.type!=="english") throw new Error("本组已经关闭，请重新打开。");
    group.entries=entries;
    try {await persistStudyDraft(group);}
    catch(error) {if(group.draftConflict) showCheckpointRetry(group,()=>checkpointEnglishGroup(entries,nextIndex),error.message);throw error;}
    group.index=nextIndex;
    group.resumed=false;
    return true;
  }

  async function completeEnglishGroup(entries) {
    const group = reviewSession;
    if (!group || group.type !== "english") return;
    group.entries = entries;
    await saveStudyGroup(group);
  }

  async function saveStudyGroup(group) {
    if (group.saving || reviewSession !== group) return;
    group.saving = true;
    group.definiteFailure = false;
    showingCelebration = true;
    showView("home");
    const root = document.getElementById("home-content");
    root.innerHTML = `<div class="card celebration study-saving"><div class="study-water-reward" aria-hidden="true">💧</div><h1>这一组完成啦</h1><p>正在保存本组学习，请稍等一下…</p><p role="status" id="study-save-status"></p><button class="btn btn-primary" id="study-save-retry" hidden>重试保存</button></div>`;
    try {
      await queueServerTask(async()=>{
        const response = await apiFetch("/api/study-groups",{method:"POST",body:JSON.stringify({id:group.id,type:group.type,mode:group.mode,entries:group.entries})});
        acceptServerState(response);
      });
      group.saving = false;
      reviewSession = null;
      const saved = Object.values(loadState().garden?.groups || {}).find(item=>item.id===group.id);
      const rewarded = !!saved?.waterAwarded;
      root.innerHTML = `<div class="card celebration study-finish"><div class="study-water-reward ${rewarded ? "is-earned" : ""}" aria-hidden="true">${rewarded ? "💧" : "✓"}</div><p class="eyebrow">一点点，就是成长</p><h1>${rewarded ? "收获一滴水！" : "这一组，认真完成啦"}</h1><p>${group.title} ${group.count} ${group.unit}已记入学习记录。</p><p>${rewarded ? "小水滴已装进水壶，回去照顾小树吧。" : "本组已保存，今天不再重复发水。"}</p><p class="muted">休息一下，看看远处的绿色。</p><button class="btn btn-primary" id="study-finish-home">回到我的小树 →</button></div>`;
      document.getElementById("study-finish-home").onclick = ()=>navigate("home");
    } catch(error) {
      group.saving = false;
      group.definiteFailure = error.status >= 400 && error.status < 500;
      document.getElementById("study-save-status").textContent = "还没有确认保存。请保持页面打开，重试不会重复领奖。";
      const button = document.getElementById("study-save-retry");
      button.hidden = false;
      button.onclick = ()=>saveStudyGroup(group);
      if (group.definiteFailure) {
        document.getElementById("study-save-status").textContent = "本组未保存，部分课堂内容可能已经更改。可以返回首页，重新开始一组。";
        const back = document.createElement("button");
        back.className = "btn btn-ghost"; back.textContent = "返回首页";
        back.textContent = "放弃失效计划，返回首页";
        back.onclick = async()=>{back.disabled=true;try{await discardStudyDraft(group);}catch(error){back.disabled=false;toast(error.message);}};root.appendChild(back);
      }
    }
  }

  async function renderHome() {
    const generation = practiceGeneration;
    let catalog = [];
    try {catalog = await studyCatalog();} catch(error) {console.warn("部分学习内容尚未准备好",error);}
    if (currentView !== "home" || showingCelebration || generation !== practiceGeneration) return;
    return window.ChenchenGarden.renderHome({
      root:document.getElementById("home-content"),loadState,todayStr,apiFetch,acceptServerState,queueServerTask,toast,navigate,syncNow,
      reviewGroups:window.ChenchenStudyGroups.reviews(catalog,loadState(),todayStr()),
      startReview:type=>startStudyGroup(type,"review"),catalog:studyCatalog,
      isActive:()=>currentView === "home" && !showingCelebration,stateReady,
    });
  }

  function openReviewItem(id, type) {
    if (type === "english") {
      showView("english");
      getEnglishModule().open({group:reviewSession});
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
    if (!it?.nextReview) return { label: "今天再想一想", cls: "due" };
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
        return !it?.nextReview || it.nextReview <= today;
      });
    }

    el.innerHTML = `
      <div class="card">
        <h2>读古诗 <span class="heading-flower">✿</span></h2>
        ${groupStartHtml("poem")}
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
              : `<div class="empty" style="grid-column:1/-1">${poemQuery ? "没有找到这首诗，换个词试试吧。" : poemFilter === "due" ? "今天的古诗都复习好啦，也可以点「全部诗卡」看看。" : "这里暂时没有诗卡，先到其他学科学习吧。"}</div>`
          }
        </div>
      </div>`;

    bindStudyStart(el);
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
    const enrolled = !!reviewSession && reviewSession.type === "poem";
    const recall = enrolled && currentStudyPhase() === "review";
    if (!recall) observedExposure("poem",id,true);

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
          <div class="poem-body" id="poem-body" ${recall ? "hidden" : ""}>${body}</div>
          ${recall ? `<div id="poem-recall-prompt"><p>看到题目，试着自己背一背。</p><button class="btn btn-ghost" id="poem-reveal">想不起来，看看原文</button></div>` : ""}
        </div>
        <div class="speak-bar">
          <button type="button" class="btn btn-speak" id="btn-speak">▶ 朗读</button>
        </div>
        ${enrolled ? `<div class="actions-bar">${assessmentButtons("poem-check","家长确认 · 背诵")}</div>` : ""}
      </div>`;

    document.getElementById("back-poems").onclick = () => navigate("poems");
    if (recall) document.getElementById("poem-reveal").onclick = () => {
      observedExposure("poem",id,true);
      document.getElementById("poem-body").hidden=false;
      document.getElementById("poem-recall-prompt").hidden=true;
    };
    if (enrolled) bindAssessment("poem-check",id,async result => {
      const r = REVIEW_RESULT[result];
      if (await completePractice(id,r,{type:"poem",title:displayTitle + (poem.subtitle ? "·" + poem.subtitle : ""),requireClassroom:enrolled,
        source:"parent",skill:"poem-recitation",details:{observedExposure:observedExposure("poem",id)}})) return;
      if (!active()) return;
      toast("记下来啦，每一次练习都有收获。");
      renderPoemDetail(id);
    });

    bindSessionExit();
    const btnSpeak = document.getElementById("btn-speak");
    updateSpeakButton("idle");
    if (btnSpeak) {
      btnSpeak.onclick = () => {
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
            onState: state => {
              if (!active()) return;
              if (state === "speaking") observedExposure("poem",id,true);
              updateSpeakButton(state);
            },
            onError: () => { if (active()) toast("朗读暂时打不开，请再试一次。"); },
            onUnsupported: () => { if (active()) toast("这首诗暂未配音。"); },
          }
        );
        if (ok) updateSpeakButton(ChenchenSpeech.getStatus());
      };
    }
  }

  // ---------- Math ----------
  const MATH_ROUND_SIZE = 10;
  let mathRoundSize = MATH_ROUND_SIZE;
  let mathQuestions = [];
  let mathQuestionKeys = [];
  let mathMode = "addsub";
  let mathScore = { ok: 0, total: 0 };
  let currentQ = null;
  let mathQuestionAnswered = false;
  let mathSaving = false;

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
    const questions = window.ChenchenMath.pool("decomp");
    return questions[randInt(0,questions.length-1)];
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
    bondQIndex = reviewSession?.practice ? reviewSession.practice.index + 1 : bondQIndex + 1;
    const item = reviewSession?.practice ? JSON.parse(JSON.stringify(mathQuestions[reviewSession.practice.index])) : genBondItem();
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
        if (mathSaving || !bondSheet || bondSheet.checked) return;
        bondSheet.activeSlot = btn.dataset.slot;
        renderBondPanel();
      };
    });
    panel.querySelectorAll(".nb-pad button[data-n]").forEach((btn) => {
      btn.onclick = () => {
        if (mathSaving || !bondSheet || !bondSheet.activeSlot || bondSheet.checked) return;
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
    if (mathSaving || !bondSheet || bondSheet.checked) return;
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
      const answerLeft = item.left;
      const answerRight = item.right;
      item.solution = {whole:item.n,left:answerLeft,right:answerRight};
      renderBondPanel();
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
    mathSaving = false;
    const existing = reviewSession?.practice;
    const practice = reviewSession ? window.ChenchenMath.restore(existing,mathMode) : null;
    if (existing && !practice) {
      document.getElementById("math-content").innerHTML = '<div class="card"><p>这一组的题目记录无法恢复，请返回首页重试。</p></div>';
      return;
    }
    if (reviewSession) reviewSession.practice = practice || window.ChenchenMath.plan(mathMode,loadState(),todayStr(),MATH_ROUND_SIZE);
    mathRoundSize = reviewSession ? reviewSession.practice.questions.length : MATH_ROUND_SIZE;
    if (reviewSession) reviewSession.count = mathRoundSize;
    const results = reviewSession?.practice?.questionResults || [];
    mathScore = {ok:results.filter(result=>result.correct).length,total:results.length};
    mathCompleted = results.length;
    bondQIndex = 0;
    mathQuestions = reviewSession?.practice?.questions || [];
    mathQuestionKeys = mathQuestions.map(question=>question.key);
    const el = document.getElementById("math-content");
    el.innerHTML = `${sessionBanner()}${reviewSession ? "" : groupStartHtml(mathMode === "decomp" ? "decomp" : "math")}<div class="card practice-card"><div class="practice-heading"><div><p class="eyebrow">数一数，想一想</p><h2>玩数学 <span class="heading-flower">＋</span></h2></div><span class="practice-count" id="math-progress">${mathCompleted} / ${mathRoundSize} 题</span></div>
      ${reviewSession ? "" : `<div class="tabs-mini"><button data-m="addsub" class="${mathMode === "addsub" ? "active" : ""}">10以内加减法</button><button data-m="decomp" class="${mathMode === "decomp" ? "active" : ""}">分解组合</button></div>`}
      <p class="practice-instruction">做 ${mathRoundSize} 道小题就休息。填完就能知道对错，看完再点下一题。</p><div class="math-panel" id="math-panel"></div>
      <div class="btn-row practice-controls"><button class="btn btn-primary" id="math-next" hidden disabled>我看懂了，下一题 →</button></div><div id="math-review-bar"></div><div id="math-save-error" role="status" hidden><span id="math-save-message"></span><button class="btn btn-ghost" id="math-save-retry" hidden>重试保存这一题</button></div></div>`;
    bindStudyStart(el);
    el.querySelectorAll("[data-m]").forEach(btn=>btn.onclick=()=>renderMath(btn.dataset.m));
    document.getElementById("math-next").onclick = advanceMathQuestion;
    if (reviewSession?.practice?.index >= mathRoundSize) renderMathFinish();
    else nextMathQ();
    bindSessionExit();
    if (reviewSession && !practice) persistMathProgress();
  }

  function mathControls(locked) {
    const root = document.getElementById("math-content");
    root.querySelectorAll("button").forEach(button=>{
      if (button.id === "math-save-retry") return;
      button.disabled = locked || (mathQuestionAnswered && (button.dataset.v !== undefined || button.dataset.n !== undefined || button.dataset.slot !== undefined));
    });
    const next = document.getElementById("math-next");
    if (next) next.disabled = locked || !mathQuestionAnswered;
  }

  async function persistMathProgress(then) {
    if (!reviewSession) { then?.(); return true; }
    const group = reviewSession;
    mathSaving = true; mathControls(true);
    const status = document.getElementById("math-save-error");
    const retry = document.getElementById("math-save-retry");
    if (status) status.hidden = false;
    if (retry) retry.hidden = true;
    const message = document.getElementById("math-save-message");
    if (message) message.textContent = "正在保存本题进度…";
    try {
      await persistStudyDraft(group);
      if (reviewSession !== group || currentView !== "math") return true;
      mathSaving = false;
      if (status) status.hidden = true;
      mathControls(false);
      then?.();
      return true;
    } catch(error) {
      if (reviewSession !== group || currentView !== "math") return false;
      if (group.draftConflict) {
        showCheckpointRetry(group,()=>persistMathProgress(then),error.message);
        return false;
      }
      if (message) message.textContent = "本题还没确认保存，请保持页面打开并重试。";
      if (retry) { retry.hidden = false; retry.disabled = false; retry.onclick = ()=>persistMathProgress(then); }
      return false;
    }
  }

  function advanceMathQuestion() {
    if (mathSaving || !mathQuestionAnswered || currentView !== "math") return;
    if (reviewSession?.practice) {
      reviewSession.practice.index++;
      return persistMathProgress(()=>{
        mathQuestionAnswered = false;
        if (mathCompleted >= mathRoundSize) renderMathFinish();
        else nextMathQ();
      });
    }
    mathQuestionAnswered = false;
    if (mathCompleted >= mathRoundSize) renderMathFinish();
    else nextMathQ();
  }

  function finishMathQuestion(correct) {
    if (mathQuestionAnswered) return;
    mathQuestionAnswered = true;
    mathCompleted++;
    if (reviewSession?.practice) {
      const answer = mathMode === "decomp" ? bondSheet.item.answers[Object.keys(bondSheet.item.blanks).find(slot=>bondSheet.item.blanks[slot])] : currentQ.attempt;
      window.ChenchenMath.record(reviewSession.practice,answer);
    }
    const progress = document.getElementById("math-progress");
    if(progress) progress.textContent = `${mathCompleted} / ${mathRoundSize} 题`;
    const next = document.getElementById("math-next");
    if(next) {
      next.hidden = false;
      next.disabled = false;
      next.textContent = (correct ? "" : "我看懂了，") + (mathCompleted >= mathRoundSize ? "完成啦 ✿" : "下一题 →");
    }
    if (reviewSession) persistMathProgress();
  }

  function renderMathFinish() {
    stopSpeechSafe();
    const id = mathMode === "decomp" ? "math-decomp-10" : "math-addsub-10";
    const result = mathScore.ok >= mathRoundSize ? "independent" : mathScore.ok > 0 ? "supported" : "again";
    const meta = {type:mathMode === "decomp" ? "decomp" : "math", title:mathMode === "decomp" ? "10以内分解组合" : "10以内加减法",
      enroll:true,source:"automatic",skill:"math-solving",details:{correct:mathScore.ok,total:mathRoundSize,mode:mathMode,questionKeys:mathQuestionKeys,questionResults:(reviewSession?.practice?.questionResults || []).map(({key,knowledgeId,correct})=>({key,knowledgeId,correct}))}};
    const panel = document.getElementById("math-panel");
    panel.innerHTML = `<div class="mini-success"><span aria-hidden="true">✿</span><h3>认真想了 ${mathRoundSize} 道题，真棒！</h3><p>${assessmentBadge(result)}</p><p>首次答对 ${mathScore.ok} / ${mathRoundSize} 题</p><button class="btn btn-primary" id="finish-math">${reviewSession ? "保存这一组，休息一下" : "自由练习完成，休息一下"}</button></div>`;
    document.querySelector("#math-content .practice-controls").hidden = true;
    document.getElementById("finish-math").onclick = async () => {
      if (!reviewSession) {navigate("home");return;}
      const advanced = await completePractice(id, REVIEW_RESULT[result], meta);
      if (!advanced) navigate("home");
    };
  }

  function nextMathQ() {
    stopSpeechSafe();
    mathQuestionAnswered = false;
    const next = document.getElementById("math-next");
    if (next) { next.disabled = true; next.hidden = true; }
    if (mathMode === "decomp") {
      bondSheet = genBondSheet();
      const saved = reviewSession?.practice?.questionResults[reviewSession.practice.index];
      if (saved) {
        const item = bondSheet.item,slot = Object.keys(item.blanks).find(slot=>item.blanks[slot]);
        item.answers[slot] = saved.answer; item.status = saved.correct ? "ok" : "bad";
        item.solution = {whole:item.n,left:item.left,right:item.right};
        bondSheet.checked = true; bondSheet.activeSlot = null;
      }
      renderBondPanel();
      if (saved) restoreMathAnswer(saved);
      return;
    }
    currentQ = reviewSession?.practice ? JSON.parse(JSON.stringify(mathQuestions[reviewSession.practice.index])) : genAddSub();
    const panel = document.getElementById("math-panel");
    if (!panel) return;
    const opts = currentQ.choices || choicesFor(currentQ.answer);
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
        if (btn.disabled || mathSaving || mathQuestionAnswered) return;
        const v = Number(btn.dataset.v);
        currentQ.attempt = v;
        const correct = v === currentQ.answer;
        mathScore.total++;
        if (correct) mathScore.ok++;
        showArithmeticAnswer(v);
        finishMathQuestion(correct);
      };
    });
    const saved = reviewSession?.practice?.questionResults[reviewSession.practice.index];
    if (saved) { showArithmeticAnswer(saved.answer); restoreMathAnswer(saved); }
  }

  function restoreMathAnswer(saved) {
    mathQuestionAnswered = true;
    const next = document.getElementById("math-next");
    next.hidden = false; next.disabled = false;
    next.textContent = (saved.correct ? "" : "我看懂了，") + (mathCompleted >= mathRoundSize ? "完成啦 ✿" : "下一题 →");
  }

  function showArithmeticAnswer(v) {
    const panel = document.getElementById("math-panel");
    const btn = [...panel.querySelectorAll(".math-opts button")].find(button=>Number(button.dataset.v)===v);
    const correct = v === currentQ.answer;
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
      fb.innerHTML = mathVerdictHtml(true);
    } else {
      btn.classList.add("wrong");
      btn.innerHTML = `<span>${v}</span><span class="math-option-mark" aria-hidden="true">×</span>`;
      btn.setAttribute("aria-label", `${v}，这次不对`);
      fb.innerHTML = `${mathVerdictHtml(false)}<span class="sr-only">正确答案是 ${currentQ.answer}：${a} ${op} ${b} = ${currentQ.answer}。看懂了，再点下一题。</span>`;
    }
    fb.className = "feedback math-feedback-visual";
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
  let pyAudioExposureId = null;

  function stopPinyinAudio(destroy = false) {
    pyAudioRequest++;
    pyVoice?.stop();
    if (destroy) { pyVoice?.destroy(); pyVoice = null; }
    pyAudioButton?.classList.remove("is-reading");
    pyAudioButton?.removeAttribute("aria-busy");
    pyAudioButton = null;
    pyAudioExposureId = null;
  }

  async function playPinyin(kind, value, button) {
    pyExposures.add(kind === "sound" ? value : pySelected);
    stopSpeechSafe();
    stopPinyinAudio();
    const request = pyAudioRequest;
    pyAudioExposureId = pinyinId(kind === "sound" ? value : pySelected);
    const status = document.getElementById("py-assessment")?.hidden === false ? document.getElementById("py-check-error") : document.getElementById("py-audio-status");
    status.textContent = "";
    pyAudioButton = button;
    button.classList.add("is-reading");
    button.setAttribute("aria-busy", "true");
    try {
      pyVoice ||= window.ChenchenPinyinAudio.create({onPlaying: () => {
        if (pyAudioExposureId) observedExposure("pinyin",pyAudioExposureId,true);
      }});
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
    const examples = PINYIN_DATA[pyTab].find(item => item.id === pySelected).examples;
    el.innerHTML = `${sessionBanner()}${reviewSession ? "" : groupStartHtml("pinyin")}<div class="card practice-card pinyin-practice"><div class="practice-heading"><div><p class="eyebrow">张开小嘴，读一读</p><h2>拼音小卡片 <span class="heading-flower">a</span></h2></div><span class="practice-count">${target ? "先试着自己读" : "自由点读 · 不留学习记录"}</span></div><div class="tabs-mini" ${target ? "hidden" : ""}><button data-pt="initials" class="${pyTab === "initials" ? "active" : ""}">声母</button><button data-pt="finals" class="${pyTab === "finals" ? "active" : ""}">韵母</button></div><div class="pinyin-sample" id="py-sample"><button class="big-letter" id="py-listen" aria-label="听拼音 ${escapeHtml(pySelected)}"><span>${escapeHtml(pySelected)}</span><span class="pinyin-speaker" aria-hidden="true">◖))</span></button><div class="pinyin-examples" aria-label="点汉字听读音">${examples.map(example=>`<button class="pinyin-example" data-py-example="${escapeHtml(example.c)}" aria-label="听汉字${escapeHtml(example.c)}的读音">${writingRuby(example.c,example.pinyin)}</button>`).join("")}</div><div class="pinyin-audio-status" id="py-audio-status" role="status" aria-live="polite"></div><button class="btn btn-primary" id="py-read" ${reviewSession ? "" : "hidden"}>确认本项练习</button></div><div class="pinyin-assessment" id="py-assessment" hidden><span class="assessment-pinyin">${escapeHtml(pySelected)}</span>${assessmentButtons("py-check","家长确认 · 能自己读吗？")}<button class="text-btn" id="py-check-hint">◖)) 听提示</button><button class="text-btn" id="py-check-back">回去练一练</button></div><div class="pinyin-grid" ${target ? "hidden" : ""}>${list.map(p=>`<button class="pinyin-chip ${p === pySelected ? "active" : ""} ${pyPracticed.has(p) ? "practiced" : ""}" data-p="${p}" aria-label="听拼音 ${p}" aria-pressed="${p === pySelected}">${p}${pyPracticed.has(p) ? '<span aria-label="已练习">✓</span>' : ""}</button>`).join("")}</div></div>`;
    bindStudyStart(el);
    let afterPractice = true, saving = false;
    const beginCheck = rehearsed => {
      stopPinyinAudio();
      afterPractice = rehearsed;
      document.getElementById("py-assessment").hidden = false;
      el.querySelector(".pinyin-practice").classList.add("is-assessing");
    };
    el.querySelectorAll("[data-pt]").forEach(btn=>btn.onclick=()=>{if(target) return;pyTab=btn.dataset.pt;renderPinyin();});
    el.querySelectorAll("[data-p]").forEach(btn=>btn.onclick=()=>{
      if (target) return;
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
    bindAssessment("py-check",targetId || pinyinId(pySelected),async result => {
      if (saving || !reviewSession) return;
      saving = true;
      stopPinyinAudio();
      const symbol = pySelected;
      const entry = {id:pinyinId(symbol),type:"pinyin",title:`拼音·${symbol}`,skill:"pinyin-reading",source:"parent",result,
        details:{symbol,afterPractice:afterPractice || pyExposures.has(symbol) || observedExposure("pinyin",pinyinId(symbol))}};
      el.querySelectorAll("button").forEach(button=>button.disabled=true);
      document.getElementById("py-check-error").textContent = "本项完成，继续这一组…";
      try {
        const advanced = await completePractice(targetId || entry.id,REVIEW_RESULT[result],{type:"pinyin",entries:[entry],enroll:true,retirePinyinGroup:true});
        if (advanced || generation !== practiceGeneration || currentView !== "pinyin") return;
        pyPracticed.add(symbol);
        if (pyPracticed.size >= 3) {navigate("home");return;}
        pySelected = list.find(p=>!pyPracticed.has(p)) || symbol;
        renderPinyin();
        toast("已记录，试试下一张。");
      } finally { saving = false; }
    });
    if (currentStudyPhase() === "review" && target === pySelected && !pyPracticed.has(target)) beginCheck(false);
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
    {"c":"牙","level":"explore","group":"人和身体","example":"牙齿","strokes":"4画","tip":"右边的长钩向下伸。"},
    {"c":"心","level":"explore","group":"人和身体","example":"开心","strokes":"4画","tip":"弯钩旁边有小点。"},
    {"c":"米","level":"explore","group":"植物粮食","example":"大米","strokes":"6画","tip":"几条线向四周散开。"},
    {"c":"禾","level":"explore","group":"植物粮食","example":"禾苗","strokes":"5画","tip":"木字上面多一小撇。"},
    {"c":"竹","level":"explore","group":"植物粮食","example":"竹子","strokes":"6画","tip":"左右两边像两棵小竹子。"},
    {"c":"花","level":"explore","group":"植物粮食","example":"小花","strokes":"7画","tip":"草字头在上面。"},
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
    {"c":"我","level":"everyday","group":"家人与朋友","example":"我们","strokes":"7画","tip":"右边的斜钩舒展开。"},
    {"c":"你","level":"everyday","group":"家人与朋友","example":"你好","strokes":"7画","tip":"左边窄，右边宽一点。"},
    {"c":"他","level":"everyday","group":"家人与朋友","example":"他们","strokes":"5画","tip":"左边单人旁，右边弯钩伸展开。"},
    {"c":"她","level":"everyday","group":"家人与朋友","example":"她们","strokes":"6画","tip":"女字旁在左，右边弯钩伸展开。"},
    {"c":"好","level":"everyday","group":"家人与朋友","example":"你好","strokes":"6画","tip":"女字在左，子字在右。"},
    {"c":"家","level":"everyday","group":"家人与朋友","example":"回家","strokes":"10画","tip":"宝盖头在上，下面舒展开。"},
    {"c":"友","level":"everyday","group":"家人与朋友","example":"朋友","strokes":"4画","tip":"下半边藏着一个又字。"},
    {"c":"学","level":"everyday","group":"校园生活","example":"学校","strokes":"8画","tip":"子字放在下半边。"},
    {"c":"文","level":"everyday","group":"校园生活","example":"中文","strokes":"4画","tip":"小点在上，下面撇捺舒展开。"},
    {"c":"字","level":"everyday","group":"校园生活","example":"写字","strokes":"6画","tip":"宝盖头下面藏着一个子字。"},
    {"c":"写","level":"everyday","group":"校园生活","example":"写字","strokes":"5画","tip":"上面小盖子，下面一条横。"},
    {"c":"画","level":"everyday","group":"校园生活","example":"画画","strokes":"8画","tip":"中间是田，下面像小托盘。"},
    {"c":"师","level":"everyday","group":"校园生活","example":"老师","strokes":"6画","tip":"左边窄，右边的小框留出空间。"},
    {"c":"生","level":"everyday","group":"校园生活","example":"生日","strokes":"5画","tip":"中间一竖，把几条横连起来。"},
    {"c":"同","level":"everyday","group":"校园生活","example":"同学","strokes":"6画","tip":"外框里面有一横和一个口。"},
    {"c":"尺","level":"everyday","group":"校园生活","example":"尺子","strokes":"4画","tip":"上面小折角，下面两边展开。"},
    {"c":"包","level":"everyday","group":"校园生活","example":"书包","strokes":"5画","tip":"外面包着，里面有弯钩。"},
    {"c":"开","level":"everyday","group":"日常动作","example":"开门","strokes":"4画","tip":"上面两条横，下面两边分开。"},
    {"c":"关","level":"everyday","group":"日常动作","example":"关门","strokes":"6画","tip":"上面两点，下面像天字。"},
    {"c":"来","level":"everyday","group":"日常动作","example":"回来","strokes":"7画","tip":"中间一竖，左右舒展开。"},
    {"c":"去","level":"everyday","group":"日常动作","example":"出去","strokes":"5画","tip":"上面土字，下面有小折角。"},
    {"c":"立","level":"everyday","group":"日常动作","example":"立正","strokes":"5画","tip":"小点在上，长横在下面托住。"},
    {"c":"吃","level":"everyday","group":"日常动作","example":"吃饭","strokes":"6画","tip":"小口在左，右边有个弯钩。"},
    {"c":"东","level":"everyday","group":"方向与比较","example":"东边","strokes":"5画","tip":"中间长钩，左右小笔画。"},
    {"c":"西","level":"everyday","group":"方向与比较","example":"西边","strokes":"6画","tip":"里面的小笔画不要挤在一起。"},
    {"c":"北","level":"everyday","group":"方向与比较","example":"北边","strokes":"5画","tip":"左边窄，右边的弯钩伸开。"},
    {"c":"后","level":"everyday","group":"方向与比较","example":"后面","strokes":"6画","tip":"小口放在右下方。"},
    {"c":"外","level":"everyday","group":"方向与比较","example":"外面","strokes":"5画","tip":"左边夕字，右边一竖一点。"},
    {"c":"多","level":"everyday","group":"方向与比较","example":"多少","strokes":"6画","tip":"上下两个夕字错开一点。"},
    {"c":"少","level":"everyday","group":"方向与比较","example":"多少","strokes":"4画","tip":"上半边像小，下面一撇伸展开。"},
    {"c":"长","level":"everyday","group":"方向与比较","example":"长短","strokes":"4画","tip":"右下方的笔画舒展开。"},
    {"c":"早","level":"everyday","group":"方向与比较","example":"早上","strokes":"6画","tip":"上面日字，下面十字。"},
    {"c":"冬","level":"everyday","group":"四季与自然","example":"冬天","strokes":"5画","tip":"下面两个小点分开一点。"},
    {"c":"光","level":"everyday","group":"四季与自然","example":"阳光","strokes":"6画","tip":"上面小笔画，下面两边展开。"},
    {"c":"电","level":"everyday","group":"四季与自然","example":"电灯","strokes":"5画","tip":"中间长钩穿过小方框。"},
    {"c":"叶","level":"everyday","group":"四季与自然","example":"树叶","strokes":"5画","tip":"口字在左，十字在右。"},
    {"c":"果","level":"everyday","group":"四季与自然","example":"水果","strokes":"8画","tip":"田字在上，木字在下。"},
    {"c":"红","level":"everyday","group":"颜色","example":"红花","strokes":"6画","tip":"绞丝旁在左，工字在右。"},
    {"c":"瓜","level":"everyday","group":"食物","example":"西瓜","strokes":"5画","tip":"外面两边伸开，里面留出空间。"},
    {"c":"肉","level":"everyday","group":"食物","example":"吃肉","strokes":"6画","tip":"外框里面，两个人上下叠着。"},
    {"c":"衣","level":"everyday","group":"身边物品","example":"衣服","strokes":"6画","tip":"小点在上，下面撇捺舒展开。"},
    {"c":"王","level":"explore","group":"生活常用","example":"王子","strokes":"4画","tip":"三条横线，中间一竖串起来。"},
    {"c":"厂","level":"starter","group":"生活常用","example":"工厂","strokes":"2画","tip":"上面一横，左边一撇向下伸。"},
    {"c":"广","level":"starter","group":"生活常用","example":"广场","strokes":"3画","tip":"上面小点，横撇像屋顶。"},
    {"c":"太","level":"explore","group":"生活常用","example":"太阳","strokes":"4画","tip":"大字下面添一点，撇捺舒展开。"},
    {"c":"虾","level":"explore","group":"生活常用","example":"小虾","strokes":"9画","tip":"左边虫字旁，右边一个下。"},
    {"c":"孙","level":"explore","group":"生活常用","example":"孙子","strokes":"6画","tip":"左边子字旁，右边小字留空隙。"},
    {"c":"片","level":"explore","group":"生活常用","example":"叶片","strokes":"4画","tip":"左边长撇，右边的折向下收。"},
    {"c":"又","level":"starter","group":"生活常用","example":"又来","strokes":"2画","tip":"横撇和捺在中间交叉。"},
    {"c":"皮","level":"explore","group":"生活常用","example":"皮球","strokes":"5画","tip":"长撇向下伸，下面的又展开。"},
    {"c":"买","level":"explore","group":"生活常用","example":"买菜","strokes":"6画","tip":"上面横钩，下面两点靠左。"},
    {"c":"酒","level":"explore","group":"生活常用","example":"米酒","strokes":"10画","tip":"左边三点水，右边方框留空隙。"},
    {"c":"比","level":"explore","group":"生活常用","example":"比赛","strokes":"4画","tip":"左边短小，右边竖弯钩站稳。"},
    {"c":"切","level":"explore","group":"生活常用","example":"切开","strokes":"4画","tip":"左边七，右边刀，两边留空隙。"},
    {"c":"寸","level":"starter","group":"生活常用","example":"一寸","strokes":"3画","tip":"长横下面一竖钩，左边添一点。"},
    {"c":"丁","level":"starter","group":"生活常用","example":"园丁","strokes":"2画","tip":"一横下面，一条竖钩向下伸。"},
    {"c":"了","level":"starter","group":"生活常用","example":"好了","strokes":"2画","tip":"上面横撇，下面弯钩向中间收。"},
    {"c":"狗","level":"explore","group":"生活常用","example":"小狗","strokes":"8画","tip":"左边反犬旁，右边小口放进勾里。"},
    {"c":"公","level":"explore","group":"生活常用","example":"公园","strokes":"4画","tip":"上面八字分开，下面撇折和点靠近。"},
    {"c":"台","level":"explore","group":"生活常用","example":"台灯","strokes":"5画","tip":"上面撇折和点，下面口字摆正。"},
    {"c":"如","level":"explore","group":"生活常用","example":"如果","strokes":"6画","tip":"左边女字旁，右边口字小一些。"},
    {"c":"妆","level":"explore","group":"生活常用","example":"化妆","strokes":"6画","tip":"左边点提和长竖，右边女字舒展开。"},
    {"c":"戏","level":"explore","group":"生活常用","example":"游戏","strokes":"6画","tip":"左边又收紧，右边斜钩向外伸。"},
    {"c":"成","level":"explore","group":"生活常用","example":"成长","strokes":"6画","tip":"长撇在左，斜钩向右下伸。"},
    {"c":"代","level":"explore","group":"生活常用","example":"代表","strokes":"5画","tip":"左边单人旁，右边斜钩舒展开。"},
    {"c":"思","level":"explore","group":"生活常用","example":"思念","strokes":"9画","tip":"上面田字摆正，下面心字托住。"},
    {"c":"忠","level":"explore","group":"生活常用","example":"忠心","strokes":"8画","tip":"上面中字居中，下面心字展开。"},
    {"c":"刀","level":"starter","group":"生活常用","example":"小刀","strokes":"2画","tip":"横折钩向下弯，里面一撇伸出来。"},
    {"c":"习","level":"starter","group":"生活常用","example":"学习","strokes":"3画","tip":"外面的钩包住一点和一提。"},
    {"c":"认","level":"explore","group":"生活常用","example":"认识","strokes":"4画","tip":"左边言字旁，右边人字舒展开。"},
    {"c":"让","level":"explore","group":"生活常用","example":"让开","strokes":"5画","tip":"左边言字旁，右边上字放稳。"},
    {"c":"讲","level":"explore","group":"生活常用","example":"讲话","strokes":"6画","tip":"左边言字旁，右边井字留出空隙。"},
    {"c":"朵","level":"explore","group":"生活常用","example":"花朵","strokes":"6画","tip":"上面小小的，下面木字展开。"},
    {"c":"没","level":"explore","group":"生活常用","example":"没有","strokes":"7画","tip":"左边三点水，右边上下对齐。"},
    {"c":"船","level":"explore","group":"生活常用","example":"小船","strokes":"11画","tip":"左边舟字旁，右边小口留空隙。"},
    {"c":"飞","level":"starter","group":"生活常用","example":"飞机","strokes":"3画","tip":"弯钩向外展开，右边两笔像翅膀。"},
    {"c":"凤","level":"explore","group":"生活常用","example":"凤凰","strokes":"4画","tip":"外面的框留开口，里面一个又。"},
    {"c":"几","level":"starter","group":"生活常用","example":"几个","strokes":"2画","tip":"左边一撇，右边弯钩像桌腿。"},
    {"c":"丸","level":"starter","group":"生活常用","example":"丸子","strokes":"3画","tip":"九字里面添一点，弯钩站稳。"},
    {"c":"队","level":"explore","group":"生活常用","example":"队伍","strokes":"4画","tip":"左边双耳旁，右边人字展开。"},
    {"c":"阳","level":"explore","group":"生活常用","example":"太阳","strokes":"6画","tip":"左边双耳旁，右边日字摆正。"},
    {"c":"邻","level":"explore","group":"生活常用","example":"邻居","strokes":"7画","tip":"左边令字收紧，右边双耳旁。"},
    {"c":"及","level":"starter","group":"生活常用","example":"及时","strokes":"3画","tip":"横折折撇连着写，捺向右下伸。"},
    {"c":"边","level":"explore","group":"生活常用","example":"旁边","strokes":"5画","tip":"先写里面的力，走之底最后托住。"},
    {"c":"建","level":"explore","group":"生活常用","example":"建立","strokes":"8画","tip":"里面横线留空隙，建字底最后托住。"},
    {"c":"汤","level":"explore","group":"生活常用","example":"米汤","strokes":"6画","tip":"左边三点水，右边两撇分开。"},
    {"c":"场","level":"explore","group":"生活常用","example":"广场","strokes":"6画","tip":"左边土字旁，右边两撇分开。"},
    {"c":"弯","level":"explore","group":"生活常用","example":"弯腰","strokes":"9画","tip":"上面点横居中，下面弓字弯弯的。"},
  ];
  // Retired cards only support saved study drafts and existing custom classroom cards.
  const RETIRED_WRITE_CHARS = [
    {"c":"足","level":"explore","group":"人和身体","example":"足球","strokes":"7画","tip":"上面一个口，下面舒展开。"},
    {"c":"草","level":"explore","group":"植物粮食","example":"小草","strokes":"9画","tip":"草字头下面有日和十。"},
    {"c":"哥","level":"everyday","group":"家人与朋友","example":"哥哥","strokes":"10画","tip":"上下各藏着一个小口。"},
    {"c":"姐","level":"everyday","group":"家人与朋友","example":"姐姐","strokes":"8画","tip":"右边的小框里，短横留出空隙。"},
    {"c":"弟","level":"everyday","group":"家人与朋友","example":"弟弟","strokes":"7画","tip":"上面两点，下面有弯弯的钩。"},
    {"c":"妹","level":"everyday","group":"家人与朋友","example":"妹妹","strokes":"8画","tip":"女字旁在左，右边两横一长一短。"},
    {"c":"爱","level":"everyday","group":"家人与朋友","example":"爱心","strokes":"10画","tip":"中间的小盖子下面留出空间。"},
    {"c":"朋","level":"everyday","group":"家人与朋友","example":"朋友","strokes":"8画","tip":"两个月字并排站。"},
    {"c":"读","level":"everyday","group":"校园生活","example":"读书","strokes":"10画","tip":"言字旁在左，右边宽一点。"},
    {"c":"课","level":"everyday","group":"校园生活","example":"上课","strokes":"10画","tip":"言字旁在左，果字在右。"},
    {"c":"校","level":"everyday","group":"校园生活","example":"学校","strokes":"10画","tip":"木字旁窄一点，右边舒展开。"},
    {"c":"桌","level":"everyday","group":"校园生活","example":"桌子","strokes":"10画","tip":"木字托住上面的部分。"},
    {"c":"笔","level":"everyday","group":"校园生活","example":"铅笔","strokes":"10画","tip":"竹字头在上，弯钩向右伸。"},
    {"c":"走","level":"everyday","group":"日常动作","example":"走路","strokes":"7画","tip":"上面像土，下面向右展开。"},
    {"c":"跑","level":"everyday","group":"日常动作","example":"跑步","strokes":"12画","tip":"足字旁在左，包字在右。"},
    {"c":"坐","level":"everyday","group":"日常动作","example":"坐下","strokes":"7画","tip":"两个人坐在土字上面。"},
    {"c":"看","level":"everyday","group":"日常动作","example":"看书","strokes":"9画","tip":"下半边是目，上面舒展开。"},
    {"c":"听","level":"everyday","group":"日常动作","example":"听话","strokes":"7画","tip":"小口在左，右边留出空间。"},
    {"c":"说","level":"everyday","group":"日常动作","example":"说话","strokes":"9画","tip":"言字旁窄一点，右边宽一点。"},
    {"c":"笑","level":"everyday","group":"日常动作","example":"微笑","strokes":"10画","tip":"竹字头在上，下面撇捺舒展开。"},
    {"c":"喝","level":"everyday","group":"日常动作","example":"喝水","strokes":"12画","tip":"左边小口，右边宽一点。"},
    {"c":"玩","level":"everyday","group":"日常动作","example":"玩具","strokes":"8画","tip":"王字旁在左，元字在右。"},
    {"c":"洗","level":"everyday","group":"日常动作","example":"洗手","strokes":"9画","tip":"三点水在左，右边弯钩伸展开。"},
    {"c":"南","level":"everyday","group":"方向与比较","example":"南边","strokes":"9画","tip":"外框里面的短横留出空隙。"},
    {"c":"前","level":"everyday","group":"方向与比较","example":"前面","strokes":"9画","tip":"右边的竖钩站直一点。"},
    {"c":"里","level":"everyday","group":"方向与比较","example":"里面","strokes":"7画","tip":"上面像田，下面一条长横。"},
    {"c":"短","level":"everyday","group":"方向与比较","example":"长短","strokes":"12画","tip":"右边是豆，左右靠近一点。"},
    {"c":"高","level":"everyday","group":"方向与比较","example":"高山","strokes":"10画","tip":"上下各藏着一个小口。"},
    {"c":"低","level":"everyday","group":"方向与比较","example":"低头","strokes":"7画","tip":"左边单人旁，右下角有个小点。"},
    {"c":"晚","level":"everyday","group":"方向与比较","example":"晚上","strokes":"11画","tip":"日字在左，右边弯钩伸展开。"},
    {"c":"春","level":"everyday","group":"四季与自然","example":"春天","strokes":"9画","tip":"上面几条横，日字在下面。"},
    {"c":"夏","level":"everyday","group":"四季与自然","example":"夏天","strokes":"10画","tip":"中间像目，下面两边舒展开。"},
    {"c":"秋","level":"everyday","group":"四季与自然","example":"秋天","strokes":"9画","tip":"禾字在左，火字在右。"},
    {"c":"星","level":"everyday","group":"四季与自然","example":"星星","strokes":"9画","tip":"日字在上，生字在下。"},
    {"c":"雪","level":"everyday","group":"四季与自然","example":"雪花","strokes":"11画","tip":"雨字头在上，下面短横留出空隙。"},
    {"c":"河","level":"everyday","group":"四季与自然","example":"小河","strokes":"8画","tip":"三点水在左，右边小口留出空间。"},
    {"c":"海","level":"everyday","group":"四季与自然","example":"大海","strokes":"10画","tip":"三点水在左，右边宽一点。"},
    {"c":"林","level":"everyday","group":"四季与自然","example":"树林","strokes":"8画","tip":"两个木字并排，左边窄一点。"},
    {"c":"黄","level":"everyday","group":"颜色","example":"黄色","strokes":"11画","tip":"下面两点分开一点。"},
    {"c":"蓝","level":"everyday","group":"颜色","example":"蓝天","strokes":"13画","tip":"草字头在上，下面的皿稳稳托住。"},
    {"c":"绿","level":"everyday","group":"颜色","example":"绿叶","strokes":"11画","tip":"绞丝旁在左，右下边舒展开。"},
    {"c":"黑","level":"everyday","group":"颜色","example":"黑色","strokes":"12画","tip":"下面四点留出小空隙。"},
    {"c":"豆","level":"everyday","group":"食物","example":"豆子","strokes":"7画","tip":"小口在中间，下面长横托住。"},
    {"c":"茶","level":"everyday","group":"食物","example":"茶杯","strokes":"9画","tip":"草字头下面，两边舒展开。"},
    {"c":"蛋","level":"everyday","group":"食物","example":"鸡蛋","strokes":"11画","tip":"虫字放在下半边。"},
    {"c":"饭","level":"everyday","group":"食物","example":"吃饭","strokes":"7画","tip":"食字旁在左，右边舒展开。"},
    {"c":"面","level":"everyday","group":"食物","example":"面条","strokes":"9画","tip":"外面方框，里面短横留出空隙。"},
  ];
  let selectedWriteId = null;
  let writingListScroll = 0;
  let writingDemo = null;
  let writingPractice = null;
  let writingVoice = null;
  let writingGeneration = 0;

  function stopWritingDemo() {
    writingGeneration++;
    writingDemo?.destroy();
    writingPractice?.destroy();
    writingVoice?.destroy();
    writingDemo = null;
    writingPractice = null;
    writingVoice = null;
  }

  function writingCharacters(includeRetired = false) {
    const vocabulary = new Map((window.ChenchenWritingVocabulary || []).map(item=>[item.c,item]));
    const allBuiltin = [...WRITE_CHARS,...RETIRED_WRITE_CHARS];
    const characters = new Map((includeRetired ? allBuiltin : WRITE_CHARS).map(ch => {
      const item = {...ch,...vocabulary.get(ch.c),id:`write-char-${ch.c.codePointAt(0).toString(16)}`};
      return [item.id,item];
    }));
    Object.values(loadState().customCharacters || {}).forEach(ch=>{
      const builtin = allBuiltin.find(item=>item.c === ch.c);
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
    el.innerHTML = `${groupStartHtml("write")}<div class="card practice-card write-library-page"><div class="practice-heading"><div><p class="eyebrow">先选一个字</p><h2>写汉字</h2></div><span class="practice-count">${all.length} 个字</span></div><p class="practice-instruction">简单的在前面，点一个字开始读写。</p><div class="write-list write-library" aria-label="从简单到复杂的汉字">${all.map(w=>`<button class="${w.id === selectedWriteId ? "active" : ""}" data-write-id="${escapeHtml(w.id)}" aria-label="选择汉字 ${escapeHtml(w.c)}" aria-pressed="${w.id === selectedWriteId}">${writingRuby(w.c,w.pinyin)}</button>`).join("")}</div></div>`;
    bindStudyStart(el);
    el.querySelectorAll("[data-write-id]").forEach(btn=>btn.onclick=()=>openWriteCharacter(btn.dataset.writeId));
  }

  function openWriteCharacter(id, rememberPosition = true) {
    if (!writingCharacters().some(ch=>ch.id === id)) return;
    if (rememberPosition) writingListScroll = window.scrollY || 0;
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
    const ch = writingCharacters(true).find(it=>it.id===selectedWriteId) || writingCharacters()[0];
    selectedWriteId = ch.id;
    const group = reviewSession;
    const characters = writingCharacters();
    const characterIndex = characters.findIndex(item=>item.id === ch.id);
    const showNavigation = !group && characterIndex >= 0;
    const lastCharacter = characterIndex === characters.length - 1;
    const startsWithBlindCheck = !!(ch.pinyin && currentStudyPhase() === "review" && group?.items[group.index]?.type === "write");
    const words = ch.words || [];
    let assisted = !startsWithBlindCheck, finished = false, watching = false, readingRequest = 0, practiceRun = 0;
    let demoReady = false, demoFailed = false, demoRun = 0;
    let practiceState = {status:"loading",completed:0,total:0,hintsUsed:0};
    if (!startsWithBlindCheck) observedExposure("write",ch.id,true);
    const active = () => token === writingGeneration && currentView === "write-detail";
    const markAssisted = () => { assisted = true; observedExposure("write",ch.id,true); };
    el.innerHTML = `${sessionBanner()}<button class="back-btn" id="write-back">← 全部汉字</button><div class="card practice-card write-practice"><div class="practice-heading"><div><p class="eyebrow">一笔一画，慢慢写</p><h2>汉字写一写</h2></div><span class="practice-count">${group ? "写完自动记录" : "自由练习 · 不留学习记录"}</span></div><button class="write-pronounce" id="write-pronounce" aria-label="听汉字读音" ${ch.pinyin ? "" : "disabled"}><span class="write-pinyin">${escapeHtml(ch.pinyin || ch.c)}</span><span class="write-listen-cue">◖)) ${ch.pinyin ? "点一下，听读音" : "照着字形描一描"}</span></button><p class="write-instruction" id="write-instruction">${startsWithBlindCheck ? "听读音，试着自己写。需要时可以看笔顺。" : "沿着浅色字形写，每写完一笔松开手指。"}</p><div class="tianzige write-stage" id="write-stage" aria-busy="true"><div class="write-shape-loading" id="write-shape-loading">字形准备中…</div><div id="write-stroke-layer" class="write-stroke-layer" hidden aria-label="笔顺示范"></div><div id="write-practice-layer" class="write-practice-layer" hidden aria-label="汉字逐笔书写区"></div></div><div class="write-stroke-status" id="write-stroke-status" role="status" aria-live="polite"></div>${words.length ? `<button class="text-btn write-show-words" id="write-show-words" ${startsWithBlindCheck ? "" : "hidden"}>看看词语</button><div id="write-words-panel" ${startsWithBlindCheck ? "hidden" : ""}><div class="write-words" aria-label="点词语听读音">${words.map((word,index)=>`<button class="write-word" data-write-word="${index}" aria-label="听词语${escapeHtml(word.text)}">${writingRuby(word.text,word.pinyin)}</button>`).join("")}</div><p class="write-word-cue">点词语，也能听读音</p></div>` : ""}<div class="btn-row write-main-controls"><button class="btn btn-learn" id="write-strokes-play" disabled>▶ 看笔顺</button><button class="btn btn-ghost" id="write-clear" disabled>↶ 重新写</button>${showNavigation ? `<button class="btn btn-primary" id="write-next">${lastCharacter ? "返回字库 ✓" : "下一个 →"}</button>` : ""}</div><button class="btn btn-primary" id="write-retry" hidden>重试加载</button></div>`;
    document.getElementById("write-back").onclick = returnToWriteLibrary;
    if (showNavigation) {
      document.getElementById("write-next").onclick = () => {
        if (!active()) return;
        if (lastCharacter) returnToWriteLibrary();
        else openWriteCharacter(characters[characterIndex + 1].id, false);
      };
    }
    const stage = document.getElementById("write-stage");
    const loading = document.getElementById("write-shape-loading");
    const layer = document.getElementById("write-stroke-layer");
    const practiceLayer = document.getElementById("write-practice-layer");
    const status = document.getElementById("write-stroke-status");
    const playButton = document.getElementById("write-strokes-play");
    const eraseButton = document.getElementById("write-clear");
    const retryButton = document.getElementById("write-retry");
    const pronounceButton = document.getElementById("write-pronounce");
    const readingButtons = [pronounceButton,...el.querySelectorAll("[data-write-word]")];
    writingVoice = window.ChenchenWritingAudio?.create() || null;
    const voice = writingVoice;
    const stopReading = () => {
      readingRequest++; voice?.stop();
      readingButtons.forEach(button=>button.classList.remove("is-reading"));
    };
    const progressText = () => "";
    const updateControls = () => {
      const busy = practiceState.status === "loading";
      const failed = practiceState.status === "error";
      stage.setAttribute("aria-busy",String(busy));
      loading.hidden = !busy;
      practiceLayer.hidden = busy || failed || watching;
      layer.hidden = !watching;
      eraseButton.disabled = busy || failed || (finished && !!group);
      playButton.disabled = !demoReady || (finished && !!group);
      playButton.textContent = watching ? "■ 停下" : demoFailed ? "↻ 重试笔顺" : "▶ 看笔顺";
      if (demoFailed && !busy && !(finished && group)) playButton.disabled = false;
      retryButton.hidden = !failed;
      status.classList.toggle("is-playing",watching);
    };
    const returnToPractice = () => {
      watching = false;
      writingPractice?.resume();
      updateControls();
      if (!finished && practiceState.status !== "error") status.textContent = progressText();
    };
    const setupDemo = () => {
      const run = ++demoRun;
      writingDemo?.destroy();
      layer.replaceChildren();
      demoReady = demoFailed = false;
      if (!window.ChenchenWritingStrokes) {demoFailed=true;updateControls();return;}
      try {
        writingDemo = window.ChenchenWritingStrokes.create({
          target:layer,character:ch.c,
          playStroke:(index,signal)=>voice?.playStroke(index,signal),
          onState(state) {
            if (!active() || run !== demoRun || state.status === "destroyed") return;
            demoReady = ["ready","playing","paused","complete"].includes(state.status);
            if (watching && state.status === "playing") status.textContent = `示范第 ${state.stroke || state.completed+1} 笔 / 共 ${state.total} 笔`;
            if (watching && state.status === "complete") returnToPractice();
            updateControls();
          },
          onError() {
            if (!active() || run !== demoRun) return;
            demoFailed = true; demoReady = false;
            if (watching) returnToPractice();
            updateControls();
            status.textContent = "示范暂时没有打开，可以继续写，或重试笔顺。";
          },
        });
      } catch (_) {demoFailed=true;updateControls();}
    };
    const setupPractice = () => {
      const run = ++practiceRun;
      writingPractice?.destroy();
      practiceLayer.replaceChildren();
      finished = false;
      practiceState = {status:"loading",completed:0,total:0,hintsUsed:0};
      updateControls();
      const current = () => active() && run === practiceRun;
      const unavailable = () => {
        if (!current()) return;
        practiceState = {...practiceState,status:"error"};
        updateControls();
        status.textContent = "这个字的笔画暂时没有准备好，请重试或返回字库。";
      };
      if (!window.ChenchenWritingPractice) {unavailable();return;}
      try {
        writingPractice = window.ChenchenWritingPractice.create({
          target:practiceLayer,character:ch.c,showOutline:!startsWithBlindCheck,
          onState(state) {
            if (!current() || state.status === "destroyed") return;
            const previous = practiceState;
            practiceState = state;
            if (state.hintsUsed > previous.hintsUsed) markAssisted();
            updateControls();
            if (!watching && !finished && state.status === "active" &&
                (previous.status !== state.status || previous.completed !== state.completed || previous.hintsUsed !== state.hintsUsed)) {
              status.textContent = state.hintsUsed > previous.hintsUsed ? "跟着提示，试着写这一笔。" : progressText();
            }
          },
          onMistake(data) {
            if (!current() || finished || watching) return;
            status.textContent = data.isBackwards
              ? "这一笔方向反了，换个方向再试试。"
              : "这一笔还没对上，再试一次；也可以看笔顺。";
          },
          onCorrectStroke() {
            if (!current() || finished || watching) return;
            status.textContent = "这一笔写对了！";
          },
          async onComplete(summary) {
            if (!current() || finished || watching || practiceState.status === "error") return;
            if (!Number.isInteger(summary.totalStrokes) || summary.totalStrokes < 1 ||
                summary.completedStrokes !== summary.totalStrokes) return;
            finished = true;
            stopReading();
            updateControls();
            const afterPractice = observedExposure("write",ch.id) || !!group?.items[group.index]?.afterPractice;
            const supported = assisted || afterPractice || summary.outlineShown || summary.hintsUsed > 0 || summary.totalMistakes > 0;
            const result = supported ? "supported" : "independent";
            status.textContent = supported ? "写好啦！在帮助下完成了全部笔画。" : "写好啦！自己完成了全部笔画。";
            if (!group || reviewSession !== group) return;
            const details = {...summary,character:ch.c,afterPractice,assisted:supported};
            const entry = {id:ch.id,type:"write",title:`汉字·${ch.c}`,source:"automatic",skill:"hanzi-writing",result,details};
            const id = group.items[group.index]?.id || ch.id;
            await completePractice(id,REVIEW_RESULT[result],{...entry,entries:[entry],enroll:true});
          },
          onError:unavailable,
        });
      } catch (_) {unavailable();}
    };
    setupDemo();
    setupPractice();
    playButton.onclick = () => {
      if (!active() || (finished && group)) return;
      if (watching) {writingDemo?.stop();returnToPractice();return;}
      if (demoFailed) {setupDemo();return;}
      if (!demoReady) return;
      markAssisted();
      stopSpeechSafe();stopReading();
      writingPractice?.pause();
      watching = true;
      updateControls();
      void writingDemo?.play();
    };
    eraseButton.onclick = () => {
      if (eraseButton.disabled || !active()) return;
      markAssisted();
      stopReading();
      if (watching) {writingDemo?.stop();watching=false;}
      finished = false;
      void writingPractice?.restart({showOutline:!startsWithBlindCheck});
      updateControls();
    };
    retryButton.onclick = () => {
      if (!active() || practiceState.status !== "error") return;
      setupPractice();
    };
    const showWords = words.length ? document.getElementById("write-show-words") : null;
    if (showWords) showWords.onclick = () => {
      markAssisted();
      document.getElementById("write-words-panel").hidden = false;
      showWords.hidden = true;
    };
    const read = async (id,button) => {
      if (!active()) return;
      stopSpeechSafe();
      if (watching) {writingDemo?.stop();returnToPractice();}
      stopReading();
      const request = readingRequest;
      button.classList.add("is-reading");
      try {
        if (!voice?.playReading) throw new Error("Reading unavailable");
        await voice.playReading(id);
      } catch (error) {
        if (active() && request === readingRequest && error.name !== "AbortError") status.textContent = "声音没有打开，再点一下试试。";
      } finally {if(active() && request===readingRequest)button.classList.remove("is-reading");}
    };
    pronounceButton.onclick = () => {if(ch.pinyin)return read(`char-${ch.c.codePointAt(0).toString(16)}`,pronounceButton);};
    el.querySelectorAll("[data-write-word]").forEach(button=>button.onclick=()=>{
      const word = words[Number(button.dataset.writeWord)];
      markAssisted();
      return read(`word-${Array.from(word.text).map(c=>c.codePointAt(0).toString(16)).join("-")}`,button);
    });
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
    if (reviewSession && (reviewSession.saving || reviewSession.draftSaving || reviewSession.draftFailed || !reviewSession.definiteFailure && reviewSession.entries.length >= reviewSession.items.length)) {toast("这一组正在确认保存，请保持页面打开并重试。");return;}
    if (!stateReady) { toast("先连接服务器，再开始复习。"); return; }
    const restorePoemScroll = v === "poems" && currentView === "poem-detail";
    showingCelebration = false;
    reviewSession = null;
    showView(v);
    if (v === "home") renderHome();
    if (v === "poems") renderPoems({restoreScroll:restorePoemScroll});
    if (v === "math") renderMath();
    if (v === "pinyin") {pyPracticed = new Set();pyExposures = new Set();renderPinyin();}
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
    window.addEventListener("beforeunload",event=>{if(reviewSession && (reviewSession.saving || reviewSession.draftSaving || reviewSession.draftFailed || !reviewSession.definiteFailure && reviewSession.entries.length>=reviewSession.items.length)){event.preventDefault();event.returnValue="";}});
    showView("home");
    initializePage();
  });
})();
