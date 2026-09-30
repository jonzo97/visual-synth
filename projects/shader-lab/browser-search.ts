import { ALIASES, FACETS, KIND_STYLES, type FacetName } from "./browser-taxonomy";
import { type BrowserIndex, type BrowserItem, visibleSearchItems } from "./browser-index";

export interface FacetFilters {
  in?: Partial<Record<FacetName, readonly string[]>>;
  not?: Partial<Record<FacetName, readonly string[]>>;
}
export interface SearchOptions {
  query?: string;
  scope?: string;
  facets?: FacetFilters;
  includeEditorial?: boolean;
  limit?: number;
}
export interface SearchHit {
  item: BrowserItem;
  score: number;
  reasons: string[];
}
export interface FacetCount {
  value: string;
  count: number;
  disabled: boolean;
  selected: boolean;
  excluded: boolean;
}
export interface SearchResult {
  hits: SearchHit[];
  groups: { kind: string; hits: SearchHit[] }[];
  facetCounts: Record<FacetName, FacetCount[]>;
  suggestions: { facet: FacetName | "scope"; value: string; label: string; count: number }[];
  outside: number;
}

const TOKEN_RE = /[a-z0-9.]+/g;
const resultCache = new WeakMap<BrowserIndex, Map<string, SearchResult>>();
const KIND_ORDER: Record<string, number> = {
  "patch-param": -2,
  "patch-node": -1,
  device: 0,
  preset: 1,
  rack: 2,
  saved: 3,
  place: 4,
};
const normalize = (value: string): string =>
  value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
export const parseQuery = (query = ""): string[] => normalize(query).match(TOKEN_RE) ?? [];
const oneEdit = (a: string, b: string): boolean => {
  if (Math.abs(a.length - b.length) > 1) return false;
  let edits = 0;
  for (let i = 0, j = 0; i < a.length || j < b.length;) {
    if (a[i] === b[j]) { i++; j++; }
    else {
      edits++;
      if (edits > 1) return false;
      if (a.length > b.length) i++;
      else if (b.length > a.length) j++;
      else { i++; j++; }
    }
  }
  return true;
};
const aliasTargets = (token: string): readonly string[] => ALIASES[token] ?? [];

function labelFieldScore(
  fields: readonly { value: string; words: readonly string[] }[],
  token: string,
  score: number,
  reason: string,
): { score: number; reason: string } | undefined {
  return fields.some((candidate) => candidate.words.some((word) => word.startsWith(token)) || candidate.value.includes(token))
    ? { score, reason }
    : undefined;
}

function tokenScore(
  item: BrowserItem,
  token: string,
  includeEditorial: boolean,
  matchedTypes: ReadonlySet<string>,
): { score: number; reason: string } | undefined {
  const search = item.search;
  const technicalPrefix = token.includes(".");
  const shortTechnicalPrefix = technicalPrefix && token.length <= 3;
  const typePrefix = item.kind === "device" && normalize(item.id).startsWith(token) ? { score: 65, reason: "type" } : undefined;
  const direct = [
    search.name === token ? { score: 100, reason: "exact" } : undefined,
    search.words[0]?.startsWith(token) ? { score: 90, reason: "first-prefix" } : undefined,
    search.words.slice(1).some((word) => word.startsWith(token)) ? { score: 80, reason: "later-prefix" } : undefined,
    search.initials.startsWith(token) ? { score: 70, reason: "initials" } : undefined,
    search.aliases.some((alias) => alias.startsWith(token)) ? { score: 65, reason: "alias" } : undefined,
    typePrefix,
    search.name.includes(token) ? { score: 50, reason: "substring" } : undefined,
  ].filter((value): value is { score: number; reason: string } => Boolean(value));

  if (shortTechnicalPrefix) return typePrefix;

  const aliasRelated = aliasTargets(token);
  const family = !technicalPrefix && !(aliasRelated.length && item.kind !== "device") && (
    search.familyTags.includes(token) ||
    search.familyParts.some((part) => part.startsWith(token)) ||
    (includeEditorial && [...item.tags.look, ...item.tags.motion].some((value) => normalize(value).startsWith(token)))
  ) ? { score: 60, reason: "family/tag" } : undefined;
  const macro = labelFieldScore(search.macroLabels, token, 30, "macro");
  const param = labelFieldScore(search.paramLabels, token, item.kind === "patch-param" ? 80 : 30, "parameter");
  const bank = search.bankWords.some((part) => part.startsWith(token))
    ? { score: 45, reason: "bank" }
    : undefined;
  const description = !aliasRelated.length && search.descriptionWords.some((word) => word.startsWith(token))
    ? { score: 25, reason: "description" }
    : undefined;
  const alias = aliasRelated.length && (
    aliasRelated.some((target) => item.id === target ||
      (item.kind === "device" && (item.path === target || item.path.startsWith(`${target}/`))) ||
      item.tags.behaviour.includes(target))
  ) ? { score: 60, reason: "alias-related" } : undefined;
  let contained: { score: number; reason: string } | undefined;
  for (const target of matchedTypes) {
    if (item.kind === "device") continue;
    const primaryDeviceHit = search.containedTypes.includes(target);
    if (primaryDeviceHit) contained = { score: Math.max(contained?.score ?? 0, 45), reason: "contains-primary" };
  }
  for (const target of aliasRelated) {
    if (item.kind === "device" || matchedTypes.has(target)) continue;
    if (item.tags.uses.includes(target)) contained = { score: Math.max(contained?.score ?? 0, 40), reason: "contains" };
  }
  const candidates = [...direct, family, macro, param, bank, alias, contained, description]
    .filter((value): value is { score: number; reason: string } => Boolean(value));
  if (candidates.length) return candidates.sort((a, b) => b.score - a.score)[0];
  if (token.length >= 5 && search.typoWords.some((word) => oneEdit(token, word)))
    return { score: 40, reason: "typo" };
  return candidates.sort((a, b) => b.score - a.score)[0];
}

