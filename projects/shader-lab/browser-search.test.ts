import { describe, expect, it } from "vitest";
import { FACETS, type FacetName } from "./browser-taxonomy";
import { createNode, type Patch } from "./core";
import { buildIndex, type BrowserIndex, type BrowserItem } from "./browser-index";
import { search, type SearchHit } from "./browser-search";

const names = (index: BrowserIndex, query: string, includeEditorial = false) =>
  search(index, { query, includeEditorial }).hits.map((hit) => hit.item.name);
const nonCandidateHits = (hits: readonly SearchHit[]) =>
  hits.filter((hit) => !isCandidateItem(hit.item));
const nonCandidateNames = (index: BrowserIndex, query: string, includeEditorial = false) =>
  nonCandidateHits(search(index, { query, includeEditorial }).hits).map((hit) => hit.item.name);
const keys = (index: BrowserIndex, query: string, includeEditorial = false) =>
  search(index, { query, includeEditorial }).hits.map((hit) => hit.item.key);

const normalize = (value: string): string =>
  value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const words = (value: string): string[] => normalize(value).match(/[a-z0-9.]+/g) ?? [];
const emptyTags = (candidate = false): BrowserItem["tags"] => ({
  look: [],
  motion: [],
  behaviour: candidate ? ["candidate"] : [],
  cost: [],
  uses: [],
  bank: [],
});
const emptyFacets = Object.fromEntries((Object.keys(FACETS) as FacetName[]).map((facet) => [
  facet,
  { ...FACETS[facet], values: [], labels: {} },
])) as unknown as BrowserIndex["facets"];

function isCandidateItem(item: BrowserItem): boolean {
  return Object.values(item.tags).some((values) => values.includes("candidate"));
}

function testItem(name: string, candidate: boolean, searchFields: Partial<BrowserItem["search"]> = {}): BrowserItem {
  const searchWords = words(name);
  return {
    key: name,
    id: name,
    kind: "preset",
    name,
    path: "Test",
    taxonomyOrder: candidate ? 0 : 1,
    tags: emptyTags(candidate),
    aliases: [],
    containedTypes: [],
    macroLabels: [],
    paramLabels: [],
    search: {
      name: normalize(name),
      words: searchWords,
      initials: searchWords.map((word) => word[0]).join(""),
      aliases: [],
      familyTags: [],
      familyParts: [],
      bankWords: [],
      macroLabels: [],
      paramLabels: [],
      descriptionWords: [],
      typoWords: [],
      containedTypes: [],
      ...searchFields,
    },
  };
}

function testIndex(items: BrowserItem[]): BrowserIndex {
  return {
    items,
    visibleItems: items,
    taxonomy: {} as BrowserIndex["taxonomy"],
    aliases: {},
    facets: emptyFacets,
  };
}

function slimePatch(): Patch {
  const source = createNode("slime", "source");
  const output = createNode("output", "output");
  return {
    version: 2,
    name: "Slime Mold Wars",
    nodes: [source, output],
    connections: [{ id: "wire", from: { node: "source", port: "frame" }, to: { node: "output", port: "in" } }],
    transport: { bpm: 120, loopSeconds: 12 },
    events: [],
  };
}
function nightPatch(): Patch {
  const source = createNode("silk", "silk");
  const output = createNode("output", "output");
  return {
    version: 2,
    name: "Night 01",
    nodes: [source, output],
    connections: [{ id: "wire", from: { node: "silk", port: "frame" }, to: { node: "output", port: "in" } }],
    transport: { bpm: 120, loopSeconds: 12 },
    events: [],
  };
}

