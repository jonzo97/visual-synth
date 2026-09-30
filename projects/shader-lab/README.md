# Visual Synth

Live workspace: http://127.0.0.1:4173/projects/shader-lab/

A local visual instrument built with React Flow, TypeScript, and MIT-licensed vgpu 0.4.1. It runs on your GPU; no account, API key, or paid rendering service is required. Ten procedural generators plus local Video now cover fabric, orbital/topographic motion, cut stencils, cellular mosaics, resonance, cyclic automata and reaction–diffusion.

## Start

From the repository root:

```sh
npm install
npm run dev
```

Chrome or Edge 113+ with working WebGPU is required. The root production build includes this page. Local FFmpeg fallback is available through the development server when `ffmpeg` is installed on PATH; browser encoding is attempted first.

## Explore

- Click a library device to add it; select a canvas device to inspect its parameters. Drag a port to another compatible port. Orange cables carry frames; pale cables carry modulation. A destination accepts one cable, outputs can branch, and cycles are rejected.
- Start with **Crushed Reverie**: **Impulse reverb 1.00 → Color crush 0.65 → Impulse reverb 1.00**. This is the user's effects-only discovery. Applying it preserves source settings and palette. Named full-patch saves are separate.
- **Breathing Phosphor** demonstrates a slow LFO driving Bayer threshold. **Magnetic Reverie** adds modulated poles while keeping the favorite effects unchanged.
- LFOs can run in Hz or beats. Connect Gate → ADSR → a parameter and hold **G** outside a text field. Modulation adds signed depth to the saved base value, then clamps to the parameter range.
- The Effects rack view provides a simpler serial-chain view. Use the graph for branching/mixing. Custom effects recipes save effect types and base settings independently of compositions. Use a full patch save to preserve modulation cables and branching.
- Connect another generator to Field Warp's `field`, or Mask Mixer's `b`/`mask` inputs. Select an effect and preview its connected inputs in the inspector without changing the saved graph. Tone Fold, Ink Morphology, Chrono Loom and Feedback Chamber add value, neighborhood and temporal processing.
- Select Rule Garden or Chemical Garden, then click the image to inject, use **Inject center**, or reset that source. These gestures are saved. The simulation grid is independent of display resolution; the inspector exposes warmup in 60 Hz ticks, with progress during rebuilding.
- Save/Save as stores a composition in this browser's IndexedDB. The working draft autosaves. JSON exports are portable backups. Checked imports migrate v1 patches/takes to independent v2 copies; reading the library does not rewrite existing records, and failed records remain available for recovery.

## Capture

### Local Video source

Add **Video** from Generators, select its device and **Choose video** (local MP4/WebM), then connect its frame output to an effect or Screen output. One Video device is supported per patch. Playback speed ranges from -4 to 4; zero freezes, negative reverses. Start offset is in seconds. Both accept modulation. Frame selection is `repeat(absolute time × speed + start offset, file duration)`; changing speed changes phase rather than integrating velocity. Video repeats independently of the transport loop and has an ordinary, potentially visible seam. Images fit the output with black letterboxing; audio is ignored.

Files are decoded locally and stored in this browser/origin's IndexedDB under a SHA-256 content ID. Limits: 128 MiB per file, 512 MiB total media, 3840×2160 coded/display dimensions, 10 minutes. Unsupported codecs, insufficient quota and missing files report errors. Stored media is retained when patches are deleted/replaced so other saved patches and undo remain recoverable; automatic media cleanup is not implemented. Keep original files: browser data can be cleared or evicted.

Save/Save as and drafts retain the media reference. JSON patch/take exports contain references, **not video bytes**. On another browser or port, select Video and **Relink original video**, choosing the identical original file. Wrong-file relinks are rejected; **Replace video** intentionally changes material. After a missing-file pause, press Play. No blob URL is persisted. Offline export opens its own decoder and awaits each requested frame; larger or long-GOP files may render slower than real time. This is SDR canvas color handling, not an HDR mastering workflow.

**Export clip** renders a clean MP4 or WebM at 720p/1080p, 30/60 FPS, for 1–60 seconds. Defaults are 1080p, 30 FPS, 12 seconds. It renders actual requested pixels with fixed timestamps, warms temporal history, reports progress, and can be cancelled. The preview is not upscaled into the export. No audio is included.

**Record** captures a live 720p/30 FPS performance for up to 60 seconds, plus a JSON take containing the initial patch and parameter/gate/reset/injection events. Live capture depends on available GPU/encoder speed. Importing a take enables replay and fixed-step export. Record first rebuilds the saved recipe at the current time so capture and later export share a reproducible starting state. Seed, grid and rule-state count must be set before recording; palette, growth controls, resets and injections remain performable. Saved recipes contain events, not GPU textures.

Delay and reverb are finite temporal image taps. Their familiar audio names are visual analogies, not audio processing. Motion with these effects is not guaranteed to loop seamlessly. Source color palettes use interpolated/light-modulated stops, not exact flat pixel colors. Pole fields are artistic coordinate warps, not physical simulations.

## Development

The public internal interfaces and ownership rules are in [CONTRACTS.md](./CONTRACTS.md). [ARCHITECTURE.md](./ARCHITECTURE.md) explains time, routing, persistence, and resource ownership.

`core.ts` is independent of React/GPU state; `renderer.ts` consumes a patch and an explicit timestamp; `Editor.tsx` owns interaction/transport; `export.ts` uses the same renderer with a separate canvas. `performance.ts` reconstructs recorded controls. `export-server.ts` implements a bounded, same-origin loopback FFmpeg bridge. The editor entry is `main.tsx`; the Player entry is `player.ts`.

