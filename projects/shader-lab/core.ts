import { generatorDefinitions, type GeneratorType } from "./generators/catalog";
import { effectDefinitions } from "./effects/catalog";
import {
  isLabEffect,
  isLabSource,
  labDeviceDefinitions,
  labLibrary,
  validateLabLibrary,
  type LabDeviceType,
} from "./lab-device";
/** Portable patch contracts: no renderer, UI, or clock dependencies. */
export type BuiltInEffectType =
  | keyof typeof effectDefinitions
  | "fx.glow"
  | "fx.bayer"
  | "fx.delay"
  | "fx.reverb"
  | "fx.crush"
  | "fx.vhs";
export type EffectType = BuiltInEffectType | LabDeviceType;
export type NodeType =
  | "video"
  | GeneratorType
  | EffectType
  | "mixer"
  | "mixer4"
  | "output"
  | "lfo"
  | "gate"
  | "adsr";
export interface SynthNode {
  /** Project media identity, never a URL. Portable patches require the same file. */
  media?: { id: string; name: string };
  /** Renderer-owned short diagnostic for fail-soft lab devices; not portable patch data. */
  labError?: string;
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  params: Record<string, number>;
}
export interface Connection {
  id: string;
  from: { node: string; port: string };
  to: { node: string; port: string };
  depth?: number;
}
export interface GateEvent {
  time: number;
  node: string;
  on: boolean;
}
export interface SimulationEvent {
  time: number;
  node: string;
  kind: "reset" | "inject";
  x?: number;
  y?: number;
  radius?: number;
  amount?: number;
}
export interface PatchSimulation {
  tickHz: 60;
  warmupTicks: number;
  events: SimulationEvent[];
}
export interface Patch {
  version: 1 | 2;
  name: string;
  nodes: SynthNode[];
  connections: Connection[];
  transport: { bpm: number; loopSeconds: number };
  events: GateEvent[];
  simulation?: PatchSimulation;
  exploration?:
    | {
      version: 1;
      seed: string;
      scope: "effects" | "whole";
      generatedNodeIds: string[];
    }
    | {
      version: 2;
      algorithm: "wander-v2";
      seed: string;
      family: string;
      sourceLocked: boolean;
      generatedNodeIds: string[];
    };
}
export interface ParameterManifest {
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  modulatable?: boolean;
  /** False for setup parameters whose allocation/initial-state changes cannot be replayed mid-take. */
  recordable?: boolean;
}
const builtInDeviceTypes = new Set<string>([
  "video",
  ...Object.keys(generatorDefinitions),
  ...Object.keys(effectDefinitions),
  "fx.glow",
  "fx.bayer",
  "fx.delay",
  "fx.reverb",
  "fx.crush",
  "fx.vhs",
  "mixer",
  "mixer4",
  "output",
  "lfo",
  "gate",
  "adsr",
]);
const labLibraryErrors = validateLabLibrary(labLibrary, builtInDeviceTypes);
if (labLibraryErrors.length)
  throw new Error(`Invalid lab device library:\n${labLibraryErrors.join("\n")}`);
const p = (
  label: string,
  min: number,
  max: number,
  value: number,
  step = 0.01,
  modulatable = true,
): ParameterManifest => ({
  label,
  min,
  max,
  step,
  default: value,
  modulatable,
});
const amount = () => ({ amount: p("Dry / wet", 0, 1, 0.5) });
export const manifests: Record<
  NodeType,
  {
    label: string;
    category: string;
    params: Record<string, ParameterManifest>;
    frameInputs?: readonly string[];
  }
