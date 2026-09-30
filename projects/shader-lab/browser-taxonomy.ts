import {
  applyRack,
  createDefaultPatch,
  createNode,
  frameInputs,
  isGenerator,
  isStatefulGenerator,
  manifests,
  rackPresets,
  type NodeType,
  type Patch,
  type SynthNode,
} from "./core";
import { isLabEffect, labDevices } from "./lab-device";
import { performanceBank } from "./performance-bank";
import { isLoopablePreset, presetCatalog, type CatalogPreset } from "./preset-catalog";
import { planFrames } from "./render-plan";

export const LOOK = [
  "lines", "geometric", "crystalline", "organic", "fluid", "psychedelic",
  "luminous", "metallic", "minimal", "retro", "glitch",
] as const;
export const MOTION = ["still", "slow", "fast", "pulsing"] as const;
export const BEHAVIOUR = [
  "loopable", "stateful", "history", "touch-xy", "needs-input", "extra-inputs", "layered", "lab", "candidate",
] as const;
export const COST = ["light", "medium", "heavy"] as const;

export type Look = (typeof LOOK)[number];
export type Motion = (typeof MOTION)[number];
export type Behaviour = (typeof BEHAVIOUR)[number];
export type Cost = (typeof COST)[number];
export type BrowserKind = "device" | "preset" | "rack";
export type FacetName = "look" | "motion" | "behaviour" | "cost" | "uses" | "bank";

export const LABELS: Record<Look | Motion | Behaviour | Cost, string> = {
  lines: "Lines", geometric: "Geometric", crystalline: "Crystalline", organic: "Organic",
  fluid: "Fluid", psychedelic: "Psychedelic", luminous: "Luminous", metallic: "Metallic",
  minimal: "Minimal", retro: "Retro", glitch: "Glitch",
  still: "Adds no motion", slow: "Slow", fast: "Fast", pulsing: "Pulsing",
  loopable: "Loops", stateful: "Simulation", history: "Uses past frames", "touch-xy": "Touch",
  "needs-input": "Needs input", "extra-inputs": "Extra inputs", layered: "Layered", lab: "Lab", candidate: "Candidate",
  light: "Light", medium: "Medium", heavy: "Heavy",
};

export const FACETS = {
  look: { values: LOOK, derived: false, editorial: true, hiddenByDefault: true, label: "Look" },
  motion: { values: MOTION, derived: false, editorial: true, hiddenByDefault: true, label: "Motion" },
  behaviour: { values: BEHAVIOUR, derived: true, editorial: false, hiddenByDefault: false, label: "Does" },
  cost: { values: COST, derived: true, editorial: false, hiddenByDefault: false, label: "Cost" },
  uses: { values: [] as readonly string[], derived: true, editorial: false, hiddenByDefault: false, label: "Uses" },
  bank: { values: [] as readonly string[], derived: true, editorial: false, hiddenByDefault: false, label: "Bank" },
} as const;
export const DEFAULT_VISIBLE_FACETS = ["behaviour", "cost", "uses", "bank"] as const;

const WAVES = "Waves & Interference";
const ORBITS = "Orbits & Contours";
const GEOMETRY = "Geometry & Tilings";
const FRACTALS = "Fractals & 3D";
const SIMULATIONS = "Simulations";
const MATERIALS = "Materials";
const MEDIA = "Media";
const WARP = "Effects/Warp & Symmetry";
const TIME = "Effects/Time & Feedback";
const TONE = "Effects/Tone & Filter";
const LOFI = "Effects/Lo-fi & Glitch";
const MIX = "Effects/Mix & Mask";
const LAB = "Lab";

