# Agent notes

- Install: `npm install` (Node 20.19+, 22 recommended). One install covers everything.
- Run: `npx vite` serves http://127.0.0.1:4173/ without opening a browser (`npm run dev` opens one).
  The server keeps running; start it in the background and stop it by its PID.
- Check before you commit: `npm run check` (typecheck + unit tests) and `npm run build`.
- Where things live:
  - `index.html`: landing page.
  - `projects/shader-lab/`: Visual Synth. `Editor.tsx` (editor UI), `player.ts` (Player),
    `core.ts` (patch model), `renderer.ts` (WebGPU), `generators/` and `effects/` (devices and
    WGSL), `*.test.ts` (unit tests). Read `README.md`, `ARCHITECTURE.md` and `CONTRACTS.md` there
    before changing it.
  - `projects/doodle-lab/`: Doodle Lab. Cards are discovered from `doodles/`, `snapshots/`, `pack/`
    and `gemini/` JSON files; see `CONTRIBUTING.md` there.
  - `projects/gemini-lab/experiments/`: single-file pages opened by the Doodle Lab's Gemini tray.
- The editor and Player need WebGPU (Chrome or Edge 113+ with a GPU). The Doodle Lab needs WebGL2.
- Don't commit `node_modules/`, `dist/`, `artifacts/` or rendered video.
