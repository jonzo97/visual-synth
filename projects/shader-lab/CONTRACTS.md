# Visual Synth implementation contracts

REFERENCE, lifecycle note 2026-09-23: the initial NodeType/Patch signatures and named agent ownership below are the historical V1 build contract, not the complete current API or live claims. Later extension sections amend that baseline. Current typed interfaces live in core.ts and renderer.ts; generator/effect registries define available modules; ARCHITECTURE.md covers v2 simulation/media and rack safety. In particular, modern rack replacement refuses branched graphs and preserves source types, and synchronous render cannot decode unprepared Video.

Scope: implement the accepted three-checkpoint plan inside this project. Current shaders are the visual baseline. The user's discovery is the EFFECTS ONLY chain: fx.reverb amount=1 -> fx.crush amount=.65 -> fx.reverb amount=1. Preserve as Crushed Reverie, independent of source or palette. Source preset and full project save are separate.

## Shared model (core.ts, owned by core agent)

`NodeType = 'silk' | 'lattice' | 'fx.glow' | 'fx.bayer' | 'fx.delay' | 'fx.reverb' | 'fx.crush' | 'fx.vhs' | 'mixer' | 'output' | 'lfo' | 'gate' | 'adsr'`.

`SynthNode {id:string;type:NodeType;position:{x:number;y:number};params:Record<string,number>}`.
`Connection {id:string;from:{node:string;port:string};to:{node:string;port:string};depth?:number}`.
`GateEvent {time:number;node:string;on:boolean}`.
`Patch {version:1;name:string;nodes:SynthNode[];connections:Connection[];transport:{bpm:number;loopSeconds:number};events:GateEvent[]}`.

Ports: image nodes output `frame`; effects/output input `in`; mixer inputs `a`,`b`; scalar nodes output `value`; gate output `gate`; ADSR input `gate`. Continuous parameter inputs are `param:<name>`. One edge per destination; fanout allowed; reject every cycle. Scalar destinations evaluate base+depth*signal, clamped to manifest limits. Output must have an input to compile. Max 24 nodes, max 12 frame processors, exactly one output. Silk can be duplicated. Types are independent of React/vgpu.

Exports:
- `manifests: Record<NodeType,{label:string;category:string;params:Record<string,{label:string;min:number;max:number;step:number;default:number;modulatable?:boolean}>}>`
- `createNode(type:NodeType,id?:string):SynthNode`
- `createDefaultPatch():Patch` (Simpsonwave source, Crushed Reverie chain)
- `validatePatch(patch:unknown):string[]` (never throws on imported input)
- `topologicalNodes(patch:Patch):SynthNode[]`
- `evaluateParameters(patch:Patch,time:number):Record<string,Record<string,number>>`
- `rackPresets: Record<string,{type:NodeType;params:Record<string,number>}[]>`
- `applyRack(patch:Patch,name:string):Patch` preserves silk/control params; replace frame processors with serial chain between first silk and output; disconnect dangling mod links.
- `savePatch(patch:Patch):Promise<void>`, `listSavedPatches():Promise<Patch[]>`, `loadDraft():Promise<Patch|null>`, `saveDraft(patch:Patch):Promise<void>` IndexedDB with storage failures surfaced.

Silk params match silk.wgsl Params fields except `phase` and `aspect` supplied by renderer. Angles offset/angle are RADIANS. Original source defaults from the first prototype: fold .65,density34,palette6,layers3,offset0,ratio8.2/4.8,strength.35,mode0,ax.35,ay.45,bx.65,by.55,crossing3,angle55*pi/180,mixAmount1.
Effects all have amount [0,1]. Bayer additionally threshold [-.5,.5] default0 and scale[1,8] default2. Mixer mix[0,1] default.5. LFO shape 0=sine,1=triangle,2=saw,3=square; rate .25 Hz; sync0/1 default1; beats8; phase0 radians. Gate has no params. ADSR attack.15 decay.3 sustain.6 release.8. Events refer to gate node IDs. No persisted GPU textures.

## Rack library

A rack is a reusable serial `fx.*` chain that expects one upstream frame input and returns one frame output. `rackPresets` remains the editable/authored set; `rack-export.ts` also extracts read-only racks from shipped presets by following the ordered effects on the Screen output path. Mixer branches are not flattened into racks. The generated device catalog lives in `projects/shader-lab/generated/device-catalog.json`; `buildDeviceCatalog` in `rack-catalog.ts` produces it.

