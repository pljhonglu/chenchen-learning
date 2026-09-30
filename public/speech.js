/* Mandarin reading with cancellable segments and a visible fallback in the caller. */
(function (global) {
  "use strict";
  let queue = [];
  let index = 0;
  let status = "idle";
  let timer = null;
  let current = null;
  let generation = 0;
  let callbacks = {};
  function supported() {
    return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
  }
  function setState(next) {
    status = next;
    if (callbacks.onState) callbacks.onState(next);
  }
  function clearTimer() { clearTimeout(timer); timer = null; }
  function pickVoice() {
    const voices = window.speechSynthesis.getVoices().filter(v => /^zh/i.test(v.lang || ""));
    return voices.find(v => /^zh[-_]CN$/i.test(v.lang)) || voices[0] || null;
  }
  function stop() {
    generation++;
    clearTimer();
    queue = []; index = 0; current = null;
    if (supported()) window.speechSynthesis.cancel();
    setState("idle");
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
    if (!supported()) { if (callbacks.onUnsupported) callbacks.onUnsupported(); return false; }
    queue = [poem.title, [poem.dynasty, poem.author].filter(Boolean).join(" "), ...(poem.lines || [])].filter(Boolean).map(String);
    if (!queue.length) return false;
    index = 0;
    setState("speaking");
    const token = generation;
    timer = setTimeout(() => { timer = null; next(token); }, 60);
    return true;
  }
  function pause() {
    if (!supported() || status !== "speaking") return;
    clearTimer(); window.speechSynthesis.pause(); setState("paused");
  }
  function resume() {
    if (!supported() || status !== "paused") return;
    setState("speaking");
    // Native synthesis stays paused even when we paused between utterances.
    // Resume that engine before queuing the next sentence.
    window.speechSynthesis.resume();
    if (!current) next(generation);
  }
  global.ChenchenSpeech = { supported, speakPoem, stop, pause, resume, getStatus: () => status };
})(typeof window !== "undefined" ? window : globalThis);
