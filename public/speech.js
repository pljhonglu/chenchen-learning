/* Bundled, pronunciation-corrected poem audio; system speech is for short guides. */
(function (global) {
  "use strict";
  let queue = [];
  let index = 0;
  let status = "idle";
  let timer = null;
  let current = null;
  let generation = 0;
  let callbacks = {};
  let audio = null;
  let playAttempt = 0;
  function synthesisSupported() {
    return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
  }
  function audioSupported() { return typeof global.Audio === "function"; }
  function supported(poem) {
    return poem && poem.id ? audioSupported() : synthesisSupported() || audioSupported();
  }
  function setState(next) {
    status = next;
    if (callbacks.onState) callbacks.onState(next);
  }
  function clearTimer() { clearTimeout(timer); timer = null; }
  function releaseAudio() {
    playAttempt++;
    if (!audio) return;
    audio.onplaying = audio.onended = audio.onerror = audio.onwaiting = null;
    audio.pause();
    // Cancel a pending media request as well as playback when leaving a page.
    audio.removeAttribute("src");
    audio.load();
    audio = null;
  }
  function pickVoice() {
    const voices = window.speechSynthesis.getVoices().filter(v => /^zh/i.test(v.lang || ""));
    return voices.find(v => /^zh[-_]CN$/i.test(v.lang)) || voices[0] || null;
  }
  function stop() {
    generation++;
    clearTimer();
    releaseAudio();
    queue = []; index = 0; current = null;
    if (synthesisSupported()) window.speechSynthesis.cancel();
    setState("idle");
  }
  function audioError(token, code) {
    if (token !== generation || !audio) return;
    clearTimer();
    releaseAudio();
    setState("idle");
    if (callbacks.onError) callbacks.onError(code);
  }
  function waitForAudio(token) {
    clearTimer();
    timer = setTimeout(() => audioError(token, "audio-load-timeout"), 20000);
  }
  function playAudio(token) {
    const active = audio;
    const attempt = ++playAttempt;
    setState("loading");
    waitForAudio(token);
    const failed = error => {
      if (token !== generation || attempt !== playAttempt || active !== audio || status === "paused") return;
      audioError(token, error && error.name === "NotAllowedError" ? "audio-playback-blocked" : "audio-unavailable");
    };
    try {
      const playback = active.play();
      if (playback && typeof playback.catch === "function") playback.catch(failed);
    } catch (error) { failed(error); }
  }
  function readPoemAudio(poem) {
    if (!audioSupported() || !/^poem-\d{2}$/.test(String(poem.id))) {
      if (callbacks.onUnsupported) callbacks.onUnsupported();
      return false;
    }
    const token = generation;
    audio = new global.Audio();
    audio.preload = "auto";
    audio.src = "/audio/poems/" + poem.id + ".mp3";
    audio.onplaying = () => {
      if (token !== generation || status === "paused") return;
      clearTimer();
      setState("speaking");
    };
    audio.onwaiting = () => {
      if (token !== generation || status === "paused") return;
      setState("loading");
      waitForAudio(token);
    };
    audio.onended = () => {
      if (token !== generation) return;
      clearTimer();
      releaseAudio();
      setState("idle");
    };
    audio.onerror = () => audioError(token, "audio-unavailable");
    playAudio(token);
    return true;
  }
  function next(token) {
    if (token !== generation || status === "paused") return;
    if (index >= queue.length) { current = null; setState("idle"); return; }
    const utter = new SpeechSynthesisUtterance(queue[index++]);
    current = utter;
    utter.lang = "zh-CN"; utter.rate = 0.82; utter.pitch = 1;
    const voice = pickVoice();
    if (voice) utter.voice = voice;
    utter.onend = () => {
      if (token !== generation) return;
      current = null;
      if (status === "paused") return;
      timer = setTimeout(() => { timer = null; next(token); }, 420);
    };
    utter.onerror = event => {
      if (token !== generation) return;
      current = null; queue = []; clearTimer(); setState("idle");
      if (!/interrupted|canceled/.test(event.error || "") && callbacks.onError) callbacks.onError(event.error);
    };
    setState("speaking");
    window.speechSynthesis.speak(utter);
  }
  function speakPoem(poem, opts) {
    stop();
    callbacks = opts || {};
    // A poem never falls back to device speech: its pronunciation must not vary
    // by browser/OS, including when the recording cannot be downloaded.
    if (poem && poem.id) return readPoemAudio(poem);
    if (!synthesisSupported()) { if (callbacks.onUnsupported) callbacks.onUnsupported(); return false; }
    window.speechSynthesis.resume();
    queue = [poem.title, [poem.dynasty, poem.author].filter(Boolean).join(" "), ...(poem.lines || [])].filter(Boolean).map(String);
    if (!queue.length) return false;
    index = 0;
    setState("speaking");
    const token = generation;
    timer = setTimeout(() => { timer = null; next(token); }, 60);
    return true;
  }
  function pause() {
    if (audio) {
      if (status !== "speaking" && status !== "loading") return;
      playAttempt++;
      clearTimer(); audio.pause(); setState("paused"); return;
    }
    if (!synthesisSupported() || status !== "speaking") return;
    clearTimer(); window.speechSynthesis.pause(); setState("paused");
  }
  function resume() {
    if (status !== "paused") return;
    if (audio) { playAudio(generation); return; }
    if (!synthesisSupported()) return;
    setState("speaking");
    // Native synthesis stays paused even when we paused between utterances.
    // Resume that engine before queuing the next sentence.
    window.speechSynthesis.resume();
    if (!current) next(generation);
  }
  global.ChenchenSpeech = { supported, speakPoem, stop, pause, resume, getStatus: () => status };
})(typeof window !== "undefined" ? window : globalThis);