> = {
  video: { label: "Video", category: "Generators", params: {
    speed: p("Playback speed", -4, 4, 1, 0.01),
    start: p("Start offset (s)", 0, 600, 0, 0.01),
  } },
  ...generatorDefinitions,
  ...effectDefinitions,
  ...labDeviceDefinitions(),
  "fx.glow": { label: "Glow", category: "Effects", params: amount() },
  "fx.bayer": {
    label: "Bayer dither",
    category: "Effects",
    params: {
      ...amount(),
      threshold: p("Threshold bias", -0.5, 0.5, 0),
      scale: p("Pattern scale", 1, 8, 2, 1),
    },
  },
  "fx.delay": { label: "Delay", category: "Effects", params: amount() },
  "fx.reverb": {
    label: "Impulse reverb",
    category: "Effects",
    params: amount(),
  },
  "fx.crush": { label: "Color crush", category: "Effects", params: amount() },
  "fx.vhs": { label: "VHS / glitch", category: "Effects", params: amount() },
  mixer: {
    label: "Mixer",
    category: "Utility",
    params: { mix: p("Crossfade", 0, 1, 0.5) },
  },
  mixer4: {
    label: "Four-channel Mixer", category: "Utility", frameInputs: ["a", "b", "c", "d"],
    params: {
      levelA: p("Channel A", 0, 1, 1), levelB: p("Channel B", 0, 1, 1),
      levelC: p("Channel C", 0, 1, 1), levelD: p("Channel D", 0, 1, 1),
      master: p("Master level", 0, 2, 1),
      blend: p("Blend mode", 0, 4, 0, 1, false),
    },
  },
  output: { label: "Screen output", category: "Output", params: {} },
  lfo: {
    label: "LFO",
    category: "Modulation",
    params: {
      shape: p("Waveform", 0, 3, 0, 1, false),
      rate: p("Rate (Hz)", 0.01, 20, 0.25),
      sync: p("Tempo sync", 0, 1, 1, 1, false),
      beats: p("Beats per cycle", 0.125, 64, 8, 0.125),
      phase: p("Phase", -Math.PI, Math.PI, 0),
    },
  },
  gate: { label: "Manual gate", category: "Modulation", params: {} },
  adsr: {
    label: "ADSR",
    category: "Modulation",
    params: {
      attack: p("Attack (s)", 0.001, 10, 0.15),
      decay: p("Decay (s)", 0.001, 10, 0.3),
      sustain: p("Sustain", 0, 1, 0.6),
      release: p("Release (s)", 0.001, 10, 0.8),
    },
  },
};
export function isGenerator(type: string): type is GeneratorType | "video" | LabDeviceType {
  return type === "video" || Object.hasOwn(generatorDefinitions, type) || isLabSource(type);
}
export function isMixer(type: string): boolean { return type === "mixer" || type === "mixer4"; }
export function isEffect(type: string): type is EffectType {
  return type.startsWith("fx.") || isLabEffect(type);
}
export function isStatefulGenerator(type: string): boolean {
  return type === "rules" || type === "chemical" || type === "slime" || type === "ink";
}
/** The declared frame inputs are shared by graph validation, UI, and rendering. */
export function frameInputs(node: SynthNode | NodeType): readonly string[] {
  const type = typeof node === "string" ? node : node.type;
  const declared = manifests[type]?.frameInputs;
  if (declared) return declared;
  if (type === "mixer") return ["a", "b"];
  if (isEffect(type) || type === "output") return ["in"];
  return [];
}
export function createNode(
  type: NodeType,
  id: string = globalThis.crypto.randomUUID(),
): SynthNode {
  if (!Object.hasOwn(manifests, type)) throw new Error("Unknown device type");
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    params: Object.fromEntries(
      Object.entries(manifests[type]!.params).map(([key, value]) => [
        key,
        value.default,
      ]),
    ),
  };
}
export const rackPresets: Record<
  string,
  { type: NodeType; params: Record<string, number> }[]
> = {
  "Crushed Reverie": [
    { type: "fx.reverb", params: { amount: 1 } },
    { type: "fx.crush", params: { amount: 0.65 } },
    { type: "fx.reverb", params: { amount: 1 } },
  ],
  "Dream Tape": [
    { type: "fx.glow", params: { amount: 0.65 } },
    { type: "fx.reverb", params: { amount: 0.35 } },
    { type: "fx.vhs", params: { amount: 0.35 } },
  ],
  "Arcade Phosphor": [
    { type: "fx.bayer", params: { amount: 0.85 } },
    { type: "fx.glow", params: { amount: 0.8 } },
    { type: "fx.crush", params: { amount: 0.25 } },
  ],
  "Broken Broadcast": [
    { type: "fx.vhs", params: { amount: 0.8 } },
    { type: "fx.delay", params: { amount: 0.65 } },
    { type: "fx.bayer", params: { amount: 0.5 } },
  ],
};
export type RackDevice = { type: NodeType; params: Record<string, number> };

