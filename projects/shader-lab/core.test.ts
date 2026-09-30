import { describe, expect, it } from "vitest";
import {
  applyRack,
  createDefaultPatch,
  createNode,
  frameInputs,
  isEffect,
  isGenerator,
  isStatefulGenerator,
  migratePatch,
  parsePatch,
  portType,
  validatePatch,
  type Patch,
} from "./core";
import magnetic from "./presets/magnetic-reverie.json";

function simulationPatch(): Patch {
  const patch = migratePatch(createDefaultPatch());
  patch.nodes[0] = createNode("rules", "silk");
  patch.simulation!.events = [
    { time: 0, node: "silk", kind: "reset" },
    { time: 1, node: "silk", kind: "inject", x: 0.25, y: 0.75, radius: 0.1, amount: 0.5 },
  ];
  return patch;
}

describe("portable v2 patch imports", () => {
  it("upgrades a checked copy without changing the legacy recipe or its parameters", () => {
    const original = structuredClone(magnetic);
    const patch = migratePatch(magnetic);
    expect(patch).toEqual({ ...original, version: 2, simulation: { tickHz: 60, warmupTicks: 0, events: [] } });
    expect(validatePatch(patch)).toEqual([]);
    expect(magnetic).toEqual(original);
    patch.nodes[0]!.params.palette = 2;
    expect(magnetic).toEqual(original);
    expect(createDefaultPatch().version).toBe(1);
  });

  it("preserves existing v2 simulation and exploration data through JSON imports", () => {
    const patch = simulationPatch();
    patch.simulation!.warmupTicks = 120;
    patch.exploration = { version: 1, seed: "legacy-seed", scope: "whole", generatedNodeIds: ["silk"] };
    const result = parsePatch(JSON.stringify(patch));
    expect(result).toEqual(patch);
    result.simulation!.events[0]!.time = 0.5;
    expect(patch.simulation!.events[0]!.time).toBe(0);
  });

  it("accepts v2 without simulation settings and supplies independent defaults", () => {
    const original = { ...createDefaultPatch(), version: 2 };
    expect(validatePatch(original)).toEqual([]);
    const a = migratePatch(original), b = migratePatch(original);
    a.simulation!.warmupTicks = 60;
    expect(b.simulation).toEqual({ tickHz: 60, warmupTicks: 0, events: [] });
    expect(original).not.toHaveProperty("simulation");
  });

  it("preserves Wander v2 recipe metadata without reinterpreting legacy exploration", () => {
    const patch = migratePatch(createDefaultPatch());
    patch.exploration = {
      version: 2,
      algorithm: "wander-v2",
      seed: "saved-seed",
      family: "Pulse + folding",
      sourceLocked: true,
      generatedNodeIds: ["silk"],
    };
    expect(validatePatch(patch)).toEqual([]);
    expect(parsePatch(JSON.stringify(patch))).toEqual(patch);
    const legacy = { ...patch, exploration: { version: 1, seed: "saved-seed", scope: "effects", generatedNodeIds: ["silk"] } };
    expect(migratePatch(legacy).exploration).toEqual(legacy.exploration);
  });

  it.each([
    { algorithm: "unknown" },
    { seed: " " },
    { seed: "s".repeat(81) },
    { family: " " },
    { family: "f".repeat(81) },
    { sourceLocked: 1 },
    { generatedNodeIds: ["silk", "silk"] },
    { generatedNodeIds: ["__proto__"] },
    { generatedNodeIds: Array.from({ length: 25 }, (_, i) => `node-${i}`) },
  ])("rejects invalid Wander v2 metadata (%j)", (invalid) => {
    const patch = createDefaultPatch();
    const exploration = { version: 2, algorithm: "wander-v2", seed: "saved-seed", family: "pulse", sourceLocked: false, generatedNodeIds: ["silk"], ...invalid };
    expect(validatePatch({ ...patch, exploration })).toContain("Invalid exploration metadata");
  });

  it("rejects malformed imports while leaving the original data intact", () => {
    const invalid = simulationPatch();
    invalid.simulation!.warmupTicks = 3601;
    const snapshot = structuredClone(invalid);
    expect(() => migratePatch(invalid)).toThrow("warmupTicks");
    expect(invalid).toEqual(snapshot);
    expect(() => parsePatch("{bad json")).toThrow();
    expect(() => parsePatch(JSON.stringify({ ...invalid, version: 3 }))).toThrow("Unsupported patch version");
  });

  it.each([
    null,
    { tickHz: 30, warmupTicks: 0, events: [] },
    { tickHz: 60, warmupTicks: -1, events: [] },
    { tickHz: 60, warmupTicks: 0.5, events: [] },
    { tickHz: 60, warmupTicks: Infinity, events: [] },
    { tickHz: 60, warmupTicks: 3601, events: [] },
    { tickHz: 60, warmupTicks: 0, events: null },
  ])("rejects invalid simulation settings (%j)", (simulation) => {
    expect(validatePatch({ ...simulationPatch(), simulation }).length).toBeGreaterThan(0);
  });

  it("accepts boundary times, normalized coordinates, and the maximum warmup", () => {
    const patch = simulationPatch();
    patch.simulation!.warmupTicks = 3600;
    patch.simulation!.events.push({ time: 86400, node: "silk", kind: "inject", x: 0, y: 1, radius: 1, amount: 0 });
    expect(validatePatch(patch)).toEqual([]);
  });

  it.each([
    null,
    { time: -1, node: "silk", kind: "reset" },
    { time: 86401, node: "silk", kind: "reset" },
    { time: NaN, node: "silk", kind: "reset" },
    { time: 0, node: "missing", kind: "reset" },
    { time: 0, node: "output", kind: "reset" },
    { time: 0, node: "silk", kind: "unknown" },
    { time: 0, node: "silk", kind: "inject" },
    { time: 0, node: "silk", kind: "inject", x: 0.5 },
    { time: 0, node: "silk", kind: "inject", x: 0.5, y: 2 },
    { time: 0, node: "silk", kind: "inject", x: NaN, y: 0.5 },
    { time: 0, node: "silk", kind: "inject", x: 0.5, y: 0.5, radius: 0 },
    { time: 0, node: "silk", kind: "inject", x: 0.5, y: 0.5, amount: 2 },
  ])("rejects malformed or invalid simulation events (%j)", (event) => {
    const patch = simulationPatch();
    expect(validatePatch({ ...patch, simulation: { ...patch.simulation, events: [event] } })).toContain("Invalid simulation event");
  });
});

