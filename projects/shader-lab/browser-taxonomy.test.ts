import { describe, expect, it } from "vitest";
import { manifests, type NodeType } from "./core";
import { performanceBank } from "./performance-bank";
import { isLoopablePreset, presetCatalog } from "./preset-catalog";
import {
  BEHAVIOUR,
  buildTaxonomy,
  catalogPresets,
  COST,
  DEVICES,
  deriveDevice,
  LOOK,
  MOTION,
} from "./browser-taxonomy";

const taxonomy = buildTaxonomy();
const presets = catalogPresets();
const vocabulary = {
  look: new Set(LOOK),
  motion: new Set(MOTION),
  behaviour: new Set(BEHAVIOUR),
  cost: new Set(COST),
};

describe("browser taxonomy", () => {
  it("classifies every NodeType under exactly one parent", () => {
    const deviceItems = taxonomy.items.filter((item) => item.kind === "device");
    expect(deviceItems).toHaveLength(Object.keys(manifests).length);
    for (const type of Object.keys(manifests) as NodeType[]) {
      const matches = deviceItems.filter((item) => item.id === type);
      expect(matches, type).toHaveLength(1);
      expect(matches[0]!.path.length, type).toBeGreaterThan(0);
    }
    for (const path of ["Sources", "Effects", "Modulators", "Utilities"]) {
      const expected = Object.values(DEVICES).filter((device) => device.path === path || device.path.startsWith(`${path}/`)).length;
      expect(taxonomy.hierarchy.find((node) => node.path === path)!.count).toBe(expected);
    }
  });

  it("classifies all shipped presets and racks", () => {
    expect(presetCatalog).toHaveLength(23);
    expect(performanceBank).toHaveLength(29);
    expect(presets).toHaveLength(52);
    expect(taxonomy.items.filter((item) => item.kind === "preset")).toHaveLength(52);
    expect(taxonomy.items.filter((item) => item.kind === "rack")).toHaveLength(4);
    expect(taxonomy.hierarchy.find((node) => node.path === "Compositions")!.count).toBe(40);
    expect(taxonomy.hierarchy.find((node) => node.path === "Instruments")!.count).toBe(12);
    expect(taxonomy.hierarchy.find((node) => node.path === "Racks")!.count).toBe(4);
  });

  it("keeps the public vocabulary closed", () => {
    for (const item of taxonomy.items) {
      for (const look of item.tags.look) expect(vocabulary.look.has(look), `${item.id}:${look}`).toBe(true);
      for (const motion of item.tags.motion) expect(vocabulary.motion.has(motion), `${item.id}:${motion}`).toBe(true);
      for (const behaviour of item.derivedTags.behaviour)
        expect(vocabulary.behaviour.has(behaviour), `${item.id}:${behaviour}`).toBe(true);
      expect(vocabulary.cost.has(item.derivedTags.cost), `${item.id}:${item.derivedTags.cost}`).toBe(true);
    }
  });

  it("marks editorial Look and Motion hidden while exposing derived facets by default", () => {
    expect(taxonomy.facets.look.editorial).toBe(true);
    expect(taxonomy.facets.look.hiddenByDefault).toBe(true);
    expect(taxonomy.facets.motion.editorial).toBe(true);
    expect(taxonomy.facets.motion.hiddenByDefault).toBe(true);
    for (const facet of ["behaviour", "cost", "uses", "bank"] as const) {
      expect(taxonomy.facets[facet].hiddenByDefault, facet).toBe(false);
    }
  });

  it("matches loopable metadata and keeps Video non-loopable", () => {
    for (const preset of presets) {
      const item = taxonomy.items.find((candidate) => candidate.kind === "preset" && candidate.id === preset.id)!;
      expect(item.derivedTags.behaviour.includes("loopable"), preset.id).toBe(isLoopablePreset(preset.patch));
    }
    expect(deriveDevice("video").behaviour).not.toContain("loopable");
  });

  it("matches the accepted derived counts", () => {
    const presetItems = taxonomy.items.filter((item) => item.kind === "preset");
    expect(presetItems.filter((item) => item.derivedTags.behaviour.includes("history"))).toHaveLength(16);
    expect(presetItems.filter((item) => item.derivedTags.cost === "heavy")).toHaveLength(5);
  });
});