export function applyRackEntries(patch: Patch, entries: readonly RackDevice[]): Patch {
  assertSerialRack(patch);
  const result = structuredClone(patch),
    source = result.nodes.find((n) => isGenerator(n.type)),
    output = result.nodes.find((n) => n.type === "output");
  if (!source || !output)
    throw new Error("Rack requires a generator and screen output");
  result.nodes = result.nodes.filter(
    (n) => !isEffect(n.type) && !isMixer(n.type),
  );
  const retained = new Set(result.nodes.map((n) => n.id));
  result.connections = result.connections.filter(
    (e) =>
      retained.has(e.from.node) &&
      retained.has(e.to.node) &&
      e.to.node !== output.id,
  );
  let previous = source;
  entries.forEach((entry, i) => {
    const node = createNode(entry.type);
    Object.assign(node.params, entry.params);
    node.position = { x: 240 * (i + 1), y: 80 };
    result.nodes.push(node);
    result.connections.push({
      id: globalThis.crypto.randomUUID(),
      from: { node: previous.id, port: "frame" },
      to: { node: node.id, port: "in" },
    });
    previous = node;
  });
  output.position = { x: 240 * (entries.length + 1), y: 80 };
  result.connections.push({
    id: globalThis.crypto.randomUUID(),
    from: { node: previous.id, port: "frame" },
    to: { node: output.id, port: "in" },
  });
  return result;
}

export function applyRack(patch: Patch, name: string): Patch {
  if (!Object.hasOwn(rackPresets, name)) throw new Error("Unknown rack preset");
  return applyRackEntries(patch, rackPresets[name]!);
}
/** Replacing a rack must never flatten an authored multi-input graph. */
function assertSerialRack(patch: Patch): void {
  const sources = patch.nodes.filter((node) => isGenerator(node.type));
  const outputs = patch.nodes.filter((node) => node.type === "output");
  if (!sources.length || !outputs.length)
    throw new Error("Rack requires a generator and screen output");
  const error = "Rack presets require a single serial generator-to-output chain; this graph was preserved";
  if (sources.length !== 1 || outputs.length !== 1 || patch.nodes.some((node) => isMixer(node.type)))
    throw new Error(error);
  const frames = patch.nodes.filter((node) =>
    isGenerator(node.type) || isEffect(node.type) || node.type === "output",
  );
  const byId = new Map(frames.map((node) => [node.id, node]));
  const edges = patch.connections.filter((edge) => {
    const target = byId.get(edge.to.node);
    return edge.from.port === "frame" || target && frameInputs(target).includes(edge.to.port);
  });
  // The default constructor begins with just an unconnected source and output.
  if (!edges.length && frames.length === 2) return;
  if (edges.length !== frames.length - 1) throw new Error(error);
  const visited = new Set<string>();
  let current = sources[0]!;
  while (current.type !== "output") {
    if (visited.has(current.id)) throw new Error(error);
    visited.add(current.id);
    const next = edges.filter((edge) => edge.from.node === current.id);
    if (next.length !== 1 || next[0]!.from.port !== "frame" || next[0]!.to.port !== "in")
      throw new Error(error);
    const target = byId.get(next[0]!.to.node);
    if (!target || isGenerator(target.type)) throw new Error(error);
    current = target;
  }
  visited.add(current.id);
  if (visited.size !== frames.length) throw new Error(error);
}
export function createDefaultPatch(): Patch {
  const silk = createNode("silk", "silk"),
    output = createNode("output", "output");
  silk.position = { x: 0, y: 80 };
  return applyRack(
    {
      version: 1,
      name: "Untitled composition",
      nodes: [silk, output],
      connections: [],
      transport: { bpm: 120, loopSeconds: 12 },
      events: [],
    },
    "Crushed Reverie",
  );
}
type PortType = "frame" | "scalar" | "gate";
export function portType(
  node: SynthNode,
  port: string,
  direction: "in" | "out",
): PortType | undefined {
  if (direction === "out") {
    if (
      port === "frame" &&
      (isGenerator(node.type) ||
        isEffect(node.type) ||
        isMixer(node.type))
    )
      return "frame";
    if (port === "value" && (node.type === "lfo" || node.type === "adsr"))
      return "scalar";
    if (port === "gate" && node.type === "gate") return "gate";
  } else {
    if (frameInputs(node).includes(port)) return "frame";
    if (port === "gate" && node.type === "adsr") return "gate";
    if (
      port.startsWith("param:") &&
      manifests[node.type]!.params[port.slice(6)]?.modulatable
    )
      return "scalar";
  }
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const identifier = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-zA-Z0-9_-]{1,100}$/.test(v) &&
  !["__proto__", "constructor", "prototype"].includes(v);
