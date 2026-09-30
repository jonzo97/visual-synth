import rawGeminiLibrary from "./library/gemini-racks.json";
import deviceCatalog from "./generated/device-catalog.json";
import {
  isLoopablePreset,
  type CatalogPreset,
  type PresetControl,
} from "./preset-catalog";
import {
  manifests,
  validatePatch,
  type NodeType,
  type Patch,
  type RackDevice,
} from "./core";

type GeminiKind = "instrument" | "rack";
type GeminiStatus = "curated" | "candidate";
type GeminiCost = "light" | "medium" | "heavy";

export interface GeminiSource {
  tool: "gemini-foundry";
  run: string;
  model: string;
  metrics: { std: number; diff: number; changed: number };
}

export interface GeminiLibraryItem {
  id: string;
  name: string;
  kind: GeminiKind;
  status: GeminiStatus;
  description: string;
  tags: { behaviour: string[]; cost: GeminiCost; uses: string[] };
  devices: RackDevice[];
  patch?: Patch;
  controls?: [PresetControl, PresetControl, PresetControl];
  source: GeminiSource;
  added: string;
}

export interface GeminiLibraryLoad {
  items: GeminiLibraryItem[];
  warnings: string[];
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;

const catalogTypes = new Set(deviceCatalog.map((entry) => entry.type));
const catalogParams = new Map(
  deviceCatalog.map((entry) => [entry.type, new Set(entry.params.map((param) => param.key))]),
);

function reason(id: string, text: string): string {
  return `${id}: ${text}`;
}

function warn(warnings: string[], message: string, enabled: boolean): void {
  warnings.push(message);
  if (enabled) console.warn(`[gemini-library] ${message}`);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function validateDevice(
  raw: unknown,
  itemId: string,
  warnings: string[],
  errors: string[],
  allowGenerators: boolean,
): RackDevice | undefined {
  if (!object(raw) || typeof raw.type !== "string" || !object(raw.params)) {
    errors.push(reason(itemId, "invalid device entry"));
    return undefined;
  }
  if (!catalogTypes.has(raw.type) || !Object.hasOwn(manifests, raw.type)) {
    errors.push(reason(itemId, `unknown device type ${raw.type}`));
    return undefined;
  }
  const type = raw.type as NodeType;
  if (!allowGenerators && !type.startsWith("fx.")) {
    errors.push(reason(itemId, `rack device ${type} is not an effect`));
    return undefined;
  }
  const allowedParams = catalogParams.get(type) ?? new Set<string>();
  const params: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw.params)) {
    const spec = manifests[type].params[key];
    if (!allowedParams.has(key) || !spec) {
      errors.push(reason(itemId, `${type}.${key} is not in the device catalog`));
      continue;
    }
    if (!finite(value)) {
      errors.push(reason(itemId, `${type}.${key} is not a finite number`));
      continue;
    }
    const clamped = Math.min(spec.max, Math.max(spec.min, value));
    if (clamped !== value) {
      warnings.push(reason(itemId, `${type}.${key} clamped from ${value} to ${clamped}`));
    }
    params[key] = clamped;
  }
  return { type, params };
}

function clampPatchParams(patch: Patch, itemId: string, warnings: string[]): Patch {
  const next = clone(patch);
  if (!Array.isArray(next.nodes)) return next;
  for (const node of next.nodes) {
    const manifest = manifests[node.type];
    if (!manifest || !object(node.params)) continue;
    for (const [key, value] of Object.entries(node.params)) {
      const spec = manifest.params[key];
      if (!spec || !finite(value)) continue;
      const clamped = Math.min(spec.max, Math.max(spec.min, value));
      if (clamped !== value) {
        warnings.push(reason(itemId, `${node.id}.${key} clamped from ${value} to ${clamped}`));
        node.params[key] = clamped;
      }
    }
  }
  return next;
}