describe("generator and effect interoperability", () => {
  it.each(["pulse", "cells", "resonance", "rules", "chemical"] as const)("registers %s with valid default parameters", (type) => {
    const patch = createDefaultPatch();
    patch.nodes[0] = createNode(type, "silk");
    expect(isGenerator(type)).toBe(true);
    expect(isStatefulGenerator(type)).toBe(type === "rules" || type === "chemical");
    expect(portType(patch.nodes[0], "frame", "out")).toBe("frame");
    expect(validatePatch(patch)).toEqual([]);
  });

  it("declares extra effect inputs without adding ports to legacy devices", () => {
    expect(frameInputs("fx.warp")).toEqual(["in", "field"]);
    expect(frameInputs(createNode("fx.mask"))).toEqual(["in", "b", "mask"]);
    expect(frameInputs("fx.delay")).toEqual(["in"]);
    expect(frameInputs("mixer")).toEqual(["a", "b"]);
    expect(frameInputs("output")).toEqual(["in"]);
    expect(frameInputs("rules")).toEqual([]);
    expect(portType(createNode("fx.warp"), "field", "in")).toBe("frame");
    expect(portType(createNode("fx.mask"), "b", "in")).toBe("frame");
    expect(portType(createNode("fx.mask"), "mask", "in")).toBe("frame");
    expect(portType(createNode("fx.glow"), "field", "in")).toBeUndefined();
    expect(portType(createNode("fx.warp"), "field", "out")).toBeUndefined();
  });

  it("reports a frame output for lab effects", () => {
    const node = createNode("lab.ripple");
    expect(isEffect(node.type)).toBe(true);
    expect(frameInputs(node)).toEqual(["in"]);
    expect(portType(node, "frame", "out")).toBe("frame");
  });

  it("validates all mask frame inputs in a multi-source graph", () => {
    const patch: Patch = {
      version: 2,
      name: "Mask test",
      nodes: [createNode("pulse", "a"), createNode("cells", "b"), createNode("resonance", "mask"), createNode("fx.mask", "mix"), createNode("output", "output")],
      connections: [
        ...(["in", "b", "mask"] as const).map((port, index) => ({ id: `input-${index}`, from: { node: ["a", "b", "mask"][index]!, port: "frame" }, to: { node: "mix", port } })),
        { id: "screen", from: { node: "mix", port: "frame" }, to: { node: "output", port: "in" } },
      ],
      transport: { bpm: 120, loopSeconds: 12 },
      events: [],
    };
    expect(validatePatch(patch)).toEqual([]);
    const original = structuredClone(patch);
    expect(() => applyRack(patch, "Dream Tape")).toThrow("single serial");
    expect(patch).toEqual(original);
  });

  it("refuses single-source branching and preserves every original node and cable", () => {
    const patch = createDefaultPatch();
    const processor = patch.nodes.find((node) => node.type === "fx.crush")!;
    Object.assign(processor, createNode("fx.warp", processor.id));
    patch.connections.push({ id: "field", from: { node: "silk", port: "frame" }, to: { node: processor.id, port: "field" } });
    expect(validatePatch(patch)).toEqual([]);
    const original = structuredClone(patch);
    expect(() => applyRack(patch, "Dream Tape")).toThrow("graph was preserved");
    expect(patch).toEqual(original);
  });

  it("refuses to discard disconnected processors or a second generator", () => {
    for (const type of ["fx.fold", "cells"] as const) {
      const patch = createDefaultPatch();
      patch.nodes.push(createNode(type, "orphan"));
      const original = structuredClone(patch);
      expect(() => applyRack(patch, "Dream Tape")).toThrow("single serial");
      expect(patch).toEqual(original);
    }
  });
});

describe("added device parameters", () => {
  it("loads Feedback Chamber patches saved before hue/lighten/pivot existed, with defaults", () => {
    const patch = createDefaultPatch();
    const fb = createNode("fx.feedback", "old-feedback");
    for (const key of ["hue", "lighten", "centerX", "centerY"]) delete fb.params[key];
    patch.nodes.push(fb);
    const raw = structuredClone(patch);
    expect(validatePatch(raw).join(" ")).toMatch(/invalid hue/);
    const migrated = migratePatch(raw);
    const params = migrated.nodes.find((n) => n.id === "old-feedback")!.params;
    expect([params.hue, params.lighten, params.centerX, params.centerY]).toEqual([0, 0, 0.5, 0.5]);
    expect(raw.nodes.at(-1)!.params.hue).toBeUndefined(); // the original is not mutated
  });
});