Run `npm run check` from the root for typechecking and unit tests, and `npm run build` for the production build. The native GPU pixel tests run only with `DIVERGENT_GPU_TESTS=1` on a machine whose GPU works with Dawn (the `webgpu` npm package).

Large graphs with many temporal processors can exhaust GPU memory at 1080p. Up to 24 nodes / 12 image processors are accepted structurally; these limits do not promise every graph fits every device. This is a first instrument checkpoint: audio/MIDI input, reusable nested graphs, generalized feedback, timeline sequencing, custom code modules, and agent-operated tools remain future work.


## Patch bank and seed explorer

Use **Explore patches & seeds** for the curated 23-preset catalog: the original eleven compositions plus twelve new cross-routed, geometric and evolving studies. Personal saved patches remain separate from the public catalog.

**Wander v2** calls `generatePatchV2(current, seed, {family, lockSource})`. Source lock preserves every source, cable, palette and gesture while varying eligible existing effects. Unlocking chooses a curated composition from the selected family, then applies bounded variations. Regenerate chooses a fresh seed; Apply seed uses the entered seed against the current starting patch. Save a keeper before exploring further; Undo restores the previous checkpoint.


Choose **Wander v1 · legacy seeds** to retain the original effects-only/whole-patch algorithm. Its whole-patch mode stays Silk/Lattice and existing seeds/defaults remain unchanged. Rack replacement and legacy effects-only exploration refuse branched graphs instead of flattening authored routing.

Save As asks before replacing an existing name. Damaged library records are reported individually; a damaged draft is preserved until you explicitly replace it. **Restart GPU** keeps your patch/time and recreates rendering, with fresh echoes. Texture budget checks reject oversized graphs before allocating their frame targets.

## Mixer & Memory

The editor bank includes Crosscurrent (opposing LFO faders) and Memory Carousel (three sources through feedback). Four-channel Mixer exposes A-D frame inputs, independent level controls, Master, and Normalized/Add/Screen/Multiply/Difference modes. Connect an LFO value cable to any channel-level or Master port. Unconnected channels are ignored; zero level mutes a channel. Normalized mix divides by active weight, Add retains HDR brightness, Screen/Multiply use bounded colors, and Difference combines channels in A-D order. The original two-input Mixer and existing recipes remain unchanged.

Feedback Chamber reuses its own prior output at60Hz, with fresh-source injection, history retention, zoom, rotation and shift. This explicit memory boundary makes feedback replayable while ordinary cable cycles remain invalid. Clear echoes resets it. The two new audition recipes are separate from the frozen23-film export catalog.

Effect Amount/Wet mix controls are now consistently labeled Dry / wet in device ports, inspector and rack, with percentage readouts.0% returns the unprocessed input;100% uses the full processed result. Existing parameter IDs, modulation and saved values are unchanged. For a parallel VHS blend, connect the upstream image directly through VHS and adjust its Dry / wet. Legacy glow, delay and reverb intentionally include the original image in their processed result; shared sends will require a separate wet-only mode.

### Operator Bloom

Two internal signed oscillators interact before palette mapping: phase modulation (carrier phase + depth × modulator) or ring modulation (signed multiplication). This is spatial PM, not an integrated time-domain FM oscillator. Carrier/modulator each offer sine, triangle, saw and square; frequency ratio and independent directions control the interference. Depth, phase, directions, frequency, smoothing and contour width accept scalar modulation. Depth is radians in PM; ring depth 0–1 crossfades into multiplication and >1 adds drive. Color follows the modulator even at zero depth.

Finite nine-harmonic waveforms suppress unresolved harmonics by pixel footprint; Harmonic smoothing attenuates their upper harmonics. This reduces aliasing, but extreme phase modulation is not guaranteed alias-free. Operator Studies adds Velvet Sidebands, Chrome Teeth and Ring Orchard, each with a slow depth LFO and one Glow. Select Operator Bloom in the seed explorer for bounded variations. Existing all-family seeds and the frozen 23-film release remain unchanged.

## Geometry sources — 2026-09-23

Three analytic sources ported from the Genart Geometry Oscillator page (WebGL2 in the
original; WGSL here, driven only by phase so seek, export and loops are exact):

- **Hyperbolic Tiling** — a {p,q} tiling of the Poincaré disk. Invalid Euclidean/spherical
  pairs raise q to the smallest hyperbolic value. Möbius drift moves the tiling along a
  closed path; spin and color cycles are whole turns per loop.
- **Quasicrystal** — N plane waves at equal angles. Wave phase spread turns the pattern;
  contour bands finer than a pixel fade to average instead of aliasing.
- **4D Polytope** — 16-cell, tesseract or 24-cell rotated in 4D and projected to glowing
  edges. Vertices and edges are rebuilt per pixel; no buffers or CPU state.

Palettes 0–8 are the shared stops; 9–11 are the page's Iridescent, Stained glass and
Luma only gradients (Luma only is dry signal for recoloring effects). The page's mirror
folds are the existing **Kaleidoscope** effect. The **Geometry Studies** bank adds Poincaré
Garden, Crystal Mandala, Tesseract Afterimage (long Feedback Chamber trail: low injection,
high retention) and Tesseract in the Disk (difference blend into a softened Crushed
Reverie). The disk sources leave black side bars at 16:9; raise Disk zoom to fill.