function validateControls(raw: unknown, patch: Patch, itemId: string, errors: string[]): GeminiLibraryItem["controls"] {
  if (!Array.isArray(raw) || raw.length !== 3) {
    errors.push(reason(itemId, "instrument controls must contain exactly 3 entries"));
    return undefined;
  }
  const nodes = new Map(patch.nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const controls: PresetControl[] = [];
  for (const control of raw) {
    if (!object(control) || typeof control.node !== "string" ||
      typeof control.param !== "string" || typeof control.label !== "string" ||
      !control.label.trim()) {
      errors.push(reason(itemId, "invalid control entry"));
      continue;
    }
    const node = nodes.get(control.node);
    const spec = node ? manifests[node.type].params[control.param] : undefined;
    const key = `${control.node}:${control.param}`;
    if (!node || !spec) {
      errors.push(reason(itemId, `control target ${key} does not exist`));
      continue;
    }
    if (spec.max <= spec.min) errors.push(reason(itemId, `control target ${key} has no range`));
    if (seen.has(key)) errors.push(reason(itemId, `duplicate control target ${key}`));
    seen.add(key);
    controls.push({ node: control.node, param: control.param, label: control.label });
  }
  return controls.length === 3 ? controls as [PresetControl, PresetControl, PresetControl] : undefined;
}

function validateItem(raw: unknown, seen: Set<string>, warnings: string[]): GeminiLibraryItem | undefined {
  const errors: string[] = [];
  if (!object(raw) || typeof raw.id !== "string") {
    warnings.push("Dropped Gemini item: invalid item object");
    return undefined;
  }
  const id = raw.id;
  if (seen.has(id)) errors.push(reason(id, "duplicate id"));
  if (!/^gemini-[a-z0-9-]+$/.test(id)) errors.push(reason(id, "id must be gemini-kebab-case"));
  if (typeof raw.name !== "string" || !raw.name.trim() || raw.name.length > 32)
    errors.push(reason(id, "name must be 1-32 characters"));
  if (raw.kind !== "instrument" && raw.kind !== "rack") errors.push(reason(id, "invalid kind"));
  if (raw.status !== "curated" && raw.status !== "candidate") errors.push(reason(id, "invalid status"));
  if (typeof raw.description !== "string" || !raw.description.trim())
    errors.push(reason(id, "description is required"));
  if (!object(raw.tags) || !strings(raw.tags.behaviour) ||
    (raw.tags.cost !== "light" && raw.tags.cost !== "medium" && raw.tags.cost !== "heavy") ||
    !strings(raw.tags.uses)) {
    errors.push(reason(id, "invalid tags"));
  }
  if (!Array.isArray(raw.devices)) errors.push(reason(id, "devices must be an array"));
  const devices = Array.isArray(raw.devices)
    ? raw.devices.map((device) => validateDevice(device, id, warnings, errors, raw.kind === "instrument"))
      .filter((device): device is RackDevice => !!device)
    : [];
  if (!devices.length) errors.push(reason(id, "at least one device is required"));

  let patch: Patch | undefined;
  let controls: GeminiLibraryItem["controls"];
  if (raw.kind === "instrument") {
    if (!object(raw.patch)) errors.push(reason(id, "instrument patch is required"));
    else {
      patch = clampPatchParams(raw.patch as unknown as Patch, id, warnings);
      const patchErrors = validatePatch(patch);
      if (patchErrors.length) errors.push(reason(id, `invalid patch: ${patchErrors.join("; ")}`));
      controls = validateControls(raw.controls, patch, id, errors);
    }
  } else if (raw.patch !== undefined || raw.controls !== undefined) {
    errors.push(reason(id, "rack items must not include patch or controls"));
  }

  if (!object(raw.source) || raw.source.tool !== "gemini-foundry" ||
    typeof raw.source.run !== "string" || typeof raw.source.model !== "string" ||
    !object(raw.source.metrics) || !finite(raw.source.metrics.std) ||
    !finite(raw.source.metrics.diff) || !finite(raw.source.metrics.changed)) {
    errors.push(reason(id, "invalid source metadata"));
  }
  if (typeof raw.added !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.added))
    errors.push(reason(id, "added must be YYYY-MM-DD"));

  if (errors.length) {
    warnings.push(`Dropped ${id}: ${errors.join("; ")}`);
    return undefined;
  }
  seen.add(id);
  const base = {
    id,
    name: raw.name as string,
    kind: raw.kind as GeminiKind,
    status: raw.status as GeminiStatus,
    description: raw.description as string,
    tags: clone(raw.tags as GeminiLibraryItem["tags"]),
    devices,
    source: clone(raw.source as GeminiSource),
    added: raw.added as string,
  };
  return patch && controls ? { ...base, patch, controls } : base;
}

function sortItems(items: GeminiLibraryItem[]): GeminiLibraryItem[] {
  const rank = (item: GeminiLibraryItem) => item.status === "curated" ? 0 : 1;
  return [...items].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function loadGeminiLibrary(input: unknown = rawGeminiLibrary, options: { warn?: boolean } = {}): GeminiLibraryLoad {
  const enabled = options.warn ?? true;
  const warnings: string[] = [];
  if (!object(input) || input.version !== 1 || !Array.isArray(input.items)) {
    warn(warnings, "Malformed Gemini library; loaded 0 items", enabled);
    return { items: [], warnings };
  }
  const seen = new Set<string>();
  const items = sortItems(input.items
    .map((item) => validateItem(item, seen, warnings))
    .filter((item): item is GeminiLibraryItem => !!item));
  for (const message of warnings) if (enabled) console.warn(`[gemini-library] ${message}`);
  return { items, warnings };
}

const loadedGeminiLibrary = loadGeminiLibrary();

export const geminiLibraryItems = loadedGeminiLibrary.items;
export const geminiInstruments = geminiLibraryItems.filter((item) => item.kind === "instrument" && item.patch);
export const geminiRacks = geminiLibraryItems.filter((item) => item.kind === "rack");
export const geminiPlayerSnapshots: CatalogPreset[] = geminiInstruments
  .filter((item) => item.status === "curated")
  .map((item) => ({
    id: item.id,
    bank: "Gemini",
    name: item.name,
    description: item.description,
    patch: clone(item.patch!),
    duration: item.patch!.transport.loopSeconds,
    loopable: isLoopablePreset(item.patch!),
    controls: clone(item.controls!),
  }));
