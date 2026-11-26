/* Local stroke-by-stroke assessment using the bundled Hanzi Writer 3.7.3. */
(function (global) {
  "use strict";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const SIZE = 300;
  const PADDING = 26;
  const ENGINE = "hanzi-writer-3.7.3";

  function validData(data) {
    return data && Array.isArray(data.strokes) && data.strokes.length > 0 && data.strokes.length <= 20 &&
      data.strokes.every(path => typeof path === "string" && path.length > 0) &&
      Array.isArray(data.medians) && data.medians.length === data.strokes.length &&
      data.medians.every(points => Array.isArray(points) && points.length >= 2 &&
        points.every(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)));
  }

  function create(options) {
    const { target, character } = options;
    if (!target || typeof target.appendChild !== "function") throw new Error("A writing target is required");
    if (typeof character !== "string" || Array.from(character).length !== 1) throw new Error("Choose one character to practice");
    const doc = target.ownerDocument || global.document;
    const make = name => doc.createElementNS(SVG_NS, name);
    const svg = make("svg");
    svg.setAttribute("viewBox", "0 0 300 300");
    svg.setAttribute("width", SIZE);
    svg.setAttribute("height", SIZE);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", character + "的逐笔书写练习");
    svg.style.width = "100%";
    svg.style.height = "100%";
    svg.style.display = "block";
    svg.style.touchAction = "none";
    svg.style.userSelect = "none";
    target.appendChild(svg);
    const defs = make("defs");
    svg.appendChild(defs);
    const ink = make("path");
    ink.setAttribute("fill", "none");
    ink.setAttribute("stroke", "#526f41");
    ink.setAttribute("stroke-width", "5");
    ink.setAttribute("stroke-linecap", "round");
    ink.setAttribute("stroke-linejoin", "round");
    ink.setAttribute("pointer-events", "none");
    let writer = null;
    let data = null;
    let status = "loading";
    let destroyed = false;
    let paused = false;
    let quizReady = false;
    let epoch = 0;
    let completed = 0;
    let totalMistakes = 0;
    let mistakesOnStroke = 0;
    let hintsUsed = 0;
    let outlineShown = options.showOutline !== false;
    let errorCode = null;
    let activePointer = null;
    let rawPoints = [];
    let submittedPoints = [];
    let hintRunning = false;
    let cancelHint = null;
    const attempts = [];
    const bridge = {};
    const loading = new global.AbortController();
    const listeners = [];
    const leniency = Number.isFinite(options.leniency) ? Math.max(0.7, Math.min(1.5, options.leniency)) : 1.15;

    function snapshot() {
      return { status, completed, total: data ? data.strokes.length : 0, totalMistakes, hintsUsed, outlineShown, error: errorCode };
    }
    function notify(next) {
      if (destroyed) return;
      status = next;
      if (typeof options.onState === "function") options.onState(snapshot());
    }
    function fail(code, cause) {
      if (destroyed) return;
      errorCode = code;
      quizReady = false;
      cancelPointer();
      notify("error");
      if (typeof options.onError === "function") options.onError(code, cause);
    }

    // rendererOverride is Hanzi Writer's supported render-target extension. Only
    // its event interface is replaced; the bundled SVG renderer and quiz matcher
    // remain in charge. No private quiz fields or permanent document listeners.
    function renderTarget(node) {
      return {
        node, svg: node, defs,
        getBoundingClientRect: () => node.getBoundingClientRect(),
        updateDimensions(width, height) { node.setAttribute("width", width); node.setAttribute("height", height); },
        createSubRenderTarget() { const group = make("g"); node.appendChild(group); return renderTarget(group); },
        addPointerStartListener(fn) { bridge.start = fn; },
        addPointerMoveListener(fn) { bridge.move = fn; },
        addPointerEndListener(fn) { bridge.end = fn; },
      };
    }

    function canDraw() { return !destroyed && quizReady && !paused && status === "active"; }
    function position(event) {
      const rect = svg.getBoundingClientRect();
      // A square viewBox is letterboxed if the container is not square.
      const scale = Math.min(rect.width, rect.height) / SIZE;
      if (!scale || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
      return {
        x: (event.clientX - rect.left - (rect.width - SIZE * scale) / 2) / scale,
        y: (event.clientY - rect.top - (rect.height - SIZE * scale) / 2) / scale,
        time: Number.isFinite(event.timeStamp) ? event.timeStamp : 0,
      };
    }
    function addPoint(event) {
      const point = position(event);
      if (!point) return;
      const previous = rawPoints[rawPoints.length - 1];
      if (!previous || point.x !== previous.x || point.y !== previous.y) rawPoints.push(point);
      ink.setAttribute("d", rawPoints.map((p, index) => (index ? "L" : "M") + p.x + " " + p.y).join(" "));
    }
    function releasePointer() {
      const id = activePointer;
      activePointer = null;
      if (id !== null && typeof svg.releasePointerCapture === "function") {
        try { svg.releasePointerCapture(id); } catch (_) { /* Already released by the browser. */ }
      }
    }
    function cancelPointer() {
      releasePointer();
      rawPoints = [];
      ink.setAttribute("d", "");
    }
    function down(event) {
      if (!canDraw() || activePointer !== null || event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
      const point = position(event);
      if (!point || point.x < 0 || point.y < 0 || point.x > SIZE || point.y > SIZE) return;
      event.preventDefault();
      activePointer = event.pointerId;
      rawPoints = [];
      svg.appendChild(ink);
      addPoint(event);
      if (typeof svg.setPointerCapture === "function") {
        try { svg.setPointerCapture(event.pointerId); } catch (_) { cancelPointer(); }
      }
    }
    function move(event) {
      if (activePointer === null || event.pointerId !== activePointer || !canDraw()) return;
      event.preventDefault();
      const coalesced = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
      coalesced.forEach(addPoint);
      addPoint(event);
    }
    function up(event) {
      if (activePointer === null || event.pointerId !== activePointer || !canDraw()) return;
      event.preventDefault();
      addPoint(event);
      submittedPoints = rawPoints.map(point => ({ ...point }));
      cancelPointer();
      // Buffer until release: a canceled gesture never enters the quiz matcher.
      if (submittedPoints.length < 2) return;
      const eventFor = point => ({ getPoint: () => ({ x: point.x, y: point.y }), preventDefault() {} });
      bridge.start(eventFor(submittedPoints[0]));
      submittedPoints.slice(1).forEach(point => bridge.move(eventFor(point)));
      bridge.end();
      submittedPoints = [];
    }
    function cancel(event) {
      if (activePointer !== null && event.pointerId === activePointer) cancelPointer();
    }
    function listen(name, fn) { svg.addEventListener(name, fn, { passive: false }); listeners.push([name, fn]); }
    listen("pointerdown", down);
    listen("pointermove", move);
    listen("pointerup", up);
    listen("pointercancel", cancel);
    listen("lostpointercapture", cancel);

    function saveAttempt(stroke, correct) {
      const attempt = {
        correct, strokeNum: stroke.strokeNum, isBackwards: Boolean(stroke.isBackwards),
        mistakesOnStroke: stroke.mistakesOnStroke, totalMistakes,
        drawnPath: {
          pathString: stroke.drawnPath.pathString,
          points: stroke.drawnPath.points.map(point => ({ ...point })),
        },
        rawPoints: submittedPoints.map(point => ({ ...point })),
      };
      attempts.push(attempt);
      return attempt;
    }
    function summary() {
      return { totalStrokes: data.strokes.length, completedStrokes: completed, totalMistakes, hintsUsed, outlineShown, engine: ENGINE, method: "stroke-quiz" };
    }
    function callbacks(id) {
      const current = () => !destroyed && id === epoch;
      return {
        // Wrong strokes can never become accepted simply because of retries.
        markStrokeCorrectAfterMisses: false, acceptBackwardsStrokes: false,
        showHintAfterMisses: false, highlightOnComplete: false,
        quizStartStrokeNum: 0, leniency,
        onMistake(stroke) {
          if (!current()) return;
          totalMistakes++;
          mistakesOnStroke++;
          const attempt = saveAttempt(stroke, false);
          notify(status);
          if (!current()) return;
          if (typeof options.onMistake === "function") options.onMistake({ ...stroke, totalMistakes, attempt });
          if (current() && mistakesOnStroke % 3 === 0) void showHint();
        },
        onCorrectStroke(stroke) {
          if (!current()) return;
          completed = stroke.strokeNum + 1;
          mistakesOnStroke = 0;
          const attempt = saveAttempt(stroke, true);
          notify(status);
          if (current() && typeof options.onCorrectStroke === "function") options.onCorrectStroke({ ...stroke, totalMistakes, attempt });
        },
        onComplete() {
          if (!current()) return;
          quizReady = false;
          notify("complete");
          if (current() && typeof options.onComplete === "function") options.onComplete(summary());
        },
      };
    }

    async function startQuiz() {
      const id = ++epoch;
      quizReady = false;
      writer.cancelQuiz();
      await (outlineShown ? writer.showOutline({ duration: 0 }) : writer.hideOutline({ duration: 0 }));
      if (destroyed || id !== epoch) return false;
      await writer.quiz(callbacks(id));
      if (destroyed || id !== epoch) {
        if (destroyed) { writer.cancelQuiz(); void writer.pauseAnimation(); }
        return false;
      }
      quizReady = true;
      notify(paused ? "paused" : "active");
      return true;
    }

    const readyPromise = (async () => {
      notify("loading");
      const timeout = setTimeout(() => loading.abort(), 15000);
      try {
        if (!global.HanziWriter) throw new Error("Writing library is unavailable");
        const response = await global.fetch("/data/strokes/" + character.codePointAt(0).toString(16) + ".json", { signal: loading.signal });
        if (!response.ok) throw new Error("Stroke data request failed: " + response.status);
        const loaded = await response.json();
        if (destroyed) return false;
        if (!validData(loaded)) throw new Error("Stroke data is invalid");
        data = loaded;
        writer = new global.HanziWriter(svg, {
          width: SIZE, height: SIZE, padding: PADDING, renderer: "svg",
          showCharacter: false, showOutline: outlineShown,
          strokeColor: "#526f41", outlineColor: "#d8dfca", drawingColor: "#526f41", highlightColor: "#bd7439",
          strokeFadeDuration: 0, drawingFadeDuration: 0, strokeHighlightSpeed: 1.5,
          charDataLoader: () => data,
          rendererOverride: { createRenderTarget: () => renderTarget(svg) },
        });
        await writer.setCharacter(character);
        if (destroyed) { writer.cancelQuiz(); void writer.pauseAnimation(); return false; }
        notify("ready");
        return await startQuiz();
      } catch (cause) {
        if (!destroyed) fail("writing-data-unavailable", cause);
        return false;
      } finally { clearTimeout(timeout); }
    })();

    function pause() {
      if (destroyed || status === "complete" || status === "error") return false;
      paused = true;
      cancelPointer();
      if (quizReady) notify("paused");
      return true;
    }
    function resume() {
      if (destroyed || status === "complete" || status === "error") return false;
      paused = false;
      if (quizReady) notify("active");
      return true;
    }
    async function restart(next = {}) {
      if (destroyed || !data || !writer) return false;
      cancelPointer();
      if (cancelHint) cancelHint();
      paused = false;
      completed = totalMistakes = mistakesOnStroke = hintsUsed = 0;
      hintRunning = false;
      attempts.length = 0;
      errorCode = null;
      if (typeof next.showOutline === "boolean") outlineShown = next.showOutline;
      notify("ready");
      try { return await startQuiz(); }
      catch (cause) { fail("writing-quiz-unavailable", cause); return false; }
    }
    async function showHint() {
      if (!canDraw() || hintRunning || completed >= data.strokes.length) return false;
      cancelPointer();
      const id = epoch;
      hintRunning = true;
      hintsUsed++;
      notify(status);
      if (destroyed || id !== epoch) return false;
      const canceled = new Promise(resolve => { cancelHint = () => resolve(false); });
      try {
        const result = await Promise.race([writer.highlightStroke(completed).then(() => true), canceled]);
        return result && !destroyed && id === epoch;
      } catch (cause) {
        if (!destroyed && id === epoch) fail("writing-hint-unavailable", cause);
        return false;
      } finally { if (id === epoch) { hintRunning = false; cancelHint = null; } }
    }
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      status = "destroyed";
      epoch++;
      quizReady = false;
      loading.abort();
      if (cancelHint) { cancelHint(); cancelHint = null; }
      cancelPointer();
      listeners.forEach(([name, fn]) => svg.removeEventListener(name, fn));
      if (writer) { writer.cancelQuiz(); void writer.pauseAnimation(); }
      svg.remove();
    }

    return {
      ready: readyPromise, pause, resume, restart, showHint, destroy, getState: snapshot,
      getAttempts: () => JSON.parse(JSON.stringify(attempts)),
    };
  }

  global.ChenchenWritingPractice = { create };
})(typeof window !== "undefined" ? window : globalThis);
