# Running Visual Synth on Linux

The Windows setup stays as it is: the same tree runs on both, and nothing here removes a Windows
path. The app is a browser app (Vite, WebGPU, Web Audio, Web MIDI), so most of the port is
drivers and a browser, not code. CI already runs `npm ci`, `npm run check` and `npm run build` on
ubuntu-latest, macos-latest and windows-latest (`.github/workflows/ci.yml`).

## 1. Setup

```sh
# Node 22 (see .nvmrc; 20.19+ works). With nvm: nvm install && nvm use
git clone <this repo> ~/visual-synth && cd ~/visual-synth
npm ci                  # never copy node_modules across machines: it holds per-OS GPU binaries
npm run check           # typecheck + unit tests (GPU pixel tests skip themselves)
npm run build
```

Line endings are already handled: `.gitattributes` checks every text file out with LF.

System packages (Debian/Ubuntu names; Fedora and Arch are similar):

| Need | Package | Check |
|---|---|---|
| Vulkan driver, AMD/Intel | `mesa-vulkan-drivers` | `vulkaninfo --summary` (from `vulkan-tools`) lists your GPU |
| Vulkan driver, NVIDIA | the proprietary driver (`nvidia-driver-5xx`) | same |
| Export fallback | `ffmpeg` | `ffmpeg -version` |
| Live audio routing | `pipewire`, `pipewire-pulse`, `wireplumber` (default on Ubuntu 22.10+, Fedora 34+) | `pactl info` shows "PulseAudio (on PipeWire ...)" |
| JACK apps (optional) | `pipewire-jack`, `qpwgraph` | `pw-jack jack_lsp` |
| MIDI | ALSA, built in | `aconnect -l` lists the controller |

## 2. GPU and WebGPU in the browser

The editor and Player need WebGPU; the Doodle Lab needs only WebGL2.

1. Use Chrome or Chromium. Open `chrome://gpu` and look for "WebGPU: Hardware accelerated".
2. If WebGPU shows as disabled, start the browser with
   `google-chrome --enable-unsafe-webgpu --enable-features=Vulkan`.
   Whether this is needed depends on the Chrome version and the GPU (not tested here on Linux; check
   `chrome://gpu` after each Chrome update).
3. Firefox's WebGPU on Linux is still behind a flag in the versions we know of; use Chrome for the synth.
4. Run `npx vite` and open http://127.0.0.1:4173/projects/shader-lab/. Keep the loopback address:
   WebGPU and Web MIDI need a secure context, and a LAN address over plain http is not one.

## 3. Audio in

The synth has no live audio input yet (see `projects/shader-lab/README.md`, "future work"). Until
it does, there are two routes:

- **Offline, from a recording** (works today): record the DJ's signal to a WAV and render frames
  from it with `npm run render:tone -- --wav set.wav --seconds 60` (section 5).
  `pw-record --format s16 --channels 1 --rate 48000 set.wav` or
  `arecord -f S16_LE -c 1 -r 48000 -d 60 set.wav` both write a file it reads.
- **Live, for when audio input lands**: the browser reads audio through PipeWire's PulseAudio
  layer (`getUserMedia`). Plug the mixer's booth or record out into a USB audio interface and pick
  that input when the browser asks. To visualise what the computer itself plays, choose the
  "Monitor of <output>" source in `pavucontrol`. JACK tools (Mixxx, Ardour) join the same graph
  through `pipewire-jack`; wire them with `qpwgraph`. For lower latency:
  `pw-metadata -n settings 0 clock.force-quantum 256`.

MIDI controllers (the profiles in `midi-profiles.ts`) work through Web MIDI on ALSA with no setup;
Chrome asks for permission the first time.

## 4. Windows-only bits and their Linux equivalents

| Where | Windows today | Linux |
|---|---|---|
| Native GPU backend (Dawn, `webgpu` npm package) | D3D12 | Vulkan with no display; with `DISPLAY` or `WAYLAND_DISPLAY` set, vgpu picks Dawn's OpenGL backend. On Linux vgpu always asks for a compatibility-level adapter. To force Vulkan from a desktop session, set `VGPU_DAWN_FLAGS=backend=vulkan` (read in `@vgpu/adapter-node`). The package ships `linux-x64` and `linux-arm64` binaries. |
| No GPU at all | n/a | `npx vgpu install-software-renderer` once (downloads a CPU renderer), then `VGPU_ADAPTER=software`. Slow, fine for a smoke test. |
| `projects/doodle-lab/tools/poster.mjs` | launches the `chrome` channel with `--use-angle=d3d11` | change the flag to `--use-angle=vulkan` (or drop it) and install the browser: `npm i -D @playwright/test && npx playwright install chromium` (Playwright is not in `package.json`). |
| Env vars in docs and test comments | PowerShell: `$env:DIVERGENT_GPU_TESTS='1'; npx vitest run ...` | `DIVERGENT_GPU_TESTS=1 npx vitest run --config vitest.config.ts projects/shader-lab/renderer-native.test.ts` |
| FFmpeg export fallback | `ffmpeg` on PATH | `apt install ffmpeg`; the code spawns plain `ffmpeg`, no shell |
| Paths, shells, `.bat`, WASAPI, DirectX in source | none found | nothing to change |

## 5. Smoke test

```sh
npm ci && npm run check                      # unit tests pass, GPU tests skip
npm run render:tone                          # 10 s test tone -> 300 PNG frames, no browser
ls artifacts/render-tone                     # contact-sheet.png  frames/  stills/  test-tone.wav
DIVERGENT_GPU_TESTS=1 npx vitest run --config vitest.config.ts projects/shader-lab/renderer-native.test.ts
npx vite                                     # then open the editor URL in Chrome, press play
```

`render:tone` prints the adapter it found (on Windows: "D3D12 ..."; on Linux expect a Vulkan or
OpenGL adapter name), then writes `artifacts/render-tone/`: 300 frames at 640x360, 6 evenly spaced
stills and a 12-frame contact sheet with a loudness bar under each frame. The tone glides
110 to 880 Hz with a 120 BPM pulse; pitch sets the line density and direction of Operator Bloom,
and loudness sets its modulation depth and the glow. Lines should get denser left to right across
the contact sheet. Options: `--wav FILE`, `--seconds N`, `--fps N`, `--size WxH`, `--stills N`,
`--out DIR`. On rollin (Windows, busy CPU) the full 10 s took about 60 s.

`render:tone` runs through `vite-node` (installed with `vitest`); `scripts/headless/` swaps the
bare `vgpu` import for its Node build with an offscreen target, the same swap
`renderer-native.test.ts` makes, so it renders through the real `renderer.ts`.

## 6. What this repo does not hold

This is the public release subset. The fuller synth history (MIDI profiles, instrument contract,
native-res and video branches) lives in local-only branches of the Tinkerbox repo on rollin,
which are not on GitHub yet. Moving them needs Jon's choice of route; see
`~/brain-bus/plans/rollin-week-1104/vsynth-port-census-1106.md` on rollin.