export const HIERARCHY: { path: string; description: string }[] = [
  { path: "Sources", description: "Devices that make an image, with no image input." },
  { path: `Sources/${WAVES}`, description: "Line weaves, wave interference and standing-wave plates." },
  { path: `Sources/${ORBITS}`, description: "Rosette shells around moving centres, and drifting contour maps." },
  { path: `Sources/${GEOMETRY}`, description: "Stencils, cell maps and exact tilings." },
  { path: `Sources/${FRACTALS}`, description: "Complex functions, strange attractors, polytopes and Julia sets." },
  { path: `Sources/${SIMULATIONS}`, description: "Simulations that keep state." },
  { path: `Sources/${MATERIALS}`, description: "Surface and material studies." },
  { path: `Sources/${MEDIA}`, description: "Video files." },
  { path: `Sources/${LAB}`, description: "Curated and candidate lab sources loaded from the committed lab device file." },
  { path: "Effects", description: "Devices that change or combine incoming images." },
  { path: WARP, description: "Displace, mirror, spiral or fold the image into a disk." },
  { path: TIME, description: "Use past frames: echoes, trails, feedback tunnels, time displacement." },
  { path: TONE, description: "Tone curves, glow and edge filters." },
  { path: LOFI, description: "Dither, colour reduction and tape damage." },
  { path: MIX, description: "Combine two or more images." },
  { path: `Effects/${LAB}`, description: "Curated and candidate lab effects loaded from the committed lab device file." },
  { path: "Modulators", description: "Control signals that move knobs." },
  { path: "Utilities", description: "Patch plumbing." },
  { path: "Compositions", description: "Complete patches." },
  ...[WAVES, ORBITS, GEOMETRY, FRACTALS, SIMULATIONS].map((family) => ({
    path: `Compositions/${family}`, description: `Compositions whose main source is in ${family}.`,
  })),
  { path: "Instruments", description: "Playable patches." },
  ...[FRACTALS, GEOMETRY, SIMULATIONS, MATERIALS].map((family) => ({
    path: `Instruments/${family}`, description: `Instruments whose main source is in ${family}.`,
  })),
  { path: "Racks", description: "Saved effect chains that replace effects after a source." },
];

interface DeviceEntry {
  path: string;
  look: readonly Look[];
  motion: readonly Motion[];
  cost: Cost;
  costBasis: string;
}
const one = "pass count: one fragment pass";
const cpu = "CPU only: no GPU pass";

