#!/usr/bin/env python3
"""Idempotent: add poem read-aloud (Web Speech API) to classic site files."""
from pathlib import Path

# speech.js lives next to this script when deployed as scripts/apply_read_aloud.py
# with scripts/read-aloud/speech.js — or fall back to sibling speech.js template.
CANDIDATES = [
    Path(__file__).resolve().parent / "read-aloud" / "speech.js",
    Path("scripts/read-aloud/speech.js"),
    Path("speech.js"),
]

CSS_BLOCK = """
/* Speak controls */
.speak-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin: 8px 0 18px;
  position: relative;
  z-index: 1;
}
.speak-bar .btn-speak {
  background: #fff4e5;
  color: #b45309;
  border: 1.5px solid rgba(245, 166, 35, 0.35);
}
.speak-bar .btn-speak.is-active {
  background: var(--orange);
  color: #fff;
  border-color: var(--orange);
}
.speak-bar .btn-speak-secondary {
  background: #f3f4f6;
  color: var(--ink);
}
.speak-bar .btn[disabled] {
  opacity: 0.45;
  cursor: not-allowed;
}
"""

HELPER = r"""
  function stopSpeechSafe() {
    try {
      if (window.ChenchenSpeech) ChenchenSpeech.stop();
    } catch (_) {}
  }

  function updateSpeakButtons(state) {
    const play = document.getElementById("btn-speak");
    const pause = document.getElementById("btn-speak-pause");
    const stop = document.getElementById("btn-speak-stop");
    if (!play) return;
    const speaking = state === "speaking";
    const paused = state === "paused";
    play.classList.toggle("is-active", speaking || paused);
    play.textContent = speaking || paused ? "🔊 朗读中" : "🔊 朗读";
    if (pause) {
      pause.disabled = !(speaking || paused);
      pause.textContent = paused ? "▶️ 继续" : "⏸️ 暂停";
    }
    if (stop) stop.disabled = !(speaking || paused);
  }

"""

BIND = r"""
    const btnSpeak = document.getElementById("btn-speak");
    const btnPause = document.getElementById("btn-speak-pause");
    const btnStop = document.getElementById("btn-speak-stop");
    updateSpeakButtons("idle");
    if (btnSpeak) {
      btnSpeak.onclick = () => {
        if (!window.ChenchenSpeech || !ChenchenSpeech.supported()) {
          toast("当前浏览器没有可用的语音引擎，请换 Chrome / Edge / Safari 试试");
          return;
        }
        const st = ChenchenSpeech.getStatus();
        if (st === "speaking" || st === "paused") {
          ChenchenSpeech.stop();
        }
        const ok = ChenchenSpeech.speakPoem(
          {
            title: displayTitle,
            dynasty: poem.dynasty,
            author: poem.author,
            lines: poem.lines.map((ln) => ln.text),
          },
          {
            onState: updateSpeakButtons,
            onUnsupported: () =>
              toast("当前浏览器没有可用的语音引擎，请换 Chrome / Edge / Safari 试试"),
          }
        );
        if (ok) updateSpeakButtons("speaking");
      };
    }
    if (btnPause) {
      btnPause.onclick = () => {
        if (!window.ChenchenSpeech) return;
        if (ChenchenSpeech.getStatus() === "paused") {
          ChenchenSpeech.resume();
          updateSpeakButtons("speaking");
        } else {
          ChenchenSpeech.pause();
          updateSpeakButtons("paused");
        }
      };
    }
    if (btnStop) {
      btnStop.onclick = () => {
        stopSpeechSafe();
        updateSpeakButtons("idle");
      };
    }
"""

SPEAK_BAR = (
    '        <div class="poem-body">${body}</div>\n'
    '        <div class="speak-bar" role="group" aria-label="朗读控制">\n'
    '          <button type="button" class="btn btn-speak" id="btn-speak">🔊 朗读</button>\n'
    '          <button type="button" class="btn btn-speak-secondary" id="btn-speak-pause" disabled>⏸️ 暂停</button>\n'
    '          <button type="button" class="btn btn-speak-secondary" id="btn-speak-stop" disabled>⏹️ 停止</button>\n'
    '        </div>\n'
    '        <div class="actions-bar">'
)

