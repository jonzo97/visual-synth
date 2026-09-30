import { useEffect, useRef, useState, useMemo } from "react";
import { storeVideo, VideoMediaError } from "./video-media";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  useNodesInitialized,
  useReactFlow,
  type Connection as FlowConnection,
} from "@xyflow/react";
import { canEncodeVideo, Quality } from "mediabunny";
import {
  manifests,
  isGenerator,
  isEffect,
  isMixer,
  isStatefulGenerator,
  frameInputs,
  createNode,
  createDefaultPatch,
  validatePatch,
  migratePatch,
  parsePatch,
  evaluateParameters,
  rackPresets,
  applyRack,
  savePatch,
  listSavedPatches,
  loadSavedLibrary,
  loadDraft,
  saveDraft,
  type Patch,
  type SynthNode,
  type NodeType,
  type SimulationEvent,
} from "./core";
import { createRenderer, type SynthRenderer } from "./renderer";
import { exportClip, exportPerformance, startRecording } from "./export";
import { outputSize, sizeLadder } from "./display-size";
import { exportSizeFor, shareFormats, type ShareFormatId } from "./share-formats";
import { isTextEditingTarget, isUndoShortcut } from "./keyboard-shortcuts";
import { buildIndex, type BrowserItem } from "./browser-index";
import { search as searchBrowser, type SearchHit } from "./browser-search";
import { actionsFor, type BrowserAction } from "./browser-actions";
import { LABELS, type FacetName } from "./browser-taxonomy";

import {
  parsePerformance,
  performancePatchAt,
  type PerformanceTake,
} from "./performance";
import { generatePatch } from "./bank";
import { presetCatalog } from "./preset-catalog";
import { performanceBank } from "./performance-bank";
// Player hand-off links (?patch=) stay well inside URL limits and the editor's node budget.
const PATCH_LINK_MAX_CHARS = 64_000;
const PATCH_LINK_MAX_NODES = 64;
const editorPresets = [...presetCatalog, ...performanceBank];
import { generatePatchV2, wanderFamilies } from "./wander-v2";
const clone = <T,>(v: T): T => structuredClone(v);
const bridgeScopes = [
  { key: "Sources", label: "Sources" },
  { key: "Effects", label: "Effects" },
  { key: "Modulators", label: "Mod" },
  { key: "Compositions", label: "Compositions" },
  { key: "Instruments", label: "Instruments" },
  { key: "Racks", label: "Racks" },
  { key: "Saved", label: "Saved" },
] as const;
const bridgeFilterChips: { facet: FacetName; value: string; label: string }[] = [
  { facet: "behaviour", value: "loopable", label: "Loops" },
  { facet: "behaviour", value: "stateful", label: "Simulation" },
  { facet: "behaviour", value: "touch-xy", label: "Touch" },
  { facet: "behaviour", value: "history", label: "Uses past frames" },
  { facet: "cost", value: "light", label: "Light" },
  { facet: "cost", value: "medium", label: "Medium" },
  { facet: "cost", value: "heavy", label: "Heavy" },
];
const itemGlyph = (item: BrowserItem) => {
  if (item.kind === "device") {
    if (isGenerator(item.id)) return "≋";
    if (item.id === "lfo") return "∿";
    if (item.id === "gate") return "▴";
    return "⌁";
  }
  if (item.kind === "rack") return "↯";
  if (item.kind === "saved") return "◇";
  if (item.kind === "patch-param") return "◌";
  return "◆";
};
const groupLabel = (kind: string) => ({
  "patch-param": "In this patch",
  "patch-node": "In this patch",
  device: "Devices",
  preset: "Compositions",
  rack: "Racks",
  saved: "Saved",
  place: "Places",
}[kind] ?? kind);
const palettes = [
  "Tidal silk",
  "Ember veil",
  "Opal current",
  "Redwood pop",
  "Acid canopy",
  "Maroon sun",
  "Simpsonwave",
  "Ion storm",
  "Solar candy",
];
const names: Record<string, string[]> = {
  palette: palettes,
  crossing: [
    "Original silk",
    "Woven fabric",
    "Interference mesh",
    "Luminous tangle",
  ],
  mode: ["Off", "Gravity", "Magnetic", "Vortex"],
  shape: ["Sine", "Triangle", "Saw", "Square"],
  sync: ["Free Hz", "Tempo sync"],
};
const deviceNames: Record<string, Record<string, string[]>> = {
  operator: { mode: ['Phase modulation', 'Ring modulation'], carrier: ['Sine', 'Triangle', 'Saw', 'Square'], modulator: ['Sine', 'Triangle', 'Saw', 'Square'] },
  mixer4: { blend: ["Normalized mix", "Add", "Screen", "Multiply", "Difference"] },
  "fx.warp": { mode: ["Luma gradient", "Red / green vectors"], boundary: ["Clamp", "Wrap", "Mirror"] },
  "fx.mask": { blend: ["Crossfade", "Multiply", "Difference"], invert: ["Normal", "Inverted"] },
  "fx.fold": { mode: ["Solarize", "Fold"], channels: ["Luminance", "RGB"] },
  "fx.morph": { mode: ["Dilate", "Erode", "Outline"], kernel: ["3 × 3", "5 × 5"], lumaOnly: ["Source color", "Luminance"] },
  "fx.chrono": { mode: ["Horizontal", "Vertical", "Radial"] },
  "fx.feedback": { lighten: ["Crossfade", "Lighten"] },
  pulse: { waveform: ["Triangle", "Saw", "Square", "Pulse"], operation: ["Union", "Intersection", "Subtraction"] },
  cells: { law: ["Orbit", "Drift", "Counterflow"] },
  rules: { neighborhood: ["Moore", "Cross"] },
  hyperbolic: { palette: [...palettes, "Iridescent", "Stained glass", "Luma only"] },
  quasicrystal: { palette: [...palettes, "Iridescent", "Stained glass", "Luma only"] },
  polytope: { palette: [...palettes, "Iridescent", "Stained glass", "Luma only"], shape: ["16-cell", "Tesseract", "24-cell"] },
  fizz: { palette: ["White can", "Frost blue", "Chrome night"] },
  julia: { shape: ["Quaternion Julia", "Mandelbulb"] },
  complex: { arrangement: ["Three zeros, two poles", "Pentagon dipoles", "Blaschke product", "Iterated cubic", "Warped quartet"], style: ["Neon grid", "Enhanced phase", "Acid checker"], iterate: ["Off", "On"] },
  attractor: { kind: ["Clifford", "de Jong"], print: ["Cyanotype", "Van Dyke", "Platinum", "Oxblood", "Luma only", "Neon"] },
  multigrid: { palette: [...palettes, "Zellige glaze", "Delft glaze", "Terracotta glaze"], color: ["Shape", "Orientation", "Hidden structure"], lines: ["None", "Strapwork", "Arcs"] },
};
const parameterOptions = (node: SynthNode, key: string) => {
  if (key === "grid" && isStatefulGenerator(node.type))
    return [128, 256, 512].map((value) => ({ label: `${value} × ${value}`, value }));
  const labels = deviceNames[node.type]?.[key] ??
    (key === "palette" || node.type === "silk" || node.type === "lfo" ? names[key] : undefined);
  return labels?.map((label, value) => ({ label, value }));
};
const DEFAULT_PREVIEW_SIZE: [number, number] = [1100, 619];
const VERTICAL_PREVIEW_SIZE: [number, number] = [619, 1100];
const RECORDING_SIZE: [number, number] = [1280, 720];
type PreviewRequest = { reset?: boolean; size?: [number, number]; sizes?: [number, number][] };
type PerformanceDraft = Omit<PerformanceTake, "duration">;
const isFrame = (type: string) =>
  isGenerator(type) || isEffect(type) || isMixer(type);