const baseDevices: Record<Exclude<NodeType, `lab.${string}`>, DeviceEntry> = {
  video: { path: `Sources/${MEDIA}`, look: [], motion: [], cost: "light", costBasis: "one upload and copy" },
  operator: { path: `Sources/${WAVES}`, look: ["lines", "geometric"], motion: [], cost: "light", costBasis: `${one}, up to 9 harmonics` },
  pulse: { path: `Sources/${GEOMETRY}`, look: ["geometric"], motion: ["pulsing"], cost: "light", costBasis: one },
  cells: { path: `Sources/${GEOMETRY}`, look: ["geometric", "crystalline"], motion: [], cost: "light", costBasis: `${one}, site search` },
  resonance: { path: `Sources/${WAVES}`, look: ["lines", "minimal"], motion: ["slow"], cost: "light", costBasis: one },
  rules: { path: `Sources/${SIMULATIONS}`, look: ["organic", "retro"], motion: ["fast"], cost: "light", costBasis: "simulation warmup measured light" },
  chemical: { path: `Sources/${SIMULATIONS}`, look: ["organic"], motion: ["slow"], cost: "light", costBasis: "simulation warmup measured light" },
  slime: { path: `Sources/${SIMULATIONS}`, look: ["organic"], motion: [], cost: "heavy", costBasis: "measured heavy at grid 512" },
  ink: { path: `Sources/${SIMULATIONS}`, look: ["fluid"], motion: [], cost: "heavy", costBasis: "measured heavy at grid 512" },
  hyperbolic: { path: `Sources/${GEOMETRY}`, look: ["geometric"], motion: [], cost: "light", costBasis: one },
  quasicrystal: { path: `Sources/${WAVES}`, look: ["crystalline", "psychedelic"], motion: [], cost: "light", costBasis: one },
  multigrid: { path: `Sources/${GEOMETRY}`, look: ["geometric", "crystalline"], motion: [], cost: "medium", costBasis: "tile search grows with symmetry" },
  attractor: { path: `Sources/${FRACTALS}`, look: ["minimal"], motion: [], cost: "medium", costBasis: "measured 3.2 ms" },
  polytope: { path: `Sources/${FRACTALS}`, look: ["geometric", "lines", "luminous"], motion: [], cost: "medium", costBasis: "many edge tests per pixel" },
  complex: { path: `Sources/${FRACTALS}`, look: ["psychedelic", "geometric"], motion: [], cost: "light", costBasis: "measured 1 ms" },
  julia: { path: `Sources/${FRACTALS}`, look: ["organic", "psychedelic"], motion: ["slow"], cost: "medium", costBasis: "measured 4.5 ms" },
  fizz: { path: `Sources/${MATERIALS}`, look: ["metallic", "minimal"], motion: [], cost: "light", costBasis: one },
  silk: { path: `Sources/${WAVES}`, look: ["lines"], motion: [], cost: "light", costBasis: one },
  lattice: { path: `Sources/${WAVES}`, look: ["crystalline", "minimal"], motion: ["slow"], cost: "light", costBasis: one },
  orbit: { path: `Sources/${ORBITS}`, look: ["lines", "luminous"], motion: ["slow"], cost: "light", costBasis: one },
  contour: { path: `Sources/${ORBITS}`, look: ["lines", "fluid"], motion: ["slow"], cost: "light", costBasis: one },
  "fx.warp": { path: WARP, look: [], motion: ["still"], cost: "light", costBasis: one },
  "fx.mask": { path: MIX, look: [], motion: ["still"], cost: "light", costBasis: one },
  "fx.fold": { path: TONE, look: ["psychedelic", "metallic"], motion: ["still"], cost: "light", costBasis: one },
  "fx.kaleido": { path: WARP, look: ["geometric", "psychedelic"], motion: ["still"], cost: "light", costBasis: one },
  "fx.morph": { path: TONE, look: ["lines"], motion: ["still"], cost: "light", costBasis: one },
  "fx.chrono": { path: TIME, look: ["glitch"], motion: [], cost: "light", costBasis: "one pass plus history atlas" },
  "fx.hyperbolic": { path: WARP, look: ["geometric"], motion: ["slow"], cost: "light", costBasis: one },
  "fx.droste": { path: WARP, look: ["psychedelic", "geometric"], motion: ["slow"], cost: "light", costBasis: "measured 1 ms" },
  "fx.marble": { path: WARP, look: ["fluid"], motion: ["slow"], cost: "light", costBasis: one },
  "fx.feedback": { path: TIME, look: ["psychedelic"], motion: [], cost: "light", costBasis: "one pass plus history copy" },
  "fx.glow": { path: TONE, look: ["luminous"], motion: ["still"], cost: "light", costBasis: one },
  "fx.bayer": { path: LOFI, look: ["retro"], motion: ["still"], cost: "light", costBasis: one },
  "fx.delay": { path: TIME, look: [], motion: [], cost: "light", costBasis: "one pass plus full-resolution history" },
  "fx.reverb": { path: TIME, look: [], motion: [], cost: "light", costBasis: "one pass plus full-resolution history" },
  "fx.crush": { path: LOFI, look: ["retro"], motion: ["still"], cost: "light", costBasis: one },
  "fx.vhs": { path: LOFI, look: ["glitch", "retro"], motion: ["fast"], cost: "light", costBasis: one },
  mixer: { path: MIX, look: [], motion: ["still"], cost: "light", costBasis: one },
  mixer4: { path: MIX, look: [], motion: ["still"], cost: "light", costBasis: one },
  output: { path: "Utilities", look: [], motion: [], cost: "light", costBasis: "screen copy" },
  lfo: { path: "Modulators", look: [], motion: ["slow"], cost: "light", costBasis: cpu },
  gate: { path: "Modulators", look: [], motion: ["pulsing"], cost: "light", costBasis: cpu },
  adsr: { path: "Modulators", look: [], motion: ["pulsing"], cost: "light", costBasis: cpu },
};
export const DEVICES: Record<NodeType, DeviceEntry> = {
  ...baseDevices,
  ...Object.fromEntries(labDevices.map((device) => [
    device.id,
    {
      path: `${device.kind === "source" ? "Sources" : "Effects"}/${LAB}`,
      look: device.kind === "source" ? ["lines"] : ["fluid"],
      motion: ["slow"],
      cost: "light",
      costBasis: "lab template: one fragment pass with bounded body",
    } satisfies DeviceEntry,
  ])),
} as Record<NodeType, DeviceEntry>;