def load_speech_template() -> str:
    for p in CANDIDATES:
        if p.is_file():
            return p.read_text(encoding="utf-8")
    raise SystemExit("speech.js template not found in " + ", ".join(str(c) for c in CANDIDATES))


def main():
    speech = load_speech_template()
    Path("speech.js").write_text(speech, encoding="utf-8")
    print("wrote speech.js", Path("speech.js").stat().st_size)

    idx = Path("index.html")
    html = idx.read_text(encoding="utf-8")
    if "speech.js" not in html:
        html = html.replace(
            '<script src="poems.js"></script>\n  <script src="app.js"></script>',
            '<script src="poems.js"></script>\n  <script src="speech.js"></script>\n  <script src="app.js"></script>',
        )
        if "speech.js" not in html:
            raise SystemExit("failed to patch index.html")
        idx.write_text(html, encoding="utf-8")
        print("patched index.html")
    else:
        print("index.html ok")

    css = Path("styles.css")
    styles = css.read_text(encoding="utf-8")
    if "/* Speak controls */" not in styles:
        css.write_text(styles.rstrip() + "\n" + CSS_BLOCK, encoding="utf-8")
        print("patched styles.css")
    else:
        print("styles.css ok")

    app_path = Path("app.js")
    app = app_path.read_text(encoding="utf-8")
    if "function stopSpeechSafe" not in app:
        app = app.replace(
            '  const views = ["home", "poems", "poem-detail", "math", "pinyin", "write"];\n',
            HELPER + '  const views = ["home", "poems", "poem-detail", "math", "pinyin", "write"];\n',
        )
    if 'if (name !== "poem-detail") stopSpeechSafe();' not in app:
        app = app.replace(
            "  function showView(name) {\n    currentView = name;\n",
            '  function showView(name) {\n    if (name !== "poem-detail") stopSpeechSafe();\n    currentView = name;\n',
        )
    if "stopSpeechSafe();\n    selectedPoemId = id;" not in app:
        app = app.replace(
            "  function renderPoemDetail(id) {\n    const poem = POEMS.find((p) => p.id === id);\n",
            "  function renderPoemDetail(id) {\n    stopSpeechSafe();\n    selectedPoemId = id;\n    const poem = POEMS.find((p) => p.id === id);\n",
        )
    if 'id="btn-speak"' not in app:
        old = '        <div class="poem-body">${body}</div>\n        <div class="actions-bar">'
        if old not in app:
            raise SystemExit("poem-body marker missing")
        app = app.replace(old, SPEAK_BAR)
    if "btnSpeak.onclick" not in app:
        marker_end = (
            '    el.querySelectorAll("[data-r]").forEach((b) => {\n'
            "      b.onclick = () => {\n"
            "        const r = b.dataset.r;\n"
            "        reviewResult(id, r, {\n"
            '          type: "poem",\n'
            '          title: displayTitle + (poem.subtitle ? "·" + poem.subtitle : ""),\n'
            "        });\n"
            "        const msg =\n"
            '          r === "remember"\n'
            '            ? "太棒了！下次间隔加长～"\n'
            '            : r === "fuzzy"\n'
            '            ? "没关系，过几天再见面"\n'
            '            : "忘掉也正常，明天再复习一次";\n'
            "        toast(msg);\n"
            "        renderPoemDetail(id);\n"
            "      };\n"
            "    });\n"
            "  }"
        )
        if marker_end not in app:
            raise SystemExit("data-r marker missing")
        app = app.replace(marker_end, marker_end[:-3] + BIND + "\n  }")
    app_path.write_text(app, encoding="utf-8")
    print("wrote app.js", app_path.stat().st_size)
    assert "btn-speak" in app
    assert "stopSpeechSafe" in app
    print("apply_read_aloud OK")


if __name__ == "__main__":
    main()
