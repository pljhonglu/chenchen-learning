/* Picture-led English: bundled voices, independent listening, optional speaking. */
(function (global) {
  "use strict";
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const shuffle = list => {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
    return copy;
  };
  function selectDaily(items, state, today, limit = 3) {
    const practiced = new Set(Object.values(state.activity || {}).filter(a => a.type === "english" && a.day === today).map(a => a.id));
    const remaining = Math.max(0, limit - practiced.size);
    const active = items.filter(item => !state.hiddenCourses?.[item.id] && !practiced.has(item.id));
    const due = active.filter(item => state.items[item.id]?.learned && state.items[item.id].nextReview <= today)
      .sort((a, b) => state.items[a.id].nextReview.localeCompare(state.items[b.id].nextReview));
    const unseen = active.filter(item => item.source === "classroom" && !state.items[item.id]);
    // Leave room to revisit classroom vocabulary that has not been checked yet.
    const selected = due.slice(0, unseen.length ? Math.max(0, remaining - 1) : remaining);
    selected.push(...unseen.slice(0, remaining - selected.length));
    selected.push(...due.filter(item => !selected.includes(item)).slice(0, remaining - selected.length));
    return selected;
  }
  function create(hooks) {
    const root = () => document.getElementById("english-content");
    let data, illustrations = {}, loading, generation = 0, round = null, theme = "all", libraryScroll = 0, themeScroll = 0, lastAudio = [], audioError = "", saving = false, detailItemId = null, detailExposed = false;
    const ratingLabel = id => global.ChenchenLearning.RATINGS.find(rating => rating.id === id).label;
    const listeningResult = result => result.firstTryCorrect === true && !result.assisted && !result.exposureFirst ? "independent" : "supported";
    const audio = global.ChenchenEnglishAudio.create({
      onState(state) {
        // A model heard on the word card is fresh exposure, including a clip
        // interrupted by the child starting its practice before it has ended.
        if (state === "speaking" && detailItemId && lastAudio.some(key => key.startsWith(detailItemId + "-"))) detailExposed = true;
        const el = root()?.querySelector("#english-audio-state");
        if (el) el.textContent = ({loading:"声音准备中…",speaking:"正在播放 · 听一听",paused:"声音已暂停",idle:"点小喇叭，随时再听",error:"声音暂时没有播放成功"})[state] || "";
        const pause = root()?.querySelector("#english-pause");
        if (pause) { pause.disabled = !["speaking","loading","paused"].includes(state); pause.textContent = state === "paused" ? "▶ 继续声音" : "Ⅱ 暂停声音"; }
      },
      onError() { audioError = "声音没有播放成功。请检查连接，点「重试声音」。"; showAudioError(); },
    });
    const state = () => hooks.loadState();
    const current = () => round?.items[round.index];
    const progress = item => state().items[item.id];
    const stage = () => round.steps[round.step];
    function showAudioError() {
      const el = root()?.querySelector("#english-audio-error");
      if (el) { el.hidden = !audioError; el.querySelector("span").textContent = audioError; }
    }
    async function play(keys) {
      lastAudio = Array.isArray(keys) ? keys : [keys];
      audioError = ""; showAudioError();
      const token = generation;
      const ok = await audio.play(lastAudio);
      if (ok && token === generation && round) {
        const phase = stage(), item = current();
        const required = item.id + (phase === "sentence" ? "-sentence" : "-word");
        if (lastAudio.includes(required)) {
          if (phase === "learn" || phase === "sentence") {
            const next = root().querySelector("#english-next");
            if (next) next.disabled = false;
            const turn = root().querySelector("#english-turn");
            if (turn) turn.textContent = "轮到你说啦，准备好了再继续。";
          } else if (phase === "listen") {
            round.result.heardPrompt = true;
            root().querySelectorAll("[data-english-choice]").forEach(b => { if (!b.dataset.wrong && !round.result.answered) b.disabled = false; });
          }
        }
      }
      return ok && token === generation;
    }
    async function json(url) {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
      try { const res = await fetch(url, {cache:"no-cache",signal:controller.signal}); if (!res.ok) throw new Error("内容暂时没有打开，请重试。"); return await res.json(); }
      finally { clearTimeout(timer); }
    }
    async function ensure() {
      if (!loading) loading = Promise.all([json("/data/english.json"), json("/data/english-illustrations.json")]).then(([content, art]) => {
        if (!Array.isArray(content.items) || !content.items.length || !Array.isArray(content.themes) || !art || typeof art !== "object") throw new Error("英语内容格式有误。");
        const ids = new Set();
        for (const item of content.items) {
          if (!/^english-[a-z-]+$/.test(item.id) || ids.has(item.id) || !item.word || !item.sentence || !item.meaning || !["classroom","extension"].includes(item.source)) throw new Error("英语词卡格式有误。");
          ids.add(item.id);
        }
        data = content; illustrations = art;
      }).catch(error => { loading = null; throw error; });
      await loading;
      await audio.preload();
    }
    function stop() { generation++; detailItemId = null; detailExposed = false; audio.stop(); round = null; saving = false; }
    function art(item, small = false) {
      const entry = illustrations[item.id];
      if (entry?.kind === "color" && /^#[a-f\d]{6}$/i.test(entry.color)) return `<span class="english-art english-color" role="img" aria-label="${escape(item.meaning)}"><i style="--paint:${entry.color}"></i></span>`;
      if (entry?.kind === "number" && entry.count >= 1 && entry.count <= 10) {
        const apple = illustrations["english-apple"];
        return `<span class="english-art english-number" role="img" aria-label="${entry.count} 个苹果">${Array.from({length:entry.count}, () => sprite(apple, true, "", true)).join("")}</span>`;
      }
      return sprite(entry, small, entry?.alt || item.meaning);
    }
    function sprite(entry, small, alt, hidden = false) {
      if (!entry || !/^\/?images\/english\/[a-z\d_-]+\.(webp|png|jpg)$/i.test(entry.src)) return `<span class="english-art english-art-missing" role="img" aria-label="${escape(alt)}">图片暂时没有打开</span>`;
      const cols = Number(entry.columns || 1), rows = Number(entry.rows || 1), index = Number(entry.index || 0);
      const x = cols === 1 ? 0 : (index % cols) / (cols - 1) * 100;
      const y = rows === 1 ? 0 : Math.floor(index / cols) / (rows - 1) * 100;
      return `<span class="english-art${small ? " is-small" : ""}" ${hidden ? 'aria-hidden="true"' : `role="img" aria-label="${escape(alt)}"`} style="background-image:url('${escape(entry.src.startsWith("/") ? entry.src : "/" + entry.src)}');background-size:${cols * 100}% ${rows * 100}%;background-position:${x}% ${y}%"></span>`;
    }
    function soundBar(compact = false) {
      if (compact) return `<div class="english-error" id="english-audio-error" role="alert" hidden><span></span><button class="btn btn-ghost" id="english-audio-retry">重试声音</button></div>`;
      return `<div class="english-soundbar"><span id="english-audio-state" role="status">点小喇叭，随时再听</span><button class="text-btn" id="english-pause" disabled>Ⅱ 暂停声音</button></div><div class="english-error" id="english-audio-error" role="alert" hidden><span></span><button class="btn btn-ghost" id="english-audio-retry">重试声音</button></div>`;
    }
    function bindSound() {
      const pause = root().querySelector("#english-pause");
      if (pause) pause.onclick = () => audio.getStatus() === "paused" ? audio.resume() : audio.pause();
      root().querySelector("#english-audio-retry").onclick = () => play(lastAudio);
      showAudioError();
    }
    function card(item) {
      const p = progress(item), paused = !!state().hiddenCourses?.[item.id];
      const status = paused ? "已暂停" : p?.learned ? "已练习" : "";
      return `<button class="english-word-card" data-english-card="${escape(item.id)}">${art(item,true)}<span class="english-word" lang="en">${escape(item.word)}</span><span>${escape(item.meaning)}</span>${status ? `<small>${status}</small>` : ""}</button>`;
    }
    function scrollTo(top) { global.scrollTo?.({top, behavior:"instant"}); }
    function rememberLibraryPosition() {
      libraryScroll = global.scrollY || 0;
      themeScroll = root().querySelector(".english-themes")?.scrollLeft || 0;
    }
    function returnToLibrary() { renderHome(); scrollTo(libraryScroll); }
    function renderHome() {
      round = null; detailItemId = null; detailExposed = false; audio.stop(); generation++; audioError = "";
      const items = data.items.filter(item => theme === "all" || item.theme === theme);
      const themes = data.themes.filter(t => data.items.some(i => i.theme === t.id));
      root().innerHTML = `<div class="english-library"><div class="english-library-heading"><h1>英语词卡 <span class="english-library-count">${data.items.length} 张</span></h1></div><div class="english-themes" aria-label="选择英语主题"><button data-english-theme="all" class="${theme === "all" ? "active" : ""}" aria-pressed="${theme === "all"}">全部</button>${themes.map(t => `<button data-english-theme="${escape(t.id)}" class="${theme === t.id ? "active" : ""}" aria-pressed="${theme === t.id}">${escape(t.title)}</button>`).join("")}</div><div class="english-word-grid">${items.map(card).join("")}</div></div>`;
      const filters = root().querySelector(".english-themes");
      if (filters) filters.scrollLeft = themeScroll;
      root().querySelectorAll("[data-english-card]").forEach(button => button.onclick = () => detail(data.items.find(i => i.id === button.dataset.englishCard)));
      root().querySelectorAll("[data-english-theme]").forEach(button => button.onclick = () => { rememberLibraryPosition(); theme = button.dataset.englishTheme; libraryScroll = 0; renderHome(); scrollTo(0); });
    }
    function detail(item) {
      rememberLibraryPosition();
      generation++; audio.stop(); round = null; audioError = "";
      detailItemId = item.id; detailExposed = false;
      root().innerHTML = `<div class="card english-detail"><button class="back-btn" id="english-back">← 全部词卡</button><div class="english-detail-layout"><button class="english-main-picture" id="english-picture" aria-label="听单词 ${escape(item.meaning)}">${art(item)}<span aria-hidden="true">◖))</span></button><div class="english-detail-copy"><h1><button class="english-read-word" id="english-word-play" lang="en" aria-label="听单词 ${escape(item.word)}">${escape(item.word)} <span aria-hidden="true">◖))</span></button></h1><button class="english-meaning english-read-meaning" id="english-meaning-play" aria-label="听中文 ${escape(item.meaning)}">${escape(item.meaning)} <span aria-hidden="true">◖))</span></button><button class="english-sentence" id="english-sentence-play" aria-label="听句子 ${escape(item.sentence)}"><span class="english-sentence-text" lang="en">${escape(item.sentence)} <i aria-hidden="true">◖))</i></span><span>${escape(item.translation)}</span></button>${item.action ? `<p class="english-action">${escape(item.action.zh)}</p>` : ""}${item.note ? `<details class="english-content-note"><summary>家长小提示</summary><p>${escape(item.note)}</p></details>` : ""}<button class="btn btn-learn english-practice-button" id="english-single">▶ 开始小练习</button></div></div>${soundBar(true)}</div>`;
      bindSound();
      root().querySelector("#english-back").onclick = returnToLibrary;
      for (const [id, key] of [["english-picture","word"],["english-word-play","word"],["english-sentence-play","sentence"],["english-meaning-play","meaning"]]) root().querySelector("#" + id).onclick = () => play(item.id + "-" + key);
      root().querySelector("#english-single").onclick = () => start([item], undefined, false, detailExposed ? [item.id] : []);
      scrollTo(0);
      play(item.id + "-word");
    }
    function dailySummary() {
      const currentState = state(), today = hooks.todayStr();
      const count = new Set(Object.values(currentState.activity || {}).filter(a => a.type === "english" && a.day === today).map(a => a.id)).size;
      return {remaining:selectDaily(data.items,currentState,today).length,count};
    }
    async function getDailySummary() { await ensure(); return dailySummary(); }
    function renderDailyEmpty() {
      generation++; audio.stop(); round = null;
      const {count} = dailySummary();
      root().innerHTML = `<div class="card english-finish"><span class="flower-reward" aria-hidden="true">✿</span><h1>${count >= 3 ? "今日英语完成啦" : "今天没有待复习的词卡"}</h1><button class="btn btn-primary" id="english-daily-home">回首页</button><button class="text-btn" id="english-daily-library">看全部词卡 →</button></div>`;
      root().querySelector("#english-daily-home").onclick = hooks.onHome;
      root().querySelector("#english-daily-library").onclick = () => { theme = "all"; libraryScroll = 0; themeScroll = 0; renderHome(); scrollTo(0); };
      scrollTo(0);
    }
    function setupItem() {
      const item = current(), existing = progress(item);
      round.steps = item.source === "extension" && !existing ? ["learn","listen","sentence","recall"] : ["listen","learn","sentence","recall"];
      round.step = 0;
      const observedExposure = round.exposedIds.includes(item.id);
      round.result = {attempts:0, firstTryCorrect:null, heardPrompt:false, assisted:false, speaking:"listened", usedHint:false, observedExposure, exposureFirst:round.steps[0] === "learn" || observedExposure};
      round.activityId = `english-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
      round.saved = false; round.operations = null;
      const same = data.items.filter(i => i.theme === item.theme && i.id !== item.id);
      const other = data.items.filter(i => i.id !== item.id && !same.includes(i));
      round.choices = shuffle([item,...shuffle(same).concat(shuffle(other)).slice(0,2)]);
    }
    async function start(items, onDone, daily = false, exposedIds = []) {
      if (saving || (!daily && !items.length)) return;
      generation++; detailItemId = null; detailExposed = false; audio.stop();
      const token = generation;
      let ok;
      try { ok = await hooks.syncNow(); } catch { ok = false; }
      if (token !== generation || !hooks.isActive()) return;
      if (!ok) { root().innerHTML = `<div class="card"><p>暂时连不上服务器。连接后再开始，才能保存练习。</p><button class="btn btn-primary" id="english-reconnect">重试</button></div>`; root().querySelector("#english-reconnect").onclick = () => start(items,onDone,daily,exposedIds); return; }
      if (daily) items = selectDaily(data.items,state(),hooks.todayStr());
      if (!items.length) { renderDailyEmpty(); return; }
      round = {items,index:0,onDone,exposedIds}; setupItem(); scrollTo(0); renderStep();
    }
    function renderStep() {
      audio.stop(); generation++; audioError = "";
      const item = current(), phase = stage(), result = round.result;
      const labels = {listen:"听声音，找图片",learn:"听单词，跟着说",sentence:"一起说一句",recall:"看图，试着自己说"};
      let content;
      if (phase === "listen") content = `<button class="btn btn-primary english-listen-button" id="english-prompt">◖)) 听一听</button><div class="english-choices">${round.choices.map((choice,i) => `<button class="english-choice" data-english-choice="${escape(choice.id)}" aria-label="选择图片 ${i + 1}：${escape(choice.meaning)}" disabled>${art(choice)}<span>${i + 1}</span></button>`).join("")}</div><p class="english-feedback" id="english-feedback" role="status">先听声音，再选图片。</p><button class="btn btn-primary english-next" id="english-next" disabled>找到了，继续 →</button>`;
      else content = `<div class="english-practice-layout"><button class="english-main-picture" id="english-repeat-picture" aria-label="再听${phase === "sentence" ? "句子" : "单词"}">${art(item)}<span>◖)) ${phase === "recall" ? "需要提示时，点这里" : "点图片，再听一次"}</span></button><div class="english-practice-copy">${phase === "recall" ? `<p class="english-recall-title">轮到你啦</p><p>可以说单词，也可以试着说一句。</p>` : `<h2 lang="en">${escape(phase === "sentence" ? item.sentence : item.word)}</h2><p class="english-meaning">${escape(phase === "sentence" ? item.translation : item.meaning)}</p>`}<div class="btn-row"><button class="btn btn-ghost" id="english-word-hint">◖)) ${phase === "recall" ? "听单词提示" : "听单词"}</button><button class="btn btn-ghost" id="english-sentence-hint">◖)) ${phase === "recall" ? "听句子提示" : "听句子"}</button></div>${item.action && phase === "sentence" ? `<p class="english-action">${escape(item.action.zh)}</p>` : ""}<p class="english-turn" id="english-turn" role="status">${phase === "recall" ? "慢慢想，想不起来也没关系。" : "先听一听，稍后轮到你说。"}</p><button class="btn btn-primary english-next" id="english-next" ${phase === "recall" ? "" : "disabled"}>${phase === "recall" ? "我试着说了 ✓" : "我准备好了，继续 →"}</button>${phase === "recall" ? `<button class="text-btn english-listen-only" id="english-listen-only">今天先听听，也可以</button><p class="english-speech-note">记录一次开口尝试，不评判发音对错。</p>` : ""}</div></div>`;
      root().innerHTML = `<div class="english-round-top"><button class="text-btn" id="english-exit">← 先休息</button><span>小小练习 ${round.index + 1} / ${round.items.length}</span><span>${round.step + 1} / 4 步</span></div><div class="english-step-dots">${round.steps.map((s,i) => `<span class="${i === round.step ? "now" : i < round.step ? "done" : ""}">${labels[s]}</span>`).join("")}</div><div class="card english-practice"><div class="english-practice-heading"><p class="eyebrow">中文带着玩 · 英文慢慢说</p><h1>${labels[phase]}</h1></div>${content}${soundBar()}<p id="english-save-error" class="form-error" role="alert"></p></div>`;
      bindSound();
      root().querySelector("#english-exit").onclick = () => {stop(); hooks.onExit();};
      root().querySelector("#english-next").onclick = next;
      if (phase === "listen") {
        root().querySelector("#english-prompt").onclick = playPrompt;
        root().querySelectorAll("[data-english-choice]").forEach(button => button.onclick = () => choose(button));
        playPrompt();
      } else {
        const hint = kind => { if (phase === "recall") result.usedHint = true; return play(item.id + "-" + kind); };
        root().querySelector("#english-repeat-picture").onclick = () => hint(phase === "sentence" ? "sentence" : "word");
        root().querySelector("#english-word-hint").onclick = () => hint("word");
        root().querySelector("#english-sentence-hint").onclick = () => hint("sentence");
        if (phase === "recall") { root().querySelector("#english-listen-only").onclick = () => finishItem("listened"); play("guide-recall"); }
        else {
          const token = generation;
          const keys = phase === "learn" ? ["guide-learn",item.id + "-meaning",item.id + "-word","guide-your-turn"] : ["guide-sentence",item.id + "-sentence","guide-your-turn"];
          play(keys).then(ok => { if (ok && token === generation) {root().querySelector("#english-next").disabled = false; root().querySelector("#english-turn").textContent = "轮到你说啦，准备好了再继续。";} });
        }
      }
    }
    async function playPrompt() {
      const token = generation, currentRound = round;
      const ok = await play(["guide-listen",current().id + "-word"]);
      if (ok && token === generation && round === currentRound) {
        round.result.heardPrompt = true;
        root().querySelectorAll("[data-english-choice]").forEach(b => {if (!b.dataset.wrong && !round.result.answered) b.disabled = false;});
        root().querySelector("#english-feedback").textContent = "选一张图片吧。小喇叭可以再听一次。";
      }
    }
    async function choose(button) {
      const result = round.result;
      if (!result.heardPrompt || result.answered || button.disabled) return;
      const correct = button.dataset.englishChoice === current().id;
      result.attempts++;
      if (result.attempts === 1) result.firstTryCorrect = correct;
      button.classList.add(correct ? "correct" : "try-again");
      if (!correct) {
        result.assisted = true; button.disabled = true; button.dataset.wrong = "true";
        root().querySelector("#english-feedback").textContent = "再听一遍，找找另一个小伙伴。";
        play(["guide-retry",current().id + "-word"]); return;
      }
      result.answered = true;
      root().querySelectorAll("[data-english-choice]").forEach(b => b.disabled = true);
      root().querySelector("#english-feedback").textContent = `${ratingLabel(listeningResult(result))} ✓ · ${current().meaning} · ${current().word}`;
      root().querySelector("#english-next").disabled = false;
      play(["guide-correct",current().id + "-word"]);
    }
    function next() {
      if (saving) return;
      if (stage() === "recall") return finishItem("attempted");
      if (stage() === "listen" && !round.result.answered) return;
      round.step++; renderStep();
    }
    async function finishItem(speaking) {
      if (saving) return;
      saving = true; audio.stop();
      const token = generation, active = round, item = current(), result = active.result;
      result.speaking = speaking;
      root().querySelector("#english-next").disabled = true;
      root().querySelector("#english-listen-only").disabled = true;
      root().querySelector("#english-save-error").textContent = "正在保存今天的小练习…";
      if (!active.operations) {
        const today = hooks.todayStr(), existing = progress(item), fresh = hooks.newItem(item.id,{type:"english",title:`${item.word} · ${item.meaning}`});
        const base = existing || fresh;
        const outcome = listeningResult(result), independent = outcome === "independent";
        const memory = base.nextReview <= today ? hooks.reviewPatch(base, independent ? "remember" : "fuzzy") : {};
        const value = {...memory,learned:true,englishListening:{day:today,firstTryCorrect:result.firstTryCorrect,attempts:result.attempts,independent,exposureFirst:result.exposureFirst,observedExposure:result.observedExposure},englishSpeaking:{day:today,status:speaking,usedHint:result.usedHint,assessed:false}};
        const activity = global.ChenchenLearning.createActivity({
          id:item.id,type:"english",title:`${item.word} · ${item.meaning}`,skill:"english-listening",result:outcome,source:"automatic",day:today,at:new Date().toISOString(),
          details:{attempts:result.attempts,firstTryCorrect:result.firstTryCorrect,exposureFirst:result.exposureFirst,observedExposure:result.observedExposure,assisted:result.assisted,speaking,usedHint:result.usedHint,speakingAssessed:false,sentencePracticed:true}
        });
        const operations = [];
        if (state().hiddenCourses?.[item.id]) operations.push({op:"delete",collection:"hiddenCourses",key:item.id});
        if (!existing) operations.push({op:"create",collection:"items",key:item.id,value:fresh});
        operations.push({op:"merge",collection:"items",key:item.id,value}, {op:"set",collection:"activity",key:active.activityId,value:{...activity,listening:outcome,speaking}});
        active.operations = operations;
      }
      try {
        await hooks.commitOperations(active.operations);
        if (token !== generation || round !== active || !hooks.isActive()) return;
        saving = false; active.saved = true;
        if (active.onDone) {const callback = active.onDone; round = null; callback(); return;}
        active.index++;
        if (active.index < active.items.length) {setupItem(); renderStep();}
        else renderFinish(active.items.length);
      } catch (error) {
        if (token !== generation || round !== active) return;
        saving = false;
        root().querySelector("#english-save-error").textContent = error.status === 409 ? "这张词卡已在另一台设备移除，请先休息，返回词卡重新开始。" : "还没有保存成功，请保持页面打开，点下面按钮重试。";
        root().querySelector("#english-next").disabled = error.status === 409;
        root().querySelector("#english-next").textContent = "重试保存";
        root().querySelector("#english-next").onclick = () => finishItem(result.speaking);
      }
    }
    function renderFinish(count) {
      generation++; round = null;
      root().innerHTML = `<div class="card english-finish"><span class="flower-reward" aria-hidden="true">✿</span><p class="eyebrow">今天的小小收获</p><h1>英语小花开啦！</h1><p>认真练习了 ${count} 个词，也听了小句子。</p><p class="muted">站起来动一动，看看远处的绿色吧。</p><button class="btn btn-primary" id="english-finish">收下小花，休息一下</button>${soundBar()}</div>`;
      bindSound(); root().querySelector("#english-finish").onclick = hooks.onHome;
      play("guide-done");
    }
    async function open(options = {}) {
      stop(); const token = generation;
      root().innerHTML = '<div class="card"><p class="empty">词卡准备中…</p></div>';
      try {
        await ensure();
        if (token !== generation || !hooks.isActive()) return;
        if (options.itemId) { const item = data.items.find(i => i.id === options.itemId); if (!item) throw new Error("没有找到这张英语词卡。"); await start([item], options.onDone); }
        else if (options.daily) await start([], undefined, true);
        else { libraryScroll = 0; renderHome(); scrollTo(0); }
      } catch (error) {
        if (token !== generation || !hooks.isActive()) return;
        root().innerHTML = `<div class="card english-load-error"><h2>词卡暂时没有打开</h2><p>${escape(error.message)}</p><button class="btn btn-primary" id="english-retry-load">重新打开</button></div>`;
        root().querySelector("#english-retry-load").onclick = () => open(options);
      }
    }
    return {open,stop,getDailySummary,pause:() => audio.pause()};
  }
  global.ChenchenEnglish = {create,selectDaily};
})(typeof window !== "undefined" ? window : globalThis);
