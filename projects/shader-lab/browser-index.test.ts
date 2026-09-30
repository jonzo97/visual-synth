import { describe, expect, it } from "vitest";
import { createNode, isGenerator, manifests, type Patch } from "./core";
import { buildIndex, frameInputCount, sourceCount } from "./browser-index";
import rawGeminiLibrary from "./library/gemini-racks.json";
import { performanceBank } from "./performance-bank";
import { presetCatalog } from "./preset-catalog";
import { extractRacks } from "./rack-export";

const rawGeminiRacks = rawGeminiLibrary.items.filter((item) => item.kind === "rack");
const rawGeminiInstruments = rawGeminiLibrary.items.filter((item) => item.kind === "instrument");
const builtInPresetCount = presetCatalog.length + performanceBank.length;

function savedPatch(): Patch {
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

describe("browser index", () => {
  it("builds a flat index of devices, presets, racks and saved patches", () => {
    const index = buildIndex({ saved: [{ id: "night", name: "Night 01", patch: savedPatch() }] });
    expect(index.items.filter((item) => item.kind === "device")).toHaveLength(Object.keys(manifests).length);
    expect(index.items.filter((item) => item.kind === "preset")).toHaveLength(builtInPresetCount + rawGeminiInstruments.length);
    expect(index.items.filter((item) => item.kind === "rack")).toHaveLength(4 + extractRacks().length + rawGeminiRacks.length);
    expect(index.items.filter((item) => item.kind === "saved")).toHaveLength(1);
    expect(sourceCount(index.items)).toBe(Object.keys(manifests).filter(isGenerator).length);
  });

  it("derives contained device and uses tags for presets and racks", () => {
    const index = buildIndex();
    const escher = index.items.find((item) => item.id === "escher-garden")!;
    expect(escher.containedTypes).toEqual(expect.arrayContaining(["complex", "fx.droste"]));
    expect(escher.tags.uses).toEqual(expect.arrayContaining(["complex", "fx.droste", "Effects/Warp & Symmetry"]));
    const crushed = index.items.find((item) => item.id === "Crushed Reverie")!;
    expect(crushed.containedTypes).toEqual(expect.arrayContaining(["fx.reverb", "fx.crush"]));
    expect(crushed.tags.behaviour).toContain("history");
    const extracted = index.items.find((item) => item.path === "Racks/From the presets")!;
    expect(extracted.rackDevices?.length).toBeGreaterThan(0);
    expect(index.facets.bank.values).toContain("From the presets");
  });

  it("includes Gemini racks and instruments in their Bridge groups", () => {
    const index = buildIndex();
    const racks = index.items.filter((item) => item.path === "Racks/Gemini");
    const instruments = index.items.filter((item) => item.path === "Instruments/Gemini");
    expect(racks).toHaveLength(rawGeminiRacks.length);
    expect(instruments).toHaveLength(rawGeminiInstruments.length);
    expect(index.facets.bank.values).toContain("Gemini");
    expect(racks.every((item) => item.tags.uses.includes("gemini"))).toBe(true);
    expect(instruments.every((item) => item.tags.uses.includes("gemini"))).toBe(true);
    for (const raw of rawGeminiInstruments.filter((item) => item.status === "candidate")) {
      expect(instruments.find((item) => item.id === raw.id)?.tags.uses).toContain("candidate");
    }
  });

  it("can include current-patch nodes and parameters", () => {
    const source = createNode("slime", "source");
    const output = createNode("output", "output");
    const patch: Patch = {
      version: 2,
      name: "Loaded",
      nodes: [source, output],
      connections: [{ id: "wire", from: { node: "source", port: "frame" }, to: { node: "output", port: "in" } }],
      transport: { bpm: 120, loopSeconds: 12 },
      events: [],
    };
    const index = buildIndex({ patch });
    expect(index.items.some((item) => item.kind === "patch-node" && item.id === "source")).toBe(true);
    expect(index.items.some((item) => item.kind === "patch-param" && item.name.startsWith("Exposure"))).toBe(true);
  });

  it("keeps frame-input facts available to Bridge actions", () => {
    expect(frameInputCount("fx.feedback")).toBe(1);
    expect(frameInputCount("mixer4")).toBe(4);
    expect(frameInputCount("silk")).toBe(0);
  });
});