### Gemini library

`projects/shader-lab/library/gemini-racks.json` is the human-editable bridge from the Gemini foundry into Visual Synth. It is versioned as `version: 1`; items are either `rack` effect chains or full-patch `instrument` entries with exactly three controls. Items marked `candidate` appear in the Bridge only, while `curated` instruments also appear in the Player. A maintainer promotes an item by changing `status` from `candidate` to `curated`; the foundry loop only appends new candidates. `gemini-library.ts` validates the file against the generated device catalog and core patch validation, rejects unknown device types or parameters, clamps out-of-range numeric parameters with a warning, drops bad items with a warning, and keeps the editor and Player loading even when the file is malformed.

## Renderer (renderer.ts, owned by root)

`createRenderer(canvas:HTMLCanvasElement, options?:{width?:number;height?:number;preview?:boolean}):Promise<SynthRenderer>`
`SynthRenderer {setPatch(patch:Patch):void;render(time:number):void;settled():Promise<void>;reset():void;resize(width:number,height:number):void;dispose():void;canvas:HTMLCanvasElement}`
setPatch validates and compiles topology; retain last valid graph if invalid. render uses explicit absolute seconds, evaluates modulation, wraps source phase only by loopSeconds. Temporal history from render time, never performance.now. reset clears history and scheduling; render negative times for export preroll. Each render draws one frame; caller controls scheduling. Preview capped at 1100x700; preview:false uses exact requested pixels. Canvas default aspect16:9.

## Export (export.ts, owned by export agent)

`exportClip(patch:Patch, options:{format:'mp4'|'webm';width:number;height:number;fps:number;duration:number;signal?:AbortSignal;onProgress?:(fraction:number)=>void}):Promise<Blob>`; independent renderer/canvas, fixed time i/fps; deterministic warmup at least2sec or longest temporal chain*.36+.24. Browser Mediabunny first, local FFmpeg fallback. Resource cleanup on success/error/abort. No audio. No overlays. Export module imports createRenderer from ./renderer and Patch type from ./core.
`startRecording(canvas:HTMLCanvasElement, options:{fps:number;onStop?:(blob:Blob)=>void}):Promise<{stop():Promise<Blob>;cancel():void}>` real-time canvas capture max60sec with clear codec errors. Editor owns parameter/gate event log and initial Patch snapshot; provides separate JSON performance download. Local fallback plugin export in export-server.ts; root will integrate in vite.config.ts. Server loopback same-origin, bounded jobs/input, fixed ffmpeg arguments, generated paths, no arbitrary command/path API.

## Editor (Editor.tsx, editor.css, main.tsx owned by editor agent)

React Flow UI matching user mockup: large live preview, patch canvas lower, library left, inspector right, orange accent. Use contracts above. All UI state derives from Patch except selection/transport/record/export status. Stable node ids, typed wires, add/delete/duplicate/connect, undo/redo coalesced sliders, panzoom. Renderer setup and animation are owned by Editor. Wire save/load JSON+IndexedDB, rack presets separately. Export dialog defaults1080p30/12seconds MP4. Performance record720p30 max60sec; lock topology/resolution, allow parameters/poles/gate events. LFO/ADSR G key outside editing inputs. Gate on/off buttons. Effects rack compact view is alternate view for serial graphs; reject/explain nonserial rack operation if needed. Save As named presets. Display errors; do not fabricate stats. Browser API available as `window.visualSynth` with getPatch/setPatch for integration tests; validated commands only.

No agents touch sibling project files. Root owns dependency installation, Vite configuration, renderer and shader edits. Core agent owns core.ts + core tests + persistence. Export agent owns export.ts/export-server.ts + export tests. Editor agent owns Editor.tsx/main.tsx/editor.css/index.html + editor tests. Communicate contract issues instead of silently changing signatures.


## Generator extension and seed bank

Use `isGenerator(type)` for generic source detection in port typing, routing, rack replacement, and rendering. Keep pole-specific UI restricted to Silk. Lattice Choir is type `lattice`, with density, fold, palette, offset, ratio, and morph parameters. Its own WGSL consumes explicit phase/aspect and participates in the same export/modulation graph; it is not a Silk preset.