interface PresetEntry {
  look: readonly Look[];
  motion: readonly Motion[];
  source?: NodeType;
}
export const PRESETS: Record<string, PresetEntry> = {
  "breathing-phosphor": { look: ["lines", "luminous"], motion: ["slow"] },
  "magnetic-reverie": { look: ["lines", "retro"], motion: ["slow"] },
  "lattice-choir": { look: ["crystalline", "luminous"], motion: ["slow"] },
  "velvet-undertow": { look: ["lines", "luminous"], motion: ["slow"] },
  "acid-fax": { look: ["lines", "retro", "glitch"], motion: ["fast"] },
  "solar-ghosts": { look: ["lines", "luminous"], motion: ["slow"] },
  "midnight-relay": { look: ["lines", "glitch"], motion: ["fast"] },
  "neon-conservatory": { look: ["lines", "luminous"], motion: ["slow"] },
  "amber-astrolabe": { look: ["lines", "luminous"], motion: ["slow"] },
  "pelagic-atlas": { look: ["lines", "fluid"], motion: ["slow"] },
  "bubblegum-estuary": { look: ["fluid"], motion: ["slow"] },
  "broken-loom": { look: ["geometric", "retro"], motion: ["pulsing"] },
  "paper-circuit": { look: ["geometric", "retro"], motion: ["pulsing"] },
  "prismatic-fault": { look: ["crystalline", "metallic"], motion: [] },
  "glass-counterpoint": { look: ["crystalline", "geometric"], motion: [] },
  "copper-cathedral": { look: ["metallic", "lines"], motion: ["slow"] },
  "ghost-membrane": { look: ["lines", "minimal"], motion: ["pulsing"] },
  "nodal-veil": { look: ["lines", "fluid"], motion: ["slow"] },
  "shutter-choir": { look: ["lines", "glitch"], motion: ["pulsing"] },
  "alien-microfiche": { look: ["organic", "retro"], motion: ["fast"], source: "rules" },
  "coral-bloom": { look: ["organic"], motion: ["slow"] },
  "acid-mycelium": { look: ["organic", "retro"], motion: [] },
  "memory-reef": { look: ["organic"], motion: [] },
  crosscurrent: { look: ["minimal", "lines"], motion: ["slow"] },
  "memory-carousel": { look: ["lines", "luminous"], motion: ["slow"] },
  "velvet-sidebands": { look: ["lines", "minimal"], motion: ["slow"] },
  "chrome-teeth": { look: ["lines", "metallic"], motion: [] },
  "ring-orchard": { look: ["lines", "geometric"], motion: [] },
  "poincare-garden": { look: ["geometric"], motion: ["slow"] },
  "crystal-mandala": { look: ["crystalline", "psychedelic"], motion: ["slow"] },
  "tesseract-afterimage": { look: ["geometric", "luminous"], motion: [] },
  "tesseract-in-the-disk": { look: ["geometric", "luminous"], motion: [] },
  "zellige-drift": { look: ["geometric", "crystalline"], motion: [] },
  "delft-loom": { look: ["geometric", "crystalline"], motion: [] },
  "zellige-in-the-disk": { look: ["geometric", "crystalline"], motion: [] },
  "operator-cathedral": { look: ["geometric"], motion: ["slow"] },
  "plasma-polytope": { look: ["luminous", "fluid"], motion: [] },
  "acid-ebru": { look: ["fluid", "psychedelic"], motion: [] },
  "hue-tunnel": { look: ["psychedelic", "luminous"], motion: [] },
  "cyanotype-veil": { look: ["minimal"], motion: ["slow"] },
  "acid-checker-garden": { look: ["psychedelic", "geometric"], motion: [] },
  "neon-quartet": { look: ["psychedelic", "luminous"], motion: [] },
  "escher-garden": { look: ["psychedelic", "geometric"], motion: ["slow"] },
  "zellige-vortex": { look: ["geometric", "crystalline"], motion: ["slow"] },
  "breathing-bulb": { look: ["organic", "psychedelic"], motion: ["slow"] },
  "nautilus-julia": { look: ["organic", "psychedelic"], motion: ["slow"] },
  "slime-mold-wars": { look: ["organic", "lines"], motion: ["fast"] },
  "mycelium-truce": { look: ["organic", "lines"], motion: [] },
  "ink-in-water": { look: ["fluid", "luminous"], motion: [] },
  "marbled-tide": { look: ["fluid"], motion: ["slow"] },
  "frost-fizz": { look: ["metallic", "minimal"], motion: [] },
  "fizz-vortex": { look: ["metallic"], motion: ["slow"] },
};

