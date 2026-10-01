/* Fixed, reviewed English and Chinese recordings. Device speech is never a fallback. */
(function (global) {
  "use strict";

  const MANIFEST_URL = "/data/english-audio.json";
  const LOAD_TIMEOUT_MS = 20000;
  let manifestPromise = null;
  let manifest = null;

  function audioError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  function validateManifest(data) {
    const entries = data && Object.prototype.hasOwnProperty.call(data, "clips") ? data.clips : data;
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) throw audioError("audio-manifest-invalid");
    const clips = Object.create(null);
    for (const [key, clip] of Object.entries(entries)) {
      // Keep all recordings inside this app. Reject traversal, URL parameters,
      // encoded paths, and remote media, even if the manifest is malformed.
      if (!clip || typeof clip.src !== "string" ||
          !/^\/audio\/english\/[a-zA-Z0-9][a-zA-Z0-9_./-]*\.(mp3|m4a|wav|ogg)$/.test(clip.src) ||
          clip.src.includes("//") || clip.src.split("/").some(segment => segment === "." || segment === "..")) {
        throw audioError("audio-manifest-invalid");
      }
      clips[key] = clip.src;
    }
    if (!Object.keys(clips).length) throw audioError("audio-manifest-invalid");
    return clips;
  }

  function loadManifest() {
    if (manifestPromise) return manifestPromise;
    // A failed request is cleared so a later, explicit tap can retry. There is
    // no background retry loop, including when the browser blocks playback.
    const request = new Promise((resolve, reject) => {
      const controller = typeof global.AbortController === "function" ? new global.AbortController() : null;
      let finished = false;
      const finish = (error, result) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(result);
      };
      const timer = setTimeout(() => {
        finish(audioError("audio-manifest-unavailable"));
        if (controller) controller.abort();
      }, LOAD_TIMEOUT_MS);
      try {
        Promise.resolve(global.fetch(MANIFEST_URL, controller ? { signal: controller.signal } : {}))
          .then(response => {
            if (!response.ok) throw audioError("audio-manifest-unavailable");
            return response.json();
          })
          .then(data => finish(null, validateManifest(data)))
          .catch(error => finish(audioError(error && error.code === "audio-manifest-invalid" ? error.code : "audio-manifest-unavailable")));
      } catch (_) {
        finish(audioError("audio-manifest-unavailable"));
      }
    });
    manifestPromise = request.then(clips => {
      manifest = clips;
      return clips;
    }).catch(error => {
      manifestPromise = null;
      throw error;
    });
    return manifestPromise;
  }

  function create(options) {
    const callbacks = options || {};
    let status = "idle";
    let generation = 0;
    let session = null;
    // Safari grants playback permission per media element. Keep this element
    // for later clips and replay taps rather than asking permission anew.
    let audioElement = null;

    function notify(callback, value) {
      // UI callbacks must not strand an active recording or its completion promise.
      if (typeof callback === "function") {
        try { callback(value); } catch (_) { /* The caller owns its UI errors. */ }
      }
    }
    function setState(next) {
      if (status === next) return;
      status = next;
      notify(callbacks.onState, next);
    }
    function active(current) {
      return current === session && current.token === generation && !current.settled;
    }
    function clearLoadTimer(current) {
      clearTimeout(current.loadTimer);
      current.loadTimer = null;
    }
    function clearGapTimer(current) {
      clearTimeout(current.gapTimer);
      current.gapTimer = null;
    }
    function releaseAudio(current) {
      current.playAttempt++;
      current.mediaGeneration++;
      const recording = current.audio;
      current.audio = null;
      if (!recording) return;
      recording.onplaying = recording.onended = recording.onerror = recording.onwaiting = recording.onstalled = null;
      try {
        recording.pause();
        recording.removeAttribute("src");
        recording.load();
      } catch (_) { /* Cleanup should also work when a device loses its audio output. */ }
    }
    function cleanup(current) {
      clearLoadTimer(current);
      clearGapTimer(current);
      releaseAudio(current);
    }
    function finish(current, completed, code) {
      if (!active(current)) return;
      current.settled = true;
      cleanup(current);
      session = null;
      current.resolve(completed);
      setState(code ? "error" : "idle");
      if (code && generation === current.token) notify(callbacks.onError, code);
      // A callback that starts another activity must not also advance the old one.
      if (completed && generation === current.token && session === null) notify(current.onEnd);
    }
    function stop() {
      generation++;
      const current = session;
      session = null;
      if (current) {
        current.settled = true;
        cleanup(current);
        current.resolve(false);
      }
      setState("idle");
    }
    function waitForAudio(current) {
      clearLoadTimer(current);
      current.loadTimer = setTimeout(() => {
        if (active(current) && !current.paused) finish(current, false, "audio-load-timeout");
      }, LOAD_TIMEOUT_MS);
    }
    function playRecording(current) {
      if (!active(current) || current.paused || !current.audio) return;
      const recording = current.audio;
      const attempt = ++current.playAttempt;
      setState("loading");
      if (!active(current) || current.paused) return;
      waitForAudio(current);
      const failed = error => {
        if (!active(current) || current.audio !== recording || current.playAttempt !== attempt || current.paused) return;
        finish(current, false, error && error.name === "NotAllowedError" ? "audio-playback-blocked" : "audio-unavailable");
      };
      try {
        const playback = recording.play();
        if (playback && typeof playback.catch === "function") playback.catch(failed);
      } catch (error) { failed(error); }
    }
    function scheduleGap(current) {
      if (!active(current) || current.paused) return;
      setState("speaking");
      if (!active(current) || current.paused) return;
      current.gapStarted = Date.now();
      current.gapTimer = setTimeout(() => {
        current.gapTimer = null;
        current.gapRemaining = 0;
        startTrack(current);
      }, current.gapRemaining);
    }
    function startTrack(current) {
      if (!active(current) || current.paused) return;
      if (current.index >= current.tracks.length) { finish(current, true); return; }
      let recording;
      try {
        if (!audioElement) audioElement = new global.Audio();
        recording = audioElement;
      } catch (_) { finish(current, false, "audio-unsupported"); return; }
      current.phase = "audio";
      current.audio = recording;
      const mediaGeneration = ++current.mediaGeneration;
      recording.preload = "auto";
      recording.src = current.tracks[current.index];
      const isCurrentRecording = () => active(current) && current.audio === recording && current.mediaGeneration === mediaGeneration;
      recording.onplaying = () => {
        if (!isCurrentRecording() || current.paused) return;
        clearLoadTimer(current);
        setState("speaking");
      };
      recording.onwaiting = recording.onstalled = () => {
        if (!isCurrentRecording() || current.paused) return;
        setState("loading");
        if (isCurrentRecording() && !current.paused) waitForAudio(current);
      };
      recording.onerror = () => {
        if (isCurrentRecording()) finish(current, false, "audio-unavailable");
      };
      recording.onended = () => {
        if (!isCurrentRecording()) return;
        clearLoadTimer(current);
        releaseAudio(current);
        current.index++;
        if (current.index >= current.tracks.length) {
          current.phase = "complete";
          if (!current.paused) finish(current, true);
        } else {
          current.phase = "gap";
          current.gapRemaining = current.gapMs;
          scheduleGap(current);
        }
      };
      playRecording(current);
    }
    function play(keys, opts) {
      stop();
      const settings = opts || {};
      const requested = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys.slice() : [];
      let resolve;
      const result = new Promise(done => { resolve = done; });
      const current = {
        token: generation, resolve, onEnd: settings.onEnd,
        audio: null, tracks: null, index: 0, phase: "manifest", paused: false, settled: false,
        playAttempt: 0, mediaGeneration: 0, loadTimer: null, gapTimer: null, gapStarted: 0, gapRemaining: 0,
        gapMs: Number.isFinite(settings.gapMs) ? Math.max(0, Math.min(10000, settings.gapMs)) : 400
      };
      session = current;
      if (!requested.length || requested.some(key => typeof key !== "string" || !key)) {
        finish(current, false, "audio-not-found");
      } else if (typeof global.Audio !== "function") {
        finish(current, false, "audio-unsupported");
      } else {
        setState("loading");
        const begin = clips => {
          if (!active(current)) return;
          if (requested.some(key => !Object.prototype.hasOwnProperty.call(clips, key))) {
            finish(current, false, "audio-not-found");
            return;
          }
          current.tracks = requested.map(key => clips[key]);
          current.phase = "ready";
          startTrack(current);
        };
        // Once loaded, call play() in the original click handler, preserving
        // browser user activation. A blocked initial load can be retried by tap.
        if (manifest) begin(manifest);
        else loadManifest().then(begin).catch(error => {
          if (active(current)) finish(current, false, error.code || "audio-manifest-unavailable");
        });
      }
      return result;
    }
    function pause() {
      const current = session;
      if (!current || current.paused) return;
      current.paused = true;
      current.playAttempt++;
      clearLoadTimer(current);
      if (current.phase === "gap" && current.gapTimer !== null) {
        current.gapRemaining = Math.max(0, current.gapRemaining - (Date.now() - current.gapStarted));
        clearGapTimer(current);
      }
      if (current.audio) {
        try { current.audio.pause(); } catch (_) { /* Resume will report an unusable device. */ }
      }
      setState("paused");
    }
    function resume() {
      const current = session;
      if (!current || !current.paused) return;
      current.paused = false;
      if (current.phase === "manifest") setState("loading");
      else if (current.phase === "gap") scheduleGap(current);
      else if (current.phase === "audio") playRecording(current);
      else if (current.phase === "complete") finish(current, true);
      else startTrack(current);
    }
    function preload() {
      return loadManifest().then(() => true, () => false);
    }
    return { play, stop, pause, resume, preload, getStatus: () => status };
  }

  global.ChenchenEnglishAudio = { create };
})(typeof window !== "undefined" ? window : globalThis);
