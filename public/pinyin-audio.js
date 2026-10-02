/* Local pronunciation recordings: pinyin sounds and their example characters. */
(function (global) {
  "use strict";

  const LOAD_TIMEOUT_MS = 20000;
  const SOUNDS = new Set([
    "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x",
    "zh", "ch", "sh", "r", "z", "c", "s", "y", "w",
    "a", "o", "e", "i", "u", "ü", "ai", "ei", "ui", "ao", "ou", "iu",
    "ie", "üe", "er", "an", "en", "in", "un", "ün", "ang", "eng", "ing", "ong",
  ]);
  const CHARACTER = /^[\u3400-\u4dbf\u4e00-\u9fff\u{20000}-\u{2fa1f}]$/u;

  function audioError(name, message) {
    const error = new Error(message);
    error.name = name;
    return error;
  }

  function create() {
    let audio = null;
    let setupError = null;
    let current = null;
    let destroyed = false;
    try {
      // One element keeps Safari's user-activation permission between taps.
      audio = new global.Audio();
      audio.preload = "none";
      // A delayed start must not revive narration after leaving the page.
      audio.onplaying = () => { if (!current || destroyed) silence(); };
    } catch (error) {
      setupError = error;
    }

    function silence() {
      if (!audio) return;
      try { audio.pause(); } catch (_) { /* Still settle pending work. */ }
      try { audio.currentTime = 0; } catch (_) { /* Data may not be ready yet. */ }
    }

    function finish(request, error) {
      if (current !== request) return;
      current = null;
      clearTimeout(request.timer);
      for (const [event, handler] of Object.entries(request.handlers)) {
        audio.removeEventListener(event, handler);
      }
      if (request.signal) request.signal.removeEventListener("abort", request.onAbort);
      if (error) {
        silence();
        request.reject(error);
      } else request.resolve();
    }

    function stop() {
      if (current) finish(current, audioError("AbortError", "Pinyin narration stopped."));
      else silence();
    }

    function playSource(src, signal) {
      if (destroyed) return Promise.reject(audioError("InvalidStateError", "Pinyin audio player was destroyed."));
      if (signal && signal.aborted) return Promise.reject(audioError("AbortError", "Pinyin narration aborted."));
      if (setupError) return Promise.reject(setupError);
      stop();

      return new Promise((resolve, reject) => {
        const request = { resolve, reject, signal, timer: null, handlers: null };
        const waitForAudio = () => {
          if (current !== request || request.timer !== null) return;
          request.timer = setTimeout(() => {
            finish(request, audioError("TimeoutError", "Pinyin narration could not load."));
          }, LOAD_TIMEOUT_MS);
        };
        request.onAbort = () => finish(request, audioError("AbortError", "Pinyin narration aborted."));
        request.handlers = {
          playing: () => {
            if (current !== request) {
              if (!current) silence();
              return;
            }
            clearTimeout(request.timer);
            request.timer = null;
          },
          waiting: waitForAudio,
          stalled: waitForAudio,
          ended: () => finish(request),
          error: () => finish(request, audioError("AudioError", "Pinyin narration could not play.")),
        };
        current = request;
        for (const [event, handler] of Object.entries(request.handlers)) {
          audio.addEventListener(event, handler);
        }
        if (signal) signal.addEventListener("abort", request.onAbort, { once: true });
        waitForAudio();
        try {
          audio.src = src;
          // No fetch or await before this call: it must run within the tap.
          const playback = audio.play();
          if (playback && typeof playback.then === "function") {
            playback.then(() => {
              if (!current || destroyed) silence();
            }, error => finish(request, error || audioError("AudioError", "Pinyin narration could not play.")));
          }
        } catch (error) { finish(request, error); }
      });
    }

    function playSound(id, signal) {
      if (!SOUNDS.has(id)) return Promise.reject(audioError("RangeError", "Invalid pinyin sound."));
      return playSource(`/audio/pinyin/sound-${id.replace(/ü/g, "v")}.mp3`, signal);
    }

    function playExample(character, signal) {
      if (typeof character !== "string" || !CHARACTER.test(character)) {
        return Promise.reject(audioError("RangeError", "A single Chinese character is required."));
      }
      return playSource(`/audio/pinyin/examples/char-${character.codePointAt(0).toString(16)}.mp3`, signal);
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      if (audio) {
        try {
          audio.removeAttribute("src");
          audio.load();
        } catch (_) { /* Pending playback is already cancelled. */ }
      }
    }

    return { playSound, playExample, stop, destroy };
  }

  global.ChenchenPinyinAudio = { create };
})(typeof window !== "undefined" ? window : globalThis);