export const RACKS: Record<string, { look: readonly Look[]; motion: readonly Motion[] }> = {
  "Crushed Reverie": { look: ["retro", "luminous"], motion: [] },
  "Dream Tape": { look: ["luminous", "glitch", "retro"], motion: ["fast"] },
  "Arcade Phosphor": { look: ["retro", "luminous"], motion: ["still"] },
  "Broken Broadcast": { look: ["glitch", "retro"], motion: ["fast"] },
};

export const HISTORY_TYPES: readonly NodeType[] = ["fx.delay", "fx.reverb", "fx.chrono", "fx.feedback"];
const RANK: Record<Cost, number> = { light: 0, medium: 1, heavy: 2 };

export const taxonomyKey = (kind: BrowserKind, id: string) => `${kind}:${id}`;
export const catalogPresets = (): CatalogPreset[] => [...presetCatalog, ...performanceBank];

export function nodeCost(node: SynthNode | NodeType): Cost {
  const type = typeof node === "string" ? node : node.type;
  if (typeof node !== "string" && type === "multigrid" && (node.params.symmetry ?? 5) >= 7) return "heavy";
  return DEVICES[type].cost;
}
function combineCost(costs: Cost[]): Cost {
  const top = Math.max(0, ...costs.map((cost) => RANK[cost]));
  const bumped = costs.filter((cost) => RANK[cost] >= 1).length >= 2 ? top + 1 : top;
  return COST[Math.min(2, bumped)]!;
}
function soloPatch(type: NodeType): Patch {
  const nodes = [createNode(type, "solo")];
  if (type === "adsr") nodes.push(createNode("gate", "gate"));
  const gated = type === "gate" || type === "adsr";
  return {
    version: 2, name: "solo", nodes, connections: [],
    transport: { bpm: 120, loopSeconds: 12 },
    events: gated ? [{ time: 0, node: type === "gate" ? "solo" : "gate", on: true }] : [],
  };
}
export function mainChainSource(patch: Patch): NodeType | undefined {
  const byId = new Map(patch.nodes.map((node) => [node.id, node]));
  const edgeInto = (id: string, port: string) =>
    patch.connections.find((edge) => edge.to.node === id && edge.to.port === port && edge.from.port === "frame");
  let node = patch.nodes.find((candidate) => candidate.type === "output");
  const seen = new Set<string>();
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    if (isGenerator(node.type)) return node.type;
    const port = frameInputs(node).find((input) => edgeInto(node!.id, input));
    node = port ? byId.get(edgeInto(node.id, port)!.from.node) : undefined;
  }
  return undefined;
}
export function primarySource(preset: CatalogPreset): NodeType | undefined {
  return PRESETS[preset.id]?.source ?? mainChainSource(preset.patch);
}
const familyOf = (type: NodeType) => DEVICES[type].path.split("/")[1] ?? DEVICES[type].path;

export interface DerivedTags {
  behaviour: Behaviour[];
  cost: Cost;
  bank?: string[];
}
export function deriveDevice(type: NodeType): DerivedTags {
  const inputs = frameInputs(type);
  const behaviour: Behaviour[] = [];
  if (type !== "video" && isLoopablePreset(soloPatch(type))) behaviour.push("loopable");
  if (isStatefulGenerator(type)) behaviour.push("stateful");
  if (type.startsWith("lab.")) behaviour.push("lab");
  if (labDevices.some((device) => device.id === type && device.status === "candidate")) behaviour.push("candidate");
  if (HISTORY_TYPES.includes(type)) behaviour.push("history");
  if (inputs.length) behaviour.push("needs-input");
  if (inputs.length > 1) behaviour.push("extra-inputs");
  return { behaviour, cost: nodeCost(type) };
}
export function derivePreset(preset: CatalogPreset): DerivedTags {
  const frames = planFrames(preset.patch).nodes;
  const behaviour: Behaviour[] = [];
  if (preset.loopable) behaviour.push("loopable");
  if (frames.some((node) => isStatefulGenerator(node.type))) behaviour.push("stateful");
  if (frames.some((node) => HISTORY_TYPES.includes(node.type))) behaviour.push("history");
  if (preset.touch) behaviour.push("touch-xy");
  if (frames.filter((node) => isGenerator(node.type)).length >= 2) behaviour.push("layered");
  return { behaviour, cost: combineCost(frames.map(nodeCost)), bank: [preset.bank] };
}
export function deriveRack(name: string): DerivedTags {
  const chain = rackPresets[name];
  if (!chain) throw new Error(`Unknown rack preset ${name}`);
  const behaviour: Behaviour[] = [];
  if (isLoopablePreset(applyRack(createDefaultPatch(), name))) behaviour.push("loopable");
  if (chain.some((entry) => HISTORY_TYPES.includes(entry.type))) behaviour.push("history");
  if (chain.some((entry) => isLabEffect(entry.type))) behaviour.push("lab");
  behaviour.push("needs-input");
  return { behaviour, cost: combineCost(chain.map((entry) => nodeCost(entry.type))) };
}
export function derive(kind: "device", id: NodeType): DerivedTags;
export function derive(kind: "preset", preset: CatalogPreset): DerivedTags;
export function derive(kind: "rack", name: string): DerivedTags;
export function derive(kind: BrowserKind, item: NodeType | CatalogPreset | string): DerivedTags {
  if (kind === "device") return deriveDevice(item as NodeType);
  if (kind === "preset") return derivePreset(item as CatalogPreset);
  return deriveRack(item as string);
}