/** Validates even null, malformed JSON and out-of-range values without throwing. */
export function validatePatch(input: unknown): string[] {
  try {
    return validate(input);
  } catch {
    return ["Patch contains unreadable data"];
  }
}
function validate(input: unknown): string[] {
  const errors: string[] = [];
  if (!object(input)) return ["Patch must be an object"];
  if (input.version !== 1 && input.version !== 2)
    errors.push("Unsupported patch version");
  if (
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 120
  )
    errors.push("Patch name must be 1–120 characters");
  if (
    !object(input.transport) ||
    !finite(input.transport.bpm) ||
    input.transport.bpm < 20 ||
    input.transport.bpm > 300 ||
    !finite(input.transport.loopSeconds) ||
    input.transport.loopSeconds < 1 ||
    input.transport.loopSeconds > 60
  )
    errors.push("Transport requires BPM 20–300 and duration 1–60 seconds");
  if (!Array.isArray(input.nodes) || input.nodes.length > 24)
    return [...errors, "Patch requires at most 24 devices"];
  const nodes = new Map<string, SynthNode>();
  for (const raw of input.nodes) {
    if (
      !object(raw) ||
      !identifier(raw.id) ||
      typeof raw.type !== "string" ||
      !Object.hasOwn(manifests, raw.type) ||
      !object(raw.params) ||
      !object(raw.position) ||
      !finite(raw.position.x) ||
      !finite(raw.position.y)
    ) {
      errors.push("Invalid device");
      continue;
    }
    const type = raw.type as NodeType;
    if (raw.media !== undefined && (type !== "video" || !object(raw.media) ||
      typeof raw.media.id !== "string" || !/^sha256-[a-f0-9]{64}$/.test(raw.media.id) ||
      typeof raw.media.name !== "string" || raw.media.name.length > 255))
      errors.push(`${raw.id}: invalid media reference`);
    if (nodes.has(raw.id)) errors.push("Duplicate device ID");
    for (const [key, spec] of Object.entries(manifests[type]!.params)) {
      const value = raw.params[key];
      if (
        !finite(value) ||
        value < spec.min ||
        value > spec.max ||
        (spec.modulatable === false && !Number.isInteger(value)) ||
        (key === "grid" && isStatefulGenerator(type) && ![128, 256, 512].includes(value))
      )
        errors.push(`${raw.id}: invalid ${key}`);
    }
    if (
      Object.keys(raw.params).some(
        (key) => !Object.hasOwn(manifests[type]!.params, key),
      )
    )
      errors.push(`${raw.id}: unknown parameter`);
    nodes.set(raw.id, raw as unknown as SynthNode);
  }
  if ([...nodes.values()].filter((n) => n.type === "output").length !== 1)
    errors.push("Exactly one screen output is required");
  if ([...nodes.values()].filter((n) => n.type === "video").length > 1)
    errors.push("This version supports one Video source per patch");
  if (
    [...nodes.values()].filter(
      (n) => isEffect(n.type) || isMixer(n.type),
    ).length > 12
  )
    errors.push("At most 12 frame processors are supported");
  if (!Array.isArray(input.connections) || input.connections.length > 512)
    return [...errors, "Invalid connections"];
  const ids = new Set<string>(),
    destinations = new Set<string>(),
    edges: Connection[] = [];
  for (const raw of input.connections) {
    if (
      !object(raw) ||
      !identifier(raw.id) ||
      !object(raw.from) ||
      !object(raw.to) ||
      typeof raw.from.node !== "string" ||
      typeof raw.to.node !== "string" ||
      typeof raw.from.port !== "string" ||
      typeof raw.to.port !== "string"
    ) {
      errors.push("Invalid connection");
      continue;
    }
    const from = nodes.get(raw.from.node),
      to = nodes.get(raw.to.node);
    if (ids.has(raw.id)) errors.push("Duplicate connection ID");
    ids.add(raw.id);
    const target = JSON.stringify([raw.to.node, raw.to.port]);
    if (destinations.has(target))
      errors.push("Only one connection is allowed per input");
    destinations.add(target);
    if (!from || !to) {
      errors.push("Connection refers to a missing device");
      continue;
    }
    const fromType = portType(from, raw.from.port, "out"),
      toType = portType(to, raw.to.port, "in");
    if (!fromType || fromType !== toType)
      errors.push("Connection ports must have matching signal types");
    if (
      raw.depth !== undefined &&
      (!finite(raw.depth) || Math.abs(raw.depth) > 10000 || toType !== "scalar")
    )
      errors.push("Invalid modulation depth");
    edges.push(raw as unknown as Connection);
  }
  const output = [...nodes.values()].find((n) => n.type === "output");
  if (
    output &&
    !edges.some((e) => e.to.node === output.id && e.to.port === "in")
  )
    errors.push("Screen output needs an input");
  try {
    topologicalNodes({
      nodes: [...nodes.values()],
      connections: edges,
    } as Patch);
  } catch {
    errors.push("Feedback cycles are not supported");
  }
  if (!Array.isArray(input.events) || input.events.length > 100000)
    errors.push("Invalid gate events");
  else
    for (const event of input.events) {
      if (
        !object(event) ||
        !finite(event.time) ||
        event.time < 0 ||
        event.time > 86400 ||
        typeof event.node !== "string" ||
        nodes.get(event.node)?.type !== "gate" ||
        typeof event.on !== "boolean"
      ) {
        errors.push("Invalid gate event");
        break;
      }
    }
  if (input.exploration !== undefined) {
    const e = input.exploration;
    if (
      !object(e) ||
      typeof e.seed !== "string" ||
      !e.seed.trim() ||
      e.seed.length > 80 ||
      !Array.isArray(e.generatedNodeIds) ||
      e.generatedNodeIds.length > 24 ||
      !e.generatedNodeIds.every(identifier) ||
      new Set(e.generatedNodeIds).size !== e.generatedNodeIds.length ||
      (e.version === 1
        ? !["effects", "whole"].includes(String(e.scope))
        : e.version !== 2 || e.algorithm !== "wander-v2" ||
          typeof e.family !== "string" || !e.family.trim() || e.family.length > 80 ||
          typeof e.sourceLocked !== "boolean")
    )
      errors.push("Invalid exploration metadata");
  }
  if (input.simulation !== undefined) {
    const simulation = input.simulation;
    if (
      !object(simulation) ||
      simulation.tickHz !== 60 ||
      !finite(simulation.warmupTicks) ||
      !Number.isInteger(simulation.warmupTicks) ||
      simulation.warmupTicks < 0 ||
      simulation.warmupTicks > 3600
    ) errors.push("Simulation requires tickHz 60 and warmupTicks 0–3600");
    if (!object(simulation) || !Array.isArray(simulation.events) || simulation.events.length > 100000)
      errors.push("Invalid simulation events");
    else if (simulation.events.some((event) => !validSimulationEvent(event, nodes)))
      errors.push("Invalid simulation event");
  }
  return errors;
}
/** Also used for performance event validation, before relative times are replayed. */
export function validSimulationEvent(
  event: unknown,
  nodes: ReadonlyMap<string, SynthNode>,
  maxTime = 86400,
): event is SimulationEvent {
  if (
    !object(event) || !finite(event.time) || event.time < 0 || event.time > maxTime ||
    typeof event.node !== "string" || !isStatefulGenerator(nodes.get(event.node)?.type ?? "") ||
    (event.kind !== "reset" && event.kind !== "inject")
  ) return false;
  for (const key of ["x", "y", "amount"] as const) {
    if (event[key] !== undefined && (!finite(event[key]) || event[key] < 0 || event[key] > 1)) return false;
  }
  if (event.radius !== undefined && (!finite(event.radius) || event.radius <= 0 || event.radius > 1)) return false;
  return event.kind === "reset" || finite(event.x) && finite(event.y);
}
/**
 * Parameters added to an existing device after patches were saved. Older patches omit them, so
 * migration fills each with its manifest default (chosen to reproduce the old output exactly).
 */
