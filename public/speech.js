/* 古诗朗读 — Web Speech API */
(function (global) {
  "use strict";

  const RATE = 0.88;
  const LANG = "zh-CN";
  const GAP_MS = 420;

  let queue = [];
  let idx = 0;
  let speaking = false;
  let paused = false;
  let currentUtter = null;
  let gapTimer = null;
  let onState = null;

  function supported() {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  function clearGap() {
    if (gapTimer) {
      clearTimeout(gapTimer);
      gapTimer = null;
    }
  }

  function setState(s) {
    speaking = s === "speaking";
    paused = s === "paused";
    if (typeof onState === "function") onState(s);
  }

  function pickVoice() {
    const voices = window.speechSynthesis.getVoices() || [];
    const zh = voices.filter(
      (v) =>
        (v.lang || "").toLowerCase().startsWith("zh") ||
        /chinese|中文|普通话|国语/i.test(v.name || "")
    );
    // Prefer mainland / simplified if available
    return (
      zh.find((v) => /zh-CN|China|中国大陆|普通话/i.test(v.lang + v.name)) ||
      zh[0] ||
      null
    );
  }

  function stop() {
    clearGap();
    queue = [];
    idx = 0;
    currentUtter = null;
    if (supported()) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) {}
    }
    setState("idle");
  }

  function pause() {
    if (!supported() || !speaking || paused) return;
    try {
      window.speechSynthesis.pause();
      setState("paused");
    } catch (_) {}
  }

  function resume() {
    if (!supported() || !paused) return;
    try {
      window.speechSynthesis.resume();
      setState("speaking");
    } catch (_) {}
  }

  function speakNext() {
    if (!queue.length || idx >= queue.length) {
      currentUtter = null;
      setState("idle");
      return;
    }
    const text = queue[idx];
    idx += 1;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LANG;
    u.rate = RATE;
    u.pitch = 1;
    const voice = pickVoice();
    if (voice) u.voice = voice;
    currentUtter = u;
    u.onend = () => {
      currentUtter = null;
      if (!queue.length) {
        setState("idle");
        return;
      }
      // brief pause between segments
      clearGap();
      gapTimer = setTimeout(() => {
        gapTimer = null;
        if (queue.length) speakNext();
      }, GAP_MS);
    };
    u.onerror = () => {
      currentUtter = null;
      // skip and continue unless cancelled
      if (queue.length && idx <= queue.length) {
        clearGap();
        gapTimer = setTimeout(() => {
          gapTimer = null;
          if (queue.length) speakNext();
        }, 200);
      } else {
        setState("idle");
      }
    };
    setState("speaking");
    window.speechSynthesis.speak(u);
  }

  /**
   * @param {{ title: string, dynasty?: string, author?: string, lines: string[] }} poem
   * @param {{ onState?: (s: string) => void, onUnsupported?: () => void }} [opts]
   */
  function speakPoem(poem, opts) {
    opts = opts || {};
    onState = opts.onState || null;
    if (!supported()) {
      setState("idle");
      if (opts.onUnsupported) opts.onUnsupported();
      return false;
    }
    // Some browsers need getVoices() warmed up
    window.speechSynthesis.getVoices();
    stop();
    onState = opts.onState || null;
    const parts = [];
    if (poem.title) parts.push(String(poem.title).trim());
    const byline = [poem.dynasty, poem.author].filter(Boolean).join(" ");
    if (byline) parts.push(byline);
    (poem.lines || []).forEach((line) => {
      const t = String(line || "").trim();
      if (t) parts.push(t);
    });
    if (!parts.length) {
      setState("idle");
      return false;
    }
    queue = parts;
    idx = 0;
    // Chrome sometimes needs a tick after cancel
    setTimeout(() => speakNext(), 60);
    return true;
  }

  function getStatus() {
    if (paused) return "paused";
    if (speaking) return "speaking";
    return "idle";
  }

  global.ChenchenSpeech = {
    supported,
    speakPoem,
    stop,
    pause,
    resume,
    getStatus,
  };
})(typeof window !== "undefined" ? window : globalThis);
