import {
  frameInputs,
  isEffect,
  isMixer,
  manifests,
  rackPresets,
  type Patch,
  type RackDevice,
  type SynthNode,
} from "./core";
import { performanceBank } from "./performance-bank";
import { presetCatalog, type CatalogPreset } from "./preset-catalog";
import { releaseBank } from "./release-bank";
import { COST, DEVICES, HISTORY_TYPES, nodeCost, type Behaviour, type Cost } from "./browser-taxonomy";

export interface ExtractedRack {
  id: string;
  name: string;
  sourcePresetIds: string[];
  devices: RackDevice[];
  tags: {
    behaviour: Behaviour[];
    cost: Cost;
    uses: string[];
  };
  description: string;
}

export interface RackCandidate extends ExtractedRack {
  sourcePresetIds: [string];
}

const RANK: Record<Cost, number> = { light: 0, medium: 1, heavy: 2 };

function uniquePresets(...groups: readonly CatalogPreset[][]): CatalogPreset[] {
  const byId = new Map<string, CatalogPreset>();
  for (const preset of groups.flat()) byId.set(preset.id, preset);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function shippedRackSourcePresets(): CatalogPreset[] {
  return uniquePresets(presetCatalog, performanceBank, releaseBank);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function canonicalDevices(devices: readonly RackDevice[]): string {
  return JSON.stringify(devices.map((device) => [
    device.type,
    Object.fromEntries(Object.entries(device.params).sort(([a], [b]) => a.localeCompare(b))),
  ]));
}

function costOf(devices: readonly RackDevice[]): Cost {
  const top = Math.max(0, ...devices.map((device) => RANK[nodeCost(device.type)]));
  const bumped = devices.filter((device) => RANK[nodeCost(device.type)] >= 1).length >= 2 ? top + 1 : top;
  return COST[Math.min(2, bumped)]!;
}

function tagsFor(devices: readonly RackDevice[]): ExtractedRack["tags"] {
  const behaviour: Behaviour[] = ["needs-input"];
  if (devices.some((device) => HISTORY_TYPES.includes(device.type))) behaviour.push("history");
  const uses = [...new Set(devices.flatMap((device) => [device.type, DEVICES[device.type].path]))].sort();
  return { behaviour, cost: costOf(devices), uses };
}

function namedAfterEffects(devices: readonly RackDevice[]): string {
  const labels = devices.map((device) => manifests[device.type].label);
  return [...new Set(labels)].slice(0, 3).join(" + ");
}

function rackName(candidate: RackCandidate, sources: readonly string[]): string {
  if (sources.length === 1) return `${candidate.name} rack`;
  return `${namedAfterEffects(candidate.devices)} rack`;
}

function edgeInto(patch: Patch, node: SynthNode, port: string) {
  return patch.connections.find((edge) =>
    edge.to.node === node.id && edge.to.port === port && edge.from.port === "frame");
}

function upstreamEffectChain(patch: Patch): RackDevice[] {
  const byId = new Map(patch.nodes.map((node) => [node.id, node]));
  const output = patch.nodes.find((node) => node.type === "output");
  if (!output) return [];
  const chain: RackDevice[] = [];
  let node: SynthNode | undefined = output;
  const seen = new Set<string>();
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    const input = frameInputs(node).includes("in") ? "in" : frameInputs(node)[0];
    if (!input) break;
    const edge = edgeInto(patch, node, input);
    if (!edge) break;
    const previous = byId.get(edge.from.node);
    if (!previous) break;
    if (isEffect(previous.type)) {
      chain.unshift({ type: previous.type, params: { ...previous.params } });
      node = previous;
      continue;
    }
    if (isMixer(previous.type)) break;
    break;
  }
  return chain;
}

export function extractRackCandidates(presets = shippedRackSourcePresets()): RackCandidate[] {
  return presets.flatMap((preset) => {
    const devices = upstreamEffectChain(preset.patch);
    if (!devices.length) return [];
    return [{
      id: `${slug(preset.id)}-rack`,
      name: preset.name,
      sourcePresetIds: [preset.id],
      devices,
      tags: tagsFor(devices),
      description: `Extracted from ${preset.name}.`,
    }];
  });
}

export function extractRacks(presets = shippedRackSourcePresets()): ExtractedRack[] {
  const bySignature = new Map<string, RackCandidate & { sourcePresetIds: string[] }>();
  for (const candidate of extractRackCandidates(presets)) {
    const signature = canonicalDevices(candidate.devices);
    const existing = bySignature.get(signature);
    if (existing) {
      existing.sourcePresetIds.push(...candidate.sourcePresetIds);
      continue;
    }
    bySignature.set(signature, { ...candidate, sourcePresetIds: [...candidate.sourcePresetIds] });
  }
  return [...bySignature.values()].map((rack) => {
    const sourcePresetIds = [...new Set(rack.sourcePresetIds)].sort();
    const name = rackName(rack, sourcePresetIds);
    return {
      id: `from-presets-${slug(name)}`,
      name,
      sourcePresetIds,
      devices: rack.devices,
      tags: tagsFor(rack.devices),
      description: sourcePresetIds.length === 1
        ? `Extracted from ${sourcePresetIds[0]}.`
        : `Shared by ${sourcePresetIds.length} shipped presets.`,
    };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function allRackEntries(): Record<string, readonly RackDevice[]> {
  return {
    ...rackPresets,
    ...Object.fromEntries(extractRacks().map((rack) => [rack.id, rack.devices] as const)),
  };
}