describe("browser search", () => {
  it("passes the golden direct queries", () => {
    const index = buildIndex();
    expect(names(index, "dro")[0]).toBe("Droste Zoom");
    expect(names(index, "qua").slice(0, 2)).toEqual(["Quasicrystal", "Neon Quartet"]);
    expect(nonCandidateNames(index, "ebru")).toEqual(["Acid Ebru"]);
    expect(nonCandidateNames(index, "fx.")).toHaveLength(16);
    expect(nonCandidateNames(index, "fx.").every((name) => index.items.find((item) => item.name === name)!.id.startsWith("fx."))).toBe(true);
    expect(names(index, "Generators")[0]).toBe("Video");
    expect(names(index, "Reverie")).toEqual(expect.arrayContaining(["Magnetic Reverie", "Crushed Reverie"]));
  });

  it("returns the accepted feedback set and order", () => {
    const index = buildIndex();
    const hits = search(index, { query: "feedback" }).hits;
    const stableHits = nonCandidateHits(hits);
    expect(stableHits).toHaveLength(23);
    expect(stableHits.filter((hit) => hit.item.kind === "device").map((hit) => hit.item.name))
      .toEqual(["Feedback Chamber", "Chrono Loom", "Delay", "Impulse reverb"]);
    expect(stableHits.filter((hit) => hit.item.kind === "preset")).toHaveLength(16);
    expect(stableHits.filter((hit) => hit.item.kind === "rack").map((hit) => hit.item.name))
      .toEqual(["Crushed Reverie", "Dream Tape", "Broken Broadcast"]);
    expect(stableHits.slice(4, 9).map((hit) => hit.item.name))
      .toEqual(["Ghost Membrane", "Memory Reef", "Memory Carousel", "Tesseract Afterimage", "Hue Tunnel"]);
  });

  it("passes alias and contextual golden queries", () => {
    const sim = nonCandidateHits(search(buildIndex(), { query: "sim" }).hits);
    expect(sim.filter((hit) => hit.item.kind === "device").map((hit) => hit.item.name))
      .toEqual(["Rule Garden", "Chemical Garden", "Slime Mold Wars", "Ink in Water"]);
    expect(sim.filter((hit) => hit.item.kind === "preset")).toHaveLength(9);
    expect(search(buildIndex(), { query: "fractal" }).hits[0]!.item.path).toMatch(/^Sources\/Fractals & 3D/);
    expect(search(buildIndex(), { query: "glitch" }).hits.some((hit) => hit.item.path === "Effects/Lo-fi & Glitch")).toBe(true);
    const withPatch = buildIndex({ patch: slimePatch() });
    expect(search(withPatch, { query: "expo" }).hits.slice(0, 2).map((hit) => hit.item.kind))
      .toEqual(["patch-param", "device"]);
    const withSaved = buildIndex({ saved: [{ id: "night", name: "Night 01", patch: nightPatch() }] });
    expect(search(withSaved, { query: "nig" }).hits[0]!.item.kind).toBe("saved");
    const instr = search(buildIndex(), { query: "instr" });
    expect(instr.suggestions).toContainEqual(expect.objectContaining({ facet: "bank", value: "Instruments", count: 12 }));
  });

  it("does not match hidden editorial tags unless requested", () => {
    const index = buildIndex();
    expect(keys(index, "psychedelic")).toHaveLength(0);
    expect(keys(index, "psychedelic", true).length).toBeGreaterThan(0);
  });

  it("implements OR within a facet, AND across facets, and NOT exclusions", () => {
    const index = buildIndex();
    const orHits = search(index, { facets: { in: { behaviour: ["history", "stateful"] } } }).hits;
    expect(orHits.some((hit) => hit.item.name === "Hue Tunnel")).toBe(true);
    expect(orHits.some((hit) => hit.item.name === "Coral Bloom")).toBe(true);
    const andHits = search(index, { facets: { in: { behaviour: ["history"], bank: ["Geometry Studies"] } } }).hits;
    expect(andHits.map((hit) => hit.item.name)).toEqual(expect.arrayContaining(["Tesseract Afterimage", "Hue Tunnel"]));
    expect(andHits.some((hit) => hit.item.name === "Ghost Membrane")).toBe(false);
    const notHits = search(index, { query: "feedback", facets: { not: { bank: ["Geometry Studies"] } } }).hits;
    expect(notHits.some((hit) => hit.item.name === "Hue Tunnel")).toBe(false);
    expect(notHits.some((hit) => hit.item.name === "Feedback Chamber")).toBe(true);
  });

  it("computes facet counts against the query and other facets", () => {
    const result = search(buildIndex(), { query: "feedback", facets: { in: { bank: ["Silk Studies"] } } });
    expect(result.facetCounts.behaviour.find((entry) => entry.value === "history")!.count).toBe(2);
    expect(result.facetCounts.cost.find((entry) => entry.value === "heavy")!.disabled).toBe(true);
  });

  it("reports the accepted loopable preset split", () => {
    const loopable = search(buildIndex(), { facets: { in: { behaviour: ["loopable"] } } }).hits
      .filter((hit) => !isCandidateItem(hit.item))
      .filter((hit) => hit.item.kind === "preset");
    expect(loopable).toHaveLength(31);
    expect(loopable.filter((hit) => hit.item.path.startsWith("Compositions"))).toHaveLength(20);
    expect(loopable.filter((hit) => hit.item.path.startsWith("Instruments"))).toHaveLength(11);
  });

  it("ranks candidates below non-candidates even with a stronger raw score", () => {
    const index = testIndex([
      testItem("Quartz Candidate", true),
      testItem("Plain Instrument", false, { descriptionWords: ["quartz"] }),
    ]);
    const result = search(index, { query: "qua" });
    expect(result.hits.map((hit) => [hit.item.name, hit.score])).toEqual([
      ["Plain Instrument", 25],
      ["Quartz Candidate", 90],
    ]);
  });

  it("keeps candidates searchable by candidate tag or alias", () => {
    const hits = search(buildIndex(), { query: "candidate" }).hits;
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => isCandidateItem(hit.item))).toBe(true);
  });

  it("stays under the per-keystroke budget in Node", () => {
    const index = buildIndex({ saved: Array.from({ length: 60 }, (_, i) => ({ id: `saved-${i}`, name: `Night ${i}`, patch: nightPatch() })) });
    const started = performance.now();
    for (let i = 0; i < 500; i++) search(index, { query: ["f", "fe", "fee", "feed", "feedback"][i % 5]! });
    const perSearch = (performance.now() - started) / 500;
    expect(perSearch).toBeLessThan(2);
  });
});
