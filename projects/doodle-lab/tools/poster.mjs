// Render a doodle in headless Chrome, report console errors, and save a poster PNG.
// Usage (from the worktree root, with Vite running; set DOODLE_LAB_BASE if it is not on 127.0.0.1:4173):
//   node projects/doodle-lab/tools/poster.mjs doodles/<slug>.html [waitMs=4000] [out.png|""] [keys]
// keys: characters pressed right after load (e.g. "m" to choose a mouse mode).
// The poster lands next to the page as <slug>.png unless an output path is given.
import { chromium } from "@playwright/test";
const [page = "", wait = "4000", out, keys = ""] = process.argv.slice(2);
if (!page.split("#")[0].endsWith(".html")) { console.error("Give a page path such as doodles/my-doodle.html"); process.exit(2); }
const target = out || `projects/doodle-lab/${page.split("#")[0].replace(/\.html$/, ".png")}`;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=d3d11", "--autoplay-policy=no-user-gesture-required"] });
const tab = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
// Resource failures are reported by URL below; the favicon request is expected to 404.
tab.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text()); });
tab.on("response", (r) => { if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) errors.push(`${r.status()} ${r.url()}`); });
tab.on("pageerror", (e) => errors.push(String(e)));
await tab.goto(`${process.env.DOODLE_LAB_BASE || "http://127.0.0.1:4173"}/projects/doodle-lab/${page}`);
for (const key of keys) { await tab.waitForTimeout(300); await tab.keyboard.press(key); }
await tab.waitForTimeout(+wait);
// Clean poster: hide fixed overlays (panels, buttons, chips) but keep canvases.
await tab.evaluate(() => {
  for (const el of document.querySelectorAll("body *")) {
    if (el instanceof HTMLCanvasElement || el.querySelector("canvas")) continue;
    if (getComputedStyle(el).position === "fixed") el.style.visibility = "hidden";
  }
});
await tab.waitForTimeout(200);
await tab.screenshot({ path: target });
console.log(JSON.stringify({ poster: target, errors }, null, 1));
await browser.close();
