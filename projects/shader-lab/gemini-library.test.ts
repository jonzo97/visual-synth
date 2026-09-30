import { describe, expect, it, vi } from "vitest";
import { createDefaultPatch, type Patch } from "./core";
import rawGeminiLibrary from "./library/gemini-racks.json";
import { geminiLibraryItems, loadGeminiLibrary } from "./gemini-library";

function rackItem(id = "gemini-test-rack") {
  return {
    id,
    name: "Test Rack",
    kind: "rack",
    status: "candidate",
    description: "A test rack.",
    tags: { behaviour: ["needs-input"], cost: "light", uses: ["fx.glow"] },
    devices: [{ type: "fx.glow", params: { amount: 0.5 } }],
    source: { tool: "gemini-foundry", run: "001-test", model: "test", metrics: { std: 1, diff: 1, changed: 1 } },
    added: "2026-09-25",
  };
}

function instrumentItem(patch: Patch = createDefaultPatch()) {
  return {
    id: "gemini-test-instrument",
    name: "Test Instrument",
    kind: "instrument",
    status: "curated",
    description: "A test instrument.",
    tags: { behaviour: ["loopable"], cost: "light", uses: ["silk"] },
    devices: [{ type: "silk", params: patch.nodes.find((node) => node.id === "silk")!.params }],
    patch,
    controls: [
      { node: "silk", param: "fold", label: "Fold" },
      { node: "silk", param: "density", label: "Density" },
      { node: "silk", param: "ratio", label: "Ratio" },
    ],
    source: { tool: "gemini-foundry", run: "002-test", model: "test", metrics: { std: 1, diff: 1, changed: 1 } },
    added: "2026-09-25",
  };
}

const library = (items: unknown[]) => ({ version: 1, items });

describe("Gemini library loader", () => {
  it("loads a good library", () => {
    const result = loadGeminiLibrary(library([rackItem(), instrumentItem()]), { warn: false });
    expect(result.warnings).toEqual([]);
    expect(result.items.map((item) => item.id)).toEqual(["gemini-test-instrument", "gemini-test-rack"]);
  });

  it("drops unknown device types", () => {
    const bad = rackItem();
    bad.devices = [{ type: "fx.nope", params: { amount: 0.5 } }];
    const result = loadGeminiLibrary(library([bad]), { warn: false });
    expect(result.items).toEqual([]);
    expect(result.warnings.join(" ")).toContain("unknown device type fx.nope");
  });

  it("clamps out-of-range params and reports them", () => {
    const bad = rackItem();
    bad.devices = [{ type: "fx.glow", params: { amount: 2 } }];
    const result = loadGeminiLibrary(library([bad]), { warn: false });
    expect(result.items[0]!.devices[0]!.params.amount).toBe(1);
    expect(result.warnings.join(" ")).toContain("clamped from 2 to 1");
  });

  it("drops bad controls", () => {
    const bad = instrumentItem();
    bad.controls[2] = { node: "silk", param: "fold", label: "Fold again" };
    const result = loadGeminiLibrary(library([bad]), { warn: false });
    expect(result.items).toEqual([]);
    expect(result.warnings.join(" ")).toContain("duplicate control target silk:fold");
  });

  it("drops duplicate ids", () => {
    const result = loadGeminiLibrary(library([rackItem(), rackItem()]), { warn: false });
    expect(result.items).toHaveLength(1);
    expect(result.warnings.join(" ")).toContain("duplicate id");
  });

  it("loads malformed files as an empty list with a warning", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = loadGeminiLibrary({ version: 1 }, { warn: true });
    expect(result.items).toEqual([]);
    expect(result.warnings).toContain("Malformed Gemini library; loaded 0 items");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("validates the committed file cleanly", () => {
    const result = loadGeminiLibrary(rawGeminiLibrary, { warn: false });
    expect(result.warnings).toEqual([]);
    expect(result.items).toHaveLength(rawGeminiLibrary.items.length);
    expect(geminiLibraryItems).toHaveLength(rawGeminiLibrary.items.length);
  });
});