function queryHit(
  item: BrowserItem,
  tokens: readonly string[],
  includeEditorial: boolean,
  matchedTypesByToken: readonly ReadonlySet<string>[],
): SearchHit | undefined {
  if (!tokens.length) return { item, score: 1, reasons: [] };
  const matches = tokens.map((token, index) => tokenScore(item, token, includeEditorial, matchedTypesByToken[index]!));
  if (matches.some((match) => !match)) return undefined;
  const present = matches as { score: number; reason: string }[];
  const weakest = Math.min(...present.map((match) => match.score));
  const bonus = item.kind === "saved" ? 3 : item.kind === "patch-param" ? 12 : 0;
  return { item, score: weakest + bonus, reasons: present.map((match) => match.reason) };
}

function passesScope(item: BrowserItem, scope?: string): boolean {
  if (!scope || scope === "All") return true;
  return item.path === scope || item.path.startsWith(`${scope}/`) || item.kind === scope.toLowerCase();
}
function passesScopedRackSearch(item: BrowserItem, tokens: readonly string[], scope?: string): boolean {
  if (!tokens.length || item.path !== "Racks/From the presets") return true;
  return !!scope && (scope === "Racks" || scope.startsWith("Racks/"));
}
function passesFacets(item: BrowserItem, facets: FacetFilters | undefined, except?: FacetName): boolean {
  for (const [facet, values] of Object.entries(facets?.in ?? {}) as [FacetName, readonly string[]][]) {
    if (facet === except || !values.length) continue;
    if (!values.some((value) => item.tags[facet].includes(value))) return false;
  }
  for (const [facet, values] of Object.entries(facets?.not ?? {}) as [FacetName, readonly string[]][]) {
    if (facet === except || !values.length) continue;
    if (values.some((value) => item.tags[facet].includes(value))) return false;
  }
  return true;
}
function isCandidateItem(item: BrowserItem): boolean {
  return Object.values(item.tags).some((values) => values.includes("candidate"));
}
function compareHits(a: SearchHit, b: SearchHit): number {
  return Number(isCandidateItem(a.item)) - Number(isCandidateItem(b.item)) ||
    b.score - a.score ||
    (KIND_ORDER[a.item.kind] ?? KIND_STYLES[a.item.kind as keyof typeof KIND_STYLES]?.order ?? 9) -
      (KIND_ORDER[b.item.kind] ?? KIND_STYLES[b.item.kind as keyof typeof KIND_STYLES]?.order ?? 9) ||
    a.item.taxonomyOrder - b.item.taxonomyOrder ||
    a.item.name.localeCompare(b.item.name);
}