`bank.ts` supplies four curated Silk patches and `generatePatch(current, seed, scope)`. Seed algorithm `wander-v1` uses deterministic IDs and PRNG. Effects scope preserves sources and retained control nodes, replacing frame processors; whole scope creates a new Silk or Lattice composition. Generated racks have 3–5 processors, no more than two temporal processors, and one generated LFO. Replacing a generated rack removes its generated controls. Generated patches still pass core validation and require no renderer-specific randomness. Seeds are recipe identity, not saved GPU history.


## Accepted expansion seam � 2026-09-09

Generator metadata lives in `generators/catalog.ts`; `generators/shaders.ts` is the renderer-only WGSL registry. A new generator supplies a pure numeric parameter manifest and WGSL Params matching those keys, plus renderer-owned phase/aspect. Use explicit time, no runtime randomness, and the existing frame output. Orbit and Contour use this same modulation/export contract. Preserve existing Silk/Lattice defaults and shader behavior. The Wander v1 picker deliberately stays Silk/Lattice; widening it requires a new algorithm version.

`generator-bank.ts` exports four portable compositions. Optional Patch.exploration v1 records seed, scope, and explicitly owned generatedNodeIds. Effects-only seeded mutation accepts one unbranched active source chain, preserving parked user devices; branched graphs reject without mutation. ID prefixes confer no ownership.

`persistence.ts` implements storage, re-exported by core. `loadSavedLibrary()` returns `{patches,warnings}` and skips malformed entries without deleting them. Draft restoration is independent; an unreadable draft disables automatic replacement until explicit loading or a successful save.

Renderer planning considers only frame ancestors of Screen output. Parameter/control/position changes do not reset temporal history. Active frame rewiring does. Targets reuse matching device IDs/types; compiled effects pool by shader family. Budget checks estimate RGBA16F frame textures (512 MiB per renderer, including replacement overlap); this is a guard, not total GPU memory accounting. GPU failures require Restart GPU, preserving patch/time but clearing history. Arbitrary untrusted shader editing remains out of scope.

## Video extension - 2026-09-21

`NodeType` adds `video`; `isGenerator` includes it without adding it to procedural `generatorIds`. Optional `SynthNode.media:{id:string;name:string}` is legal only on Video and requires `sha256-` plus 64 lowercase hex digits. Missing media is a valid editable patch state but an active missing source fails rendering/export visibly. At most one Video source is accepted. Numeric `speed[-4,4]` and `start[0,600]` are recordable/modulatable; these map absolute time, not accumulated playback velocity.

Video requires `await renderAt(time, options)` before `settled/readFrame`; synchronous unprepared rendering throws. Each renderer resolves project media independently. Render completion means the requested presentation frame was decoded and uploaded. Cancellation or revision change rejects before upload. Media replacement resets temporal state. Portable JSON never contains blob URLs or video bytes; the inspector distinguishes exact-file relink from replacement. One 4-byte upload texture per output pixel is budgeted alongside the existing 8-byte source target. No new provider, network source, playback clock or export-specific video shortcut is introduced.

## Instruments

An instrument is a Visual Synth device plus playable evidence. It must be either a registered generator/effect in `manifests` (`NodeType`, `generatorDefinitions` or `effectDefinitions`) with a WGSL `Params` struct matching the numeric parameter manifest, or an existing registered effect used as the authored instrument surface. It also needs at least two `CatalogPreset` snapshots in `performanceBank` with `bank:'Instruments'`, each with `controls:[PresetControl, PresetControl, PresetControl]` exactly. Optional `CatalogPreset.touch` may map `x` and/or `y` to `{node,param}` or set `inject` for a simulation. The Doodle Lab source card for the same `id` is `projects/doodle-lab/snapshots/<id>.json` plus `<id>.png` on the Doodle Lab branch; this branch may not contain those files.

Stateless sources and effects are pure functions of parameters, input textures, `phase` and `aspect`. If advertised as loopable, they must be bit-periodic at `phase + 2*pi` for integer-turn parameters only, and the browser regression suite (not included in this repository) must render the device and prove visible pixels, motion and exact repeat. Stateful instruments use `Patch.simulation:{tickHz:60,warmupTicks,events}` and implement `SimulationPass` through `createSimulationPass`; they advance only on the 60 Hz simulation tick, replay bit-identically from `seed`, and pass the no-leak check: queued `SynthRenderer.live()` input cannot affect a later replay/export, while live input during advancing ticks visibly acts.

`SynthRenderer.live(event: Omit<SimulationEvent,"time">)` is performance-only input. The renderer keeps a bounded queue of up to 16 events, applies matching-node events to the next advancing simulation step, then clears the queue. `reset()` clears pending live events. `live()` never writes `Patch.simulation.events`, never changes the saved patch, and must not reach export except through explicitly recorded `Patch.simulation.events`.

