# Visual Synth

[![CI](https://github.com/jonzo97/visual-synth/actions/workflows/ci.yml/badge.svg)](https://github.com/jonzo97/visual-synth/actions/workflows/ci.yml)

A modular visual synthesizer that runs on your GPU in the browser, plus the Doodle Lab: a shelf of
small playable math, simulation and generative-art doodles. Wire sources through effects and
modulation, play finished patches like instruments, or export clips. No account, API key or server
beyond the local dev server.

## Quickstart

Needs Node 20.19 or newer (22 recommended; `nvm use` reads `.nvmrc`).

```sh
git clone https://github.com/jonzo97/visual-synth.git
cd visual-synth
npm install
npm run dev
```

`npm run dev` serves http://127.0.0.1:4173/ and opens it in your default browser.

**Browser:** the Visual Synth editor and Player use WebGPU, so open them in **Chrome or Edge 113
or newer** (Windows, macOS or ChromeOS; on Linux, Chrome may need
`chrome://flags/#enable-unsafe-webgpu`). The Doodle Lab only needs WebGL2 and runs in any current
browser. MIDI control needs Chrome or Edge. The dev server listens on 127.0.0.1 because WebGPU
needs a secure context; a LAN address over plain http will not start the Visual Synth.

## The three pages

### Doodle Lab: `/projects/doodle-lab/`

Every doodle, synth snapshot and generative demo on one page. Peek shows a card live; Play opens
it full screen.

- `/` jumps to search, `Esc` closes the peek.
- `/projects/doodle-lab/#<card-id>` opens one card directly.
- Inside a doodle: drag or tap to play and `H` hides the controls. Most doodles also record a clip
  with `R` or a Record button.
- The Synth snapshots tray opens each snapshot in the Player. The Gemini experiments tray holds
  16 small pieces made by Gemini 3.8 Flash in a generate-and-critique loop; they are fast and
  rough. The hand theremin needs a camera and loads MediaPipe from a CDN.

### Player: `/projects/shader-lab/player.html`

One finished patch at a time, played like an instrument: three knobs, a Morph wheel, Mutate and
Randomize. Drag on the picture to play the instrument patches.

If you see "WebGPU is required": use Chrome or Edge 113+; on Linux enable
`chrome://flags/#enable-unsafe-webgpu` (and `chrome://flags/#enable-vulkan`) first.

| Key | Action |
| --- | --- |
| `←` `→` | previous / next snapshot |
| `Space` | pause / play |
| `M` | Mutate (roll a new Morph target) |
| `R` | Randomize knobs and Morph |
| `U` | undo the last Randomize |
| `L` | open the snapshot list (`Esc` closes it) |
| `H` | hide the UI |
| `F` | fullscreen |
| `V` | show a centered 9:16 frame |
| `↑` `↓` | adjust the focused knob |

- `#<snapshot-id>` opens a snapshot, for example `player.html#poincare-garden`.
- It renders at the screen's native resolution, up to 2560×1440. `?res=720` is lighter, `?res=4k`
  raises the cap to 3840×2160, and `?frame=9x16` starts with the vertical frame.
- **Export clip** offers Vertical 9:16, Landscape 16:9, Square 1:1 and Portrait 4:5.
- **MIDI** picks a profile from the device name (Launch Control XL, Launch Control, Launchkey,
  Launchpad, MIDI Fighter 3D) and otherwise uses knobs on CC 21–23 and Morph on the mod wheel
  (CC 1). Click a knob label and move any control to learn it instead. The profiles are untested on
  real hardware.

### Visual Synth editor: `/projects/shader-lab/`

The full modular editor: library on the left, live preview and patch graph in the middle,
inspector on the right. Click a library device to add it, drag between ports to connect, and use
the Effects rack view for simple chains. Add **Video** to process your own MP4 or WebM file.

If you see "WebGPU is required" or "requestAdapter() returned null": use Chrome or Edge 113+; on
Linux enable `chrome://flags/#enable-unsafe-webgpu` (and `chrome://flags/#enable-vulkan`) first.

| Key | Action |
| --- | --- |
| `/` or `Ctrl`/`Cmd`+`F` | search the library |
| `Ctrl`/`Cmd`+`Z` | undo (add `Shift` to redo) |
| hold `G` | fire every Gate device |
| `Delete` / `Backspace` | remove the selected devices or cables |

- `?preset=poincare-garden` opens a Geometry Study; **Explore patches & seeds** browses the whole
  catalog.
- Patches save in this browser (IndexedDB); JSON export is the portable backup.
- **Export clip** renders MP4 or WebM in the browser (720p to 1440p, 4K experimental; 30 or 60
  FPS). If browser
  encoding fails and `ffmpeg` is on your PATH, the dev server encodes instead and writes under
  `artifacts/`.

More detail: [projects/shader-lab/README.md](projects/shader-lab/README.md),
[ARCHITECTURE.md](projects/shader-lab/ARCHITECTURE.md) and
[CONTRACTS.md](projects/shader-lab/CONTRACTS.md). To add a doodle, see
[projects/doodle-lab/CONTRIBUTING.md](projects/doodle-lab/CONTRIBUTING.md).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | dev server on 127.0.0.1:4173, opens the landing page |
| `npm run check` | TypeScript typecheck and unit tests (no GPU or browser needed) |
| `npm run build` | production build into `dist/` |
| `npm run preview` | serve `dist/` on 127.0.0.1:4174 |

## For AI agents

- Install and verify: `npm install && npm run check && npm run build`. All three must exit 0, and
  none needs a GPU or a browser.
- Run without opening a browser: `npx vite`, then load http://127.0.0.1:4173/. It keeps running
  until stopped, so start it in the background.
- WebGPU pages need a real GPU. In headless Chromium without one, the Player shows
  "WebGPU is required" and the editor shows "navigator.gpu.requestAdapter() returned null.
  Rendering paused."; that is expected, not a bug in your setup. Headless Chrome
  (`channel: "chrome"`) on a machine with a GPU does run them.
- Repository rules for agents are in [AGENTS.md](AGENTS.md).

## Licence

MIT, see [LICENSE](LICENSE). Third-party material is listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
