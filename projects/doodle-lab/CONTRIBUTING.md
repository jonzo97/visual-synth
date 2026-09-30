# Doodle Lab — contributing a doodle

Doodles are interactive one-offs: self-contained experiments that sit beside the Visual Synth rather than inside it. A doodle that proves itself can later be ported into the synth as a source or effect.

## One doodle = three files in `doodles/`
- `<slug>.html` — one self-contained page. Inline CSS/JS. External scripts only from `cdn.jsdelivr.net/npm/` or `cdnjs.cloudflare.com`, fonts only from Google Fonts. No build step, no bundler imports.
- `<slug>.json` — metadata the dashboard reads:
  `{"title":"Plain name","blurb":"One sentence: what you see and what you do.","tags":["simulation","shader"],"controls":"Drag to …, click to …, H hides UI","made":"YYYY-MM-DD","by":"agent name","tech":"WebGL2 fragment shader"}`
- `<slug>.png` — 1280×720 poster from `node projects/doodle-lab/tools/poster.mjs doodles/<slug>.html` while `npm run dev` is running. The poster tool drives Google Chrome through Playwright, which is not installed by default: run `npm install --no-save @playwright/test` first.

The dashboard discovers doodles automatically; never edit the dashboard, another agent's files, or anything outside `projects/doodle-lab/doodles/`.

## Page contract
- In `<head>`, before any other script: `<script src="../tools/lab-shim.js"></script>` — it provides local recording (`window.claude.use("downloads")` → browser download) and the back-to-lab chip.
- Full-bleed canvas; a small collapsible control panel; **H** toggles all UI for clean capture; **R** or a Record button captures the canvas with MediaRecorder and saves via `(await window.claude.use("downloads")).save({filename, data: blob})`.
- Interactive from the first second without instructions: pointer/touch does something visible. Pointer events, not mouse-only.
- Responsive to any viewport, devicePixelRatio capped at 2, handles resize, runs at 60 fps on a desktop GPU. Respect `prefers-reduced-motion` with a calmer default.
- Surface shader compile errors in the panel instead of a black screen. Seeded randomness with a visible Reseed button.
- Titles are plain and navigable ("Reaction–Diffusion Tie-Dye", not "Whispers of the Void").

## Done means
Syntax-clean, the poster tool reports zero console errors, and you have looked at the poster yourself and it is eye-catching. Report honestly what you did not verify (for example, real touch input or recording on a device).
