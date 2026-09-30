/* 辰辰幼小衔接 — 应用逻辑 */
(function () {
  "use strict";

  const STORAGE_KEY = "chenchen-learning-v1";
  const INTERVALS = [1, 2, 4, 7, 15, 30]; // days
  // Cloudflare Worker API（部署后填入；空字符串则仅本地）
  const API_BASE = "https://chenchen-learning-api.pljhonglu.workers.dev";
  const SYNC_CODE_KEY = "chenchen-sync-code";
  const SYNC_META_KEY = "chenchen-sync-meta";
  const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I/L/O/0/1

  // ---------- Storage / SM-2 simplified ----------
  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { items: {} };
    } catch {
      return { items: {} };
    }
  }
  function saveState(state) {
    if (!state.updatedAt) state.updatedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    scheduleCloudPush();
  }

  // ---------- Cloud sync (D1 via Worker) ----------
  let syncStatus = { text: "未开启云同步", kind: "muted" };
  let pushTimer = null;
  let syncBusy = false;

  function getSyncCode() {
    return (localStorage.getItem(SYNC_CODE_KEY) || "").trim().toUpperCase();
  }
  function setSyncCode(code) {
    const c = String(code || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-HJ-NP-Z2-9]/g, "");
    if (c) localStorage.setItem(SYNC_CODE_KEY, c);
    else localStorage.removeItem(SYNC_CODE_KEY);
    return c;
  }
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
  function generateSyncCode(len) {
    const n = len || 8;
    const buf = new Uint8Array(n);
    crypto.getRandomValues(buf);
    let out = "";
    for (let i = 0; i < n; i++) out += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
    return out;
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
      items,
      updatedAt: Math.max(localAt, remoteAt, Date.now()),
    };
  }
  async function cloudFetch(path, opts) {
    if (!API_BASE) throw new Error("API_BASE 未配置");
    const res = await fetch(API_BASE + path, {
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
    const code = getSyncCode();
    if (!code || !API_BASE) return null;
    setSyncStatus("正在从云端拉取…", "busy");
    const data = await cloudFetch(
      "/api/progress?code=" + encodeURIComponent(code),
      { method: "GET" }
    );
    if (!data.found || !data.payload) {
      setSyncStatus("云端暂无数据，下次上传会创建", "ok");
      setSyncMeta({ lastPullAt: Date.now(), serverUpdatedAt: null });
      return null;
    }
    const local = loadState();
    const merged = mergeProgressPayloads(local, data.payload);
    // Avoid recursive push during pull apply
    const prevTimer = pushTimer;
    pushTimer = null;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    pushTimer = prevTimer;
    setSyncMeta({
      lastPullAt: Date.now(),
      serverUpdatedAt: data.updatedAt,
    });
    setSyncStatus("已与云端合并 · " + new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }), "ok");
    return merged;
  }
  async function pushToCloud() {
    const code = getSyncCode();
    if (!code || !API_BASE) return null;
    const state = loadState();
    const clientUpdatedAt = Number(state.updatedAt) || Date.now();
    setSyncStatus("正在上传到云端…", "busy");
    const data = await cloudFetch("/api/progress", {
      method: "PUT",
      body: JSON.stringify({
        code,
        payload: state,
        clientUpdatedAt,
      }),
    });
    if (data.payload && data.kept === "server") {
      // Server won LWW — adopt server
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data.payload));
    } else if (data.payload) {
      // Keep local but bump meta
      const s = loadState();
      s.updatedAt = data.updatedAt || s.updatedAt;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    }
    setSyncMeta({
      lastPushAt: Date.now(),
      serverUpdatedAt: data.updatedAt,
    });
    setSyncStatus(
      (data.kept === "server" ? "云端较新，已采用云端 · " : "已同步到云端 · ") +
        new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
      "ok"
    );
    return data;
  }
  function scheduleCloudPush() {
    if (!getSyncCode() || !API_BASE) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      syncNow("push").catch(() => {});
    }, 900);
  }
  async function syncNow(mode) {
    if (syncBusy) return;
    const code = getSyncCode();
    if (!code) {
      setSyncStatus("请先生成或输入同步码", "warn");
      return;
    }
    if (!API_BASE) {
      setSyncStatus("未配置云端 API", "warn");
      return;
    }
    syncBusy = true;
    try {
      if (mode === "push") {
        await pushToCloud();
      } else {
        await pullAndMerge();
        await pushToCloud();
      }
      // Refresh home if visible so counts update
      if (currentView === "home") renderHome();
    } catch (e) {
      console.warn("sync failed", e);
      setSyncStatus("同步失败：" + (e.message || "网络错误"), "err");
    } finally {
      syncBusy = false;
    }
  }
  function syncPanelHtml() {
    const code = getSyncCode();
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
        <h2>☁️ 云同步</h2>
        <p class="sync-desc">同一同步码可在手机/平板/电脑间共享复习进度（离线仍用本机缓存）。</p>
        <div class="sync-code-row">
          <label for="sync-code-input">同步码</label>
          <input id="sync-code-input" class="sync-input" type="text" maxlength="8"
            placeholder="6–8 位" value="${escapeHtml(code)}" autocomplete="off" spellcheck="false" />
        </div>
        <div class="btn-row sync-actions">
          <button type="button" class="btn btn-ghost" id="sync-gen">生成新码</button>
          <button type="button" class="btn btn-primary" id="sync-save">保存并同步</button>
          <button type="button" class="btn btn-learn" id="sync-now">立即同步</button>
        </div>
        <div class="sync-status" id="sync-status" data-kind="${escapeHtml(syncStatus.kind)}">${escapeHtml(syncStatus.text)}</div>
        <div class="sync-meta">上次：${escapeHtml(last)}${API_BASE ? "" : " · API 未配置"}</div>
      </div>`;
  }
  function bindSyncPanel(root) {
    const card = (root || document).querySelector("#sync-card");
    if (!card) return;
    const input = card.querySelector("#sync-code-input");
    card.querySelector("#sync-gen").onclick = () => {
      const code = generateSyncCode(8);
      input.value = code;
      setSyncCode(code);
      setSyncStatus("已生成新同步码，请点「保存并同步」并抄到其他设备", "ok");
      toast("新同步码：" + code);
    };
    card.querySelector("#sync-save").onclick = async () => {
      const code = setSyncCode(input.value);
      if (!code || code.length < 6) {
        setSyncStatus("同步码需 6–8 位易读字符", "warn");
        return;
      }
      input.value = code;
      toast("同步码已保存");
      await syncNow("full");
    };
    card.querySelector("#sync-now").onclick = () => syncNow("full");
  }

  function todayStr() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }
  function addDays(dateStr, days) {
    const d = new Date(dateStr + "T12:00:00");
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
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
    let stage = cur.stage || 0;
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
      nextReview: addDays(todayStr(), days),
      learned: true,
    });
  }

  function markLearned(id, meta) {
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
  let poemFilter = "all";
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

  function renderHome() {
    const due = dueItems();
    const learned = allLearned();
    const el = document.getElementById("home-content");
    const stats = `
      <div class="card">
        <h2>👋 你好，<span class="badge-name">辰辰</span></h2>
        <p style="color:var(--muted);margin-top:4px">今天是 ${formatDateCN(
          todayStr()
        )}，一起复习吧！</p>
        <div class="score-bar" style="margin-top:14px;justify-content:flex-start;gap:20px">
          <span>📚 已学 <b>${learned.length}</b></span>
          <span>🔔 今日待复习 <b>${due.length}</b></span>
          <span>📜 古诗 <b>${POEMS.length}</b> 首</span>
        </div>
      </div>`;

    if (due.length === 0) {
      el.innerHTML =
        stats +
        `<div class="card"><div class="empty"><span class="big">🌟</span>今天没有待复习的内容啦！<br>去「古诗馆」学习新诗，或做几道数学题吧～</div>
        <div class="btn-row" style="justify-content:center">
          <button class="btn btn-primary" data-go="poems">去古诗馆</button>
          <button class="btn btn-ghost" data-go="math">做数学</button>
        </div></div>`;
      el.innerHTML += syncPanelHtml();
      el.querySelectorAll("[data-go]").forEach((b) =>
        b.addEventListener("click", () => {
          if (b.dataset.go === "poems") {
            showView("poems");
            renderPoems();
          } else {
            showView("math");
            renderMath();
          }
        })
      );
      bindSyncPanel(el);
      return;
    }

    const list = due
      .map((it) => {
        return `<div class="review-item" data-id="${escapeHtml(it.id)}" data-type="${escapeHtml(
          it.type
        )}">
          <div class="icon">${typeIcon(it.type)}</div>
          <div class="meta">
            <div class="title">${escapeHtml(it.title)}</div>
            <div class="desc">${typeLabel(it.type)} · 间隔第 ${
          (it.stage || 0) + 1
        } 档（${INTERVALS[it.stage || 0]}天）</div>
          </div>
          <span class="chip due">待复习</span>
        </div>`;
      })
      .join("");

    el.innerHTML =
      stats +
      `<div class="card"><h2>今日复习</h2>${list}
      <p style="font-size:0.8rem;color:var(--muted);margin-top:10px">点开项目后，可用「记得 / 模糊 / 忘了」更新下次复习时间。</p></div>` +
      syncPanelHtml();

    el.querySelectorAll(".review-item").forEach((row) => {
      row.addEventListener("click", () => openReviewItem(row.dataset.id, row.dataset.type));
    });
    bindSyncPanel(el);
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
    if (!it || !it.learned) return { label: "未学", cls: "" };
    const today = todayStr();
    if (it.nextReview && it.nextReview <= today)
      return { label: "待复习", cls: "due" };
    return { label: "已学会", cls: "learned" };
  }

  function renderPoems() {
    const el = document.getElementById("poems-content");
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
        <h2>📜 古诗馆</h2>
        <p style="color:var(--muted);font-size:0.9rem;margin-bottom:10px">共 ${POEMS.length} 首 · 点击查看大字拼音</p>
        <div class="toolbar">
          <input type="search" id="poem-search" placeholder="搜索题目 / 作者 / 诗句…" value="${escapeHtml(
            poemQuery
          )}" />
          <div class="filter-btns">
            <button data-f="all" class="${poemFilter === "all" ? "active" : ""}">全部</button>
            <button data-f="new" class="${poemFilter === "new" ? "active" : ""}">未学</button>
            <button data-f="learned" class="${poemFilter === "learned" ? "active" : ""}">已学</button>
            <button data-f="due" class="${poemFilter === "due" ? "active" : ""}">待复习</button>
          </div>
        </div>
        <div class="poem-grid">
          ${
            list.length
              ? list
                  .map((p) => {
                    const st = poemStatus(p.id);
                    const display = p.titleDisplay || p.title;
                    return `<div class="poem-card" data-id="${p.id}">
                      <div class="ptitle">${escapeHtml(display)}${
                      p.subtitle ? `<span style="font-size:0.7em;color:var(--muted)"> · ${p.subtitle}</span>` : ""
                    }</div>
                      <div class="pmeta">${escapeHtml(p.dynasty)} · ${escapeHtml(
                      p.author
                    )}</div>
                      <div class="status"><span class="chip ${st.cls}">${st.label}</span></div>
                    </div>`;
                  })
                  .join("")
              : `<div class="empty" style="grid-column:1/-1">没有找到相关古诗</div>`
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

  function renderPoemDetail(id) {
    stopSpeechSafe();
    selectedPoemId = id;
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
      <div class="poem-detail">
        <div class="watercolor"></div>
        <button class="back-btn" id="back-poems">← 返回古诗馆</button>
        <div class="ruby-line title-line">${rubyChars(titleChars)}${
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
        <div class="poem-body">${body}</div>
        <div class="speak-bar" role="group" aria-label="朗读控制">
          <button type="button" class="btn btn-speak" id="btn-speak">🔊 朗读</button>
          <button type="button" class="btn btn-speak-secondary" id="btn-speak-pause" disabled>⏸️ 暂停</button>
          <button type="button" class="btn btn-speak-secondary" id="btn-speak-stop" disabled>⏹️ 停止</button>
        </div>
        <div class="actions-bar">
          ${
            !enrolled
              ? `<div class="hint">学会了吗？加入复习计划，系统会按间隔提醒你。</div>
                 <div class="btn-row" style="justify-content:center">
                   <button class="btn btn-learn" id="btn-enroll">✅ 已学会，进入复习</button>
                 </div>`
              : `<div class="hint">下次复习：${formatDateCN(
                  it.nextReview
                )}${isDue ? "（今天该复习了）" : ""} · 当前间隔 ${
                  INTERVALS[it.stage || 0]
                } 天</div>
                 <div class="btn-row" style="justify-content:center">
                   <button class="btn btn-ok" data-r="remember">记得 😊</button>
                   <button class="btn btn-fuzzy" data-r="fuzzy">模糊 🤔</button>
                   <button class="btn btn-forget" data-r="forgot">忘了 😅</button>
                 </div>`
          }
        </div>
      </div>`;

    document.getElementById("back-poems").onclick = () => {
      showView("poems");
      renderPoems();
    };
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
        reviewResult(id, r, {
          type: "poem",
          title: displayTitle + (poem.subtitle ? "·" + poem.subtitle : ""),
        });
        const msg =
          r === "remember"
            ? "太棒了！下次间隔加长～"
            : r === "fuzzy"
            ? "没关系，过几天再见面"
            : "忘掉也正常，明天再复习一次";
        toast(msg);
        renderPoemDetail(id);
      };
    });

    const btnSpeak = document.getElementById("btn-speak");
    const btnPause = document.getElementById("btn-speak-pause");
    const btnStop = document.getElementById("btn-speak-stop");
    updateSpeakButtons("idle");
    if (btnSpeak) {
      btnSpeak.onclick = () => {
        if (!window.ChenchenSpeech || !ChenchenSpeech.supported()) {
          toast("当前浏览器没有可用的语音引擎，请换 Chrome / Edge / Safari 试试");
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
            onUnsupported: () =>
              toast("当前浏览器没有可用的语音引擎，请换 Chrome / Edge / Safari 试试"),
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
    if (!bondSheet) return;
    const item = bondSheet.item;
    const need = ["whole", "left", "right"].filter((s) => item.blanks[s]);
    const filled = need.every(
      (s) => item.answers[s] !== null && item.answers[s] !== undefined
    );
    if (!filled) {
      toast("先点空框，再用下方数字填写哦");
      bondSheet.activeSlot = firstBlankSlot(item);
      renderBondPanel();
      return;
    }
    const L = item.blanks.left ? Number(item.answers.left) : item.left;
    const R = item.blanks.right ? Number(item.answers.right) : item.right;
    const W = item.blanks.whole ? Number(item.answers.whole) : item.n;
    const good =
      Number.isFinite(L) &&
      Number.isFinite(R) &&
      Number.isFinite(W) &&
      L >= 0 &&
      R >= 0 &&
      W >= 0 &&
      W <= 10 &&
      L + R === W;

    bondSheet.activeSlot = null;
    mathScore.total += 1;
    const fb = document.getElementById("math-fb");
    if (good) {
      item.status = "ok";
      mathScore.ok += 1;
      bondSheet.checked = true;
      renderBondPanel();
      if (fb) {
        fb.textContent = "答对啦！真棒 ⭐ 点「下一题」继续";
        fb.className = "feedback ok";
      }
    } else {
      item.status = "bad";
      bondSheet.checked = false;
      renderBondPanel();
      if (fb) {
        fb.textContent = "再想想～空框已清空，再试一次";
        fb.className = "feedback no";
      }
      need.forEach((s) => {
        item.answers[s] = null;
      });
      item.status = "open";
      setTimeout(() => {
        bondSheet.activeSlot = firstBlankSlot(item);
        renderBondPanel();
        const fb2 = document.getElementById("math-fb");
        if (fb2) {
          fb2.textContent = "再试试吧";
          fb2.className = "feedback no";
        }
      }, 650);
    }
    const okEl = document.getElementById("math-ok");
    const totEl = document.getElementById("math-total");
    if (okEl) okEl.textContent = mathScore.ok;
    if (totEl) totEl.textContent = mathScore.total;
  }

  function renderBondPanel() {
    const panel = document.getElementById("math-panel");
    if (!panel || !bondSheet) return;
    const item = bondSheet.item;
    const pad = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
      .map((n) => `<button type="button" data-n="${n}">${n}</button>`)
      .join("");
    const modeHint = item.mode === "decomp" ? "倒 V（Λ）是分解：总数在上" : "V 是组成：合数在下";
    panel.innerHTML = `
      <div class="nb-sheet-head">
        <div class="nb-sheet-title">10以内 · 一题一练</div>
        <div class="nb-sheet-hint">点粉色空框，再点下方数字 · ${modeHint}</div>
      </div>
      <div class="nb-single-wrap">
        ${nbCardHtml(item, bondSheet.qIndex)}
      </div>
      <div class="nb-pad" id="nb-pad">
        ${pad}
        <button type="button" class="nb-pad-clear" id="nb-clear">清除</button>
      </div>
      <div class="nb-actions">
        <button type="button" class="btn btn-learn" id="nb-check"${bondSheet.checked ? " disabled" : ""}>检查答案</button>
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

  function renderMath(forceMode) {
    if (forceMode) mathMode = forceMode;
    const el = document.getElementById("math-content");
    const nextLabel = "下一题";
    el.innerHTML = `
      <div class="card">
        <h2>🔢 数学乐园</h2>
        <div class="tabs-mini">
          <button data-m="addsub" class="${mathMode === "addsub" ? "active" : ""}">10以内加减法</button>
          <button data-m="decomp" class="${mathMode === "decomp" ? "active" : ""}">分解组合</button>
        </div>
        <div class="math-panel" id="math-panel"></div>
        <div class="score-bar">
          <span>答对 <b id="math-ok">${mathScore.ok}</b></span>
          <span>共做 <b id="math-total">${mathScore.total}</b></span>
        </div>
        <div class="btn-row" style="justify-content:center;margin-top:16px">
          <button class="btn btn-ghost" id="math-next">${nextLabel}</button>
          <button class="btn btn-learn" id="math-enroll">加入复习队列</button>
        </div>
        <div id="math-review-bar"></div>
      </div>`;

    el.querySelectorAll("[data-m]").forEach((b) =>
      b.addEventListener("click", () => {
        mathMode = b.dataset.m;
        mathScore = { ok: 0, total: 0 };
        bondSheet = null;
        bondQIndex = 0;
        renderMath();
      })
    );
    document.getElementById("math-next").onclick = () => nextMathQ();
    document.getElementById("math-enroll").onclick = () => {
      const id =
        mathMode === "decomp" ? "math-decomp-10" : "math-addsub-10";
      const title =
        mathMode === "decomp" ? "10以内分解组合" : "10以内加减法";
      markLearned(id, { type: mathMode === "decomp" ? "decomp" : "math", title });
      toast("已加入今日复习队列");
      renderMathReviewBar();
    };
    nextMathQ();
    renderMathReviewBar();
  }

  function renderMathReviewBar() {
    const bar = document.getElementById("math-review-bar");
    if (!bar) return;
    const id = mathMode === "decomp" ? "math-decomp-10" : "math-addsub-10";
    const title = mathMode === "decomp" ? "10以内分解组合" : "10以内加减法";
    const type = mathMode === "decomp" ? "decomp" : "math";
    const it = getItem(id);
    if (!it?.learned) {
      bar.innerHTML = "";
      return;
    }
    const due = it.nextReview <= todayStr();
    bar.innerHTML = `
      <div class="actions-bar" style="position:static;margin-top:14px">
        <div class="hint">复习进度：下次 ${formatDateCN(it.nextReview)}${
          due ? "（今天该复习）" : ""
        } · 间隔 ${INTERVALS[it.stage || 0]} 天</div>
        <div class="btn-row" style="justify-content:center">
          <button class="btn btn-ok" data-r="remember">记得 😊</button>
          <button class="btn btn-fuzzy" data-r="fuzzy">模糊 🤔</button>
          <button class="btn btn-forget" data-r="forgot">忘了 😅</button>
        </div>
      </div>`;
    bar.querySelectorAll("[data-r]").forEach((b) => {
      b.onclick = () => {
        reviewResult(id, b.dataset.r, { type, title });
        toast("已更新下次复习时间");
        renderMathReviewBar();
      };
    });
  }

  function nextMathQ() {
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
          fb.textContent = `再想想～ 正确答案是 ${currentQ.answer}`;
          fb.className = "feedback no";
        }
        document.getElementById("math-ok").textContent = mathScore.ok;
        document.getElementById("math-total").textContent = mathScore.total;
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
  const PY_SAMPLES = {
    b: "波 bō · 爸爸",
    p: "坡 pō · 苹果",
    m: "摸 mō · 妈妈",
    f: "佛 fó · 飞机",
    d: "得 dé · 大象",
    t: "特 tè · 太阳",
    n: "讷 nè · 牛奶",
    l: "勒 lè · 老虎",
    g: "哥 gē · 鸽子",
    k: "科 kē · 可爱",
    h: "喝 hē · 花朵",
    j: "基 jī · 鸡蛋",
    q: "欺 qī · 气球",
    x: "希 xī · 西瓜",
    zh: "知 zhī · 桌子",
    ch: "蚩 chī · 吃饭",
    sh: "诗 shī · 书本",
    r: "日 rì · 太阳",
    z: "资 zī · 字",
    c: "雌 cí · 草地",
    s: "思 sī · 松鼠",
    y: "衣 yī · 鸭子",
    w: "乌 wū · 乌龟",
    a: "啊 a · 啊",
    o: "喔 o · 喔",
    e: "鹅 é · 鹅",
    i: "衣 i · 衣服",
    u: "乌 u · 乌鸦",
    ü: "迂 ü · 鱼",
    ai: "哀 āi · 爱",
    ei: "欸 ēi · 飞",
    ui: "威 uī · 水",
    ao: "熬 áo · 猫",
    ou: "欧 ōu · 口",
    iu: "忧 iū · 球",
    ie: "耶 iē · 叶子",
    üe: "约 üē · 月亮",
    er: "儿 ér · 耳朵",
    an: "安 ān · 安静",
    en: "恩 ēn · 认真",
    in: "因 īn · 拼音",
    un: "温 ūn · 春天",
    ün: "晕 ūn · 云",
    ang: "昂 áng · 大象",
    eng: "亨 ēng · 风",
    ing: "英 īng · 明星",
    ong: "轰 ōng · 工农",
  };

  let pyTab = "initials";

  function renderPinyin() {
    const el = document.getElementById("pinyin-content");
    const list = pyTab === "initials" ? INITIALS : FINALS;
    el.innerHTML = `
      <div class="card">
        <h2>🔤 拼音认读</h2>
        <p style="color:var(--muted);font-size:0.9rem;margin-bottom:10px">点一点，读一读（骨架练习）</p>
        <div class="tabs-mini">
          <button data-pt="initials" class="${pyTab === "initials" ? "active" : ""}">声母</button>
          <button data-pt="finals" class="${pyTab === "finals" ? "active" : ""}">韵母</button>
        </div>
        <div class="pinyin-grid">
          ${list
            .map((p) => `<button class="pinyin-chip" data-p="${p}">${p}</button>`)
            .join("")}
        </div>
        <div class="pinyin-sample" id="py-sample">
          <span class="big-letter">?</span>
          点击上方字母开始认读
        </div>
        <div class="btn-row" style="justify-content:center;margin-top:12px">
          <button class="btn btn-learn" id="py-enroll">加入复习队列</button>
        </div>
      </div>`;
    el.querySelectorAll("[data-pt]").forEach((b) =>
      b.addEventListener("click", () => {
        pyTab = b.dataset.pt;
        renderPinyin();
      })
    );
    el.querySelectorAll(".pinyin-chip").forEach((chip) => {
      chip.onclick = () => {
        el.querySelectorAll(".pinyin-chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        const p = chip.dataset.p;
        document.getElementById("py-sample").innerHTML = `
          <span class="big-letter">${escapeHtml(p)}</span>
          ${escapeHtml(PY_SAMPLES[p] || "")}`;
      };
    });
    document.getElementById("py-enroll").onclick = () => {
      markLearned("pinyin-basic", { type: "pinyin", title: "声母韵母认读" });
      toast("拼音认读已加入复习");
    };
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
    el.innerHTML = `
      <div class="card">
        <h2>✍️ 写汉字</h2>
        <p style="color:var(--muted);font-size:0.9rem">田字格描红骨架 · 选一个字跟着写</p>
        <div class="tianzige"><div class="char">${ch.c}</div></div>
        <div class="stroke-hint"><b>${ch.c}</b>　${escapeHtml(ch.strokes)}<br>${escapeHtml(
      ch.tip
    )}</div>
        <div class="write-list">
          ${WRITE_CHARS.map(
            (w, i) =>
              `<button class="${i === writeIdx ? "active" : ""}" data-i="${i}">${w.c}</button>`
          ).join("")}
        </div>
        <div class="btn-row" style="justify-content:center;margin-top:14px">
          <button class="btn btn-learn" id="write-enroll">加入复习队列</button>
        </div>
        <p style="font-size:0.8rem;color:var(--muted);text-align:center;margin-top:10px">
          提示：可在纸上对照田字格练习；后续可扩展笔顺动画。
        </p>
      </div>`;
    el.querySelectorAll(".write-list button").forEach((b) => {
      b.onclick = () => {
        writeIdx = Number(b.dataset.i);
        renderWrite();
      };
    });
    document.getElementById("write-enroll").onclick = () => {
      markLearned("write-basic", { type: "write", title: "常用汉字描红" });
      toast("写字练习已加入复习");
    };
  }

  // ---------- Toast ----------
  function toast(msg) {
    let t = document.getElementById("toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "toast";
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
  function bindNav() {
    document.querySelectorAll(".nav button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = btn.dataset.nav;
        showView(v);
        if (v === "home") renderHome();
        if (v === "poems") renderPoems();
        if (v === "math") renderMath();
        if (v === "pinyin") renderPinyin();
        if (v === "write") renderWrite();
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindNav();
    showView("home");
    renderHome();
    if (getSyncCode() && API_BASE) {
      setSyncStatus("启动中，正在同步…", "busy");
      syncNow("full").catch(() => {});
    } else if (!getSyncCode()) {
      setSyncStatus("未开启云同步", "muted");
    }
  });
})();