export function presetPaths(presets: CatalogPreset[]): Map<string, string> {
  const base = new Map<string, { path: string; source: NodeType }>();
  for (const preset of presets) {
    const source = primarySource(preset);
    if (!source) throw new Error(`${preset.id}: no source reaches Screen output`);
    base.set(preset.id, { path: `${preset.touch ? "Instruments" : "Compositions"}/${familyOf(source)}`, source });
  }
  const result = new Map<string, string>();
  for (const [id, { path, source }] of base) {
    const siblings = [...base.values()].filter((entry) => entry.path === path);
    const sameSource = siblings.filter((entry) => entry.source === source).length;
    result.set(id, siblings.length > 8 && sameSource >= 3 ? `${path}/${manifests[source].label}` : path);
  }
  return result;
}
export function sharedNames(presets = catalogPresets()): { name: string; device: NodeType; preset: string }[] {
  return presets.flatMap((preset) => (Object.keys(manifests) as NodeType[])
    .filter((type) => manifests[type].label === preset.name)
    .map((device) => ({ name: preset.name, device, preset: preset.id })));
}

export interface TaxonomyItem {
  id: string;
  kind: BrowserKind;
  name: string;
  path: string;
  tags: { look: Look[]; motion: Motion[] };
  derivedTags: DerivedTags;
  source?: NodeType;
  costBasis?: string;
}
export interface TaxonomyBuild {
  logic: string;
  hierarchy: ({ path: string; description: string; count: number })[];
  facets: Record<FacetName, {
    values: readonly string[];
    labels: Record<string, string>;
    derived: boolean;
    editorial: boolean;
    hiddenByDefault: boolean;
    label: string;
  }>;
  sharedNames: { name: string; device: NodeType; preset: string }[];
  items: TaxonomyItem[];
}

export const KIND_STYLES: Record<BrowserKind, { label: string; order: number }> = {
  device: { label: "Device", order: 0 },
  preset: { label: "Preset", order: 1 },
  rack: { label: "Rack", order: 2 },
};

export const ALIASES: Record<string, readonly string[]> = {
  feedback: ["Effects/Time & Feedback", "fx.feedback"],
  trails: ["Effects/Time & Feedback", "fx.feedback"],
  echo: ["Effects/Time & Feedback", "fx.feedback"],
  memory: ["Effects/Time & Feedback", "fx.feedback"],
  history: ["Effects/Time & Feedback", "fx.feedback"],
  kaleido: ["Effects/Warp & Symmetry"],
  mirror: ["Effects/Warp & Symmetry"],
  symmetry: ["Effects/Warp & Symmetry"],
  glitch: ["Effects/Lo-fi & Glitch", "glitch"],
  tape: ["Effects/Lo-fi & Glitch"],
  noise: ["Effects/Lo-fi & Glitch"],
  dither: ["fx.bayer"],
  pixel: ["fx.bayer"],
  fractal: ["Sources/Fractals & 3D"],
  "3d": ["Sources/Fractals & 3D"],
  sim: ["Sources/Simulations", "stateful"],
  grow: ["Sources/Simulations", "stateful"],
  living: ["Sources/Simulations", "stateful"],
  tile: ["Sources/Geometry & Tilings"],
  tiling: ["Sources/Geometry & Tilings"],
  zellige: ["Sources/Geometry & Tilings"],
  touch: ["touch-xy"],
  xy: ["touch-xy"],
  playable: ["touch-xy"],
  blend: ["Effects/Mix & Mask"],
  composite: ["Effects/Mix & Mask"],
  mask: ["Effects/Mix & Mask"],
  tunnel: ["fx.droste", "fx.feedback"],
  spiral: ["fx.droste", "fx.feedback"],
  zoom: ["fx.droste", "fx.feedback"],
  lfo: ["lfo"],
  wobble: ["lfo"],
  generators: ["Sources"],
  generator: ["Sources"],
  utility: ["Effects/Mix & Mask"],
  "patch bank": ["Compositions"],
  preset: ["Compositions"],
  seed: ["Wander"],
};

