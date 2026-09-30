# Visual Synth architecture

The manual instrument is the product foundation. “Don't use AI to replace the creative process. Use AI to make the creative space larger.”

## Current implementation boundaries

The project remains a small TypeScript application inside `projects/shader-lab`. `CONTRACTS.md` pins module interfaces. React/React Flow implements the editor; vgpu implements GPU rendering. Neither library is part of the portable patch schema.

| Module | Responsibility |
| --- | --- |
| `core.ts`, `persistence.ts` | Patch validation/migration, typed ports, LFO/ADSR evaluation and rack safety; isolated IndexedDB persistence |
| `generators/`, `effects/` | Ten procedural source manifests/shaders plus local Video; seven new image-map/temporal/spatial effects (including Kaleidoscope) alongside the six legacy effects |
| `renderer.ts` | Compile validated image routing, own textures, execute WGSL passes at explicit time, manage temporal history |
| `simulation-runtime.ts`, `render-plan.ts` | Fixed-grid simulation stepping and explicit texture declarations/budgeting |
| `Editor.tsx` | Patch interactions, inspector, transport, undo/redo, saved patches, export/record UI |
| `performance.ts`, `export.ts` | Control/gate/simulation replay, independent fixed-step capture, encoding and cancellation |
| `preset-catalog.ts`, `wander-v2.ts` | Curated 23-preset catalog and versioned source-family exploration |
| `batch-export.ts`, `batch-server.ts` | Resumable batch rendering of the catalog through the development server |
| `export-server.ts` | Local development FFmpeg fallback using bounded jobs and fixed arguments |

`main.tsx` is the editor entry point; `player.ts` is the Player's.

## Portable graph and signal semantics

`Patch` accepts versions 1 and 2. Both contain stable-ID nodes, typed connections, transport and gate events. Version 2 adds optional `simulation: {tickHz: 60, warmupTicks, events}`; warmup is an integer from 0–3600 ticks. Reset/inject events address a Rule Garden or Chemical Garden node, with normalized injection coordinates. `migratePatch`/`parsePatch` validate and return an independent v2 copy, supplying zero warmup and an empty event list when omitted. Existing v1 recipe constructors and stored records are not rewritten during reads. Numeric node settings, angles in radians and explicit cable IDs remain portable; GPU textures and DOM references are never serialized.

Current signal families are **Frame**, **Scalar**, and **Gate**. `frameInputs(nodeOrType)` supplies the editor and validator with declared image inputs: Field Warp uses `in`/`field`; Mask Mixer uses `in` (A), `b`, and `mask`; legacy effects use `in`, and Mixer uses `a`/`b`. Generators, effects and Mixer emit `frame`. LFO/ADSR emit `value`, Gate emits `gate`, and continuous parameter inputs use `param:<name>`. One cable per input, output fan-out, DAG validation and the 24-node/12-processor limits remain unchanged. Image control maps do not expose internal simulation buffers.

Manifests provide labels, categories, bounds, steps, defaults, modulation eligibility, and optional recordable:false for initialization parameters. Seed, simulation grid and rule state count are configured before a take; performance imports reject unsupported mid-take changes. At evaluation time each destination is `clamp(base + depth × signal)`. Effective values are derived; saved base knobs remain unchanged. Enum controls are not modulatable.

**Crushed Reverie remains an effects preset:** Impulse Reverb 1.00 → Color Crush 0.65 → Impulse Reverb 1.00. Rack replacement preserves source/control settings and removes obsolete effect cables only for a single serial chain. Multi-source, branched, mixer and orphan-processor graphs are refused without mutation. Full composition saves preserve those richer graphs.

## Evaluation, resources, and time

The renderer exposes `setPatch`, `render(time)`, async `renderAt(time, {signal, onProgress, patchAt})`, `settled`, `reset`, `resize`, and `dispose`. The editor submits one asynchronous draw at a time; stale requests abort and the latest patch retries. `patchAt` supplies the absolute-time control/event timeline for recorded simulation reconstruction. Source animation phase may wrap, but evolving simulation time does not. Unconnected image inputs normally use black; Field Warp without a field bypasses, while Mask Mixer without B repeats A and without a mask uses its mix control.

Rule Garden owns two `r32uint` state textures; Chemical Garden owns two `rg32float` concentration textures. Simulation uses unfiltered loads on a fixed 128/256/512 square grid, default 256, independent of display size. `renderAt` advances every required 60 Hz tick, yields during long rebuilds, and reconstructs backward seeks from the configured warmup origin. Events apply at the first tick at or after their timestamp. Display resizing preserves simulation buffers; changes to initial conditions or event history reconstruct state.

Each active image pass also owns an RGBA16F display target. Legacy delay/reverb retain their four input-history targets and approximately 0.12-second cadence. Chrono Loom uses 32 tiles in an 8×4 atlas, sampled at 15 Hz, capped at 5120×1440; Feedback Chamber keeps its prior output at no more than 640×360. `textureSpecs` accounts for format, dimensions, count and replacement overlap against the 512 MiB texture budget. Explicit state modules retain the DAG boundary; they do not allow general graph feedback. Temporal histories can clear on resize and do not promise seamless loops or cross-GPU pixel identity.

