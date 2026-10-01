/* Bundled Mandarin stroke announcements; no device speech or remote service. */
(function (global) {
  "use strict";

  const PLAYBACK_TIMEOUT_MS = 20000;
  const clipPath = index => `/audio/writing/stroke-${String(index).padStart(2, "0")}.mp3`;

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
      // Safari grants playback permission per element, so keep this one for
      // every stroke. Preloading must never start playback without a tap.
      audio = new global.Audio();
      audio.preload = "auto";
      audio.src = clipPath(1);
      audio.load();
    } catch (error) {
      setupError = error;
    }

    function silence() {
      if (!audio) return;
      try { audio.pause(); } catch (_) { /* Cleanup must still settle the promise. */ }
      try { audio.currentTime = 0; } catch (_) { /* Media may not have loaded yet. */ }
    }

    function finish(request, error) {
      // Old play() rejections, timers, and media handlers cannot settle a new clip.
      if (current !== request) return;
      current = null;
      clearTimeout(request.timer);
      audio.removeEventListener("ended", request.onEnded);
      audio.removeEventListener("error", request.onError);
      if (request.signal) request.signal.removeEventListener("abort", request.onAbort);
      if (error) {
        silence();
        request.reject(error);
      } else {
        request.resolve();
      }
    }

    function stop() {
      if (current) finish(current, audioError("AbortError", "Writing narration stopped."));
      else silence();
    }

    function playStroke(index, signal) {
      if (destroyed) return Promise.reject(audioError("InvalidStateError", "Writing audio player was destroyed."));
      if (!Number.isInteger(index) || index < 1 || index > 20) {
        return Promise.reject(audioError("RangeError", "Stroke number must be an integer from 1 to 20."));
      }
      if (signal && signal.aborted) return Promise.reject(audioError("AbortError", "Writing narration aborted."));
      if (setupError) return Promise.reject(setupError);
      stop();

      return new Promise((resolve, reject) => {
        const request = { resolve, reject, signal, timer: null };
        request.onEnded = () => finish(request);
        request.onError = () => finish(request, audioError("AudioError", "Writing narration could not play."));
        request.onAbort = () => finish(request, audioError("AbortError", "Writing narration aborted."));
        current = request;
        audio.addEventListener("ended", request.onEnded);
        audio.addEventListener("error", request.onError);
        if (signal) signal.addEventListener("abort", request.onAbort, { once: true });
        request.timer = setTimeout(() => {
          finish(request, audioError("TimeoutError", "Writing narration timed out."));
        }, PLAYBACK_TIMEOUT_MS);

        try {
          audio.src = clipPath(index);
          // Keep this synchronous with the click that requested playback.
          // Fetching a manifest or awaiting anything here loses user activation.
          const playback = audio.play();
          if (playback && typeof playback.catch === "function") {
            playback.catch(error => finish(request, error || audioError("AudioError", "Writing narration could not play.")));
          }
        } catch (error) {
          finish(request, error);
        }
      });
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      if (audio) {
        try {
          audio.removeAttribute("src");
          audio.load();
        } catch (_) { /* All pending playback has already been cancelled. */ }
      }
    }

    return { playStroke, stop, destroy };
  }

  global.ChenchenWritingAudio = { create };
})(typeof window !== "undefined" ? window : globalThis);
