import { frameInputs, isGenerator, manifests, rackPresets, type NodeType, type Patch, type RackDevice } from "./core";
import { extractRacks } from "./rack-export";
import { geminiInstruments, geminiRacks } from "./gemini-library";
import { performanceBank } from "./performance-bank";
import { presetCatalog, type CatalogPreset } from "./preset-catalog";
import { planFrames } from "./render-plan";
import {
  ALIASES,
  buildTaxonomy,
  catalogPresets,
  DEVICES,
  FACETS,
  HISTORY_TYPES,
  LABELS,
  taxonomyKey,
  type BrowserKind,
  type FacetName,
  type TaxonomyBuild,
  type TaxonomyItem,
} from "./browser-taxonomy";

export type BrowserItemKind = BrowserKind | "saved" | "patch-node" | "patch-param" | "place";

export interface SavedPatchInput {
  id: string;
  name: string;
  patch: Patch;
  updatedAt?: number;
  recovery?: boolean;
}
export interface BrowserItem {
  key: string;
  id: string;
  kind: BrowserItemKind;
  name: string;
  path: string;
  description?: string;
  taxonomyOrder: number;
  tags: Record<FacetName, string[]>;
  aliases: string[];
  containedTypes: NodeType[];
  macroLabels: string[];
  paramLabels: string[];
  source?: NodeType;
  patch?: Patch;
  preset?: CatalogPreset;
  rackDevices?: RackDevice[];
  hidden?: boolean;
  search: BrowserSearchFields;
}
export interface BrowserSearchFields {
  name: string;
  words: string[];
  initials: string;
  aliases: string[];
  familyTags: string[];
  familyParts: string[];
  bankWords: string[];
  macroLabels: { value: string; words: string[] }[];
  paramLabels: { value: string; words: string[] }[];
  descriptionWords: string[];
  typoWords: string[];
  containedTypes: string[];
}
export interface BrowserIndex {
  items: BrowserItem[];
  visibleItems: BrowserItem[];
  taxonomy: TaxonomyBuild;
  aliases: typeof ALIASES;
  facets: TaxonomyBuild["facets"];
}
export interface BuildIndexOptions {
  presets?: CatalogPreset[];
  saved?: SavedPatchInput[];
  patch?: Patch;
}

const defaultPresets = (): CatalogPreset[] => [...presetCatalog, ...performanceBank];
const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];
const TOKEN_RE = /[a-z0-9.]+/g;
const normalize = (value: string): string =>
  value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const searchWords = (value: string): string[] => normalize(value).match(TOKEN_RE) ?? [];
const initials = (value: string): string => searchWords(value).map((word) => word[0]).join("");
const familyValues = (path: string): string[] => {
  const parts = path.split("/");
  return unique([path, parts.slice(0, 2).join("/"), parts[0] ?? ""].filter(Boolean));
};
const patchTypes = (patch: Patch): NodeType[] => unique(planFrames(patch).nodes.map((node) => node.type));
const typeFamilies = (types: readonly NodeType[]): string[] => unique(types.flatMap((type) => familyValues(DEVICES[type].path)));
const patchHasHistory = (patch: Patch): boolean => planFrames(patch).nodes.some((node) => HISTORY_TYPES.includes(node.type));
const pathAliases = (path: string): string[] =>
  Object.entries(ALIASES).filter(([, targets]) => targets.includes(path)).map(([alias]) => alias);
const searchableParts = (values: readonly string[]): string[] =>
  unique(values.flatMap((value) => normalize(value).split("/").flatMap((part) => searchWords(part))));
const labelFields = (values: readonly string[]) =>
  values.filter(Boolean).map((value) => ({ value: normalize(value), words: searchWords(value) }));

function taxonomyTags(item: TaxonomyItem, containedTypes: NodeType[]): Record<FacetName, string[]> {
  return {
    look: item.tags.look,
    motion: item.tags.motion,
    behaviour: item.derivedTags.behaviour,
    cost: [item.derivedTags.cost],
    uses: unique([...familyValues(item.path), ...typeFamilies(containedTypes), ...containedTypes]),
    bank: item.derivedTags.bank ?? [],
  };
}

function descriptionForPreset(preset: CatalogPreset): string {
  return preset.description;
}