const addedParams: Partial<Record<NodeType, readonly string[]>> = {
  "fx.feedback": ["hue", "lighten", "centerX", "centerY"],
};
function withAddedParams(input: unknown): unknown {
  if (!object(input) || !Array.isArray(input.nodes)) return input;
  const copy = structuredClone(input) as { nodes: unknown[] };
  for (const node of copy.nodes) {
    if (!object(node) || !object(node.params) || typeof node.type !== "string") continue;
    const params = node.params as Record<string, unknown>;
    for (const key of addedParams[node.type as NodeType] ?? [])
      if (params[key] === undefined) {
        const fallback = manifests[node.type as NodeType]?.params[key]?.default;
        if (fallback !== undefined) params[key] = fallback;
      }
  }
  return copy;
}
/** Validated, independent copy: importing never mutates the original; the only repair is
 * filling parameters added to a device after the patch was saved (see addedParams). */
export function migratePatch(input: unknown): Patch {
  input = withAddedParams(input);
  const errors = validatePatch(input);
  if (errors.length) throw new Error(errors.join("; "));
  const patch = structuredClone(input as Patch);
  patch.version = 2;
  patch.simulation ??= { tickHz: 60, warmupTicks: 0, events: [] };
  return patch;
}
export function parsePatch(text: string): Patch {
  return migratePatch(JSON.parse(text));
}
export function topologicalNodes(patch: Patch): SynthNode[] {
  const byId = new Map(patch.nodes.map((n) => [n.id, n])),
    degree = new Map(patch.nodes.map((n) => [n.id, 0])),
    next = new Map<string, string[]>();
  for (const e of patch.connections) {
    if (!byId.has(e.from.node) || !byId.has(e.to.node))
      throw new Error("Missing connected device");
    degree.set(e.to.node, degree.get(e.to.node)! + 1);
    next.set(e.from.node, [...(next.get(e.from.node) || []), e.to.node]);
  }
  const queue = patch.nodes.filter((n) => degree.get(n.id) === 0),
    result: SynthNode[] = [];
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i]!;
    result.push(node);
    for (const id of next.get(node.id) || []) {
      degree.set(id, degree.get(id)! - 1);
      if (degree.get(id) === 0) queue.push(byId.get(id)!);
    }
  }
  if (result.length !== patch.nodes.length)
    throw new Error("Feedback cycles are not supported");
  return result;
}
function envelope(
  events: GateEvent[],
  time: number,
  p: Record<string, number>,
): number {
  let gate = false,
    changed = 0,
    start = 0;
  const level = (t: number) => {
    const elapsed = Math.max(0, t - changed);
    if (!gate) return start * Math.max(0, 1 - elapsed / p.release!);
    if (elapsed < p.attack!) return start + ((1 - start) * elapsed) / p.attack!;
    return 1 + (p.sustain! - 1) * Math.min(1, (elapsed - p.attack!) / p.decay!);
  };
  for (const event of events) {
    if (event.time > time) break;
    if (event.on === gate) continue;
    start = level(event.time);
    changed = event.time;
    gate = event.on;
  }
  return level(time);
}
export function evaluateParameters(
  patch: Patch,
  time: number,
): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = Object.create(null),
    signals = new Map<string, number>();
  for (const node of topologicalNodes(patch)) {
    const params = { ...node.params };
    for (const edge of patch.connections) {
      if (edge.to.node === node.id && edge.to.port.startsWith("param:")) {
        const key = edge.to.port.slice(6),
          spec = manifests[node.type]!.params[key];
        if (spec)
          params[key] = Math.min(
            spec.max,
            Math.max(
              spec.min,
              params[key]! +
                (edge.depth ?? 1) * (signals.get(edge.from.node) ?? 0),
            ),
          );
      }
    }
    result[node.id] = params;
    if (node.type === "lfo") {
      const rate = params.sync
        ? patch.transport.bpm / 60 / params.beats!
        : params.rate!;
      const cycles = time * rate + params.phase! / (Math.PI * 2),
        phase = ((cycles % 1) + 1) % 1;
      signals.set(
        node.id,
        params.shape === 0
          ? Math.sin(phase * Math.PI * 2)
          : params.shape === 1
            ? 1 - 4 * Math.abs(phase - 0.5)
            : params.shape === 2
              ? 2 * phase - 1
              : phase < 0.5
                ? 1
                : -1,
      );
    } else if (node.type === "adsr") {
      const gate = patch.connections.find(
        (e) => e.to.node === node.id && e.to.port === "gate",
      )?.from.node;
      const events = patch.events
        .filter((e) => e.node === gate)
        .sort((a, b) => a.time - b.time);
      signals.set(node.id, envelope(events, time, params));
    }
  }
  return result;
}
export {
  savePatch,
  saveDraft,
  listSavedPatches,
  loadSavedLibrary,
  loadDraft,
} from "./persistence";
