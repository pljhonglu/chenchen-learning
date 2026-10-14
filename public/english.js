/* Picture-led English: bundled voices, independent listening, optional speaking. */
(function (global) {
  "use strict";
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const shuffle = list => {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
    return copy;
  };
  function create(hooks) {
    const root = () => document.getElementById("english-content");
    let data, illustrations = {}, loading, generation = 0, round = null, theme = "all", libraryScroll = 0, themeScroll = 0, lastAudio = [], audioError = "", saving = false, detailItemId = null;
    let exposureDay = "";
    const dailyExposures = new Set();
    function exposure(id, remember = false) {
      const day = hooks.todayStr();
      if (day !== exposureDay) { exposureDay = day; dailyExposures.clear(); }
      if (remember) dailyExposures.add(id);
      return dailyExposures.has(id);
    }
    const ratingLabel = id => global.ChenchenLearning.RATINGS.find(rating => rating.id === id).label;
    const listeningResult = result => result.firstTryCorrect === true && !result.assisted && !result.exposureFirst ? "independent" : "supported";
    const audio = global.ChenchenEnglishAudio.create({
      onState(state) {
        // A model heard on the word card is fresh exposure, including a clip
        // interrupted by the child starting its practice before it has ended.
        if (state === "speaking") {
          if (detailItemId && lastAudio.some(key => key.startsWith(detailItemId + "-"))) exposure(detailItemId,true);
          // A listening question's prompt is valid test evidence, not teaching.
          // Subsequent models/hints matter to later groups, while this item's
          // first-answer evidence stays frozen in round.result.
          if (round && stage() !== "listen" && lastAudio.some(key => key.startsWith(current().id + "-"))) exposure(current().id,true);
        }
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
        const required = item.id + "-word";
        if (lastAudio.includes(required)) {
          if (phase === "learn") {
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
          if (!/^english-[a-z-]+$/.test(item.id) || ids.has(item.id) || !item.word || !item.meaning || !content.themes.some(t => t.id === item.theme) || !["classroom","extension"].includes(item.source)) throw new Error("英语词卡格式有误。");
          ids.add(item.id);
        }
        data = content; illustrations = art;
      }).catch(error => { loading = null; throw error; });
      await loading;
      await audio.preload();
    }
    function stop() { generation++; detailItemId = null; audio.stop(); round = null; saving = false; }
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
    function libraryItems() { return data.items.filter(item => theme === "all" || item.theme === theme); }
    function themeTitle() { return data.themes.find(t => t.id === theme)?.title || "全部词卡"; }
    function renderHome() {
      round = null; detailItemId = null; audio.stop(); generation++; audioError = "";
      const items = libraryItems();
      const themes = data.themes.filter(t => data.items.some(i => i.theme === t.id));
      root().innerHTML = `<div class="english-library">${hooks.groupStartHtml()}<div class="english-library-heading"><h1>英语词卡 <span class="english-library-count">${items.length} 张</span></h1></div><div class="english-themes" aria-label="选择英语主题"><button data-english-theme="all" class="${theme === "all" ? "active" : ""}" aria-pressed="${theme === "all"}">全部</button>${themes.map(t => `<button data-english-theme="${escape(t.id)}" class="${theme === t.id ? "active" : ""}" aria-pressed="${theme === t.id}">${escape(t.title)}</button>`).join("")}</div><div class="english-word-grid">${items.map(card).join("")}</div></div>`;
      root().querySelector("[data-start-study]").onclick = hooks.startStudy;
      const filters = root().querySelector(".english-themes");
      if (filters) filters.scrollLeft = themeScroll;
      root().querySelectorAll("[data-english-card]").forEach(button => button.onclick = () => detail(data.items.find(i => i.id === button.dataset.englishCard)));
      root().querySelectorAll("[data-english-theme]").forEach(button => button.onclick = () => { rememberLibraryPosition(); theme = button.dataset.englishTheme; libraryScroll = 0; renderHome(); scrollTo(0); });
    }
    function detail(item, rememberPosition = true) {
      if (rememberPosition) rememberLibraryPosition();
      generation++; audio.stop(); round = null; audioError = "";
      detailItemId = item.id;
      const items = libraryItems(), index = items.findIndex(candidate => candidate.id === item.id);
      const title = themeTitle(), last = index === items.length - 1;
      root().innerHTML = `<div class="card english-detail"><div class="english-detail-top"><button class="back-btn" id="english-back">← ${escape(title)}</button><span class="english-card-position" role="status">${escape(title)} · ${index + 1} / ${items.length}</span></div><div class="english-detail-layout"><button class="english-main-picture" id="english-picture" aria-label="听单词 ${escape(item.meaning)}">${art(item)}<span aria-hidden="true">◖))</span></button><div class="english-detail-copy"><h1><button class="english-read-word" id="english-word-play" lang="en" aria-label="听单词 ${escape(item.word)}">${escape(item.word)} <span aria-hidden="true">◖))</span></button></h1><button class="english-meaning english-read-meaning" id="english-meaning-play" aria-label="听中文 ${escape(item.meaning)}">${escape(item.meaning)} <span aria-hidden="true">◖))</span></button><p class="english-browse-note">自由听读 · 不记录学习，不获得水滴</p></div></div>${soundBar(true)}<div class="english-card-navigation" aria-label="分类词卡切换"><button class="btn btn-ghost" id="english-card-previous" ${index === 0 ? "disabled" : ""}>← 上一个</button><button class="btn btn-primary" id="english-card-next">${last ? "看完了，返回分类 ✓" : "下一个 →"}</button></div></div>`;
      bindSound();
      root().querySelector("#english-back").onclick = returnToLibrary;
      root().querySelector("#english-card-previous").onclick = () => { if (index > 0) detail(items[index - 1], false); };
      root().querySelector("#english-card-next").onclick = () => last ? returnToLibrary() : detail(items[index + 1], false);
      for (const [id, key] of [["english-picture","word"],["english-word-play","word"],["english-meaning-play","meaning"]]) root().querySelector("#" + id).onclick = () => play(item.id + "-" + key);
      scrollTo(0);
      play(item.id + "-word");
    }
    function setupItem() {
      const item = current(), existing = progress(item);
      const reviewing = item.phase === "review";
      round.steps = reviewing ? ["listen"] : item.source === "extension" && !existing ? ["learn","listen","recall"] : ["listen","learn","recall"];
      round.step = 0;
      const observedExposure = exposure(item.id) || !!(round.group.resumed && round.group.resumeExposure !== false && round.index === round.resumeIndex);
      round.result = {attempts:0, firstTryCorrect:null, heardPrompt:false, assisted:false, speaking:"listened", usedHint:false, observedExposure, exposureFirst:round.steps[0] === "learn" || observedExposure};
      round.activityId = `english-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
      round.pendingEntries = null;
      const same = data.items.filter(i => i.theme === item.theme && i.id !== item.id);
      const other = data.items.filter(i => i.id !== item.id && !same.includes(i));
      round.choices = shuffle([item,...shuffle(same).concat(shuffle(other)).slice(0,2)]);
    }
    function start(group) {
      if (saving) return;
      if (!group || !Array.isArray(group.items) || group.items.length < 1 || group.items.length > 5) throw new Error("这一组需要 1 到 5 个词，请返回重新生成。");
      const items = group.items.map(selected => {
        const item = data.items.find(candidate => candidate.id === selected.id);
        return item ? {...item,phase:selected.phase || group.mode} : null;
      });
      if (items.some(item=>!item) || new Set(items.map(item=>item.id)).size !== items.length) throw new Error("这一组有词卡暂时无法打开，请返回重新生成。");
      const entries = (group.entries || []).map(entry=>({...entry,details:{...entry.details}}));
      const index = group.index ?? entries.length;
      if (!Number.isInteger(index) || index < 0 || index > items.length || entries.length !== index || entries.some((entry,i)=>entry.id !== items[i].id)) throw new Error("这一组的进度暂时无法恢复，请返回重试。");
      generation++; detailItemId = null; audio.stop();
      round = {items,index,entries,group,resumeIndex:index};
      scrollTo(0);
      if (index === items.length) { renderCompleted(); return; }
      setupItem(); renderStep();
    }
    function renderStep() {
      audio.stop(); generation++; audioError = "";
      const item = current(), phase = stage(), result = round.result;
      const labels = {listen:"听声音，找图片",learn:"听单词，跟着说",recall:"看图，试着说单词"};
      let content;
      if (phase === "listen") content = `<button class="btn btn-primary english-listen-button" id="english-prompt">◖)) 听一听</button><div class="english-choices">${round.choices.map((choice,i) => `<button class="english-choice" data-english-choice="${escape(choice.id)}" aria-label="选择图片 ${i + 1}：${escape(choice.meaning)}" disabled>${art(choice)}<span>${i + 1}</span></button>`).join("")}</div><p class="english-feedback" id="english-feedback" role="status">先听声音，再选图片。</p><button class="btn btn-primary english-next" id="english-next" disabled>找到了，继续 →</button>`;
      else content = `<div class="english-practice-layout"><button class="english-main-picture" id="english-repeat-picture" aria-label="再听单词">${art(item)}<span>◖)) ${phase === "recall" ? "需要提示时，点这里" : "点图片，再听一次"}</span></button><div class="english-practice-copy">${phase === "recall" ? `<p class="english-recall-title">轮到你啦</p><p>看着图片，试着说出这个单词。</p>` : `<h2 lang="en">${escape(item.word)}</h2><p class="english-meaning">${escape(item.meaning)}</p>`}<div class="btn-row"><button class="btn btn-ghost" id="english-word-hint">◖)) ${phase === "recall" ? "听单词提示" : "听单词"}</button><button class="btn btn-ghost" id="english-meaning-hint">◖)) 听中文</button></div><p class="english-turn" id="english-turn" role="status">${phase === "recall" ? "慢慢想，想不起来也没关系。" : "先听一听，稍后轮到你说。"}</p><button class="btn btn-primary english-next" id="english-next" ${phase === "recall" ? "" : "disabled"}>${phase === "recall" ? "我试着说了 ✓" : "我准备好了，继续 →"}</button>${phase === "recall" ? `<button class="text-btn english-listen-only" id="english-listen-only">今天先听听，也可以</button><p class="english-speech-note">记录一次开口尝试，不评判发音对错。</p>` : ""}</div></div>`;
      root().innerHTML = `<div class="english-round-top"><button class="text-btn" id="english-exit">← 先休息</button><span>英语${item.phase === "review" ? "复习" : "学习"} ${round.index + 1} / ${round.items.length}</span><span id="english-step-count">${round.step + 1} / ${round.steps.length} 步</span></div><p class="study-group-note">${round.group.items[round.index]?.afterPractice ? "顺便温习 · 原定复习日期不变" : Object.values(state().garden?.groups || {}).filter(group=>group.day===hooks.todayStr() && group.waterAwarded).length >= 3 ? "今天水滴已领完，本组仍会记录学习" : `学完本组 ${round.items.length} 个词，收获 1 滴水 · 完成的词会保存，可继续学习`}</p><div class="english-step-dots" id="english-step-dots">${round.steps.map((s,i) => `<span class="${i === round.step ? "now" : i < round.step ? "done" : ""}">${labels[s]}</span>`).join("")}</div><div class="card english-practice"><div class="english-practice-heading"><p class="eyebrow">中文带着玩 · 英文慢慢说</p><h1>${labels[phase]}</h1></div>${content}${soundBar()}<p id="english-save-error" class="form-error" role="alert"></p></div>`;
      bindSound();
      root().querySelector("#english-exit").onclick = () => {
        if (saving || round?.pendingEntries || hooks.groupSaving?.()) return;
        stop(); hooks.onExit();
      };
      root().querySelector("#english-next").onclick = next;
      if (phase === "listen") {
        root().querySelector("#english-prompt").onclick = playPrompt;
        root().querySelectorAll("[data-english-choice]").forEach(button => button.onclick = () => choose(button));
        playPrompt();
      } else {
        const hint = kind => { if (phase === "recall") result.usedHint = true; return play(item.id + "-" + kind); };
        root().querySelector("#english-repeat-picture").onclick = () => hint("word");
        root().querySelector("#english-word-hint").onclick = () => hint("word");
        root().querySelector("#english-meaning-hint").onclick = () => hint("meaning");
        if (phase === "recall") { root().querySelector("#english-listen-only").onclick = () => finishItem("listened"); play("guide-recall"); }
        else {
          const token = generation;
          const keys = ["guide-learn",item.id + "-meaning",item.id + "-word","guide-your-turn"];
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
        if (current().phase === "review" && round.steps.length === 1) {
          round.steps = ["listen","learn","recall"];
          root().querySelector("#english-step-count").textContent = `1 / ${round.steps.length} 步`;
          root().querySelector("#english-step-dots").innerHTML = '<span class="now">听声音，找图片</span><span>听单词，跟着说</span><span>看图，试着说单词</span>';
        }
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
      if (saving || !round) return;
      if (round.pendingEntries) return finishItem();
      if (stage() === "recall") return finishItem("attempted");
      if (stage() === "listen" && !round.result.answered) return;
      if (stage() === "listen" && round.steps.length === 1) return finishItem("listened");
      round.step++; renderStep();
    }
    async function finishItem(speaking) {
      if (saving || !round) return;
      saving = true; audio.stop();
      const active = round, item = current(), result = active.result;
      if (!active.pendingEntries) {
        result.speaking = speaking;
        active.pendingEntries = [...active.entries,{
          id:item.id,type:"english",title:`${item.word} · ${item.meaning}`,skill:"english-listening",result:listeningResult(result),source:"automatic",
          details:{attempts:result.attempts,firstTryCorrect:result.firstTryCorrect,exposureFirst:result.exposureFirst,observedExposure:result.observedExposure,assisted:result.assisted,speaking,usedHint:result.usedHint,speakingAssessed:false,sentencePracticed:false}
        }];
      }
      const nextButton = root().querySelector("#english-next"), listenOnly = root().querySelector("#english-listen-only");
      nextButton.disabled = true;
      if (listenOnly) listenOnly.disabled = true;
      root().querySelector("#english-save-error").textContent = "";
      try {
        const saved = await hooks.checkpointEnglishGroup(active.pendingEntries, active.index + 1);
        if (saved === false) throw new Error("这个词还没有保存成功，请重试。");
        if (round !== active || !hooks.isActive()) return;
        active.entries = active.pendingEntries; active.pendingEntries = null; active.index++;
        if (active.index < active.items.length) {saving=false;setupItem();renderStep();}
        else await completeRound(active);
      } catch (error) {
        if (round !== active || !hooks.isActive()) return;
        saving = false;
        if (active.index === active.items.length) { renderCompleted(error.message); return; }
        root().querySelector("#english-save-error").textContent = error.message || "这个词还没有保存成功，请重试。";
        nextButton.disabled = false; nextButton.textContent = "重试保存 →";
      }
    }
    async function completeRound(active) {
      saving = true;
      await hooks.completeGroup(active.entries);
    }
    function renderCompleted(message = "") {
      saving = false;
      root().innerHTML = `<div class="card english-practice"><h1>本组词汇已经练完啦</h1><p>已保存 ${round.entries.length} 个词，完成本组即可记录本次学习。</p><button class="btn btn-primary" id="english-complete">完成本组</button><p id="english-save-error" class="form-error" role="alert">${escape(message)}</p></div>`;
      const active = round;
      root().querySelector("#english-complete").onclick = async () => {
        if (saving) return;
        root().querySelector("#english-complete").disabled = true;
        try { await completeRound(active); }
        catch (error) { if (round === active && hooks.isActive()) renderCompleted(error.message || "本组还没有保存成功，请重试。"); }
      };
    }
    async function open(options = {}) {
      stop(); const token = generation;
      root().innerHTML = '<div class="card"><p class="empty">词卡准备中…</p></div>';
      try {
        await ensure();
        if (token !== generation || !hooks.isActive()) return;
        if (options.group) start(options.group);
        else if (options.itemId) {const item=data.items.find(item=>item.id===options.itemId);if(!item) throw new Error("没有找到这张英语词卡。");theme=item.theme;libraryScroll=0;detail(item,false);}
        else { libraryScroll = 0; renderHome(); scrollTo(0); }
      } catch (error) {
        if (token !== generation || !hooks.isActive()) return;
        root().innerHTML = `<div class="card english-load-error"><h2>词卡暂时没有打开</h2><p>${escape(error.message)}</p><button class="btn btn-primary" id="english-retry-load">重新打开</button></div>`;
        root().querySelector("#english-retry-load").onclick = () => open(options);
      }
    }
    return {open,stop,catalog:async()=>{await ensure();return data.items.map(item=>({...item,type:"english",title:`${item.word} · ${item.meaning}`}));},pause:() => audio.pause()};
  }
  global.ChenchenEnglish = {create};
})(typeof window !== "undefined" ? window : globalThis);