function searchFields(item: Omit<BrowserItem, "search">): BrowserSearchFields {
  const familyTagValues = [
    item.path,
    ...item.tags.behaviour,
    ...item.tags.cost,
    ...item.tags.uses,
    ...item.tags.bank,
  ];
  const typoValues = [
    item.name,
    item.id,
    ...item.aliases,
    ...item.paramLabels,
    ...item.macroLabels,
  ];
  return {
    name: normalize(item.name),
    words: searchWords(item.name),
    initials: initials(item.name),
    aliases: unique(item.aliases.map(normalize)),
    familyTags: unique(familyTagValues.map(normalize)),
    familyParts: searchableParts(familyTagValues),
    bankWords: searchableParts(item.tags.bank),
    macroLabels: labelFields(item.macroLabels),
    paramLabels: labelFields(item.paramLabels),
    descriptionWords: item.description ? searchWords(item.description) : [],
    typoWords: unique(typoValues.flatMap(searchWords)),
    containedTypes: item.containedTypes.map(normalize),
  };
}

function addItem(items: BrowserItem[], item: Omit<BrowserItem, "search">): void {
  items.push({ ...item, search: searchFields(item) });
}

export function buildIndex(options: BuildIndexOptions = {}): BrowserIndex {
  const presets = options.presets ?? defaultPresets();
  const taxonomy = buildTaxonomy(presets);
  const presetById = new Map(presets.map((preset) => [preset.id, preset]));
  const items: BrowserItem[] = [];
  let taxonomyOrder = 0;
  for (const item of taxonomy.items) {
    const preset = item.kind === "preset" ? presetById.get(item.id) : undefined;
    const containedTypes = item.kind === "device"
      ? [item.id as NodeType]
      : item.kind === "preset" && preset
        ? patchTypes(preset.patch)
        : item.kind === "rack"
          ? unique(rackPresets[item.id]!.map((entry) => entry.type))
          : [];
    const macroLabels = preset?.controls.map((control) => control.label) ?? [];
    const paramLabels = item.kind === "device"
      ? Object.values(manifests[item.id as NodeType].params).map((param) => param.label)
      : containedTypes.flatMap((type) => Object.values(manifests[type].params).map((param) => param.label));
    addItem(items, {
      key: taxonomyKey(item.kind, item.id),
      id: item.id,
      kind: item.kind,
      name: item.name,
      path: item.path,
      description: preset ? descriptionForPreset(preset) : undefined,
      taxonomyOrder: taxonomyOrder++,
      tags: taxonomyTags(item, containedTypes),
      aliases: unique([
        item.id,
        ...pathAliases(item.path),
        ...pathAliases(item.path.split("/").slice(0, 2).join("/")),
      ]),
      containedTypes,
      macroLabels,
      paramLabels,
      source: item.source,
      patch: preset?.patch,
      preset,
      hidden: item.kind === "device" && item.id === "output",
    });
  }
  for (const rack of extractRacks()) {
    const containedTypes = unique(rack.devices.map((entry) => entry.type));
    addItem(items, {
      key: `rack:${rack.id}`,
      id: rack.id,
      kind: "rack",
      name: rack.name,
      path: "Racks/From the presets",
      description: rack.description,
      taxonomyOrder: taxonomyOrder++,
      tags: {
        look: [],
        motion: [],
        behaviour: rack.tags.behaviour,
        cost: [rack.tags.cost],
        uses: unique([...rack.tags.uses, ...typeFamilies(containedTypes), ...containedTypes]),
        bank: ["From the presets"],
      },
      aliases: unique([rack.id, ...rack.sourcePresetIds]),
      containedTypes,
      macroLabels: [],
      paramLabels: containedTypes.flatMap((type) => Object.values(manifests[type].params).map((param) => param.label)),
      rackDevices: rack.devices.map((entry) => ({ type: entry.type, params: { ...entry.params } })),
    });
  }
  for (const rack of geminiRacks) {
    const containedTypes = unique(rack.devices.map((entry) => entry.type));
    const statusTags = rack.status === "candidate" ? ["candidate"] : [];
    addItem(items, {
      key: `rack:${rack.id}`,
      id: rack.id,
      kind: "rack",
      name: rack.name,
      path: "Racks/Gemini",
      description: rack.description,
      taxonomyOrder: taxonomyOrder++,
      tags: {
        look: [],
        motion: [],
        behaviour: rack.tags.behaviour,
        cost: [rack.tags.cost],
        uses: unique(["gemini", ...statusTags, ...rack.tags.uses, ...typeFamilies(containedTypes), ...containedTypes]),
        bank: ["Gemini"],
      },
      aliases: unique([rack.id, "gemini", ...statusTags, rack.source.run]),
      containedTypes,
      macroLabels: [],
      paramLabels: containedTypes.flatMap((type) => Object.values(manifests[type].params).map((param) => param.label)),
      rackDevices: rack.devices.map((entry) => ({ type: entry.type, params: { ...entry.params } })),
    });
  }
  for (const item of geminiInstruments) {
    const containedTypes = unique(item.devices.map((entry) => entry.type));
    const statusTags = item.status === "candidate" ? ["candidate"] : [];
    const preset: CatalogPreset = {
      id: item.id,
      bank: "Gemini",
      name: item.name,
      description: item.description,
      patch: item.patch!,
      duration: item.patch!.transport.loopSeconds,
      loopable: item.tags.behaviour.includes("loopable"),
      controls: item.controls!,
    };
    addItem(items, {
      key: `preset:${item.id}`,
      id: item.id,
      kind: "preset",
      name: item.name,
      path: "Instruments/Gemini",
      description: item.description,
      taxonomyOrder: taxonomyOrder++,
      tags: {
        look: [],
        motion: [],
        behaviour: item.tags.behaviour,
        cost: [item.tags.cost],
        uses: unique(["gemini", ...statusTags, ...item.tags.uses, ...typeFamilies(containedTypes), ...containedTypes]),
        bank: ["Gemini"],
      },
      aliases: unique([item.id, "gemini", ...statusTags, item.source.run]),
      containedTypes,
      macroLabels: item.controls?.map((control) => control.label) ?? [],
      paramLabels: containedTypes.flatMap((type) => Object.values(manifests[type].params).map((param) => param.label)),
      patch: item.patch,
      preset,
    });
  }
  for (const saved of options.saved ?? []) {
    const containedTypes = patchTypes(saved.patch);
    addItem(items, {
      key: `saved:${saved.id}`,
      id: saved.id,
      kind: "saved",
      name: saved.name,
      path: saved.recovery ? "Saved/Recovery" : "Saved",
      taxonomyOrder: taxonomyOrder++,
      tags: {
        look: [], motion: [],
        behaviour: patchHasHistory(saved.patch) ? ["history"] : [],
        cost: [],
        uses: unique([...typeFamilies(containedTypes), ...containedTypes]),
        bank: [],
      },
      aliases: [],
      containedTypes,
      macroLabels: [],
      paramLabels: containedTypes.flatMap((type) => Object.values(manifests[type].params).map((param) => param.label)),
      patch: saved.patch,
    });
  }
  if (options.patch) {
    for (const node of options.patch.nodes) {
      addItem(items, {
        key: `patch-node:${node.id}`,
        id: node.id,
        kind: "patch-node",
        name: manifests[node.type].label,
        path: "In this patch",
        taxonomyOrder: taxonomyOrder++,
        tags: { look: [], motion: [], behaviour: [], cost: [], uses: [node.type, ...familyValues(DEVICES[node.type].path)], bank: [] },
        aliases: [node.type],
        containedTypes: [node.type],
        macroLabels: [],
        paramLabels: Object.values(manifests[node.type].params).map((param) => param.label),
      });
      for (const [paramKey, param] of Object.entries(manifests[node.type].params)) {
        addItem(items, {
          key: `patch-param:${node.id}:${paramKey}`,
          id: `${node.id}:${paramKey}`,
          kind: "patch-param",
          name: `${param.label} - ${manifests[node.type].label}`,
          path: "In this patch",
          taxonomyOrder: taxonomyOrder++,
          tags: { look: [], motion: [], behaviour: [], cost: [], uses: [node.type, ...familyValues(DEVICES[node.type].path)], bank: [] },
          aliases: [node.type, paramKey],
          containedTypes: [node.type],
          macroLabels: [],
          paramLabels: [param.label],
        });
      }
    }
  }
  const useValues = unique(items.flatMap((item) => item.tags.uses)).sort();
  const bankValues = unique([
    ...taxonomy.facets.bank.values,
    ...items.flatMap((item) => item.tags.bank),
  ]).sort();
  const facets = {
    ...taxonomy.facets,
    uses: {
      ...FACETS.uses,
      values: useValues,
      labels: Object.fromEntries(useValues.map((value) => [value, (LABELS as Record<string, string>)[value] ?? value.split("/").pop() ?? value])),
    },
    bank: {
      ...taxonomy.facets.bank,
      values: bankValues,
      labels: Object.fromEntries(bankValues.map((value) => [value, (LABELS as Record<string, string>)[value] ?? value.split("/").pop() ?? value])),
    },
  };
  const visibleItems = items.filter((item) => !item.hidden && item.kind !== "place");
  return { items, visibleItems, taxonomy, aliases: ALIASES, facets };
}

export function sourceCount(items: readonly BrowserItem[]): number {
  return items.filter((item) => item.kind === "device" && isGenerator(item.id)).length;
}

export function visibleSearchItems(index: BrowserIndex): BrowserItem[] {
  return index.visibleItems;
}

export function frameInputCount(type: NodeType): number {
  return frameInputs(type).length;
}

export const shippedCatalogPresets = catalogPresets;
