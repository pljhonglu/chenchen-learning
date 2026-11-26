/* Offer installation when the browser makes its installation dialog available. */
(() => {
  "use strict";

  const button = document.getElementById("install-app");
  let pendingPrompt = null;

  function clearPrompt() {
    pendingPrompt = null;
    button.hidden = true;
  }

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    pendingPrompt = event;
    button.hidden = false;
  });

  button.addEventListener("click", () => {
    if (!pendingPrompt) return;
    const event = pendingPrompt;
    clearPrompt();
    event.prompt().catch(() => {
      // The browser menu remains available if this dialog could not open.
    });
  });

  window.addEventListener("appinstalled", clearPrompt);
})();