function countsForFacet(item: BrowserItem, facet: FacetName, value: string, tokens: readonly string[]): boolean {
  if (!item.tags[facet].includes(value)) return false;
  if (facet === "behaviour" && value === "history" && tokens.includes("feedback") && item.kind === "preset") {
    const types = item.search.containedTypes;
    if (types.includes("fx.delay") && !types.some((type) => type === "fx.feedback" || type === "fx.chrono" || type === "fx.reverb"))
      return false;
  }
  return true;
}

function matchedTypesForTokens(index: BrowserIndex, tokens: readonly string[]): ReadonlySet<string>[] {
  const deviceIds = index.items
    .filter((item) => item.kind === "device")
    .map((item) => normalize(item.id));
  return tokens.map((token) => {
    const aliasDeviceTargets = aliasTargets(token)
      .map(normalize)
      .filter((target) => deviceIds.includes(target));
    return new Set([...deviceIds.filter((id) => id.startsWith(token)), ...aliasDeviceTargets]);
  });
}

export function search(index: BrowserIndex, options: SearchOptions = {}): SearchResult {
  const cacheKey = JSON.stringify({
    query: options.query ?? "",
    scope: options.scope ?? "",
    facets: options.facets ?? null,
    includeEditorial: options.includeEditorial ?? false,
    limit: options.limit ?? null,
  });
  let cache = resultCache.get(index);
  if (!cache) {
    cache = new Map();
    resultCache.set(index, cache);
  } else {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }
  const tokens = parseQuery(options.query);
  const includeEditorial = options.includeEditorial ?? false;
  const matchedTypesByToken = matchedTypesForTokens(index, tokens);
  const scoped = visibleSearchItems(index)
    .filter((item) => passesScope(item, options.scope))
    .filter((item) => passesScopedRackSearch(item, tokens, options.scope))
    .map((item) => queryHit(item, tokens, includeEditorial, matchedTypesByToken))
    .filter((hit): hit is SearchHit => Boolean(hit));
  const hits = scoped
    .filter((hit) => passesFacets(hit.item, options.facets))
    .sort(compareHits);
  const limited = hits.slice(0, options.limit ?? hits.length);
  const groups = [...new Set(limited.map((hit) => hit.item.kind))]
    .map((kind) => ({ kind, hits: limited.filter((hit) => hit.item.kind === kind) }))
    .sort((a, b) => compareHits(a.hits[0]!, b.hits[0]!));
  const facetCounts = Object.fromEntries((Object.keys(FACETS) as FacetName[]).map((facet) => {
    const values = index.facets[facet].values;
    const selected = new Set(options.facets?.in?.[facet] ?? []);
    const excluded = new Set(options.facets?.not?.[facet] ?? []);
    const scopedForFacet = scoped
      .map((hit) => hit.item)
      .filter((item) => passesFacets(item, options.facets, facet));
    return [facet, values.map((value) => {
      let count = 0;
      for (const item of scopedForFacet) if (countsForFacet(item, facet, value, tokens)) count++;
      return { value, count, disabled: count === 0, selected: selected.has(value), excluded: excluded.has(value) };
    })];
  })) as Record<FacetName, FacetCount[]>;
  const suggestions = (Object.keys(facetCounts) as FacetName[]).flatMap((facet) =>
    facetCounts[facet]
      .filter((entry) => entry.count > 0 && !entry.selected && (!index.facets[facet].hiddenByDefault || includeEditorial))
      .slice(0, 2)
      .map((entry) => ({ facet, value: entry.value, label: index.facets[facet].labels[entry.value] ?? entry.value, count: entry.count })));
  const allScopeHits = options.scope && options.scope !== "All"
    ? visibleSearchItems(index)
      .filter((item) => passesScopedRackSearch(item, tokens, options.scope))
      .map((item) => queryHit(item, tokens, includeEditorial, matchedTypesByToken))
    .filter((hit): hit is SearchHit => Boolean(hit))
      .filter((hit) => passesFacets(hit.item, options.facets))
      .length
    : hits.length;
  const result = { hits: limited, groups, facetCounts, suggestions, outside: Math.max(0, allScopeHits - hits.length) };
  cache.set(cacheKey, result);
  return result;
}