Review gate: a builder supplies tests and a receipt, then an independent reviewer runs the C5 loop for at most three rounds. Review must inspect code, compile/render evidence, the Player snapshots and macro controls, Doodle Lab card evidence, browser periodicity/no-leak coverage, determinism from seed for stateful instruments, normal-speed playback/scrubbing where relevant, and naming/brand safety. A builder's own tests are not independent review.

Naming: instruments may be inspired by products or visual genres, but must not reproduce logos, wordmarks, trade dress, or product names. Use generic names and labels, as `Frost Fizz` does for the can study.

Checklist for adding an instrument:
- Register the device and manifest in `projects/shader-lab/generators/instruments.ts`, `generators/simulation.ts`, or the relevant effect catalog/shader registry.
- Add WGSL and renderer bindings so `Params` matches the manifest plus renderer-owned fields such as `phase` and `aspect`.
- For stateful work, implement or extend `SimulationPass` in `simulation-runtime.ts`, `slime-runtime.ts`, or `ink-runtime.ts`, with `seed`, `grid`, `Patch.simulation`, 60 Hz ticks, reset, replay and no-leak behavior.
- Add at least two `performanceBank` entries in the `Instruments` bank, each with exactly three `controls` and optional `touch`.
- Ensure Player behavior in `player.ts` remains valid: macro knobs, Morph exclusions, palette handling, MIDI defaults from `midi-profiles.ts`, and `touchAt()` mapping to params and/or `renderer.live()`.
- Add or update browser coverage in the browser regression suite (not included in this repository) for render visibility, exact stateless periodicity, all Instrument snapshots, and stateful deterministic/no-leak/liveActs behavior.
- Add the Doodle Lab card files `projects/doodle-lab/snapshots/<id>.json` and `<id>.png` on the Doodle Lab branch, preserving the instrument id.

## Lab devices

Lab devices are data-only Visual Synth devices loaded from `projects/shader-lab/library/lab-devices.json`. The file has `version:1` and a `devices` array; each device id is `lab.<kebab-name>`, declares `kind:"effect"` or `kind:"source"`, `status:"curated"` or `status:"candidate"`, one to six numeric params, short provenance metadata, an added date, and a WGSL body. Runtime loading is only from this committed JSON file: no URL fetch, localStorage shader text, dynamic import, or JavaScript evaluation is part of the contract.

The synth owns the fixed template in `lab-device.ts`. The body may define constants and helper functions, but must provide `fn labMain(uv: vec2f) -> vec4f`; the template supplies the fragment entry point, the uniform struct (`p0..p5`, `time`, `width`, `height`), and helpers `labInput` for effects, `labParam`, `labTime`, and `labAspect`. Effects use the same source/sampler/params binding convention as built-in single-input effects; sources use the source-side params binding.

`validateLabLibrary`, `validateLabDeviceSpec`, and `validateLabBody` are the shared static gate for shipped lab devices and future foundry output. Bodies are capped at 6000 characters, must define `labMain`, and reject binding declarations, shader entry point attributes, storage/uniform/workgroup/private variables, feature directives, texture stores, atomics, pointers, and unbounded loop forms. These restrictions keep lab bodies from declaring their own GPU access surface, reading or writing arbitrary GPU memory, adding hidden entry points, or enabling extensions outside the synth-owned template. `for` loops must use integer literal bounds, each loop is capped at 64 iterations, and nested products are capped at 256, and a loop body may not assign to, increment or take the address of its own counter (which would defeat the bound); together these reduce GPU hang risk. Loops inside helper functions called from other loops are not multiplied statically, so the foundry's render check also enforces a frame-time budget. Params require unique keys, numeric `min < max`, and defaults inside range. Lab ids must match `^lab\.[a-z0-9-]{3,40}$` and cannot clash with built-in device types.

Curated devices are hand/reviewer accepted. Candidate devices may appear in the Bridge under Lab and carry the `candidate` tag, but only a human or Claude may flip `candidate` to `curated`. A lab shader that fails GPU compilation must fail soft: effects render pass-through, sources render black, and the renderer records a short `labError` diagnostic on the node object. Built-in devices keep their existing compile behavior. If a patch references a lab id no longer present in the committed file, it validates as an unknown device type, matching existing missing-device behavior.