function Device({ data, selected }: any) {
  const node: SynthNode = data.node;
  const manifest = manifests[node.type];
  const inputs = node.type === "adsr" ? ["gate"] : frameInputs(node);
  const output = isFrame(node.type)
    ? "frame"
    : node.type === "gate"
      ? "gate"
      : node.type === "output"
        ? null
        : "value";
  return (
    <div className={`device ${selected ? "selected" : ""} ${data.revealed ? "revealed" : ""}`}>
      <div className="device-category">{manifest.category}</div>
      <strong>{manifest.label}</strong>
      <div className={`device-wave ${node.type.replace(".", "-")}`}>
        {node.type === "silk"
          ? "≋"
          : node.type === "output"
            ? "▣"
            : node.type === "lfo"
              ? "∿"
              : node.type === "gate"
                ? "▴"
                : isMixer(node.type)
                  ? "⋈"
                  : "⌁"}
      </div>
      {inputs.map((port, i) => (
        <div className="port-row" key={port}>
          <Handle
            type="target"
            position={Position.Left}
            id={port}
            style={{ top: 91 + i * 20 }}
            className={port === "gate" ? "control-port" : ""}
          />
          <span>{node.type === "fx.mask" && port === "in" ? "in · A" : port}</span>
        </div>
      ))}
      {output && (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id={output}
            style={{ top: 65 }}
            className={output !== "frame" ? "control-port" : ""}
          />
          <span className="out-label">{output}</span>
        </>
      )}
      <div className="parameter-ports">
        {Object.entries(manifest.params)
          .filter(([, spec]) => spec.modulatable)
          .map(([key, spec]) => (
            <div key={key} className="parameter-port">
              <Handle
                type="target"
                position={Position.Left}
                id={`param:${key}`}
                className="control-port"
              />
              <span>{spec.label}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
const nodeTypes = { device: Device };
function FitLoadedPatch({ revision }: { revision: number }) {
  const initialized = useNodesInitialized();
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (!initialized) return;
    const frame = requestAnimationFrame(() => { void fitView({ padding: 0.12 }); });
    return () => cancelAnimationFrame(frame);
  }, [revision, initialized, fitView]);
  return null;
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export default function Editor() {
  const [patch, setPatch] = useState<Patch>(createDefaultPatch);
  const patchRef = useRef(patch);
  patchRef.current = patch;
  const [patchNameText, setPatchNameText] = useState(patch.name);
  const [tempoText, setTempoText] = useState(String(patch.transport.bpm));
  const [draftSaveAllowed, setDraftSaveAllowed] = useState(true);
  const [gpuGeneration, setGpuGeneration] = useState(0);
  const [gpuStarting, setGpuStarting] = useState(true);
  const [warmupProgress, setWarmupProgress] = useState<number | null>(null);
  const [inputPreview, setInputPreview] = useState<{ node: string; port: string } | null>(null);
  const inputPreviewRef = useRef(inputPreview);
  inputPreviewRef.current = inputPreview;
  const previewControl = useRef<{ request(options?: PreviewRequest): Promise<void> } | null>(null);
  const startupFinished = useRef(false);
  useEffect(() => setPatchNameText(patch.name), [patch.name]);
  useEffect(
    () => setTempoText(String(patch.transport.bpm)),
    [patch.transport.bpm],
  );
  const [take, setTake] = useState<PerformanceTake | null>(null);
  const replayRef = useRef<PerformanceTake | null>(null);
  const [selectedEdges, setSelectedEdges] = useState<string[]>([]);
  const [naming, setNaming] = useState<"patch" | "rack" | null>(null),
    [saveName, setSaveName] = useState("");
  const [nameCollision, setNameCollision] = useState<string | null>(null);
  const [namingBusy, setNamingBusy] = useState(false);
  useEffect(() => setNameCollision(null), [saveName, naming]);
  useEffect(() => {
    if (!naming) return;
    requestAnimationFrame(() => saveNameRef.current?.select());
  }, [naming]);
  const [rackVersion, setRackVersion] = useState(0);
  void rackVersion;
  const [loaded, setLoaded] = useState(false),
    [selected, setSelected] = useState<string>(""),
    [view, setView] = useState("patch"),
    [message, setMessage] = useState("Starting the GPU…"),
    [error, setError] = useState("");
  const [playing, setPlaying] = useState(true),
    [time, setTime] = useState(0),
    [fps, setFps] = useState(0),
    [search, setSearch] = useState(""),
    [saved, setSaved] = useState<Patch[]>([]);
  const [bridgeScope, setBridgeScope] = useState<(typeof bridgeScopes)[number]["key"]>("Sources");
  const [bridgeFilters, setBridgeFilters] = useState<{ facet: FacetName; value: string }[]>([]);
  const [bridgeActive, setBridgeActive] = useState(0);
  const [collapsedFamilies, setCollapsedFamilies] = useState<string[]>([]);
  const [revealedNode, setRevealedNode] = useState<string>("");
  const [videoLoading, setVideoLoading] = useState(false);
  const [exportResult, setExportResult] = useState<{
    url: string;
    format: string;
    width: number;
    height: number;
    duration: number;
    name: string;
  } | null>(null);
  const exportUrl = useRef<string | null>(null);
  const [seed, setSeed] = useState("fern-001");
  const explorationMetadata = JSON.stringify(patch.exploration ?? null);
  useEffect(() => {
    if (patch.exploration) {
      setSeed(patch.exploration.seed);
      if (patch.exploration.version === 2) {
        setWanderVersion("v2");
        setWanderFamily(wanderFamilies.includes(patch.exploration.family as typeof wanderFamilies[number]) ? patch.exploration.family as typeof wanderFamilies[number] : "all");
        setLockSource(patch.exploration.sourceLocked);
      } else {
        setWanderVersion("v1");
        setWanderScope(patch.exploration.scope);
      }
      return;
    }
    const prefix = "Wander v1 · ";
    if (patch.name.startsWith(prefix)) setSeed(patch.name.slice(prefix.length));
  }, [patch.name, explorationMetadata]);
  const [wanderVersion, setWanderVersion] = useState<"v1" | "v2">("v2");
  const [wanderFamily, setWanderFamily] = useState<typeof wanderFamilies[number]>("all");
  const [lockSource, setLockSource] = useState(true);
  const [wanderScope, setWanderScope] = useState<"effects" | "whole">(
    "effects",
  );
  const [fitRevision, setFitRevision] = useState(0);
  const [exportOpen, setExportOpen] = useState(false),
    [format, setFormat] = useState<"mp4" | "webm">("mp4"),
    [shareFormatId, setShareFormatId] = useState<ShareFormatId>("landscape"),
    [height, setHeight] = useState(1080),
    [exportFps, setExportFps] = useState(30),
    [duration, setDuration] = useState(12),
    [progress, setProgress] = useState<number | null>(null);
  const [recording, setRecording] = useState(false),
    [recordStarting, setRecordStarting] = useState(false),
    [recordSeconds, setRecordSeconds] = useState(0),
    [previewOrientation, setPreviewOrientation] = useState<"16:9" | "9:16">("16:9"),
    [previewSize, setPreviewSize] = useState<[number, number]>(DEFAULT_PREVIEW_SIZE),
    [, setHistoryVersion] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null),
    renderer = useRef<SynthRenderer | null>(null),
    clock = useRef(0),
    playRef = useRef(true),
    undo = useRef<Patch[]>([]),
    redo = useRef<Patch[]>([]),
    gesture = useRef<Patch | null>(null),
    abort = useRef<AbortController | null>(null),
    recorder = useRef<Awaited<ReturnType<typeof startRecording>> | null>(null),
    recordStart = useRef(0),
    performanceData = useRef<PerformanceDraft | null>(null),
    importFile = useRef<HTMLInputElement>(null),
    searchRef = useRef<HTMLInputElement>(null),
    saveNameRef = useRef<HTMLInputElement>(null);
  const recordingRef = useRef(recording);
  recordingRef.current = recording;
  // The window key handler reads these through refs, so it never sees a dialog that has just closed.
  const namingRef = useRef(naming);
  namingRef.current = naming;
  const exportOpenRef = useRef(exportOpen);
  exportOpenRef.current = exportOpen;
  const recordStartingRef = useRef(recordStarting);
  recordStartingRef.current = recordStarting;
  const previewOrientationRef = useRef(previewOrientation);
  previewOrientationRef.current = previewOrientation;
  const locked = recording || recordStarting || progress !== null || take !== null || videoLoading;
  const previewBaseSize = () => previewOrientationRef.current === "9:16" ? VERTICAL_PREVIEW_SIZE : DEFAULT_PREVIEW_SIZE;
  const fullscreenSize = () => {
    const vertical = previewOrientationRef.current === "9:16";
    const cssHeight = screen.height;
    const cssWidth = vertical ? cssHeight * 9 / 16 : screen.width;
    return (
    outputSize({
      cssWidth,
      cssHeight,
      dpr: devicePixelRatio || 1,
      maxDimension: 8192,
    }));
  };
  const requestFullscreenPreviewSize = () => {
    if (recordingRef.current || recordStartingRef.current) return;
    const size = fullscreenSize();
    redraw({ sizes: sizeLadder(size) });
  };
  const restorePreviewSize = () => {
    const inPreviewFullscreen = document.fullscreenElement === canvas.current;
    if (inPreviewFullscreen) {
      const size = fullscreenSize();
      redraw({ sizes: sizeLadder(size) });
    } else redraw({ size: previewBaseSize() });
  };
  const redraw = (options?: PreviewRequest) => {
    void previewControl.current?.request(options).catch(() => {});
  };
  const commit = (next: Patch, checkpoint = true) => {
    if (checkpoint) {
      undo.current.push(clone(patchRef.current));
      if (undo.current.length > 100) undo.current.shift();
      redo.current = [];
      setHistoryVersion((v) => v + 1);
    }
    patchRef.current = next;
    setPatch(next);
  };
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e));
  const gpuFailure = (e: unknown) => {
    const detail = e instanceof Error ? e.message : String(e);
    setError(
      `${detail}\nRendering paused. Use Restart GPU to recreate the renderer with your current patch. A shader or invalid-patch error may require changing the patch before restarting.`,
    );
    setMessage("GPU stopped · Restart GPU to recover");
    setPlaying(false);
    playRef.current = false;
  };
  const beginGesture = () => {
    if (!gesture.current) gesture.current = clone(patchRef.current);
  };
  const endGesture = () => {
    const previous = gesture.current;
    gesture.current = null;
    if (
      previous &&
      JSON.stringify(previous) !== JSON.stringify(patchRef.current)
    ) {
      undo.current.push(previous);
      if (undo.current.length > 100) undo.current.shift();
      redo.current = [];
      setHistoryVersion((v) => v + 1);
    }
  };
  const commitPatchName = () => {
    const name = patchNameText.trim();
    if (locked || !name || name.length > 120) {
      setPatchNameText(patchRef.current.name);
      return;
    }
    setPatchNameText(name);
    if (name !== patchRef.current.name) commit({ ...patchRef.current, name });
  };
  const commitTempo = () => {
    const value = Number(tempoText);
    if (locked || !tempoText.trim() || !Number.isFinite(value)) {
      setTempoText(String(patchRef.current.transport.bpm));
      return;
    }
    const bpm = Math.max(20, Math.min(300, value));
    setTempoText(String(bpm));
    if (bpm !== patchRef.current.transport.bpm)
      commit({
        ...patchRef.current,
        transport: { ...patchRef.current.transport, bpm },
      });
  };
  const parameter = (id: string, key: string, value: number) => {
    if (recordStarting || replayRef.current || progress !== null) return;
    const next = clone(patchRef.current);
    const n = next.nodes.find((n) => n.id === id);
    if (!n) return;
    n.params[key] = value;
    commit(next, false);
    if (performanceData.current)
      performanceData.current.controls.push({
        time: clock.current - recordStart.current,
        node: id,
        param: key,
        value,
      });
  };
  const gate = (id: string, on: boolean) => {
    if (recordStarting || replayRef.current || progress !== null) return;
    const next = clone(patchRef.current);
    next.events.push({ time: clock.current, node: id, on });
    commit(next, false);
    if (performanceData.current)
      performanceData.current.gates.push({
        time: clock.current - recordStart.current,
        node: id,
        on,
      });
  };
  const simulationGesture = (kind: SimulationEvent["kind"], x?: number, y?: number) => {
    if (recordStarting || replayRef.current || progress !== null) return;
    const current = patchRef.current;
    const target = current.nodes.find((node) => node.id === selected && isStatefulGenerator(node.type)) ??
      current.nodes.find((node) => isStatefulGenerator(node.type));
    if (!target) return;
    const event: SimulationEvent = {
      kind,
      node: target.id,
      time: Math.ceil((clock.current - 1e-7) * 60) / 60,
      ...(kind === "inject" ? { x: x ?? 0.5, y: y ?? 0.5, radius: 0.06, amount: 1 } : {}),
    };
    const next = clone(current);
    next.version = 2;
    next.simulation ??= { tickHz: 60, warmupTicks: 0, events: [] };
    next.simulation.events.push(event);
    if (!playRef.current) {
      clock.current = event.time;
      setTime(event.time);
    }
    commit(next, !performanceData.current);
    if (performanceData.current) {
      performanceData.current.simulation ??= [];
      performanceData.current.simulation.push({ ...event, time: event.time - recordStart.current });
    }
    setMessage(`${kind === "reset" ? "Reset" : "Injected into"} ${manifests[target.type].label} at ${event.time.toFixed(2)} s`);
  };
  const undoAction = () => {
    if (locked || !undo.current.length) return;
    redo.current.push(clone(patchRef.current));
    const p = undo.current.pop()!;
    patchRef.current = p;
    setPatch(p);
    setHistoryVersion((v) => v + 1);
  };
  const redoAction = () => {
    if (locked || !redo.current.length) return;
    undo.current.push(clone(patchRef.current));
    const p = redo.current.pop()!;
    patchRef.current = p;
    setPatch(p);
    setHistoryVersion((v) => v + 1);
  };
  useEffect(() => {
    // Fast Refresh reruns effects while retaining the live working patch.
    // A completed startup must never reload an older stored draft over it.
    if (startupFinished.current) return;
    try {
      const racks = JSON.parse(
        localStorage.getItem("visual-synth-racks") || "{}",
      );
      for (const [name, entries] of Object.entries(racks)) {
        rackPresets[name] = entries as any;
        if (validatePatch(applyRack(createDefaultPatch(), name)).length)
          delete rackPresets[name];
      }
      setRackVersion((v) => v + 1);
    } catch (e) {
      fail(e);
    }
    let alive = true;
    (async () => {
      try {
        const [draft, library] = await Promise.allSettled([
          loadDraft(),
          loadSavedLibrary(),
        ]);
        if (!alive) return;
        const warnings: string[] = [];
        if (draft.status === "fulfilled") {
          if (draft.value) {
            setPatch(draft.value);
            patchRef.current = draft.value;
          }
        } else {
          setDraftSaveAllowed(false);
          warnings.push(
            `${draft.reason instanceof Error ? draft.reason.message : String(draft.reason)} Automatic draft saving is paused until you load a patch or successfully Save / Save as.`,
          );
        }
        if (library.status === "fulfilled") {
          setSaved(library.value.patches);
          warnings.push(...library.value.warnings);
        } else {
          warnings.push(
            `Saved library could not be loaded: ${library.reason instanceof Error ? library.reason.message : String(library.reason)}`,
          );
        }
        if (warnings.length) setError(warnings.join("\n"));
      } catch (e) {
        if (alive) {
          setDraftSaveAllowed(false);
          fail(e);
        }
      } finally {
        if (alive) {
          startupFinished.current = true;
          setLoaded(true);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!loaded || !draftSaveAllowed) return;
    const timer = setTimeout(() => saveDraft(patch).catch(fail), 500);
    return () => clearTimeout(timer);
  }, [patch, loaded, draftSaveAllowed]);
  useEffect(() => {
    if (!loaded || !canvas.current) return;
    setGpuStarting(true);
    let disposed = false;
    let frame = 0;
    let owned: SynthRenderer | null = null;
    let inFlight: Promise<void> | null = null;
    let activeAbort: AbortController | null = null;
    let revision = 0;
    let dirty = true;
    let resetRequested = false;
    let pendingSizes: [number, number][] | undefined;
    let strictResize = true;
    let appliedPatch: Patch | undefined;
    const waiters: { revision: number; resolve(): void; reject(error: unknown): void }[] = [];
    let last = performance.now(),
      meter = last,
      count = 0;
    const cancelled = () => new DOMException("Preview cancelled", "AbortError");
    const schedule = () => {
      if (!disposed && owned && !frame && !inFlight && (dirty || playRef.current))
        frame = requestAnimationFrame(tick);
    };
    const control = {
      request(options: PreviewRequest = {}): Promise<void> {
        if (disposed) return Promise.reject(cancelled());
        revision++;
        dirty = true;
        resetRequested ||= options.reset ?? false;
        if (options.sizes) {
          pendingSizes = options.sizes;
          strictResize = false;
        } else if (options.size) {
          pendingSizes = [options.size];
          strictResize = true;
        }
        activeAbort?.abort();
        const promise = new Promise<void>((resolve, reject) => waiters.push({ revision, resolve, reject }));
        schedule();
        return promise;
      },
    };
    previewControl.current = control;
    const tick = (now: number) => {
      frame = 0;
      if (disposed || !owned || inFlight) return;
      const r = owned;
      const requested = revision;
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      // A load, seek, or paused edit draws its exact requested time first.
      if (playRef.current && appliedPatch && !resetRequested) clock.current += dt;
      const active = replayRef.current;
      if (active) clock.current = Math.min(clock.current, active.startTime + active.duration);
      const live = performanceData.current;
      const timeline: PerformanceTake | null = active ?? (live ? {
        ...clone(live), duration: Math.max(1 / 60, clock.current - live.startTime),
      } : null);
      const controller = new AbortController();
      activeAbort = controller;
      inFlight = (async () => {
        try {
          let current = timeline ? performancePatchAt(timeline, clock.current - timeline.startTime) : patchRef.current;
          const preview = inputPreviewRef.current;
          if (preview && !active) {
            const edge = current.connections.find((connection) => connection.to.node === preview.node && connection.to.port === preview.port);
            const output = current.nodes.find((node) => node.type === "output");
            if (edge && output) {
              const outputCable = current.connections.find((connection) => connection.to.node === output.id);
              current = clone(current);
              current.connections = current.connections.filter((connection) => connection.to.node !== output.id);
              current.connections.push({ id: outputCable?.id ?? crypto.randomUUID(), from: { ...edge.from }, to: { node: output.id, port: "in" } });
            }
          }
          if (current !== appliedPatch) {
            await r.setPatch(current);
            appliedPatch = current;
          }
          if (resetRequested) {
            r.reset();
            resetRequested = false;
          }
          if (pendingSizes) {
            const candidates = pendingSizes;
            const mustResize = strictResize;
            pendingSizes = undefined;
            strictResize = true;
            let resized = false;
            let resizeError: unknown;
            for (const candidate of candidates) {
              try {
                r.resize(...candidate);
                setPreviewSize([r.canvas.width, r.canvas.height]);
                resized = true;
                break;
              } catch (error) {
                resizeError = error;
              }
            }
            if (!resized) {
              setPreviewSize([r.canvas.width, r.canvas.height]);
              if (mustResize) throw resizeError;
              fail(resizeError);
            }
          }
          const started = performance.now();
          await r.renderAt(clock.current, {
            signal: controller.signal,
            onProgress: (fraction) => {
              if (!disposed && !controller.signal.aborted && performance.now() - started > 100)
                setWarmupProgress(fraction < 1 ? fraction : null);
            },
            ...(timeline ? { patchAt: (at: number) => performancePatchAt(timeline, at - timeline.startTime) } : {}),
          });
          await r.settled();
          if (disposed || controller.signal.aborted) return;
          if (requested === revision) dirty = false;
          for (let i = waiters.length - 1; i >= 0; i--) {
            if (waiters[i]!.revision <= requested) waiters.splice(i, 1)[0]!.resolve();
          }
          if (active && clock.current >= active.startTime + active.duration) {
            setPlaying(false);
            playRef.current = false;
          }
          count++;
          const completed = performance.now();
          if (completed - meter > 400 || !playRef.current) {
            setTime(clock.current);
            setFps(Math.round((count * 1000) / Math.max(1, completed - meter)));
            count = 0;
            meter = completed;
          }
        } catch (e) {
          if (disposed) return;
          if (e instanceof Error && e.name === "AbortError") {
            dirty = true;
            return;
          }
          dirty = false;
          waiters.splice(0).forEach((waiter) => waiter.reject(e));
          if (e instanceof VideoMediaError) {
            fail(e); setPlaying(false); playRef.current = false;
            setMessage("Video needs attention · choose or relink the file, then Play");
          } else gpuFailure(e);
        } finally {
          if (!disposed) {
            setWarmupProgress(null);
            setGpuStarting(false);
          }
        }
      })();
      void inFlight.finally(() => {
        inFlight = null;
        activeAbort = null;
        if (disposed) r.dispose();
        else schedule();
      });
    };
    (async () => {
      try {
        const r = await createRenderer(canvas.current!, {
          preview: false,
          width: DEFAULT_PREVIEW_SIZE[0],
          height: DEFAULT_PREVIEW_SIZE[1],
        });
        if (disposed) {
          r.dispose();
          return;
        }
        owned = r;
        renderer.current = r;
        setPreviewSize([r.canvas.width, r.canvas.height]);
        setMessage("Live output · vgpu");
        schedule();
      } catch (e) {
        if (!disposed) {
          waiters.splice(0).forEach((waiter) => waiter.reject(e));
          gpuFailure(e);
          setGpuStarting(false);
        }
      }
    })();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      activeAbort?.abort();
      waiters.splice(0).forEach((waiter) => waiter.reject(cancelled()));
      if (!inFlight) owned?.dispose();
      if (renderer.current === owned) renderer.current = null;
      if (previewControl.current === control) previewControl.current = null;
    };
  }, [loaded, gpuGeneration]);
  useEffect(() => {
    redraw();
  }, [patch]);
  useEffect(() => {
    const onFullscreenChange = () => {
      if (document.fullscreenElement === canvas.current) requestFullscreenPreviewSize();
      else if (!recordingRef.current && !recordStartingRef.current) redraw({ size: previewBaseSize() });
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);
  useEffect(() => {
    if (!recordingRef.current && !recordStartingRef.current)
      redraw({ size: previewBaseSize() });
  }, [previewOrientation]);
  useEffect(() => {
    playRef.current = playing;
    redraw();
  }, [playing]);
  useEffect(() => {
    redraw();
  }, [inputPreview]);
  useEffect(() => {
    if (inputPreview && (selected !== inputPreview.node || !patch.connections.some((edge) => edge.to.node === inputPreview.node && edge.to.port === inputPreview.port)))
      setInputPreview(null);
  }, [selected, patch, inputPreview]);
  useEffect(() => {
    const api = {
      getPatch: () => clone(patchRef.current),
      setPatch: (next: Patch) => {
        if (locked)
          throw new Error(
            "Finish capture or replay before replacing the patch.",
          );
        commit(migratePatch(next));
        setDraftSaveAllowed(true);
      },
    };
    (window as any).visualSynth = api;
    return () => {
      delete (window as any).visualSynth;
    };
  }, [locked]);
  // Latest gate(), so the key handler below never calls a copy that closed over old recording/export state.
  const gateRef = useRef(gate);
  gateRef.current = gate;
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (namingRef.current || exportOpenRef.current) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f" && !isTextEditingTarget(e.target)) {
        e.preventDefault();
        searchRef.current?.focus({ preventScroll: true });
        searchRef.current?.select();
        return;
      }
      if (e.key === "/" && !isTextEditingTarget(e.target)) {
        e.preventDefault();
        searchRef.current?.focus({ preventScroll: true });
        searchRef.current?.select();
        return;
      }
      if (isTextEditingTarget(e.target))
        return;
      if (e.key.toLowerCase() === "g" && !e.repeat) {
        e.preventDefault();
        patchRef.current.nodes
          .filter((n) => n.type === "gate")
          .forEach((n) => gateRef.current(n.id, true));
      }
      if (isUndoShortcut(e)) {
        e.preventDefault();
        e.shiftKey ? redoAction() : undoAction();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "g")
        patchRef.current.nodes
          .filter((n) => n.type === "gate")
          .forEach((n) => gateRef.current(n.id, false));
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [locked]);
  const add = (type: NodeType) => {
    if (locked) return;
    const next = clone(patchRef.current);
    const n = createNode(type);
    if (type === "video" && next.nodes.some(node => node.type === "video")) {
      setSelected(next.nodes.find(node => node.type === "video")!.id);
      setError("This version supports one Video source per patch. Select it to replace or relink its file.");
      return;
    }
    n.position = {
      x: 180 + (next.nodes.length % 4) * 230,
      y: 100 + Math.floor(next.nodes.length / 4) * 230,
    };
    next.nodes.push(n);
    if (next.nodes.length > 24) {
      setError("A patch supports up to 24 devices.");
      return;
    }
    commit(next);
    setSelected(n.id);
  };
  const connect = (c: FlowConnection) => {
    if (locked || !c.source || !c.target || !c.sourceHandle || !c.targetHandle)
      return;
    const next = clone(patchRef.current);
    next.connections = next.connections.filter(
      (e) => !(e.to.node === c.target && e.to.port === c.targetHandle),
    );
    next.connections.push({
      id: crypto.randomUUID(),
      from: { node: c.source, port: c.sourceHandle },
      to: { node: c.target, port: c.targetHandle },
      ...(c.targetHandle.startsWith("param:") ? { depth: 0.25 } : {}),
    });
    const errors = validatePatch(next);
    if (errors.length) {
      setError(errors.join(" "));
      return;
    }
    setError("");
    commit(next);
  };
  const remove = (ids: string[]) => {
    if (locked) return;
    const next = clone(patchRef.current);
    const safe = ids.filter(
      (id) => next.nodes.find((n) => n.id === id)?.type !== "output",
    );
    next.nodes = next.nodes.filter((n) => !safe.includes(n.id));
    next.connections = next.connections.filter(
      (e) => !safe.includes(e.from.node) && !safe.includes(e.to.node),
    );
    next.events = next.events.filter((e) => !safe.includes(e.node));
    if (next.simulation)
      next.simulation.events = next.simulation.events.filter((event) => !safe.includes(event.node));
    commit(next);
    setSelected("");
    setInputPreview(null);
  };
  const storePatch = async (as = false) => {
    try {
      let next = clone(patchRef.current);
      if (as) {
        setSaveName(next.name);
        setNaming("patch");
        return;
      }
      await savePatch(next);
      setDraftSaveAllowed(true);
      setSaved(await listSavedPatches());
      setMessage(`Saved “${next.name}”`);
    } catch (e) {
      fail(e);
    }
  };
  const load = (next: Patch) => {
    if (locked) return;
    let checked: Patch;
    try { checked = migratePatch(next); }
    catch (e) { fail(e); return; }
    replayRef.current = null;
    setTake(null);
    commit(checked);
    setDraftSaveAllowed(true);
    clock.current = 0;
    setTime(0);
    inputPreviewRef.current = null;
    setInputPreview(null);
    redraw({ reset: true });
    setSelected("");
    setError("");
    setMessage(`Loaded “${next.name}”`);
    setFitRevision((value) => value + 1);
  };
  const wander = (fresh: boolean) => {
    const nextSeed = fresh
      ? String(crypto.getRandomValues(new Uint32Array(1))[0])
      : seed;
    try {
      const next = wanderVersion === "v1"
        ? generatePatch(patchRef.current, nextSeed, wanderScope)
        : generatePatchV2(patchRef.current, nextSeed, { family: wanderFamily, lockSource });
      setSeed(nextSeed);
      load(next);
    } catch (e) {
      fail(e);
    }
  };
  // Deep links: ?preset=<bank id> or ?patch=<base64url JSON> open once, after saving a recovery copy.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (!loaded || locked || deepLinked.current) return;
    deepLinked.current = true;
    const query = new URLSearchParams(location.search);
    const id = query.get("preset"), encoded = query.get("patch");
    if (!id && !encoded) return;
    let incoming: { patch: Patch; name: string; note: string };
    try {
      if (encoded) {
        // ?patch= carries a Player snapshot (base64url JSON). The current patch is saved as a
        // recovery copy below before anything loads; size and node count are capped here.
        if (encoded.length > PATCH_LINK_MAX_CHARS) throw new Error("The patch link is too long.");
        const bin = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
        const patch = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))) as Patch;
        if (!Array.isArray(patch?.nodes) || patch.nodes.length > PATCH_LINK_MAX_NODES) throw new Error("The patch link has too many nodes.");
        const problems = validatePatch(patch);
        if (problems.length) throw new Error(problems.join(" "));
        incoming = { patch, name: patch.name, note: "Opened from the Player with its current knob and Morph settings." };
      } else {
        const preset = editorPresets.find((item) => item.id === id);
        if (!preset) { setError(`No bank composition named “${id}”.`); return; }
        incoming = { patch: preset.patch, name: preset.name, note: preset.description };
      }
    } catch (e) { setError(`That link does not contain a valid patch: ${e instanceof Error ? e.message : String(e)}`); return; }
    void (async () => {
      try {
        const recoveryName = `Before ${incoming.name} · ${new Date().toISOString()} · ${crypto.randomUUID().slice(0, 8)}`;
        await savePatch({ ...clone(patchRef.current), name: recoveryName });
        load(incoming.patch);
        setSaved(await listSavedPatches());
        playRef.current = true; setPlaying(true);
        setMessage(`${incoming.name} · ${incoming.note} Previous draft saved as “${recoveryName}”.`);
      } catch (e) { fail(e); }
    })();
  }, [loaded, locked]);
  const ensureExportEncoder = async (options: { format: "mp4" | "webm"; width: number; height: number; fps: number }) => {
    if (options.width * options.height < 3840 * 2160) return true;
    const codec = options.format === "mp4" ? "avc" : "vp9";
    const quality = new Quality({
      bitrate: Math.min(
        24_000_000,
        Math.max(4_000_000, options.width * options.height * options.fps * 0.16),
      ),
    });
    if (await canEncodeVideo(codec, { width: options.width, height: options.height, quality })) return true;
    setError(`This browser cannot encode ${options.width} × ${options.height} ${options.format.toUpperCase()} video. Choose 1440p or a different format.`);
    setMessage("4K export is not supported by this browser encoder");
    return false;
  };
  const doExport = async () => {
    const [width, exportHeight] = exportSizeFor(shareFormatId, height / 1080);
    const options = {
      format,
      width,
      height: exportHeight,
      fps: exportFps,
      duration: take ? take.duration : duration,
      onProgress: setProgress,
    };
    setError("");
    if (!(await ensureExportEncoder(options))) return;
    const wasPlaying = playing;
    playRef.current = false;
    setPlaying(false);
    setProgress(0);
    abort.current = new AbortController();
    try {
      const blob = take
        ? await exportPerformance(take, { ...options, signal: abort.current.signal })
        : await exportClip(clone(patchRef.current), { ...options, signal: abort.current.signal });
      download(blob, `${slug(patchRef.current.name)}-${shareFormatId}.${format}`);
      if (exportUrl.current) URL.revokeObjectURL(exportUrl.current);
      exportUrl.current = URL.createObjectURL(blob);
      setExportResult({
        url: exportUrl.current,
        format,
        width: options.width,
        height: options.height,
        duration: options.duration,
        name: `${slug(patchRef.current.name)}-${shareFormatId}`,
      });
      setMessage("Clip exported · preview ready");
    } catch (e) {
      fail(e);
    } finally {
      abort.current = null;
      setProgress(null);
      setPlaying(wasPlaying);
    }
  };
  const stopRecording = async () => {
    const rec = recorder.current;
    if (!rec) return;
    recorder.current = null;
    const data = performanceData.current;
    performanceData.current = null;
    const recordingDuration = Math.max(1 / 60, clock.current - recordStart.current, ...(data?.simulation ?? []).map((event) => event.time));
    try {
      const blob = await rec.stop();
      download(
        blob,
        `${slug(patchRef.current.name)}-performance.${blob.type.includes("mp4") ? "mp4" : "webm"}`,
      );
      if (!data) throw new Error("The performance event log is unavailable.");
      const completedTake: PerformanceTake = { ...data, duration: recordingDuration };
      if (exportUrl.current) URL.revokeObjectURL(exportUrl.current);
      exportUrl.current = URL.createObjectURL(blob);
      setExportResult({
        url: exportUrl.current,
        format: blob.type.includes("mp4") ? "mp4" : "webm",
        width: 1280,
        height: 720,
        duration: recordingDuration,
        name: slug(patchRef.current.name) + "-performance",
      });
      setExportOpen(true);
      download(
        new Blob([JSON.stringify(completedTake, null, 2)], {
          type: "application/json",
        }),
        `${slug(patchRef.current.name)}-performance.json`,
      );
      setMessage("Performance video, controls, and simulation gestures saved");
    } catch (e) {
      fail(e);
    } finally {
      performanceData.current = null;
      recordingRef.current = false;
      setRecording(false);
      restorePreviewSize();
    }
  };
  const record = async () => {
    if (recordStartingRef.current) return;
    if (recording) {
      await stopRecording();
      return;
    }
    recordStartingRef.current = true;
    setRecordStarting(true);
    try {
      if (!canvas.current || !renderer.current)
        throw new Error("Wait for the GPU before recording.");
      inputPreviewRef.current = null;
      setInputPreview(null);
      // Rebuild from the saved recipe so captured and exported takes share their starting state.
      await previewControl.current?.request({ size: RECORDING_SIZE, reset:true });
      recordStart.current = clock.current;
      performanceData.current = {
        version: 2,
        patch: clone(patchRef.current),
        startTime: clock.current,
        controls: [],
        gates: [],
        simulation: [],
      };
      recorder.current = await startRecording(canvas.current, {
        fps: 30,
        onStop: () => {
          if (recorder.current) void stopRecording();
        },
      });
      setRecordSeconds(0);
      setRecording(true);
      playRef.current = true;
      setPlaying(true);
      redraw();
    } catch (e) {
      performanceData.current = null;
      restorePreviewSize();
      fail(e);
    } finally {
      recordStartingRef.current = false;
      setRecordStarting(false);
    }
  };
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      const elapsed = clock.current - recordStart.current;
      setRecordSeconds(elapsed);
      if (elapsed >= 59.8) void stopRecording();
    }, 200);
    return () => clearInterval(timer);
  }, [recording]);
  useEffect(
    () => () => {
      recorder.current?.cancel();
      abort.current?.abort();
      if (exportUrl.current) URL.revokeObjectURL(exportUrl.current);
    },
    [],
  );
  const selectedNode = patch.nodes.find((n) => n.id === selected);
  const simulationNode = selectedNode && isStatefulGenerator(selectedNode.type) ? selectedNode :
    patch.nodes.find((node) => isStatefulGenerator(node.type));
  let effective: Record<string, Record<string, number>> = {};
  try {
    effective = evaluateParameters(
      take ? performancePatchAt(take, time - take.startTime) : patch,
      time,
    );
  } catch {}
  const flowNodes = useMemo(()=>patch.nodes.map((n) => ({
    id: n.id,
    type: "device",
    position: n.position,
    data: { node: n, revealed: n.id === revealedNode },
    selected: n.id === selected,
  })),[patch.nodes,selected,revealedNode]);
  const flowEdges = useMemo(()=>patch.connections.map((e) => ({
    id: e.id,
    selected: selectedEdges.includes(e.id),
    source: e.from.node,
    target: e.to.node,
    sourceHandle: e.from.port,
    targetHandle: e.to.port,
    style: {
      stroke: e.from.port === "frame" ? "#fa8c43" : "#9db2a6",
      strokeWidth: selectedEdges.includes(e.id) ? 4 : 2,
    },
    animated: e.from.port === "gate",
    label: e.to.port.startsWith("param:") ? `× ${e.depth ?? 0}` : undefined,
  })),[patch.connections,selectedEdges]);
  const applyPreset = (name: string) => {
    try {
      commit(applyRack(patchRef.current, name));
      setMessage(`Loaded effects only: ${name}`);
      setError("");
    } catch (e) {
      fail(e);
    }
  };
  const effects: SynthNode[] = [];
  let cursor = patch.nodes.find((n) => isGenerator(n.type))?.id;
  const visited = new Set<string>();
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const edge = patch.connections.find(
      (e) => e.from.node === cursor && e.from.port === "frame",
    );
    const next = patch.nodes.find((n) => n.id === edge?.to.node);
    if (!next) break;
    if (isEffect(next.type)) effects.push(next);
    cursor = next.id;
  }
  const serial =
    patch.connections.filter((edge) => edge.from.port === "frame").every((edge) => edge.to.port === "in") &&
    patch.nodes
      .filter((n) => isFrame(n.type))
      .every(
        (n) =>
          patch.connections.filter(
            (e) => e.from.node === n.id && e.from.port === "frame",
          ).length <= 1,
      ) &&
    patch.nodes.filter((n) => isGenerator(n.type)).length === 1 &&
    !patch.nodes.some((n) => isMixer(n.type)) &&
    visited.has(patch.nodes.find((node) => node.type === "output")?.id ?? "") &&
    effects.length ===
      patch.nodes.filter((n) => isEffect(n.type)).length;
  const saveRack = () => {
    if (!serial) {
      setError(
        "Save a serial effects rack; use full patch save for branched routing.",
      );
      return;
    }
    setSaveName("My effects rack");
    setNaming("rack");
  };
  const confirmName = async () => {
    const name = saveName.trim();
    if (!name || namingBusy) return;
    if (naming === "patch") {
      setNamingBusy(true);
      try {
        const library = await listSavedPatches();
        setSaved(library);
        if (
          library.some((item) => item.name === name) &&
          nameCollision !== `patch:${name}`
        ) {
          setNameCollision(`patch:${name}`);
          return;
        }
        const next = { ...clone(patchRef.current), name };
        await savePatch(next);
        setDraftSaveAllowed(true);
        commit(next);
        setSaved(await listSavedPatches());
        setMessage("Saved full patch: " + name);
        setNaming(null);
      } catch (e) {
        fail(e);
      } finally {
        setNamingBusy(false);
      }
      return;
    }
    try {
      const entries = effects.map((n) => ({
        type: n.type,
        params: clone(n.params),
      }));
      const stored = JSON.parse(
        localStorage.getItem("visual-synth-racks") || "{}",
      );
      if (
        (Object.hasOwn(stored, name) || Object.hasOwn(rackPresets, name)) &&
        nameCollision !== `rack:${name}`
      ) {
        setNameCollision(`rack:${name}`);
        return;
      }
      stored[name] = entries;
      localStorage.setItem("visual-synth-racks", JSON.stringify(stored));
      rackPresets[name] = entries;
      setRackVersion((v) => v + 1);
      setNaming(null);
      setMessage(`Saved effects only: ${name}`);
    } catch (e) {
      fail(e);
    }
  };
  const importRack = (data: any) => {
    const entries = data.effects ?? data.devices;
    if (
      data.version !== 1 ||
      typeof data.name !== "string" ||
      !Array.isArray(entries) ||
      entries.length > 12 ||
      entries.some(
        (n: any) =>
          !n || typeof n.type !== "string" || !isEffect(n.type),
      )
    )
      throw new Error("Invalid effects rack file");
    const key = `import-${crypto.randomUUID()}`;
    rackPresets[key] = entries;
    try {
      const next = applyRack(patchRef.current, key);
      const errors = validatePatch(next);
      if (errors.length) throw new Error(errors.join(" "));
      commit(next);
      setMessage(`Imported effects only: ${data.name}`);
    } finally {
      delete rackPresets[key];
    }
  };
  const reorderRack = (index: number, step: number) => {
    if (locked || !serial) return;
    const nodes = [...effects];
    const destination = index + step;
    if (destination < 0 || destination >= nodes.length) return;
    [nodes[index], nodes[destination]] = [nodes[destination]!, nodes[index]!];
    const next = clone(patchRef.current);
    const source = next.nodes.find((n) => isGenerator(n.type))!,
      output = next.nodes.find((n) => n.type === "output")!;
    next.connections = next.connections.filter((e) => e.from.port !== "frame");
    let previous = source.id;
    for (const n of [...nodes, output]) {
      next.connections.push({
        id: crypto.randomUUID(),
        from: { node: previous, port: "frame" },
        to: { node: n.id, port: "in" },
      });
      previous = n.id;
    }
    commit(next);
  };
  const renderParameters = (node: SynthNode) =>
    Object.entries(manifests[node.type].params).map(([key, spec]) => (
      <label className="parameter" key={key} data-param-row={`${node.id}:${key}`}>
        <span>
          {spec.label}
          <output>
            {isEffect(node.type) && key === "amount" ? `${Math.round((effective[node.id]?.[key] ?? node.params[key] ?? spec.default) * 100)}%` : (
              effective[node.id]?.[key] ??
              node.params[key] ??
              spec.default
            ).toFixed(spec.step >= 1 ? 0 : 2)}
          </output>
        </span>
        {parameterOptions(node, key) ? (
          <select
            aria-label={spec.label}
            disabled={recordStarting || take !== null || progress !== null || (recording && spec.recordable===false)}
            value={node.params[key]}
            onChange={(e) => {
              beginGesture();
              parameter(node.id, key, Number(e.target.value));
              endGesture();
            }}
          >
            {parameterOptions(node, key)!.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            aria-label={spec.label}
            title={isEffect(node.type) && key === "amount" ? "0%: dry input · 100%: processed effect. Supports LFO modulation." : undefined}
            disabled={recordStarting || take !== null || progress !== null || (recording && spec.recordable===false)}
            type="range"
            min={spec.min}
            max={spec.max}
            step={spec.step}
            value={node.params[key] ?? spec.default}
            onPointerDown={beginGesture}
            onPointerUp={endGesture}
            onBlur={endGesture}
            onKeyDown={beginGesture}
            onKeyUp={endGesture}
            onChange={(e) => parameter(node.id, key, Number(e.target.value))}
          />
        )}{" "}
        {isEffect(node.type) && key === "amount" && <small>0% dry · 100% processed</small>}
        {patch.connections
          .filter((e) => e.to.node === node.id && e.to.port === `param:${key}`)
          .map((e) => (
            <span key={e.id} className="mod-depth">
              Modulation depth
              <input
                aria-label={`${spec.label} modulation depth`}
                disabled={locked}
                type="number"
                step="0.01"
                value={e.depth ?? 0}
                onChange={(ev) => {
                  const p = clone(patchRef.current);
                  p.connections.find((c) => c.id === e.id)!.depth = Number(
                    ev.target.value,
                  );
                  commit(p);
                }}
              />
              <small>
                Base {node.params[key]?.toFixed(2)} → live value above
              </small>
            </span>
          ))}
      </label>
    ));
  const bridgeIndex = useMemo(() => buildIndex({
    saved: saved.map((item, index) => ({
      id: `${index}-${item.name}`,
      name: item.name,
      patch: item,
      recovery: item.name.startsWith("Before "),
    })),
    patch,
  }), [saved, patch]);
  const activeFilterObject = useMemo(() => ({
    in: bridgeFilters.reduce<Partial<Record<FacetName, string[]>>>((result, filter) => {
      result[filter.facet] = [...(result[filter.facet] ?? []), filter.value];
      return result;
    }, {}),
  }), [bridgeFilters]);
  const bridgeResults = useMemo(() => searchBrowser(bridgeIndex, {
    query: search,
    scope: search.trim() ? undefined : bridgeScope,
    facets: activeFilterObject,
  }), [bridgeIndex, search, bridgeScope, activeFilterObject]);
  const searchEntries = useMemo(() => bridgeResults.groups.flatMap((group) => group.hits), [bridgeResults]);
  const scopedItems = useMemo(() => {
    if (search.trim()) return [];
    return bridgeIndex.visibleItems
      .filter((item) => item.path === bridgeScope || item.path.startsWith(`${bridgeScope}/`) || (bridgeScope === "Saved" && item.kind === "saved"))
      .filter((item) => bridgeFilters.every((filter) => item.tags[filter.facet].includes(filter.value)))
      .sort((a, b) => a.path.localeCompare(b.path) || a.name.localeCompare(b.name));
  }, [bridgeIndex, bridgeScope, bridgeFilters, search]);
  const actionForItem = (item: BrowserItem): BrowserAction =>
    actionsFor(item, { selectedNodeId: selected || undefined }, patchRef.current);
  const reveal = (nodeId: string) => {
    setSelected(nodeId);
    setSelectedEdges([]);
    setRevealedNode(nodeId);
    setFitRevision((value) => value + 1);
    window.setTimeout(() => setRevealedNode((current) => current === nodeId ? "" : current), 1300);
  };
  const jumpToPatchItem = (item: BrowserItem) => {
    const [nodeId, paramKey] = item.id.split(":");
    setSelected(nodeId ?? "");
    setSelectedEdges([]);
    setMessage(`Jumped to ${item.name}`);
    window.setTimeout(() => {
      const target = paramKey
        ? document.querySelector<HTMLElement>(`[data-param-row="${nodeId}:${paramKey}"] input, [data-param-row="${nodeId}:${paramKey}"] select`)
        : null;
      target?.focus({ preventScroll: false });
    }, 0);
  };
  const runBrowserItem = (item: BrowserItem) => {
    if (locked) return;
    const action = actionForItem(item);
    if (!action.valid) {
      setError(action.reason ?? "That browser action is not available.");
      return;
    }
    if (item.kind === "patch-param" || item.kind === "patch-node") {
      jumpToPatchItem(item);
      return;
    }
    try {
      const result = action.build();
      if (item.kind === "preset" || item.kind === "saved") {
        load(result.patch);
        return;
      }
      commit(result.patch);
      setDraftSaveAllowed(true);
      setError("");
      setMessage(`${action.verb} · ${item.name}`);
      const report = "report" in result ? result.report : undefined;
      const changed = report?.addedNodeIds[0] ?? report?.retargetedConnectionIds
        .map((id) => result.patch.connections.find((edge) => edge.id === id)?.from.node)
        .find(Boolean);
      if (changed) reveal(changed);
      else setFitRevision((value) => value + 1);
    } catch (e) {
      fail(e);
    }
  };
  const toggleBridgeFilter = (facet: FacetName, value: string) => {
    setBridgeFilters((current) =>
      current.some((filter) => filter.facet === facet && filter.value === value)
        ? current.filter((filter) => filter.facet !== facet || filter.value !== value)
        : [...current, { facet, value }]);
    setBridgeActive(0);
  };
  const renderBrowserRow = (item: BrowserItem, key: string, hit?: SearchHit, index?: number) => {
    const action = actionForItem(item);
    const top = index === bridgeActive && search.trim();
    const familyPath = item.path.split("/").slice(1).join(" · ") || item.path;
    const reason = hit?.reasons.length ? ` · ${hit.reasons[0]}` : "";
    const verbIcon = action.verb === "Insert" || action.verb === "Add" ? "+" :
      action.verb === "Swap" || action.verb === "Apply" ? "⇄" :
      action.verb === "Load" ? "↧" :
      action.verb === "Jump" ? "→" :
      "?";
    const run = () => runBrowserItem(item);
    const disabled = locked || !action.valid;
    return (
      <div
        key={key}
        id={index !== undefined ? `bridge-result-${index}` : undefined}
        className={`bridge-row ${top ? "active" : ""}`}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        title={`${action.verb} · ${action.target}`}
        data-bridge-row
        onClick={run}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          run();
        }}
      >
        <span className="bridge-icon">{itemGlyph(item)}</span>
        <span className="bridge-name">
          <span className="bridge-name-text">{item.name}</span>
          <span className="bridge-meta">
            <small>{familyPath}{reason}</small>
            {item.kind === "preset" && item.preset?.touch && <span className="bridge-badge">Touch</span>}
            {item.tags.behaviour.includes("history") && <span className="bridge-badge">Past</span>}
            {item.tags.cost[0] && <span className="bridge-badge">{LABELS[item.tags.cost[0] as keyof typeof LABELS] ?? item.tags.cost[0]}</span>}
            {item.kind === "preset" && item.path.startsWith("Instruments") && (
              <a
                className="bridge-player-link"
                href={`/projects/shader-lab/player.html#${item.id}`}
                onClick={(event) => event.stopPropagation()}
              >
                Play in Player ↗
              </a>
            )}
          </span>
        </span>
        <button
          className="bridge-verb"
          type="button"
          disabled={disabled}
          aria-label={`${action.verb} ${item.name}`}
          title={action.verb}
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation();
            run();
          }}
        >
          {top ? `↵ ${action.verb}` : verbIcon}
        </button>
      </div>
    );
  };
  const renderSearchResults = () => (
    <div className="bridge-results" role="listbox" aria-label="Search results" aria-activedescendant={`bridge-result-${bridgeActive}`}>
      <div className="bridge-result-summary">{bridgeResults.hits.length} result{bridgeResults.hits.length === 1 ? "" : "s"}</div>
      {bridgeResults.groups.map((group) => (
        <section className="bridge-result-group" key={group.kind}>
          <h3>{groupLabel(group.kind)} <span>{group.hits.length}</span></h3>
          {group.hits.map((hit) => renderBrowserRow(hit.item, `${group.kind}:${hit.item.key}`, hit, searchEntries.indexOf(hit)))}
        </section>
      ))}
      {!bridgeResults.hits.length && <p className="muted bridge-empty">No matching library rows.</p>}
    </div>
  );
  const renderScopedItems = () => {
    const groups = new Map<string, BrowserItem[]>();
    for (const item of scopedItems) {
      const family = item.path === bridgeScope ? bridgeScope : item.path.slice(bridgeScope.length + 1).split("/")[0] || bridgeScope;
      groups.set(family, [...(groups.get(family) ?? []), item]);
    }
    return (
      <div className="bridge-results">
        {[...groups.entries()].map(([family, items]) => {
          const collapsed = collapsedFamilies.includes(`${bridgeScope}:${family}`);
          return (
            <section className="bridge-result-group" key={family}>
              <button
                type="button"
                className="bridge-family"
                onClick={() => setCollapsedFamilies((current) =>
                  current.includes(`${bridgeScope}:${family}`)
                    ? current.filter((value) => value !== `${bridgeScope}:${family}`)
                    : [...current, `${bridgeScope}:${family}`])}
              >
                <span>{collapsed ? "›" : "⌄"}</span>{family}<b>{items.length}</b>
              </button>
              {!collapsed && items.sort((a, b) => a.name.localeCompare(b.name)).map((item) => renderBrowserRow(item, item.key))}
            </section>
          );
        })}
        {!scopedItems.length && <p className="muted bridge-empty">No rows in this scope.</p>}
      </div>
    );
  };
  return (
    <main className="studio">
      <header className="topbar">
        <a className="brand" href="/">
          ◈ <span>VISUAL SYNTH</span>
        </a>
        <span className="separator" />
        <input
          aria-label="Patch name"
          className="patch-name"
          value={patchNameText}
          maxLength={120}
          disabled={locked}
          onChange={(e) => setPatchNameText(e.target.value)}
          onBlur={commitPatchName}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        <div className="file-actions">
          <button onClick={() => void storePatch()}>Save</button>
          <button onClick={() => void storePatch(true)}>Save as</button>
          <button disabled={locked} onClick={() => importFile.current?.click()}>
            Import
          </button>
          <button
            onClick={() =>
              download(
                new Blob([JSON.stringify(patch, null, 2)], {
                  type: "application/json",
                }),
                `${slug(patch.name)}.json`,
              )
            }
          >
            JSON ↓
          </button>
        </div>
        <div className="header-end">
          <button
            className={recording ? "record active" : "record"}
            disabled={recordStarting || gpuStarting || progress !== null || take !== null || videoLoading}
            onClick={() => void record()}
          >
            ● {recordStarting ? "Preparing…" : recording ? `Stop ${recordSeconds.toFixed(0)}s` : "Record"}
          </button>
          <button
            className="primary"
            disabled={recording || progress !== null || videoLoading}
            onClick={() => setExportOpen(true)}
          >
            Export clip ↗
          </button>
        </div>
      </header>
      <input
        hidden
        ref={importFile}
        type="file"
        accept=".json,application/json"
        onChange={async (e) => {
          try {
            const file = e.target.files?.[0];
            if (file) {
              const text = await file.text();
              const data = JSON.parse(text);
              if (data?.kind === "effects-rack") importRack(data);
              else if (data && typeof data === "object" && "patch" in data) {
                const imported = parsePerformance(text);
                load(performancePatchAt(imported, 0));
                replayRef.current = imported;
                setTake(imported);
                clock.current = imported.startTime;
                setTime(imported.startTime);
                playRef.current = true;
                setPlaying(true);
                redraw({ reset: true });
                setMessage("Replaying imported performance");
              } else load(parsePatch(text));
            }
          } catch (err) {
            fail(err);
          }
          e.target.value = "";
        }}
      />
      <aside
        className="library bridge-library nokey"
        onKeyDown={(event) => {
          const searching = search.trim().length > 0;
          if ((((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") || event.key === "/") && !isTextEditingTarget(event.target)) {
            event.preventDefault();
            event.stopPropagation();
            searchRef.current?.focus({ preventScroll: true });
            searchRef.current?.select();
            return;
          }
          event.stopPropagation();
          if (isUndoShortcut(event)) {
            event.preventDefault();
            event.shiftKey ? redoAction() : undoAction();
            return;
          }
          if (document.activeElement === searchRef.current) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (!searchEntries.length) return;
              const step = event.key === "ArrowDown" ? 1 : -1;
              setBridgeActive((current) => (current + step + searchEntries.length) % searchEntries.length);
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              const hit = searchEntries[bridgeActive] ?? searchEntries[0];
              if (hit) runBrowserItem(hit.item);
              searchRef.current?.blur();
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setSearch("");
              setBridgeActive(0);
              return;
            }
          }
          if (!searching && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            const rows = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-bridge-row]")];
            const current = rows.indexOf(document.activeElement as HTMLElement);
            if (!rows.length) return;
            event.preventDefault();
            const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)));
            rows[next]?.focus({ preventScroll: true });
          }
        }}
      >
        <div className="panel-heading">
          Library <span>BRIDGE</span>
        </div>
        <input
          ref={searchRef}
          className="search bridge-search"
          placeholder="Search everything"
          aria-label="Search everything"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setBridgeActive(0);
          }}
        />
        <div className="bridge-tabs" role="tablist" aria-label="Library scopes">
          {bridgeScopes.map((scope) => (
            <button
              key={scope.key}
              type="button"
              role="tab"
              aria-selected={bridgeScope === scope.key}
              onClick={() => {
                setBridgeScope(scope.key);
                setBridgeActive(0);
              }}
            >
              {scope.label}
            </button>
          ))}
        </div>
        <div className="bridge-chips" aria-label="Library filters">
          {bridgeFilterChips.map((chip) => {
            const pressed = bridgeFilters.some((filter) => filter.facet === chip.facet && filter.value === chip.value);
            const count = bridgeResults.facetCounts[chip.facet]?.find((entry) => entry.value === chip.value)?.count ?? 0;
            return (
              <button
                key={`${chip.facet}:${chip.value}`}
                type="button"
                aria-pressed={pressed}
                disabled={!pressed && count === 0}
                onClick={() => toggleBridgeFilter(chip.facet, chip.value)}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
        {search.trim() ? renderSearchResults() : renderScopedItems()}
        {!search.trim() && bridgeScope === "Saved" && <section className="library-group bridge-legacy">
          <h3>Explore patches &amp; seeds</h3>
          <p className="muted">Seed explorer and saved patches are below while the full browser grows around this Bridge.</p>
        </section>}
        <div className={bridgeScope === "Saved" && !search.trim() ? "legacy-saved visible" : "legacy-saved"}>
        <div className="panel-heading">
          Library <span>DEVICES</span>
        </div>
        <input
          className="search"
          placeholder="Search devices…"
          aria-label="Search devices"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          style={{ margin: "0 12px 8px", width: "calc(100% - 24px)" }}
          onClick={() =>
            document
              .getElementById("patch-bank")
              ?.scrollIntoView({ block: "start" })
          }
        >
          Explore patches & seeds ↓
        </button>
        {Array.from(
          new Set(Object.values(manifests).map((m) => m.category)),
        ).map((category) => (
          <section className="library-group" key={category}>
            <h3>{category}</h3>
            {Object.entries(manifests)
              .filter(
                ([type, m]) =>
                  m.category === category &&
                  type !== "output" &&
                  m.label.toLowerCase().includes(search.toLowerCase()),
              )
              .map(([type, m]) => (
                <button
                  key={type}
                  disabled={locked}
                  onClick={() => add(type as NodeType)}
                >
                  <span className="library-icon">
                    {isGenerator(type)
                      ? "≋"
                      : type === "lfo"
                        ? "∿"
                        : type === "gate"
                          ? "▴"
                          : "⌁"}
                  </span>
                  <span>
                    {m.label}
                    <small>
                      {isEffect(type)
                        ? frameInputs(type as NodeType).length > 1 ? "Connect image maps" : "Image processor"
                        : isGenerator(type)
                          ? isStatefulGenerator(type) ? "Growing simulation" : "Animated source"
                          : "Patch device"}
                    </small>
                  </span>
                  <span className="add-mark">+</span>
                </button>
              ))}
          </section>
        ))}
        <section className="library-group" id="patch-bank">
          <h3>Patch bank</h3>
          {Array.from(new Set(editorPresets.map((item) => item.bank))).map((bank) => (
            <div key={bank}>
              <h4>{bank}</h4>
              {editorPresets.filter((item) => item.bank === bank).map((item) => (
                <button disabled={locked} key={item.id} onClick={() => load(item.patch)} title={item.description}>
                  <span>◇ {item.name}<small>{item.description}</small></span>
                </button>
              ))}
            </div>
          ))}
          <p className="muted">Replaces source, effects and modulation.</p>
        </section>
        <section className="library-group wander-controls">
          <h3>Seed explorer</h3>
          <label>
            Algorithm
            <select
              aria-label="Seed algorithm"
              value={wanderVersion}
              disabled={locked}
              onChange={(e) => setWanderVersion(e.target.value as "v1" | "v2")}
            >
              <option value="v2">Wander v2 · all families</option>
              <option value="v1">Wander v1 · legacy seeds</option>
            </select>
          </label>
          {wanderVersion === "v2" ? <>
            <label>
              Source family
              <select aria-label="Source family" value={wanderFamily} disabled={locked || lockSource} onChange={(e) => setWanderFamily(e.target.value as typeof wanderFamily)}>
                {wanderFamilies.map((family) => <option key={family} value={family}>{family === "all" ? "All source families" : manifests[family].label}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" aria-label="Lock source" checked={lockSource} disabled={locked} onChange={(e) => setLockSource(e.target.checked)} style={{ width: "auto", margin: 0 }} />
              Lock source and routing
            </label>
          </> : <label>
            Scope
            <select aria-label="Randomization scope" value={wanderScope} disabled={locked} onChange={(e) => setWanderScope(e.target.value as "effects" | "whole")}>
              <option value="effects">Effects only</option>
              <option value="whole">Whole patch</option>
            </select>
          </label>}
          <label>
            Seed
            <input
              aria-label="Patch seed"
              value={seed}
              maxLength={80}
              disabled={locked}
              onChange={(e) => setSeed(e.target.value)}
            />
          </label>
          <button
            className="primary"
            disabled={locked}
            onClick={() => wander(true)}
          >
            ↻ Regenerate
          </button>
          <button disabled={locked} onClick={() => wander(false)}>
            Apply seed
          </button>
          <p className="muted">
            {wanderVersion === "v2"
              ? lockSource ? "Source lock keeps every source, cable, palette, and gesture while varying existing effects. Unlock to explore a family."
                : "Choose a family to explore a curated composition with bounded variations. Undo returns to your previous patch."
              : "The original seed algorithm: 3–5 effects and slow modulation. Effects only keeps your source."}
            {" "}Save a keeper before exploring further.
          </p>
        </section>
        <section className="library-group legacy-saved-patches">
          <h3>Saved patches</h3>
          {saved.length ? (
            saved.map((p) => (
              <button key={p.name} disabled={locked} onClick={() => load(p)}>
                ◇ {p.name}
              </button>
            ))
          ) : (
            <p className="muted">Save a discovery to keep it here.</p>
          )}
        </section>
        </div>
      </aside>
      <section className="center">
        <div className="preview">
          <div
            className="art-stage"
            style={previewOrientation === "9:16"
              ? { width: "min(100cqw, 56.25cqh)", height: "min(100cqh, 177.7778cqw)" }
              : undefined}
          >
            <canvas
              ref={canvas}
              aria-label="Visual synth live output"
              title={simulationNode ? `Click to inject into ${manifests[simulationNode.type].label}` : undefined}
              style={{ cursor: simulationNode && !take ? "crosshair" : undefined }}
              onPointerDown={(event) => {
                if (!simulationNode || event.button !== 0) return;
                const box = event.currentTarget.getBoundingClientRect();
                if (!box.width || !box.height) return;
                simulationGesture("inject", Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)));
              }}
            />
            {patch.nodes
              .filter((n) => n.type === "silk" && (n.params.mode ?? 0) > 0)
              .slice(0, 1)
              .flatMap((n) =>
                ["a", "b"].map((pole) => (
                  <button
                    key={pole}
                    className="pole"
                    aria-label={`Pole ${pole.toUpperCase()}`}
                    style={{
                      left: `${(n.params[pole + "x"] ?? 0.5) * 100}%`,
                      top: `${(n.params[pole + "y"] ?? 0.5) * 100}%`,
                    }}
                    onPointerDown={(e) => {
                      beginGesture();
                      e.currentTarget.setPointerCapture(e.pointerId);
                    }}
                    onPointerMove={(e) => {
                      if (!e.currentTarget.hasPointerCapture(e.pointerId))
                        return;
                      const box =
                        e.currentTarget.parentElement!.getBoundingClientRect();
                      parameter(
                        n.id,
                        pole + "x",
                        Math.max(
                          0,
                          Math.min(1, (e.clientX - box.left) / box.width),
                        ),
                      );
                      parameter(
                        n.id,
                        pole + "y",
                        Math.max(
                          0,
                          Math.min(1, (e.clientY - box.top) / box.height),
                        ),
                      );
                    }}
                    onPointerUp={endGesture}
                    onPointerCancel={endGesture}
                    onLostPointerCapture={endGesture}
                    onKeyDown={(e) => {
                      const directions: Record<string, [number, number]> = {
                        ArrowLeft: [-0.01, 0],
                        ArrowRight: [0.01, 0],
                        ArrowUp: [0, -0.01],
                        ArrowDown: [0, 0.01],
                      };
                      const delta = directions[e.key];
                      if (!delta) return;
                      e.preventDefault();
                      beginGesture();
                      parameter(
                        n.id,
                        pole + "x",
                        Math.max(
                          0,
                          Math.min(
                            1,
                            (n.params[pole + "x"] ?? 0.5) +
                              delta[0] * (e.shiftKey ? 5 : 1),
                          ),
                        ),
                      );
                      parameter(
                        n.id,
                        pole + "y",
                        Math.max(
                          0,
                          Math.min(
                            1,
                            (n.params[pole + "y"] ?? 0.5) +
                              delta[1] * (e.shiftKey ? 5 : 1),
                          ),
                        ),
                      );
                      endGesture();
                    }}
                  >
                    {pole.toUpperCase()}
                  </button>
                )),
              )}
          </div>
          {simulationNode && (
            <div style={{ position: "absolute", top: 8, left: 8, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <button disabled={recordStarting || take !== null || progress !== null} onClick={() => simulationGesture("reset")}>
                Reset {manifests[simulationNode.type].label}
              </button>
              <button disabled={recordStarting || take !== null || progress !== null} onClick={() => simulationGesture("inject", 0.5, 0.5)}>Inject center</button>
              <span style={{ background: "#101916bb", padding: 5 }}>Click image to inject</span>
            </div>
          )}
          <div className="preview-caption">
            <span>
              {previewSize[0]} × {previewSize[1]}{" "}
              <i /> {playing ? fps : 0} FPS <i />{" "}
              {warmupProgress !== null ? `WARMING ${Math.round(warmupProgress * 100)}%` : inputPreview ? `INPUT · ${inputPreview.port.toUpperCase()}` : recording ? "RECORDING" : playing ? "LIVE OUTPUT" : "PAUSED"}
              {warmupProgress !== null && <progress aria-label="Simulation warmup" value={warmupProgress} max={1} style={{ marginLeft: 8, width: 90 }} />}
            </span>
            <div>
              {inputPreview && <button aria-label="Show full patch output" onClick={() => setInputPreview(null)}>Output</button>}
              <button
                aria-label="Use 16:9 preview"
                aria-pressed={previewOrientation === "16:9"}
                onClick={() => setPreviewOrientation("16:9")}
              >
                16:9
              </button>
              <button
                aria-label="Use 9:16 preview"
                aria-pressed={previewOrientation === "9:16"}
                onClick={() => setPreviewOrientation("9:16")}
              >
                9:16
              </button>
              <button
                aria-label="Fullscreen preview"
                onClick={() => canvas.current?.requestFullscreen().catch(fail)}
              >
                ⛶
              </button>
              <button
                aria-label={playing ? "Pause" : "Play"}
                disabled={recording || recordStarting}
                onClick={() => {
                  playRef.current = !playing;
                  setPlaying(!playing);
                  redraw();
                }}
              >
                {playing ? "Ⅱ" : "▶"}
              </button>
              <span className="live-dot">●</span>
            </div>
          </div>
        </div>
        <div className="transport">
          <div className="view-tabs">
            <button
              className={view === "patch" ? "active" : ""}
              onClick={() => setView("patch")}
            >
              Patch
            </button>
            <button
              className={view === "rack" ? "active" : ""}
              onClick={() => setView("rack")}
            >
              Effects rack
            </button>
          </div>
          <button
            disabled={locked || !undo.current.length}
            onClick={undoAction}
            aria-label="Undo"
          >
            ↶
          </button>
          <button
            disabled={locked || !redo.current.length}
            onClick={redoAction}
            aria-label="Redo"
          >
            ↷
          </button>
          <div className="transport-end">
            {selectedEdges.length > 0 && (
              <button
                aria-label="Disconnect selected cables"
                disabled={locked}
                onClick={() => {
                  commit({
                    ...patchRef.current,
                    connections: patchRef.current.connections.filter(
                      (e) => !selectedEdges.includes(e.id),
                    ),
                  });
                  setSelectedEdges([]);
                }}
              >
                Disconnect
              </button>
            )}
            <button
              disabled={recording || recordStarting}
              aria-label="Restart transport"
              onClick={() => {
                clock.current = replayRef.current?.startTime ?? 0;
                setTime(clock.current);
                redraw({ reset: true });
              }}
            >
              ■
            </button>
            <label>
              <input
                aria-label="Tempo BPM"
                disabled={locked}
                type="number"
                min="20"
                max="300"
                value={tempoText}
                onChange={(e) => setTempoText(e.target.value)}
                onBlur={commitTempo}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />{" "}
              BPM
            </label>
            <span>{(take ? time - take.startTime : time).toFixed(1)} s</span>
            {take && (
              <button
                onClick={() => {
                  const current = performancePatchAt(
                    take,
                    clock.current - take.startTime,
                  );
                  replayRef.current = null;
                  setTake(null);
                  commit(current);
                  setMessage("Performance released for editing");
                }}
              >
                Exit replay
              </button>
            )}
            <button
              disabled={locked}
              onClick={() => {
                if (locked) return;
                redraw({ reset: true });
              }}
            >
              Clear echoes
            </button>
            <button
              disabled={locked || gpuStarting}
              title="Recreate the GPU renderer while keeping your patch and timeline position. Echo history starts fresh."
              onClick={() => {
                if (locked || gpuStarting) return;
                setGpuStarting(true);
                setError("");
                setMessage("Restarting GPU · keeping your patch and timeline");
                setGpuGeneration((value) => value + 1);
              }}
            >
              {gpuStarting ? "Starting GPU…" : "Restart GPU"}
            </button>
          </div>
        </div>
        <div className="patch-area">
          {view === "patch" ? (
            <ReactFlow
              key={fitRevision}
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={nodeTypes}
              fitView
              minZoom={0.15}
              maxZoom={2}
              nodesDraggable={!locked}
              nodesConnectable={!locked}
              elementsSelectable
              onNodeClick={(_, n) => {
                setSelected(n.id);
                setSelectedEdges([]);
              }}
              onPaneClick={() => {
                setSelected("");
                setSelectedEdges([]);
              }}
              onEdgeClick={(_, edge) => {
                setSelected("");
                setSelectedEdges([edge.id]);
              }}
              onEdgesChange={(changes) => {
                setSelectedEdges((current) => {
                  let next = [...current];
                  for (const change of changes) {
                    if (change.type === "select")
                      next = change.selected
                        ? [...new Set([...next, change.id])]
                        : next.filter((id) => id !== change.id);
                  }
                  return next;
                });
              }}
              onConnect={connect}
              onNodeDragStart={beginGesture}
              onNodeDrag={(_, node) => {
                const next = clone(patchRef.current);
                next.nodes.find((n) => n.id === node.id)!.position =
                  node.position;
                commit(next, false);
              }}
              onNodeDragStop={endGesture}
              onNodesDelete={(nodes) => remove(nodes.map((n) => n.id))}
              onEdgesDelete={(edges) => {
                if (locked) return;
                setSelectedEdges([]);
                commit({
                  ...patchRef.current,
                  connections: patchRef.current.connections.filter(
                    (c) => !edges.some((e) => e.id === c.id),
                  ),
                });
              }}
              deleteKeyCode={locked ? null : ["Backspace", "Delete"]}
            >
              <FitLoadedPatch revision={fitRevision} />
              <Background color="#293130" gap={24} />
              <Controls showInteractive={false} />
              <MiniMap
                nodeColor="#4a5350"
                maskColor="#101515bb"
                pannable
                zoomable
              />
            </ReactFlow>
          ) : (
            <div className="rack-view">
              <h2>
                Effects rack <span>Source-independent presets</span>
              </h2>
              <div className="rack-presets">
                <button disabled={locked || !serial} onClick={saveRack}>
                  Save effects rack
                </button>
                <button
                  disabled={!serial}
                  onClick={() =>
                    download(
                      new Blob(
                        [
                          JSON.stringify(
                            {
                              kind: "effects-rack",
                              version: 1,
                              name: "Effects rack",
                              effects: effects.map((n) => ({
                                type: n.type,
                                params: n.params,
                              })),
                            },
                            null,
                            2,
                          ),
                        ],
                        { type: "application/json" },
                      ),
                      "effects-rack.json",
                    )
                  }
                >
                  Rack JSON ↓
                </button>
                {Object.keys(rackPresets).map((name) => (
                  <button
                    disabled={locked || !serial}
                    key={name}
                    onClick={() => applyPreset(name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
              <p className="muted">
                Crushed Reverie: reverb smears → color crush breaks the
                gradients → reverb staggers the result. Presets preserve your
                source and palette.
              </p>
              {!serial ? (
                <p className="notice">
                  This patch uses multiple sources, image maps, or disconnected devices.
                  Edit its routing on the canvas; rack presets require one serial chain.
                </p>
              ) : (
                effects.map((n, i) => (
                  <div className="rack-device" key={n.id}>
                    <button onClick={() => setSelected(n.id)}>
                      {i + 1}. {manifests[n.type].label}
                    </button>
                    <label>
                      Dry / wet
                      <input
                        aria-label={`Rack ${i + 1} dry / wet`}
                        type="range"
                        min="0"
                        max="1"
                        step=".01"
                        value={n.params.amount}
                        onPointerDown={beginGesture}
                        onPointerUp={endGesture}
                        onChange={(e) =>
                          parameter(n.id, "amount", Number(e.target.value))
                        }
                      />
                      <output>{Math.round((n.params.amount ?? 0) * 100)}%</output>
                    </label>
                    <button
                      aria-label={`Move effect ${i + 1} up`}
                      disabled={locked || i === 0}
                      onClick={() => reorderRack(i, -1)}
                    >
                      ↑
                    </button>
                    <button
                      aria-label={`Move effect ${i + 1} down`}
                      disabled={locked || i === effects.length - 1}
                      onClick={() => reorderRack(i, 1)}
                    >
                      ↓
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        <footer className="statusbar">
          <span role="status">{message}</span>
          <span>
            {patch.nodes.length} devices · {patch.connections.length}{" "}
            connections
          </span>
        </footer>
      </section>
      <aside className="inspector">
        <div className="panel-heading">
          Inspector <span>{selectedNode ? "DEVICE" : "PATCH"}</span>
        </div>
        {selectedNode ? (
          <>
            <div className="inspector-title">
              <span className="library-icon">⌁</span>
              <div>
                <h2>{manifests[selectedNode.type].label}</h2>
                <p>{manifests[selectedNode.type].category}</p>
              </div>
            </div>
            {selectedNode.type === "video" && <section className="video-source">
              <p>{selectedNode.media?.name ?? "No video selected"}</p>
              {videoLoading && <p role="status">Checking and storing video…</p>}
              <p>Local MP4/WebM · up to 128 MiB, 4K and 10 minutes. Ordinary repeat has a visible seam. JSON patches do not include media; relink the original file on another browser.</p>
              {[false, ...(selectedNode.media ? [true] : [])].map(relink => <label key={String(relink)}>
                {relink ? "Relink original video" : selectedNode.media ? "Replace video" : "Choose video"}
                <input type="file" accept=".mp4,.webm" disabled={locked} aria-label={relink ? "Relink original video" : "Choose video"}
                  onChange={async event => {
                    const file = event.target.files?.[0]; event.target.value = "";
                    if (!file || locked) return;
                    setVideoLoading(true);
                    const nodeId = selectedNode.id, originalId = selectedNode.media?.id;
                    try {
                      const media = await storeVideo(file, relink ? originalId : undefined);
                      const next = clone(patchRef.current), node = next.nodes.find(n => n.id === nodeId);
                      if (!node || node.type !== "video" || node.media?.id !== originalId) return;
                      node.media = media; commit(next); setError("");
                      setMessage("Video ready · local file stored");
                    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
                    finally { setVideoLoading(false); }
                  }} />
              </label>)}
              <p>Speed 0 holds a frame; negative speed plays backwards. Changing speed or start offset scrubs the clip.</p>
            </section>}
            {renderParameters(selectedNode)}
            {selectedNode.type === "operator" && <p>Two signed oscillators interact before coloring. Phase modulation bends the carrier by Depth radians; Ring modulation introduces multiplication from 0–1, then adds drive above 1. Ratio sets spatial frequency, not animation speed. Try an LFO on Depth or Modulator phase. Harmonic smoothing softens the triangle, saw and square waveforms.</p>}
            {selectedNode.type === "mixer4" && <p>Connect up to four images to A–D. Unconnected channels are ignored. Drag an LFO to a channel level or Master port. Normalized mix balances the active weights; the other blends layer A → D. Use level zero to mute a channel.</p>}
            {selectedNode.type === "fx.feedback" && <p>This chamber transforms and reuses its own previous output at 60 ticks per second. Injection introduces fresh image; retention keeps its memory. Modulate zoom, rotation or shift for moving trails. Clear echoes resets the memory.</p>}
            {frameInputs(selectedNode).length > 0 && (
              <div>
                <h3>Preview an input</h3>
                <div className="device-actions">
                  {frameInputs(selectedNode).map((port) => (
                    <button key={port} disabled={locked || !patch.connections.some((edge) => edge.to.node === selectedNode.id && edge.to.port === port)}
                      onClick={() => setInputPreview({ node: selectedNode.id, port })}
                      aria-pressed={inputPreview?.node === selectedNode.id && inputPreview.port === port}>
                      {selectedNode.type === "fx.mask" && port === "in" ? "A · in" : port}
                    </button>
                  ))}
                  <button disabled={!inputPreview} onClick={() => setInputPreview(null)}>Full output</button>
                </div>
                {selectedNode.type === "fx.warp" && <p className="muted">Connect an image to field for displacement. An empty field input leaves the source image unchanged.</p>}
                {selectedNode.type === "fx.mask" && <p className="muted">A enters in; B enters b. The mask image controls their blend. Empty B repeats A; an empty mask uses the layer mix.</p>}
              </div>
            )}
            {isStatefulGenerator(selectedNode.type) && (
              <div>
                <p>Click the image to inject into this source, or use Inject center. Resets and injections are saved with the patch and recorded performance.</p>
                <label className="parameter">
                  <span>Warmup before time zero <output>{((patch.simulation?.warmupTicks ?? 0) / 60).toFixed(1)} s</output></span>
                  <input type="number" aria-label="Simulation warmup ticks" min={0} max={3600} step={1} value={patch.simulation?.warmupTicks ?? 0} disabled={locked}
                    onChange={(event) => {
                      const ticks = Number(event.target.value);
                      if (!Number.isInteger(ticks) || ticks < 0 || ticks > 3600) return;
                      const next = clone(patchRef.current);
                      next.version = 2;
                      next.simulation ??= { tickHz: 60, warmupTicks: 0, events: [] };
                      next.simulation.warmupTicks = ticks;
                      commit(next);
                    }} />
                  <small>60 ticks per second · maximum 60 seconds</small>
                </label>
              </div>
            )}
            {selectedNode.type === "gate" && (
              <button
                className="primary gate-button"
                disabled={take !== null || progress !== null}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  gate(selectedNode.id, true);
                }}
                onPointerUp={() => gate(selectedNode.id, false)}
                onPointerCancel={() => gate(selectedNode.id, false)}
              >
                Hold gate · G
              </button>
            )}
            <div className="device-actions">
              <button
                disabled={locked || selectedNode.type === "output" || selectedNode.type === "video"}
                onClick={() => {
                  const next = clone(patchRef.current),
                    n = clone(selectedNode);
                  n.id = crypto.randomUUID();
                  n.position = { x: n.position.x + 50, y: n.position.y + 50 };
                  next.nodes.push(n);
                  if (next.nodes.length > 24) {
                    setError("Maximum 24 devices.");
                    return;
                  }
                  commit(next);
                  setSelected(n.id);
                }}
              >
                Duplicate
              </button>
              <button
                disabled={locked || selectedNode.type === "output"}
                onClick={() => remove([selectedNode.id])}
              >
                Delete
              </button>
            </div>
          </>
        ) : (
          <div className="inspector-intro">
            <div className="big-wave">≋</div>
            <h2>A patch worth getting lost in.</h2>
            <p>
              Select a device to shape its soundless signal. Orange cables carry
              images; pale cables carry modulation.
            </p>
            <h3>Start with a discovery</h3>
            {Object.keys(rackPresets).map((name) => (
              <button
                className="preset-button"
                disabled={locked || !serial}
                key={name}
                onClick={() => applyPreset(name)}
              >
                {name}
                <span>↗</span>
              </button>
            ))}
            <p>
              Connect an LFO’s value to a parameter port. Use a Gate → ADSR →
              parameter for a gesture. Hold G to trigger gates.
            </p>
          </div>
        )}
        <div className="inspector-foot">
          Saved patches preserve the recipe and simulation gestures. Growing sources and temporal effects reconstruct their history before capture.
        </div>
      </aside>
      {error && (
        <div className="error-toast" role="alert">
          <span style={{ whiteSpace: "pre-line" }}>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      {naming && (
        <div className="modal-shade">
          <form
            className="export-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={
              naming === "patch" ? "Save full patch" : "Save effects rack"
            }
            onSubmit={(e) => {
              e.preventDefault();
              void confirmName();
            }}
          >
            <p className="eyebrow">KEEP A DISCOVERY</p>
            <h2>
              {naming === "patch" ? "Save full patch" : "Save effects rack"}
            </h2>
            <p>
              {naming === "patch"
                ? "Preserve the source, effects, routing and modulation."
                : "Preserve this effects chain independently of the source and palette."}
            </p>
            <label className="name-field">
              Name
              <input
                ref={saveNameRef}
                autoFocus
                aria-label={
                  naming === "patch" ? "Full patch name" : "Effects rack name"
                }
                value={saveName}
                disabled={namingBusy}
                onChange={(e) => setSaveName(e.target.value)}
              />
            </label>
            {nameCollision && (
              <p role="alert">
                “{saveName.trim()}” already exists. Choose another name or click
                Replace saved {naming === "patch" ? "patch" : "rack"} to
                overwrite it.
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                disabled={namingBusy}
                onClick={() => setNaming(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="primary"
                disabled={!saveName.trim() || namingBusy}
              >
                {namingBusy
                  ? "Saving…"
                  : nameCollision
                    ? `Replace saved ${naming === "patch" ? "patch" : "rack"}`
                    : "Save name"}
              </button>
            </div>
          </form>
        </div>
      )}
      {exportOpen && (
        <div className="modal-shade">
          <section
            className="export-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Export clip"
          >
            <p className="eyebrow">RENDER A DISCOVERY</p>
            <h2>Export clip</h2>
            <p>
              Clean frames, with the effects chain warmed up. No audio. Echoes
              may not form a seamless loop.
            </p>
            <div className="export-grid">
              <label>
                Format
                <select
                  aria-label="Export format"
                  disabled={progress !== null}
                  value={format}
                  onChange={(e) => setFormat(e.target.value as any)}
                >
                  <option value="mp4">MP4</option>
                  <option value="webm">WebM</option>
                </select>
              </label>
              <label>
                Orientation / format
                <select
                  aria-label="Export orientation / format"
                  disabled={progress !== null}
                  value={shareFormatId}
                  onChange={(e) => setShareFormatId(e.target.value as ShareFormatId)}
                >
                  {shareFormats.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Resolution
                <select
                  aria-label="Export resolution"
                  disabled={progress !== null}
                  value={height}
                  onChange={(e) => setHeight(Number(e.target.value))}
                >
                  <option value="720">720p</option>
                  <option value="1080">1080p</option>
                  <option value="1440">1440p (2K)</option>
                  <option value="2160">2160p (4K, experimental)</option>
                </select>
              </label>
              <label>
                Frame rate
                <select
                  aria-label="Export frame rate"
                  disabled={progress !== null}
                  value={exportFps}
                  onChange={(e) => setExportFps(Number(e.target.value))}
                >
                  <option value="30">30 FPS</option>
                  <option value="60">60 FPS</option>
                </select>
              </label>
              <label>
                Duration (seconds)
                <input
                  aria-label="Export duration"
                  disabled={progress !== null || take !== null}
                  type="number"
                  min="1"
                  max="60"
                  value={take?.duration ?? duration}
                  onChange={(e) =>
                    setDuration(
                      Math.max(1, Math.min(60, Number(e.target.value))),
                    )
                  }
                />
              </label>
            </div>
            {progress !== null && (
              <>
                <progress value={progress} max="1" />
                <p role="status">Rendering {Math.round(progress * 100)}%</p>
              </>
            )}
            <div className="export-result">
              {exportResult && (
                <>
                  <video
                    aria-label="Exported clip preview"
                    src={exportResult.url}
                    controls
                    playsInline
                  />
                  <p>
                    {exportResult.width} × {exportResult.height} ·{" "}
                    {exportResult.duration.toFixed(2)} seconds ·{" "}
                    {exportResult.format.toUpperCase()}
                  </p>
                  <a
                    className="export-download"
                    href={exportResult.url}
                    download={`${exportResult.name}.${exportResult.format}`}
                  >
                    Download {exportResult.format.toUpperCase()} ↓
                  </a>
                </>
              )}
            </div>
            <div className="dialog-actions">
              <button
                onClick={() =>
                  progress !== null
                    ? abort.current?.abort()
                    : setExportOpen(false)
                }
              >
                {progress !== null ? "Cancel render" : "Close"}
              </button>
              <button
                className="primary"
                disabled={progress !== null}
                onClick={() => void doExport()}
              >
                Export {format.toUpperCase()}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