export function buildTaxonomy(presets = catalogPresets()): TaxonomyBuild {
  const items: TaxonomyItem[] = [];
  for (const type of Object.keys(manifests) as NodeType[]) {
    const entry = DEVICES[type];
    items.push({
      id: type, kind: "device", name: manifests[type].label, path: entry.path,
      tags: { look: [...entry.look], motion: [...entry.motion] },
      derivedTags: deriveDevice(type), costBasis: entry.costBasis,
    });
  }
  const paths = presetPaths(presets);
  for (const preset of presets) {
    const entry = PRESETS[preset.id];
    if (!entry) throw new Error(`${preset.id}: missing from PRESETS`);
    items.push({
      id: preset.id, kind: "preset", name: preset.name, path: paths.get(preset.id)!,
      tags: { look: [...entry.look], motion: [...entry.motion] },
      derivedTags: derivePreset(preset), source: primarySource(preset),
    });
  }
  for (const name of Object.keys(rackPresets)) {
    const entry = RACKS[name];
    if (!entry) throw new Error(`${name}: missing from RACKS`);
    items.push({
      id: name, kind: "rack", name, path: "Racks",
      tags: { look: [...entry.look], motion: [...entry.motion] },
      derivedTags: deriveRack(name),
    });
  }
  const nodes = [...HIERARCHY];
  const size = (path: string) => items.filter((item) => item.path === path).length;
  const generated = [...new Set(items.map((item) => item.path))]
    .filter((path) => !nodes.some((node) => node.path === path))
    .sort((a, b) => size(b) - size(a) || a.localeCompare(b));
  for (const path of generated) {
    const parent = path.slice(0, path.lastIndexOf("/"));
    const at = nodes.findIndex((node) => node.path === parent);
    if (at < 0 || path.split("/").length > 3) throw new Error(`${path}: not in HIERARCHY`);
    let end = at + 1;
    while (end < nodes.length && nodes[end]!.path.startsWith(`${parent}/`)) end++;
    nodes.splice(end, 0, { path, description: `Presets whose main source is ${path.split("/").pop()}.` });
  }
  const hierarchy = nodes.map((node) => ({
    ...node,
    count: items.filter((item) => item.path === node.path || item.path.startsWith(`${node.path}/`)).length,
  })).filter((node) => node.count > 0);
  const banks = [...new Set(presets.map((preset) => preset.bank))];
  const uses = [...new Set(items.flatMap((item) => [item.path, item.path.split("/").slice(0, 2).join("/")]))]
    .filter(Boolean).sort();
  const label = (value: string) => (LABELS as Record<string, string>)[value] ?? value.split("/").pop() ?? value;
  const facets = Object.fromEntries((Object.keys(FACETS) as FacetName[]).map((name) => {
    const base = FACETS[name];
    const values = name === "bank" ? banks : name === "uses" ? uses : [...base.values];
    return [name, { ...base, values, labels: Object.fromEntries(values.map((value) => [value, label(value)])) }];
  })) as unknown as TaxonomyBuild["facets"];
  for (const item of items) {
    if (item.tags.look.length > 3) throw new Error(`${item.id}: more than 3 look tags`);
    if (item.kind === "preset") {
      const preset = presets.find((candidate) => candidate.id === item.id)!;
      if (item.derivedTags.behaviour.includes("loopable") !== isLoopablePreset(preset.patch))
        throw new Error(`${item.id}: loopable disagrees with isLoopablePreset`);
    }
  }
  return {
    logic: "OR within a facet, AND across facets",
    hierarchy,
    facets,
    sharedNames: sharedNames(presets),
    items,
  };
}
