// Doodle Lab shim, loaded by every doodle before its own scripts.
// 1. Local recording: pages written for claude.ai call window.claude.use("downloads");
//    outside claude.ai we provide the same save({filename, data}) as a browser download.
// 2. Navigation: a small "← Doodle Lab" chip that hides with the page's H key.
(() => {
  if (!window.claude?.use) {
    const downloads = {
      async save({ filename, data }) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(data); a.download = filename;
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      },
    };
    window.claude = Object.assign(window.claude || {}, { use: async (name) => (name === "downloads" ? downloads : null) });
  }
  if (window.top !== window) return; // embedded in the lab's preview; no chip needed
  addEventListener("DOMContentLoaded", () => {
    const chip = document.createElement("a");
    chip.href = "/projects/doodle-lab/"; chip.textContent = "← Doodle Lab";
    chip.setAttribute("style", "position:fixed;left:12px;top:12px;z-index:2147483647;font:600 12px system-ui,sans-serif;color:#fff;background:rgba(15,10,30,.7);border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:6px 12px;text-decoration:none;backdrop-filter:blur(6px)");
    document.body.appendChild(chip);
    addEventListener("keydown", (e) => {
      if ((e.key === "h" || e.key === "H") && !e.target.closest?.("input,textarea,select")) chip.hidden = !chip.hidden;
    });
  });
})();
