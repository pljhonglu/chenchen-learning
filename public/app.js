/* 辰辰幼小衔接 — 应用逻辑 */
(function () {
  "use strict";

  const STORAGE_KEY = "chenchen-learning-v1";
  const INTERVALS = [1, 2, 4, 7, 15, 30]; // days
  // Same-origin /api/* (Docker SQLite). Override only if API is on another host.
  const API_BASE = "";
  const SYNC_META_KEY = "chenchen-sync-meta";


  // ---------- Poems data (loaded from public/data/poems.json) ----------
  let POEMS = [];
  let poemsLoadPromise = null;

  function ensurePoems() {
    if (!poemsLoadPromise) {
      poemsLoadPromise = fetch("data/poems.json", { cache: "force-cache" })
        .then((r) => {
          if (!r.ok) throw new Error("poems_load_failed");
          return r.json();
        })
        .then((data) => {
          POEMS = Array.isArray(data) ? data : [];
          return POEMS;
        })
        .catch((e) => {
          console.warn("诗卡暂时没有打开，请刷新再试一次", e);
          POEMS = [];
          throw e;
        });
    }
    return poemsLoadPromise;
  }

  // ---------- Storage / SM-2 simplified ----------
  function loadState() {
    try {
      const state = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return state && typeof state === "object" && !Array.isArray(state)
        ? { ...state, items: state.items && typeof state.items === "object" ? state.items : {} }
        : { items: {} };
    } catch {
      return { items: {} };
    }
  }
  function saveState(state) {
    state.updatedAt = Math.max(Date.now(), (Number(state.updatedAt) || 0) + 1);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    scheduleProgressPush();
  }

  // ---------- Server sync (SQLite via same-origin /api/progress) ----------
  let syncStatus = { text: "正在连接服务器…", kind: "busy" };
  let pushTimer = null;
  let syncBusy = false;
  let syncPending = false;

  function getSyncMeta() {
    try {
      return JSON.parse(localStorage.getItem(SYNC_META_KEY) || "{}");
    } catch {
      return {};
    }
  }
  function setSyncMeta(patch) {
    const m = { ...getSyncMeta(), ...patch };
    localStorage.setItem(SYNC_META_KEY, JSON.stringify(m));
    return m;
  }
  function setSyncStatus(text, kind) {
    syncStatus = { text, kind: kind || "muted" };
    const el = document.getElementById("sync-status");
    if (el) {
      el.textContent = text;
      el.dataset.kind = syncStatus.kind;
    }
  }
  function mergeProgressPayloads(local, remote) {
    const a = local && typeof local === "object" ? local : { items: {} };
    const b = remote && typeof remote === "object" ? remote : { items: {} };
    const items = { ...(a.items || {}) };
    for (const [id, rit] of Object.entries(b.items || {})) {
      const lit = items[id];
      if (!lit) {
        items[id] = rit;
        continue;
      }
      const lt = Date.parse(lit.updatedAt || lit.createdAt || 0) || 0;
      const rt = Date.parse(rit.updatedAt || rit.createdAt || 0) || 0;
      items[id] = rt >= lt ? { ...lit, ...rit } : { ...rit, ...lit };
    }
    const localAt = Number(a.updatedAt) || 0;
    const remoteAt = Number(b.updatedAt) || 0;
    return {
      ...(localAt > remoteAt ? a : b),
      items,
      activity: { ...(a.activity || {}), ...(b.activity || {}) },
      updatedAt: Math.max(localAt, remoteAt, Date.now()),
    };
  }
  async function apiFetch(path, opts) {
    const base = API_BASE === undefined || API_BASE === null ? "" : API_BASE;
    const res = await fetch(base + path, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...(opts && opts.headers),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || "sync_failed");
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }
  async function pullAndMerge() {
    setSyncStatus("正在从服务器拉取…", "busy");
    const data = await apiFetch("/api/progress", { method: "GET" });
    if (!data.found || !data.payload) {
      setSyncStatus("服务器暂无数据，打卡后会自动保存", "ok");
      setSyncMeta({ lastPullAt: Date.now(), serverUpdatedAt: null });
      return null;
    }
    const local = loadState();
    const merged = mergeProgressPayloads(local, data.payload);
    merged.updatedAt = Math.max(merged.updatedAt, Number(data.updatedAt) || 0);
    const prevTimer = pushTimer;
    pushTimer = null;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    pushTimer = prevTimer;
    setSyncMeta({
      lastPullAt: Date.now(),
      serverUpdatedAt: data.updatedAt,
    });
    setSyncStatus(
      "已与服务器合并 · " +
        new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
      "ok"
    );
    return merged;
  }
  async function pushProgress() {
    const state = loadState();
    const clientUpdatedAt = Number(state.updatedAt) || Date.now();
    setSyncStatus("正在保存到服务器…", "busy");
    const data = await apiFetch("/api/progress", {
      method: "PUT",
      body: JSON.stringify({
        payload: state,
        clientUpdatedAt,
      }),
    });
    if (data.payload) {
      const latest = loadState();
      const changedDuringSave = (Number(latest.updatedAt) || 0) > clientUpdatedAt;
      const merged = mergeProgressPayloads(latest, data.payload);
      merged.updatedAt = Math.max(merged.updatedAt, Number(data.updatedAt) || 0);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      if (changedDuringSave || data.kept === "server") syncPending = true;
    }
    setSyncMeta({
      lastPushAt: Date.now(),
      serverUpdatedAt: data.updatedAt,
    });
    setSyncStatus(
      (data.kept === "server" ? "服务器较新，已采用服务器 · " : "已保存到服务器 · ") +
        new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
      "ok"
    );
    return data;
  }
  function scheduleProgressPush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      syncNow("push").catch(() => {});
    }, 900);
  }
  async function syncNow(mode) {
    if (syncBusy) { syncPending = true; return; }
    syncBusy = true;
    try {
      if (mode === "push") {
        await pushProgress();
      } else {
        await pullAndMerge();
        await pushProgress();
      }
      if (currentView === "home" && !showingCelebration) renderHome();
    } catch (e) {
      console.warn("sync failed", e);
      setSyncStatus("同步失败：" + (e.message || "网络错误"), "err");
    } finally {
      syncBusy = false;
      if (syncPending) {
        syncPending = false;
        clearTimeout(pushTimer);
        pushTimer = setTimeout(() => syncNow("push"), 50);
      }
    }
  }
  function syncPanelHtml() {
    const meta = getSyncMeta();
    const last =
      meta.lastPushAt || meta.lastPullAt
        ? new Date(meta.lastPushAt || meta.lastPullAt).toLocaleString("zh-CN", {
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "尚未同步";
    return `
      <div class="card sync-card" id="sync-card">
        <h2>💾 进度同步</h2>
        <p class="sync-desc">练习进度自动保存在这台设备，并同步到服务端。家里不同设备访问同一地址即可共用进度。网络暂时断开时仍可练习。</p>
        <div class="btn-row sync-actions">
          <button type="button" class="btn btn-learn" id="sync-now">立即同步</button>
        </div>
        <div class="sync-status" id="sync-status" data-kind="${escapeHtml(syncStatus.kind)}">${escapeHtml(syncStatus.text)}</div>
        <div class="sync-meta">上次：${escapeHtml(last)}</div>
      </div>`;
  }
  function bindSyncPanel(root) {
    const card = (root || document).querySelector("#sync-card");
    if (!card) return;
    const btn = card.querySelector("#sync-now");
    if (btn) btn.onclick = () => syncNow("full");
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

  function upsertItem(id, patch) {
    const s = loadState();
    const prev = s.items[id] || {
      id,
      type: patch.type || "poem",
      title: patch.title || id,
      stage: 0,
      nextReview: todayStr(),
      lastResult: null,
      learned: false,
      createdAt: new Date().toISOString(),
    };
    s.items[id] = { ...prev, ...patch, updatedAt: new Date().toISOString() };
    saveState(s);
    return s.items[id];
  }

  /** result: 'remember' | 'fuzzy' | 'forgot' */
  function reviewResult(id, result, meta) {
    const cur = getItem(id) || upsertItem(id, meta || {});
    const startingStage = cur.reviewDay === todayStr() ? (cur.reviewStartStage || 0) : (cur.stage || 0);
    let stage = startingStage;
    if (result === "remember") {
      stage = Math.min(stage + 1, INTERVALS.length - 1);
    } else if (result === "fuzzy") {
      stage = Math.max(0, stage - 1);
    } else {
      stage = 0;
    }
    const days = INTERVALS[stage];
    return upsertItem(id, {
      ...meta,
      stage,
      lastResult: result,
      reviewDay: todayStr(),
      reviewStartStage: startingStage,
      nextReview: addDays(todayStr(), days),
      learned: true,
    });
  }

  function markLearned(id, meta) {
    if (getItem(id)?.learned) return getItem(id);
    return upsertItem(id, {
      ...meta,
      learned: true,
      stage: 0,
      nextReview: todayStr(),
      lastResult: "enrolled",
    });
  }

  function dueItems() {
    const s = loadState();
    const today = todayStr();
    return Object.values(s.items).filter(
      (it) => it.learned && it.nextReview && it.nextReview <= today
    );
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
  let showingCelebration = false;
  let poemFilter = "learned";
  let poemQuery = "";
  let selectedPoemId = null;


  function stopSpeechSafe() {
    try {
      if (window.ChenchenSpeech) ChenchenSpeech.stop();
    } catch (_) {}
  }

  function updateSpeakButtons(state) {
    const play = document.getElementById("btn-speak");
    const pause = document.getElementById("btn-speak-pause");
    const stop = document.getElementById("btn-speak-stop");
    if (!play) return;
    const speaking = state === "speaking";
    const paused = state === "paused";
    play.classList.toggle("is-active", speaking || paused);
    play.textContent = speaking || paused ? "🔊 朗读中" : "🔊 朗读";
    if (pause) {
      pause.disabled = !(speaking || paused);
      pause.textContent = paused ? "▶️ 继续" : "⏸️ 暂停";
    }
    if (stop) stop.disabled = !(speaking || paused);
  }

  const views = ["home", "poems", "poem-detail", "math", "pinyin", "write"];

  function showView(name) {
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
      };
      btn.classList.toggle("active", btn.dataset.nav === map[name]);
      if (btn.dataset.nav === map[name]) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---------- Home / Review ----------
  function typeIcon(type) {
    return (
      { poem: "📜", math: "➕", decomp: "🔢", pinyin: "🔤", write: "✍️" }[type] ||
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
      }[type] || type
    );
  }

  let reviewSession = null;
  let pySelected = "a";
  let pyPracticed = new Set();

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

  function recordPractice(id, type) {
    const s = loadState();
    s.activity = s.activity || {};
    s.activity[`${Date.now()}-${Math.random().toString(36).slice(2, 8)}`] = { day: todayStr(), id, type };
    // Keep about three months of the small completion log; course progress is never removed.
    const cutoff = addDays(todayStr(), -90);
    Object.keys(s.activity).forEach(key => { if (s.activity[key].day < cutoff) delete s.activity[key]; });
    saveState(s);
  }

  function sessionBanner() {
    if (!reviewSession) return "";
    return `<div class="session-banner"><span>小小复习 · ${reviewSession.index + 1} / ${reviewSession.items.length}</span><span>${reviewSession.items.map((_, i) => `<i class="${i < reviewSession.index ? "done" : i === reviewSession.index ? "now" : ""}"></i>`).join("")}</span><button class="text-btn" id="session-exit">先休息</button></div>`;
  }

  function bindSessionExit() {
    const btn = document.getElementById("session-exit");
    if (btn) btn.onclick = () => { reviewSession = null; showView("home"); renderHome(); };
  }

  function completePractice(id, result, meta) {
    if (reviewSession && reviewSession.items[reviewSession.index]?.id !== id) return true;
    if (getItem(id)?.learned) reviewResult(id, result, meta);
    recordPractice(id, meta.type);
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
    await ensurePoems().catch(() => {});
    const learned = allLearned();
    const due = dueItems();
    if (!learned.length) { openParent(); return; }
    const items = (due.length ? due : learned).slice(0, 3);
    reviewSession = { items, index: 0 };
    openReviewItem(items[0].id, items[0].type);
  }

  async function renderHome() {
    try { await ensurePoems(); } catch (_) {}
    const due = dueItems();
    const learned = allLearned();
    const state = loadState();
    const practiced = Object.values(state.activity || {}).filter(it => it.day === todayStr()).length;
    const todayList = (due.length ? due : learned).slice(0, 3);
    const el = document.getElementById("home-content");
    el.innerHTML = `
      <div class="welcome-line"><span>你好，辰辰 <span aria-hidden="true">☀</span></span><span>${formatDateCN(todayStr())} · 美好的一天</span></div>
      <div class="home-top">
        <section class="hero">
          <div class="hero-copy"><p class="eyebrow"><span></span> 把学过的，再想起来</p><h1>每天一点点，<br>记忆开出小花。</h1><p class="hero-description">${practiced >= 3 ? "今天已经认真练习啦，先休息一会儿吧。" : "和小兔一起，复习课上的小本领。"}</p><button class="btn btn-primary start-btn" id="start-review"><span aria-hidden="true">▶</span> ${practiced >= 3 ? "再复习一会儿" : "开始复习"} <span aria-hidden="true">→</span></button><p class="hero-note">${learned.length ? `一次 ${todayList.length} 个小练习 · 不着急，慢慢来` : "第一次来？请家长先选好课上学过的内容"}</p></div>
          <div class="hero-illustration">${rabbitArt()}<span class="art-caption">小兔陪你，一起长大</span></div>
        </section>
        <aside class="growth-card"><div class="growth-heading"><span class="tiny-sprout" aria-hidden="true">♧</span><span>我的小小收获</span></div><h2>${practiced ? "小花正在长大" : "今天也来浇浇水"}</h2><p>${practiced ? `今天完成了 ${practiced} 次练习` : "每认真练习一次，就收获一朵小花"}</p><div class="flower-row" aria-label="今天完成 ${practiced} 次练习">${[0,1,2].map(i => `<span class="flower ${i < practiced ? "bloomed" : ""}" aria-hidden="true">✿<i></i></span>`).join("")}</div><div class="growth-bottom"><span>${Math.min(practiced,3)} / 3 朵小花</span><span>一点点，就是进步</span></div><div class="growth-track"><span style="width:${Math.min(practiced/3,1)*100}%"></span></div></aside>
      </div>
      <div class="section-heading"><div><h2>选一个小本领</h2><p>读一读，想一想，动动小手</p></div><button class="listen-guide" id="home-guide" aria-label="听听怎么玩">◖)) <span>听听怎么玩</span></button></div>
      <div class="subject-grid">
        <button class="subject-card subject-poems" data-go="poems"><span class="subject-drawing poem-drawing" aria-hidden="true"><i>诗</i><span>⌁</span></span><span class="subject-text"><strong>读古诗</strong><small>听一听 · 背一背</small></span><span class="subject-arrow">↗</span></button>
        <button class="subject-card subject-math" data-go="math"><span class="subject-drawing math-drawing" aria-hidden="true"><i>2</i><i>＋</i><i>3</i></span><span class="subject-text"><strong>玩数学</strong><small>数一数 · 想一想</small></span><span class="subject-arrow">↗</span></button>
        <button class="subject-card subject-pinyin" data-go="pinyin"><span class="subject-drawing pinyin-drawing" aria-hidden="true"><i>a</i><i>o</i><i>e</i></span><span class="subject-text"><strong>读拼音</strong><small>张开嘴 · 读一读</small></span><span class="subject-arrow">↗</span></button>
        <button class="subject-card subject-write" data-go="write"><span class="subject-drawing write-drawing" aria-hidden="true"><i>大</i><span>✎</span></span><span class="subject-text"><strong>写汉字</strong><small>看一看 · 描一描</small></span><span class="subject-arrow">↗</span></button>
      </div>
      <section class="today-card"><div class="today-intro"><span class="today-tag">TODAY'S LITTLE STEPS</span><h2>今天，和它们见个面</h2><p>${learned.length ? "都是课上学过的内容哦" : "让爸爸妈妈选好内容，我们就可以出发啦"}</p></div><div class="today-items">${todayList.length ? todayList.map((it,i) => `<button class="today-item" data-review="${escapeHtml(it.id)}" data-type="${escapeHtml(it.type)}"><span class="step-number">0${i+1}</span><span><strong>${escapeHtml(it.title)}</strong><small>${typeLabel(it.type)} · ${due.length ? "再想一想" : "熟悉的老朋友"}</small></span><span class="step-go">→</span></button>`).join("") : `<button class="empty-setup" id="home-setup"><span aria-hidden="true">＋</span><strong>选好课上学过的内容</strong><small>请爸爸妈妈帮忙，第一次设置就好</small></button>`}</div></section>`;
    document.getElementById("start-review").onclick = startReview;
    document.getElementById("home-guide").onclick = () => speakGuide("点开始复习，和小兔一起，把课上学过的再想一想。一次一点点，慢慢来。");
    document.getElementById("home-setup")?.addEventListener("click", openParent);
    el.querySelectorAll("[data-go]").forEach(btn => btn.onclick = () => navigate(btn.dataset.go));
    el.querySelectorAll("[data-review]").forEach(btn => btn.onclick = () => { reviewSession = {items:[getItem(btn.dataset.review)],index:0}; openReviewItem(btn.dataset.review,btn.dataset.type); });
  }

  async function openParent() {
    await ensurePoems().catch(() => {});
    const dialog = document.getElementById("parent-dialog");
    const courses = [
      {id:"math-addsub-10", type:"math", title:"10以内加减法"},
      {id:"math-decomp-10", type:"decomp", title:"10以内分解组合"},
      {id:"pinyin-basic", type:"pinyin", title:"声母韵母认读"},
      {id:"write-basic", type:"write", title:"常用汉字描红"},
    ];
    const learned = allLearned();
    dialog.innerHTML = `<div class="dialog-heading"><div><p class="eyebrow">陪伴孩子，轻轻复习</p><h2 id="parent-title">家长的小帮手</h2></div><button class="close-btn" id="close-parent" aria-label="关闭家长入口">×</button></div><p class="parent-description">先选孩子课上已经学过的内容。首页会优先安排需要复习的内容，每次最多 3 个，不计时、不排名。</p><h3>1. 选择课上学过的古诗</h3><div class="parent-add"><select id="parent-poem" aria-label="选择学过的古诗"><option value="">请选择古诗…</option>${POEMS.map(p => `<option value="${p.id}">${escapeHtml(p.title)} · ${escapeHtml(p.author)}</option>`).join("")}</select><button class="btn btn-primary" id="add-class-poem">加入</button></div><h3>2. 选择已经学过的小本领</h3><div class="parent-courses">${courses.map(c=>`<button class="parent-course ${getItem(c.id)?.learned ? "selected" : ""}" data-course="${c.id}" aria-pressed="${!!getItem(c.id)?.learned}"><span>${escapeHtml(c.title)}</span><span>${getItem(c.id)?.learned ? "✓ 已选" : "+ 添加"}</span></button>`).join("")}</div><h3>正在复习的内容 <span class="muted">${learned.length}</span></h3><div class="parent-enrolled">${learned.length ? learned.map(it => `<div><span>${escapeHtml(it.title)}<small>下次 ${escapeHtml(it.nextReview || todayStr())}</small></span><button class="text-btn" data-remove="${escapeHtml(it.id)}" aria-label="暂停复习 ${escapeHtml(it.title)}">暂停</button></div>`).join("") : `<p class="muted">还没有添加。选一两项就可以开始，不用一次选很多。</p>`}</div><p class="parent-tip">陪练建议：古诗先回想再听示范；拼音请家长示范发音；写字以纸笔为主，屏幕描红用来熟悉字形。</p>${syncPanelHtml()}<button class="btn btn-primary parent-done" id="parent-done">选好啦，回小花园</button>`;
    if (!dialog.open) dialog.showModal();
    const close = () => {dialog.close(); if(currentView === "home" && !showingCelebration) renderHome();};
    document.getElementById("close-parent").onclick = close;
    document.getElementById("parent-done").onclick = () => { dialog.close(); navigate("home"); };
    document.getElementById("add-class-poem").onclick = () => {
      const poem = POEMS.find(p=>p.id===document.getElementById("parent-poem").value);
      if(!poem) {toast("先选择一首古诗"); return;}
      if (!getItem(poem.id)?.learned) markLearned(poem.id,{type:"poem",title:poem.title});
      openParent();
      toast("已加入课后复习");
    };
    dialog.querySelectorAll("[data-course]").forEach(btn=>btn.onclick=()=>{
      const c=courses.find(it=>it.id===btn.dataset.course);
      if(getItem(c.id)?.learned) upsertItem(c.id,{learned:false});
      else markLearned(c.id,c);
      openParent();
    });
    dialog.querySelectorAll("[data-remove]").forEach(btn=>btn.onclick=()=>{upsertItem(btn.dataset.remove,{learned:false});openParent();});
    bindSyncPanel(dialog);
  }

  function openReviewItem(id, type) {
    if (type === "poem") {
      selectedPoemId = id;
      showView("poem-detail");
      renderPoemDetail(id);
    } else if (type === "math" || type === "decomp") {
      showView("math");
      renderMath(type === "decomp" ? "decomp" : "addsub");
    } else if (type === "pinyin") {
      showView("pinyin");
      pyPracticed = new Set();
      renderPinyin();
    } else if (type === "write") {
      showView("write");
      renderWrite();
    }
  }

  function formatDateCN(iso) {
    const [y, m, d] = iso.split("-");
    return `${y}年${Number(m)}月${Number(d)}日`;
  }

  // ---------- Poems ----------
  function poemStatus(id) {
    const it = getItem(id);
    if (!it || !it.learned) return { label: "还没加入", cls: "" };
    const today = todayStr();
    if (it.nextReview && it.nextReview <= today)
      return { label: "再想一想", cls: "due" };
    return { label: "课上学过", cls: "learned" };
  }

  async function renderPoems() {
    const el = document.getElementById("poems-content");
    if (!POEMS.length) {
      el.innerHTML = '<div class="card"><div class="empty">小兔正在拿诗卡…</div></div>';
      try { await ensurePoems(); } catch (_) {
        el.innerHTML = '<div class="card"><div class="empty">诗卡暂时没有打开，请刷新再试一次</div></div>';
        return;
      }
    }
    let list = POEMS.slice();
    if (poemQuery) {
      const q = poemQuery.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.title.includes(q) ||
          p.author.includes(q) ||
          p.dynasty.includes(q) ||
          p.lines.some((l) => l.text.includes(q))
      );
    }
    if (poemFilter === "learned") {
      list = list.filter((p) => getItem(p.id)?.learned);
    } else if (poemFilter === "due") {
      const today = todayStr();
      list = list.filter((p) => {
        const it = getItem(p.id);
        return it?.learned && it.nextReview <= today;
      });
    } else if (poemFilter === "new") {
      list = list.filter((p) => !getItem(p.id)?.learned);
    }

    el.innerHTML = `
      <div class="card">
        <h2>读古诗 <span class="heading-flower">✿</span></h2>
        <p style="color:var(--muted);font-size:0.9rem;margin-bottom:10px">先自己想一想，再听一听。会一点点也很棒！</p>
        <div class="toolbar">
          <input type="search" id="poem-search" placeholder="搜索题目 / 作者 / 诗句…" value="${escapeHtml(
            poemQuery
          )}" />
          <div class="filter-btns">
            <button data-f="all" class="${poemFilter === "all" ? "active" : ""}">全部诗卡</button>
            <button data-f="new" class="${poemFilter === "new" ? "active" : ""}">还没学过</button>
            <button data-f="learned" class="${poemFilter === "learned" ? "active" : ""}">课上学过</button>
            <button data-f="due" class="${poemFilter === "due" ? "active" : ""}">再想一想</button>
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
                      <div class="ptitle">${escapeHtml(display)}${
                      p.subtitle ? `<span style="font-size:0.7em;color:var(--muted)"> · ${p.subtitle}</span>` : ""
                    }</div>
                      <div class="pmeta">${escapeHtml(p.dynasty)} · ${escapeHtml(
                      p.author
                    )}</div>
                      <div class="status"><span class="chip ${st.cls}">${st.label}</span></div>
                    </button>`;
                  })
                  .join("")
              : `<div class="empty" style="grid-column:1/-1">这里还没有诗卡。请家长添加课上学过的古诗，或点「全部诗卡」看看。</div>`
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
      c.addEventListener("click", () => {
        selectedPoemId = c.dataset.id;
        showView("poem-detail");
        renderPoemDetail(c.dataset.id);
      })
    );
  }

  async function renderPoemDetail(id) {
    stopSpeechSafe();
    selectedPoemId = id;
    try { await ensurePoems(); } catch (_) {}
    const poem = POEMS.find((p) => p.id === id);
    const el = document.getElementById("poem-detail-content");
    if (!poem) {
      el.innerHTML = `<div class="card"><p>未找到古诗</p></div>`;
      return;
    }
    const displayTitle = poem.titleDisplay || poem.title;
    const titleChars = titleToChars(displayTitle, poem.titlePy);
    const dynastyChars = poem.dynastyPy.map((p, i) => ({
      c: [...poem.dynasty][i],
      p,
    }));
    const authorChars = poem.authorPy.map((p, i) => ({
      c: [...poem.author][i],
      p,
    }));

    const body = poem.lines
      .map((line) => `<div class="ruby-line">${rubyChars(line.chars)}</div>`)
      .join("");

    const it = getItem(id);
    const enrolled = !!it?.learned;
    const today = todayStr();
    const isDue = enrolled && it.nextReview <= today;

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
          <span class="dot-sep">·</span>
          ${rubyChars(authorChars)}
        </div>
        ${
          poem.note
            ? `<div class="poem-note">${escapeHtml(poem.note)}</div>`
            : ""
        }
        <div class="poem-body" id="poem-body">${body}</div>
        <div class="recall-tools"><button class="btn btn-ghost" id="hide-poem" aria-pressed="false">藏起汉字，试着背</button><button class="btn btn-ghost" id="hide-pinyin" aria-pressed="false">收起拼音</button></div>
        <div class="speak-bar" role="group" aria-label="朗读控制">
          <button type="button" class="btn btn-speak" id="btn-speak">🔊 朗读</button>
          <button type="button" class="btn btn-speak-secondary" id="btn-speak-pause" disabled>⏸️ 暂停</button>
          <button type="button" class="btn btn-speak-secondary" id="btn-speak-stop" disabled>⏹️ 停止</button>
        </div>
        <div class="actions-bar">
          ${
            !enrolled
              ? `<div class="hint">这首诗课上学过吗？请爸爸妈妈帮忙选进复习。</div>
                 <div class="btn-row" style="justify-content:center">
                   <button class="btn btn-learn" id="btn-enroll">＋ 课上学过，加入复习</button>
                 </div>`
              : `<div class="hint">试着背一背，再告诉小兔吧</div>
                 <div class="btn-row" style="justify-content:center">
                   <button class="btn btn-ok" data-r="remember">😊 我记得</button>
                   <button class="btn btn-fuzzy" data-r="fuzzy">🌱 提醒一下</button>
                   <button class="btn btn-forget" data-r="forgot">🐰 一起再读</button>
                 </div>`
          }
        </div>
      </div>`;

    document.getElementById("back-poems").onclick = () => navigate("poems");
    const enroll = document.getElementById("btn-enroll");
    if (enroll) {
      enroll.onclick = () => {
        markLearned(id, {
          type: "poem",
          title: displayTitle + (poem.subtitle ? "·" + poem.subtitle : ""),
        });
        renderPoemDetail(id);
        toast("已加入复习计划！可在下方打卡，或回首页「今日复习」");
      };
    }
    el.querySelectorAll("[data-r]").forEach((b) => {
      b.onclick = () => {
        const r = b.dataset.r;
        if (completePractice(id, r, {
          type: "poem", title: displayTitle + (poem.subtitle ? "·" + poem.subtitle : ""),
        })) return;
        const msg =
          r === "remember"
            ? "你把它想起来啦！送你一朵小花。"
            : r === "fuzzy"
            ? "有一点提示也很棒，我们下次再读。"
            : "没关系，一起读一遍，明天再见。";
        toast(msg);
        renderPoemDetail(id);
      };
    });

    bindSessionExit();
    document.getElementById("hide-poem").onclick = (event) => {
      const hidden = document.getElementById("poem-body").classList.toggle("hide-characters");
      event.currentTarget.textContent = hidden ? "打开汉字，看一看" : "藏起汉字，试着背";
      event.currentTarget.setAttribute("aria-pressed", String(hidden));
    };
    document.getElementById("hide-pinyin").onclick = (event) => {
      const hidden = document.getElementById("poem-body").classList.toggle("hide-pinyin");
      event.currentTarget.textContent = hidden ? "打开拼音" : "收起拼音";
      event.currentTarget.setAttribute("aria-pressed", String(hidden));
    };
    const btnSpeak = document.getElementById("btn-speak");
    const btnPause = document.getElementById("btn-speak-pause");
    const btnStop = document.getElementById("btn-speak-stop");
    updateSpeakButtons("idle");
    if (btnSpeak) {
      btnSpeak.onclick = () => {
        if (!window.ChenchenSpeech || !ChenchenSpeech.supported()) {
          toast("暂时没有声音，可以看着文字和爸爸妈妈一起读。");
          return;
        }
        const st = ChenchenSpeech.getStatus();
        if (st === "speaking" || st === "paused") {
          ChenchenSpeech.stop();
        }
        const ok = ChenchenSpeech.speakPoem(
          {
            title: displayTitle,
            dynasty: poem.dynasty,
            author: poem.author,
            lines: poem.lines.map((ln) => ln.text),
          },
          {
            onState: updateSpeakButtons,
            onError: () => toast("暂时没有声音，可以看着文字和爸爸妈妈一起读。"),
            onUnsupported: () =>
              toast("暂时没有声音，可以看着文字和爸爸妈妈一起读。"),
          }
        );
        if (ok) updateSpeakButtons("speaking");
      };
    }
    if (btnPause) {
      btnPause.onclick = () => {
        if (!window.ChenchenSpeech) return;
        if (ChenchenSpeech.getStatus() === "paused") {
          ChenchenSpeech.resume();
          updateSpeakButtons("speaking");
        } else {
          ChenchenSpeech.pause();
          updateSpeakButtons("paused");
        }
      };
    }
    if (btnStop) {
      btnStop.onclick = () => {
        stopSpeechSafe();
        updateSpeakButtons("idle");
      };
    }

  }

  // ---------- Math ----------
  let mathMode = "addsub";
  let mathScore = { ok: 0, total: 0 };
  let currentQ = null;

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

  function nbCellHtml(item, slot) {
    const isBlank = item.blanks[slot];
    const truth = item[slot === "whole" ? "n" : slot];
    const filled = item.answers[slot];
    const isActive = bondSheet && bondSheet.activeSlot === slot;
    if (!isBlank) {
      return `<span class="nb-num">${truth}</span>`;
    }
    const val = filled === null || filled === undefined ? "" : String(filled);
    let cls = "nb-box";
    if (isActive) cls += " is-active";
    if (item.status === "ok") cls += " is-ok";
    if (item.status === "bad") cls += " is-bad";
    return `<button type="button" class="${cls}" data-slot="${slot}" aria-label="填写">${val || "&nbsp;"}</button>`;
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
        renderBondPanel();
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
    const checkBtn = panel.querySelector("#nb-check");
    if (checkBtn) {
      checkBtn.onclick = () => checkBondSheet();
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
    if (!item.attempted) mathScore.total++;
    item.attempted = true;
    if(good) {
      item.status = "ok";
      bondSheet.checked = true;
      bondSheet.activeSlot = null;
      mathScore.ok++;
      renderBondPanel();
      document.getElementById("math-fb").textContent = "你把数字朋友找到啦！✿";
      document.getElementById("math-fb").className = "feedback ok";
      finishMathQuestion();
    } else {
      item.status = "bad";
      bondSheet.activeSlot = need[0];
      renderBondPanel();
      document.getElementById("math-fb").textContent = "两边合起来，要和总数一样哦。点空格换个数字试试。";
      document.getElementById("math-fb").className = "feedback no";
    }
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
        <div class="nb-sheet-hint">${modeHint} · 点空格，再点数字</div>
      </div>
      <div class="nb-single-wrap">
        ${nbCardHtml(item, bondSheet.qIndex)}
      </div>
      <div class="nb-pad" id="nb-pad">
        ${pad}
        <button type="button" class="nb-pad-clear" id="nb-clear">清除</button>
      </div>
      <div class="nb-actions">
        <button type="button" class="btn btn-learn" id="nb-check"${bondSheet.checked ? " disabled" : ""}>我填好啦</button>
      </div>
      <div class="feedback" id="math-fb"></div>`;
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
    if (forceMode) mathMode = forceMode;
    mathScore = { ok: 0, total: 0 };
    mathCompleted = 0;
    bondQIndex = 0;
    const el = document.getElementById("math-content");
    el.innerHTML = `${sessionBanner()}<div class="card practice-card"><div class="practice-heading"><div><p class="eyebrow">数一数，想一想</p><h2>玩数学 <span class="heading-flower">＋</span></h2></div><span class="practice-count" id="math-progress">0 / 3 题</span></div>
      ${reviewSession ? "" : `<div class="tabs-mini"><button data-m="addsub" class="${mathMode === "addsub" ? "active" : ""}">10以内加减法</button><button data-m="decomp" class="${mathMode === "decomp" ? "active" : ""}">分解组合</button></div>`}
      <p class="practice-instruction">做 3 道小题就休息。答错也没关系，我们一起想。</p><div class="math-panel" id="math-panel"></div>
      <div class="btn-row practice-controls"><button class="btn btn-ghost" id="math-read">◖)) 听题目</button><button class="btn btn-primary" id="math-next" disabled>下一题 →</button></div><div id="math-review-bar"></div></div>`;
    el.querySelectorAll("[data-m]").forEach(btn=>btn.onclick=()=>renderMath(btn.dataset.m));
    document.getElementById("math-next").onclick = () => {
      if (mathCompleted >= 3) renderMathFinish();
      else nextMathQ();
    };
    document.getElementById("math-read").onclick = () => {
      if (mathMode === "decomp") {
        const it = bondSheet.item;
        speakGuide(it.mode === "decomp" ? `把 ${it.n} 分成两部分，点空格，再点数字。` : "两部分合起来是多少？点空格，再点数字。");
      } else speakGuide(`${currentQ.meta.a} ${currentQ.meta.op === "+" ? "加" : "减"} ${currentQ.meta.b} 等于几？点一点击答案。`);
    };
    nextMathQ();
    bindSessionExit();
  }

  function finishMathQuestion() {
    mathCompleted++;
    const progress = document.getElementById("math-progress");
    if(progress) progress.textContent = `${mathCompleted} / 3 题`;
    const next = document.getElementById("math-next");
    if(next) { next.disabled = false; next.textContent = mathCompleted >= 3 ? "完成啦 ✿" : "下一题 →"; }
  }

  function renderMathFinish() {
    const id = mathMode === "decomp" ? "math-decomp-10" : "math-addsub-10";
    const meta = {type:mathMode === "decomp" ? "decomp" : "math", title:mathMode === "decomp" ? "10以内分解组合" : "10以内加减法"};
    const panel = document.getElementById("math-panel");
    panel.innerHTML = `<div class="mini-success"><span aria-hidden="true">✿</span><h3>认真想了 3 道题，真棒！</h3><p>今天的小数字，下次再来见面。</p><button class="btn btn-primary" id="finish-math">${reviewSession ? "收下小花，继续 →" : "收下小花，休息一下"}</button></div>`;
    document.querySelector("#math-content .practice-controls").hidden = true;
    document.getElementById("finish-math").onclick = () => {
      const advanced = completePractice(id, mathScore.ok >= 3 ? "remember" : "fuzzy", meta);
      if (!advanced) navigate("home");
    };
  }

  function nextMathQ() {
    const next = document.getElementById("math-next");
    if (next) next.disabled = true;
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
      <div class="feedback" id="math-fb"></div>`;

    panel.querySelectorAll(".math-opts button").forEach((btn) => {
      btn.onclick = () => {
        if (btn.disabled) return;
        const v = Number(btn.dataset.v);
        mathScore.total++;
        const fb = document.getElementById("math-fb");
        panel.querySelectorAll(".math-opts button").forEach((b) => {
          b.disabled = true;
          if (Number(b.dataset.v) === currentQ.answer) b.classList.add("correct");
        });
        if (v === currentQ.answer) {
          mathScore.ok++;
          btn.classList.add("correct");
          fb.textContent = "答对啦！真棒 ⭐";
          fb.className = "feedback ok";
        } else {
          btn.classList.add("wrong");
          fb.textContent = `我们一起数一数，答案是 ${currentQ.answer}。下次再试试！`;
          fb.className = "feedback no";
        }
        finishMathQuestion();
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
  // Example syllables use the actual spelling of the familiar word, not a
  // synthetic pronunciation of an isolated initial or compound final.
  const PY_SAMPLES = {
    b: "bā · 八", p: "pá · 爬", m: "mā · 妈妈", f: "fēi · 飞机",
    d: "dà · 大象", t: "tài · 太阳", n: "niú · 小牛", l: "lǎo · 老虎",
    g: "gē · 鸽子", k: "kē · 一颗星", h: "huā · 花朵",
    j: "jī · 小鸡", q: "qì · 气球", x: "xī · 西瓜",
    zh: "zhī · 蜘蛛", ch: "chī · 吃饭", sh: "shū · 书本", r: "rì · 日出",
    z: "zì · 写字", c: "cǎo · 小草", s: "sān · 三", y: "yā · 鸭子", w: "wū · 乌龟",
    a: "ā · 啊", o: "ō · 喔", e: "é · 鹅", i: "yī · 衣服", u: "wū · 乌龟", ü: "yú · 小鱼",
    ai: "ài · 爱", ei: "fēi · 飞机", ui: "shuǐ · 水", ao: "māo · 小猫", ou: "kǒu · 口",
    iu: "qiú · 皮球", ie: "yè · 叶子", üe: "yuè · 月亮", er: "ěr · 耳朵",
    an: "ān · 安静", en: "mén · 门", in: "pīn · 拼音", un: "chūn · 春天",
    ün: "yún · 白云", ang: "yáng · 小羊", eng: "fēng · 风", ing: "xīng · 星星", ong: "hóng · 红色",
  };

  let pyTab = "initials";

  function renderPinyin() {
    const el = document.getElementById("pinyin-content");
    const list = pyTab === "initials" ? INITIALS : FINALS;
    if (!list.includes(pySelected)) pySelected = list[0];
    el.innerHTML = `${sessionBanner()}<div class="card practice-card"><div class="practice-heading"><div><p class="eyebrow">张开小嘴，读一读</p><h2>拼音小卡片 <span class="heading-flower">a</span></h2></div><span class="practice-count">读 3 张就休息</span></div><div class="tabs-mini"><button data-pt="initials" class="${pyTab === "initials" ? "active" : ""}">声母</button><button data-pt="finals" class="${pyTab === "finals" ? "active" : ""}">韵母</button></div><div class="pinyin-sample" id="py-sample"><span class="big-letter">${escapeHtml(pySelected)}</span><p>${escapeHtml(PY_SAMPLES[pySelected] || "")}</p><button class="btn btn-ghost" id="py-listen">◖)) 听例词</button><button class="btn btn-primary" id="py-read">我读过啦 ✓</button><small>拼音请跟着家长读，例词帮你记一记。</small></div><p class="practice-instruction">点一张卡片，自己读给爸爸妈妈听。</p><div class="pinyin-grid">${list.map(p=>`<button class="pinyin-chip ${p === pySelected ? "active" : ""} ${pyPracticed.has(p) ? "practiced" : ""}" data-p="${p}" aria-pressed="${p === pySelected}">${p}${pyPracticed.has(p) ? '<span aria-label="已读过">✓</span>' : ""}</button>`).join("")}</div><div class="recall-footer"><span>已读过 ${pyPracticed.size} 张小卡片</span><button class="btn btn-learn" id="py-finish" ${pyPracticed.size ? "" : "disabled"}>${reviewSession ? "读好啦，继续 →" : "读好啦，收下小花"}</button></div></div>`;
    el.querySelectorAll("[data-pt]").forEach(btn=>btn.onclick=()=>{pyTab=btn.dataset.pt;renderPinyin();});
    el.querySelectorAll("[data-p]").forEach(btn=>btn.onclick=()=>{pySelected=btn.dataset.p;renderPinyin();});
    document.getElementById("py-listen").onclick = () => speakGuide((PY_SAMPLES[pySelected] || "").split("·").pop().trim());
    document.getElementById("py-read").onclick = () => {
      pyPracticed.add(pySelected);
      if (pyPracticed.size < 3) pySelected = list.find(p=>!pyPracticed.has(p)) || pySelected;
      renderPinyin();
      toast(pyPracticed.size >= 3 ? "读了 3 张卡片啦，收下小花休息吧！" : "读得很认真！试试下一张。");
    };
    document.getElementById("py-finish").onclick = () => {
      if(!pyPracticed.size) return;
      if(!completePractice("pinyin-basic","remember",{type:"pinyin",title:"声母韵母认读"})) navigate("home");
    };
    bindSessionExit();
  }

  // ---------- Writing ----------
  const WRITE_CHARS = [
    { c: "人", strokes: "2画 · 撇、捺", tip: "撇捺舒展，像人在走路" },
    { c: "大", strokes: "3画 · 横、撇、捺", tip: "横要平，撇捺对称" },
    { c: "小", strokes: "3画 · 竖钩、撇、点", tip: "中间竖钩居中" },
    { c: "口", strokes: "3画 · 竖、横折、横", tip: "方口略扁，下横封口" },
    { c: "日", strokes: "4画 · 竖、横折、横、横", tip: "比「口」瘦长，中间一横" },
    { c: "月", strokes: "4画 · 撇、横折钩、横、横", tip: "外面像月牙" },
    { c: "水", strokes: "4画 · 竖钩、横撇、撇、捺", tip: "中间竖钩为主笔" },
    { c: "火", strokes: "4画 · 点、撇、撇、捺", tip: "两点像火苗" },
    { c: "山", strokes: "3画 · 竖、竖折、竖", tip: "中间最高" },
    { c: "石", strokes: "5画 · 横、撇、竖、横折、横", tip: "上面「厂」，下面「口」" },
    { c: "田", strokes: "5画 · 竖、横折、横、竖、横", tip: "中间十字" },
    { c: "木", strokes: "4画 · 横、竖、撇、捺", tip: "竖在横中间" },
  ];
  let writeIdx = 0;

  function renderWrite() {
    const el = document.getElementById("write-content");
    const ch = WRITE_CHARS[writeIdx];
    el.innerHTML = `${sessionBanner()}<div class="card practice-card"><div class="practice-heading"><div><p class="eyebrow">小手动一动</p><h2>汉字描一描 <span class="heading-flower">✎</span></h2></div><span class="practice-count">描 1 个字就好</span></div><p class="practice-instruction">沿着浅浅的字，用手指或鼠标描一描。</p><div class="tianzige"><div class="char">${ch.c}</div><canvas id="write-canvas" width="600" height="600" aria-label="${ch.c} 字描红画布"></canvas></div><div class="stroke-hint"><b>${ch.c}</b>　${escapeHtml(ch.strokes)}<br>${escapeHtml(ch.tip)}</div><div class="btn-row practice-controls"><button class="btn btn-ghost" id="write-clear">↶ 重新描</button><button class="btn btn-ghost" id="write-listen">◖)) 听一听</button><button class="btn btn-primary" id="write-finish" disabled>描好啦 ✿</button></div><div class="write-list">${WRITE_CHARS.map((w,i)=>`<button class="${i === writeIdx ? "active" : ""}" data-i="${i}" aria-pressed="${i === writeIdx}">${w.c}</button>`).join("")}</div><p class="paper-note">也可以拿出纸和笔，照着写一遍。<button class="text-btn" id="write-paper">我在纸上写好啦 ✓</button></p></div>`;
    el.querySelectorAll("[data-i]").forEach(btn=>btn.onclick=()=>{writeIdx=Number(btn.dataset.i);renderWrite();});
    const canvas = document.getElementById("write-canvas");
    const ctx = canvas.getContext("2d");
    ctx.strokeStyle = "#668753"; ctx.lineWidth = 14; ctx.lineCap = "round"; ctx.lineJoin = "round";
    let drawing = false;
    let moved = false;
    const position = event => { const r=canvas.getBoundingClientRect(); return [(event.clientX-r.left)*600/r.width,(event.clientY-r.top)*600/r.height]; };
    canvas.onpointerdown = event => { event.preventDefault(); drawing=true; canvas.setPointerCapture(event.pointerId); ctx.beginPath(); ctx.moveTo(...position(event)); };
    canvas.onpointermove = event => { if(!drawing)return; event.preventDefault();ctx.lineTo(...position(event));ctx.stroke();moved=true;document.getElementById("write-finish").disabled=false; };
    canvas.onpointerup = canvas.onpointercancel = () => { drawing=false; };
    document.getElementById("write-clear").onclick = () => {ctx.clearRect(0,0,600,600);moved=false;document.getElementById("write-finish").disabled=true;};
    document.getElementById("write-listen").onclick = () => speakGuide(`${ch.c}。${ch.strokes}。${ch.tip}。`);
    const finish = () => {if(!completePractice("write-basic","remember",{type:"write",title:"常用汉字描红"})) navigate("home");};
    document.getElementById("write-finish").onclick = () => {if(moved) finish();};
    document.getElementById("write-paper").onclick = finish;
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
    showingCelebration = false;
    reviewSession = null;
    showView(v);
    if (v === "home") renderHome();
    if (v === "poems") renderPoems();
    if (v === "math") renderMath();
    if (v === "pinyin") {pyPracticed = new Set();renderPinyin();}
    if (v === "write") renderWrite();
  }
  function bindNav() {
    document.querySelectorAll(".nav button").forEach(btn=>btn.onclick=()=>navigate(btn.dataset.nav));
    document.getElementById("brand-home").onclick = event => {event.preventDefault();navigate("home");};
    document.getElementById("open-parent").onclick = openParent;
    document.getElementById("parent-dialog").addEventListener("click",event=>{if(event.target===event.currentTarget){event.currentTarget.close();if(currentView==="home" && !showingCelebration)renderHome();}});
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindNav();
    showView("home");
    ensurePoems()
      .catch(() => {})
      .finally(() => {
        renderHome();
      });
    setSyncStatus("启动中，正在同步…", "busy");
    syncNow("full").catch(() => {});
  });
})();
