/* Local, narrated stroke demonstrations. Drawing practice stays on its own canvas. */
(function (global) {
  "use strict";
  const SVG_NS = "http://www.w3.org/2000/svg";

  function abortError() {
    const error = new Error("Stroke playback was stopped");
    error.name = "AbortError";
    return error;
  }

  function abortable(promise, signal) {
    if (signal.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const abort = () => { cleanup(); reject(abortError()); };
      const cleanup = () => signal.removeEventListener("abort", abort);
      signal.addEventListener("abort", abort, { once: true });
      Promise.resolve(promise).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    });
  }

  function wait(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(abortError()); return; }
      const abort = () => { clearTimeout(timer); reject(abortError()); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
      signal.addEventListener("abort", abort, { once: true });
    });
  }

  function validData(data) {
    return data && Array.isArray(data.strokes) && data.strokes.length > 0 && data.strokes.length <= 20 &&
      data.strokes.every(path => typeof path === "string" && path.length > 0) &&
      Array.isArray(data.medians) && data.medians.length === data.strokes.length &&
      data.medians.every(points => Array.isArray(points) && points.length >= 2 &&
        points.every(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)));
  }

  function create(options) {
    const { target, character } = options;
    if (!target || typeof target.appendChild !== "function") throw new Error("A stroke drawing target is required");
    if (typeof character !== "string" || Array.from(character).length !== 1) throw new Error("Choose one character to demonstrate");
    const doc = target.ownerDocument || global.document;
    const make = name => doc.createElementNS(SVG_NS, name);
    const svg = make("svg");
    svg.setAttribute("viewBox", "0 0 300 300");
    svg.setAttribute("width", "300");
    svg.setAttribute("height", "300");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", character + "的逐笔书写示范");
    svg.style.width = "100%";
    svg.style.height = "100%";
    svg.style.display = "block";
    svg.style.pointerEvents = "none";
    target.appendChild(svg);
    let writer = null;
    let data = null;
    let completedGroup = null;
    let completed = 0;
    let current = 0;
    let status = "loading";
    let destroyed = false;
    let ready = false;
    let runId = 0;
    let playback = null;
    let errorCode = null;
    const loading = new global.AbortController();

    function snapshot() { return { status, stroke: current, total: data ? data.strokes.length : 0, completed, error: errorCode }; }
    function notify(next) {
      status = next;
      if (typeof options.onState === "function") options.onState(snapshot());
    }
    function error(code, cause) {
      errorCode = code;
      notify("error");
      if (typeof options.onError === "function") options.onError(code, cause);
    }

    // This viewer does not run Hanzi Writer quizzes. A rendering-only target keeps
    // its otherwise permanent document pointer listeners out of page navigation.
    function renderTarget(node, defs) {
      return {
        node, svg: node, defs,
        getBoundingClientRect: () => node.getBoundingClientRect(),
        updateDimensions(width, height) { node.setAttribute("width", width); node.setAttribute("height", height); },
        createSubRenderTarget() { const group = make("g"); node.appendChild(group); return renderTarget(group, defs); },
        addPointerStartListener() {}, addPointerMoveListener() {}, addPointerEndListener() {},
      };
    }

    function hideCurrent() {
      // hideCharacter also cancels an in-flight single stroke. Finished strokes
      // live in a separate SVG group, so a stopped half-stroke never counts.
      return writer ? writer.hideCharacter({ duration: 0 }) : Promise.resolve();
    }

    const readyPromise = (async () => {
      notify("loading");
      const timeout = setTimeout(() => loading.abort(), 15000);
      try {
        if (!global.HanziWriter) throw new Error("Stroke drawing library is unavailable");
        const response = await global.fetch("/data/strokes/" + character.codePointAt(0).toString(16) + ".json", { signal: loading.signal });
        if (!response.ok) throw new Error("Stroke data request failed: " + response.status);
        const loaded = await response.json();
        if (destroyed) return false;
        if (!validData(loaded)) throw new Error("Stroke data is invalid");
        data = loaded;
        const defs = make("defs");
        svg.appendChild(defs);
        writer = new global.HanziWriter(svg, {
          width: 300, height: 300, padding: 26,
          renderer: "svg", showCharacter: false, showOutline: true,
          strokeColor: "#bd7439", outlineColor: "#d8dfca",
          strokeAnimationSpeed: 0.7, strokeFadeDuration: 0,
          charDataLoader: () => data,
          rendererOverride: { createRenderTarget: () => renderTarget(svg, defs) },
        });
        await writer.setCharacter(character);
        if (destroyed) { await hideCurrent(); return false; }
        completedGroup = make("g");
        completedGroup.setAttribute("transform", global.HanziWriter.getScalingTransform(300, 300, 26).transform);
        completedGroup.setAttribute("fill", "#526f41");
        svg.appendChild(completedGroup);
        ready = true;
        notify("ready");
        return true;
      } catch (cause) {
        if (!destroyed) error("stroke-data-unavailable", cause);
        return false;
      } finally { clearTimeout(timeout); }
    })();

    function isCurrent(id, signal) { return !destroyed && id === runId && !signal.aborted; }

    async function run(all) {
      if (!ready || destroyed || status === "playing") return false;
      const id = ++runId;
      playback = new global.AbortController();
      const signal = playback.signal;
      errorCode = null;
      if (all || completed === data.strokes.length) {
        completed = 0;
        completedGroup.replaceChildren();
      }
      current = completed;
      notify("playing");
      try {
        // Start the first recording in the original button-click call stack.
        // Safari can otherwise lose media permission while awaiting SVG work.
        const hiding = hideCurrent();
        do {
          if (!isCurrent(id, signal)) return false;
          const index = completed;
          current = index + 1;
          notify("playing");
          if (typeof options.onStroke === "function") options.onStroke(current, data.strokes.length);
          if (!isCurrent(id, signal)) return false;
          const narration = typeof options.playStroke === "function" ? options.playStroke(current, signal) : undefined;
          await abortable(Promise.all([hiding, narration]), signal);
          if (!isCurrent(id, signal)) return false;
          const result = await abortable(writer.animateStroke(index), signal);
          if (!isCurrent(id, signal) || (result && result.canceled)) return false;
          const path = make("path");
          path.setAttribute("d", data.strokes[index]);
          completedGroup.appendChild(path);
          completed++;
          await abortable(hideCurrent(), signal);
          if (!isCurrent(id, signal)) return false;
          if (completed === data.strokes.length) { notify("complete"); return true; }
          if (!all) { notify("paused"); return true; }
          await wait(300, signal);
        } while (isCurrent(id, signal));
        return false;
      } catch (cause) {
        if (isCurrent(id, signal)) {
          await hideCurrent();
          if (isCurrent(id, signal)) error("stroke-playback-unavailable", cause);
        }
        return false;
      } finally { if (id === runId) playback = null; }
    }

    function stop() {
      if (destroyed) return;
      runId++;
      if (playback) playback.abort();
      playback = null;
      current = completed;
      if (ready) {
        void hideCurrent();
        errorCode = null;
        notify(completed === data.strokes.length ? "complete" : completed ? "paused" : "ready");
      }
    }

    function restart() {
      if (destroyed || !ready) return false;
      stop();
      completed = current = 0;
      completedGroup.replaceChildren();
      notify("ready");
      return true;
    }

    function destroy() {
      if (destroyed) return;
      stop();
      destroyed = true;
      ready = false;
      loading.abort();
      svg.remove();
      notify("destroyed");
    }

    return { ready: readyPromise, play: () => run(true), next: () => run(false), restart, stop, destroy, getState: snapshot };
  }

  global.ChenchenWritingStrokes = { create };
})(typeof window !== "undefined" ? window : globalThis);
