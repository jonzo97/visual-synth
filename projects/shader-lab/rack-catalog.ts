import {
  frameInputs,
  manifests,
  rackPresets,
  type NodeType,
  type ParameterManifest,
  type Patch,
} from "./core";
import { performanceBank } from "./performance-bank";
import { presetCatalog, type CatalogPreset } from "./preset-catalog";
import { releaseBank } from "./release-bank";
import { DEVICES, deriveDevice } from "./browser-taxonomy";
import { labDevice } from "./lab-device";

export interface DeviceParamCatalogEntry {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  optionLabels?: string[];
}

export interface DeviceCatalogEntry {
  type: NodeType;
  label: string;
  family: string;
  category: string;
  inputPorts: string[];
  outputPorts: string[];
  params: DeviceParamCatalogEntry[];
  tags: ReturnType<typeof deriveDevice>;
  usage: number;
  status?: "curated" | "candidate";
}

export interface DeviceUsageEntry {
  type: NodeType;
  label: string;
  usage: number;
}

export interface UsageSource {
  id: string;
  name: string;
  patch?: Patch;
  rack?: { type: NodeType; params: Record<string, number> }[];
}

function uniquePresets(...groups: readonly CatalogPreset[][]): CatalogPreset[] {
  const byId = new Map<string, CatalogPreset>();
  for (const preset of groups.flat()) byId.set(preset.id, preset);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function shippedUsageSources(): UsageSource[] {
  const presets = uniquePresets(presetCatalog, performanceBank, releaseBank);
  return [
    ...presets.map((preset) => ({ id: preset.id, name: preset.name, patch: preset.patch })),
    ...Object.entries(rackPresets).map(([name, rack]) => ({ id: `rack:${name}`, name, rack })),
  ];
}

function outputPorts(type: NodeType): string[] {
  if (type === "output") return [];
  if (type === "lfo" || type === "adsr") return ["value"];
  if (type === "gate") return ["gate"];
  return ["frame"];
}

function optionLabels(param: ParameterManifest): string[] | undefined {
  if (param.modulatable !== false || param.step !== 1) return undefined;
  const [, raw] = param.label.split(":");
  if (!raw?.includes("/")) return undefined;
  const labels = raw.split("/").map((part) => part.trim()).filter(Boolean);
  return labels.length ? labels : undefined;
}

function sourceTypes(source: UsageSource): Set<NodeType> {
  if (source.patch) return new Set(source.patch.nodes.map((node) => node.type));
  return new Set(source.rack?.map((entry) => entry.type) ?? []);
}

export function countDeviceUsage(sources = shippedUsageSources()): Record<NodeType, number> {
  const usage = Object.fromEntries((Object.keys(manifests) as NodeType[]).map((type) => [type, 0])) as Record<NodeType, number>;
  for (const source of sources) {
    for (const type of sourceTypes(source)) usage[type] += 1;
  }
  return usage;
}

export function buildDeviceCatalog(): DeviceCatalogEntry[] {
  const usage = countDeviceUsage();
  return (Object.keys(manifests) as NodeType[]).sort().map((type) => {
    const manifest = manifests[type];
    const path = DEVICES[type].path;
    return {
      type,
      label: manifest.label,
      family: path.split("/")[1] ?? path,
      category: manifest.category,
      inputPorts: [...frameInputs(type)],
      outputPorts: outputPorts(type),
      params: Object.entries(manifest.params).map(([key, param]) => ({
        key,
        label: param.label,
        min: param.min,
        max: param.max,
        step: param.step,
        default: param.default,
        ...(optionLabels(param) ? { optionLabels: optionLabels(param)! } : {}),
      })),
      tags: deriveDevice(type),
      usage: usage[type],
      ...(type.startsWith("lab.") ? { status: labDevice(type)?.status ?? "candidate" } : {}),
    };
  });
}

export function buildDeviceUsage(): DeviceUsageEntry[] {
  return buildDeviceCatalog()
    .map(({ type, label, usage }) => ({ type, label, usage }))
    .sort((a, b) => a.usage - b.usage || a.type.localeCompare(b.type));
}