Preview resolution is capped; offline export requests exact pixel dimensions and an independent renderer. Export snapshots the patch, steps at `i / fps`, and prerolls based on temporal-chain depth. Browser WebCodecs/Mediabunny encoding is preferred; local FFmpeg is a development-server fallback. Export cancels and releases its own resources. Record reconstructs the saved recipe at its starting timestamp before capture, freezing controls during preparation. Real-time recording captures the live canvas and can drop frames under load; it is a distinct operation from fixed-step export.

`runBatchExport(catalog, dependencies, options)` fingerprints each curated recipe, writes portable JSON, renders a 1080p/30 FPS master once, and derives public MP4/WebM files and a poster. Its manifest checkpoints completed writes and supports cancellation/resume. Generated artifacts and publication still require root verification; a complete code path is not a completed release.

## Editing and persistence

The editor owns one patch state and snapshot-based undo/redo. Drag gestures coalesce into checkpoints. Import validation happens before installing data; failed imports must preserve the current composition. Named patches and the working draft live in IndexedDB; JSON is the portable backup format. Storage failures are visible rather than reported as successful saves.

`window.visualSynth.getPatch/setPatch` provides a small integration seam. This is not yet a generalized agent API, permission system, or plugin host. GPU state stays private to the renderer, and all future graph tools must validate mutations through the same core rules.

## Deliberate limits and risks

- Checked v1→v2 patch/performance migration exists. Unknown future versions are rejected; failed imports and corrupt storage records remain preserved.
- WebGPU is required. WebGL fallback and generalized color management are future work; keep the current shader color treatment stable during UI changes.
- Float textures and temporal history dominate memory. A 1080p RGBA16F texture is about 16 MiB; four history images per temporal node amplify this quickly. Limits prevent unbounded graphs but do not guarantee every legal graph fits every GPU.
- Shader/texture ownership and failed compilation need explicit cleanup. Validation errors should leave the last usable graph available; device loss may require renderer recreation.
- Saved settings reconstruct temporal state after warmup; they do not preserve the exact moment of a live smear.
- Node manifests and a renderer boundary preserve extension options without a monorepo, general plugin SDK, optimizer, or asynchronous provider framework.

Local Video already uses project-owned media IDs; future media types should follow that boundary. Future model nodes must deliver asynchronous artifacts and retain their last valid result while requests run; no provider or agent belongs in the frame loop. Feedback Chamber already has an explicit previous-frame boundary. General recurrent cable routing remains future work and must preserve that scheduling discipline.

## Local video boundary

`video-media.ts` implements one local video source per patch. `SynthNode.media = {id: "sha256-…", name}` contains identity only; the separate `tinkerbox-visual-synth-media` IndexedDB stores bounded blobs without upgrading patch storage. Import validates metadata and the first decoded frame before committing storage or changing the patch. Relink checks byte identity. JSON/takes remain portable recipes requiring separately retained media.

Each renderer owns `VideoFrames`, its own Mediabunny Input/VideoSampleSink, a reusable output-sized CPU canvas and an RGBA8 upload texture. Requested time maps to the last presentation frame at or before `firstTimestamp + repeat(time × speed + start, duration)`. Every asynchronous render step, including simulation/feedback rebuilding and export preroll, awaits this decode before any effect pass. Frames close in finally blocks; changed/removed sources release decoders, resize releases the upload target, and disposal releases all media resources. Cancellation/revision checks precede upload, so stale decode results cannot become rendered frames. An in-progress codec call finishes before cancellation can release its sample; no wall-clock media element exists.

The upload target is included in the existing 512 MiB GPU texture budget (4 bytes/pixel in addition to the 8-byte RGBA16F source output). CPU canvas and codec buffers are separate and bounded by a single source, 4K dimensions and 128 MiB file limit. Temporal state resets on media identity change. Legacy delay/reverb keep their existing call-cadence semantics; arbitrary isolated seeks do not reconstruct those histories, while fixed-step export prerolls them. Feedback/Chrono retain their existing 60 Hz reconstruction. Video is excluded from procedural seed-family selection; source-locked exploration and effects racks preserve its identity.


## Generator expansion and recovery checkpoint

Ten procedural sources share the registry: Operator Bloom, Interference Silk, Lattice Choir, Orbital Bloom, Contour Drift, Pulse Foundry, Cell Press, Resonant Plate, Rule Garden and Chemical Garden. Renderer planning prunes disconnected devices and pools effects. Source manifests and Wander v1 seeds retain their existing defaults; Wander v2 records algorithm, family, source-lock and owned-node metadata separately.

Storage is isolated in persistence.ts. A damaged library record no longer suppresses valid draft restoration. Save As collisions require deliberate replacement; ordinary Save intentionally updates the named patch. Transient name/BPM input prevents incomplete typing from entering the model. Restart GPU recreates the device from the current patch and timeline; it is recovery, not arbitrary shader sandboxing.
