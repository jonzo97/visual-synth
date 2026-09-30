import { expect, it } from "vitest";
import {
  createDefaultPatch,
  createNode,
  isGenerator,
  isMixer,
  isStatefulGenerator,
  validatePatch,
  type Patch,
} from "./core";
import { generatorIds } from "./generators/catalog";
import { insertEffect, removeNode, replaceMixer, replaceSource } from "./graph-ops";
import { performanceBank } from "./performance-bank";
import { presetCatalog } from "./preset-catalog";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function frameProcessorCount(patch: Patch): number {
  return patch.nodes.filter((node) => node.type.startsWith("fx.") || isMixer(node.type)).length;
}

function effectCount(patch: Patch): number {
  return patch.nodes.filter((node) => node.type.startsWith("fx.")).length;
}

function hasOutputCable(patch: Patch): boolean {
  const output = patch.nodes.find((node) => node.type === "output")!;
  return patch.connections.some((edge) => edge.to.node === output.id && edge.to.port === "in");
}

it("inserts Droste Zoom before the Screen output in the default rack", () => {
  const input = deepFreeze(createDefaultPatch());
  const beforeOutput = input.connections.find((edge) => edge.to.node === "output")!;
  const previousLastEffect = beforeOutput.from.node;
  const { patch, report } = insertEffect(input, "fx.droste", "beforeOutput");
  const droste = patch.nodes.find((node) => node.type === "fx.droste")!;
  expect(report.addedNodeIds).toEqual([droste.id]);
  expect(patch.connections).toEqual(expect.arrayContaining([
    expect.objectContaining({ from: { node: previousLastEffect, port: "frame" }, to: { node: droste.id, port: "in" } }),
    expect.objectContaining({ from: { node: droste.id, port: "frame" }, to: { node: "output", port: "in" } }),
  ]));
  expect(droste.position.x).toBeGreaterThan(patch.nodes.find((node) => node.id === previousLastEffect)!.position.x);
  expect(droste.position.x).toBeLessThan(patch.nodes.find((node) => node.id === "output")!.position.x);
  expect(validatePatch(patch)).toEqual([]);
});

it("hot-swaps Silk to Quasicrystal while preserving the rack and shared palette", () => {
  const input = deepFreeze(createDefaultPatch());
  const { patch } = replaceSource(input, "silk", "quasicrystal");
  const source = patch.nodes.find((node) => node.type === "quasicrystal")!;
  expect(source.id).not.toBe("silk");
  expect(source.params.palette).toBe(input.nodes.find((node) => node.id === "silk")!.params.palette);
  expect(effectCount(patch)).toBe(3);
  expect(hasOutputCable(patch)).toBe(true);
  expect(validatePatch(patch)).toEqual([]);
});

it("strips simulation events when replacing a stateful source with a stateless generator", () => {
  const input = createDefaultPatch();
  input.nodes[0] = createNode("slime", "slime");
  input.connections = input.connections.map((edge) =>
    edge.from.node === "silk" ? { ...edge, from: { ...edge.from, node: "slime" } } : edge,
  );
  input.simulation = {
    tickHz: 60,
    warmupTicks: 120,
    events: [{ time: 0, node: "slime", kind: "reset" }],
  };
  deepFreeze(input);
  const { patch, report } = replaceSource(input, "slime", "silk");
  expect(patch.simulation?.events).toEqual([]);
  expect(report.messages.join(" ")).toContain("Dropped simulation events");
  expect(validatePatch(patch)).toEqual([]);
});

it("downgrades mixer4 to mixer by dropping c/d cables and reporting them", () => {
  const input: Patch = {
    version: 2,
    name: "Mixer downgrade",
    transport: { bpm: 120, loopSeconds: 12 },
    events: [],
    nodes: [
      createNode("silk", "a"),
      createNode("lattice", "b"),
      createNode("orbit", "c"),
      createNode("contour", "d"),
      createNode("mixer4", "mix"),
      createNode("output", "output"),
    ],
    connections: [
      { id: "a-mix", from: { node: "a", port: "frame" }, to: { node: "mix", port: "a" } },
      { id: "b-mix", from: { node: "b", port: "frame" }, to: { node: "mix", port: "b" } },
      { id: "c-mix", from: { node: "c", port: "frame" }, to: { node: "mix", port: "c" } },
      { id: "d-mix", from: { node: "d", port: "frame" }, to: { node: "mix", port: "d" } },
      { id: "mix-out", from: { node: "mix", port: "frame" }, to: { node: "output", port: "in" } },
    ],
  };
  deepFreeze(input);
  const { patch, report } = replaceMixer(input, "mix", "mixer");
  const mixer = patch.nodes.find((node) => node.type === "mixer")!;
  expect(patch.connections.some((edge) => edge.to.node === mixer.id && ["c", "d"].includes(edge.to.port))).toBe(false);
  expect(report.removedConnectionIds.sort()).toEqual(["c-mix", "d-mix"]);
  expect(report.messages.join(" ")).toContain("Dropped c cable");
  expect(validatePatch(patch)).toEqual([]);
});

it("removes a node by bypassing its frame input to its frame output", () => {
  const input = deepFreeze(createDefaultPatch());
  const crush = input.nodes.find((node) => node.type === "fx.crush")!;
  const { patch } = removeNode(input, crush.id);
  expect(patch.nodes.some((node) => node.id === crush.id)).toBe(false);
  expect(effectCount(patch)).toBe(2);
  expect(hasOutputCable(patch)).toBe(true);
  expect(validatePatch(patch)).toEqual([]);
});

it("reports readable device and frame-processor limit errors", () => {
  let processorLimit = createDefaultPatch();
  for (let i = 0; i < 9; i++) processorLimit = insertEffect(processorLimit, "fx.glow", "beforeOutput").patch;
  expect(frameProcessorCount(processorLimit)).toBe(12);
  expect(() => insertEffect(deepFreeze(processorLimit), "fx.glow", "beforeOutput")).toThrow("At most 12 frame processors");

  const deviceLimit = createDefaultPatch();
  for (let i = deviceLimit.nodes.length; i < 24; i++) deviceLimit.nodes.push(createNode("lfo", `lfo-${i}`));
  expect(() => insertEffect(deepFreeze(deviceLimit), "fx.glow", "beforeOutput")).toThrow("Patch requires at most 24 devices");
});

it("swaps every preset source for another generator without losing effects or output", () => {
  const presets = [...presetCatalog, ...performanceBank];
  expect(presets).toHaveLength(52);
  for (const preset of presets) {
    const sources = preset.patch.nodes.filter((node) => isGenerator(node.type));
    for (const source of sources) {
      const replacement = generatorIds.find((type) => type !== source.type && !isStatefulGenerator(type))!;
      const originalEffectCount = effectCount(preset.patch);
      const result = replaceSource(deepFreeze(structuredClone(preset.patch)), source.id, replacement).patch;
      expect(effectCount(result), `${preset.id}:${source.id}`).toBe(originalEffectCount);
      expect(hasOutputCable(result), `${preset.id}:${source.id}`).toBe(true);
      expect(validatePatch(result), `${preset.id}:${source.id}`).toEqual([]);
    }
  }
});

it("does not mutate inputs across graph operations", () => {
  const base = createDefaultPatch();
  const frozen = deepFreeze(structuredClone(base));
  insertEffect(frozen, "fx.droste", "beforeOutput");
  expect(frozen).toEqual(base);

  const swapped = replaceSource(frozen, "silk", "quasicrystal").patch;
  const source = swapped.nodes.find((node) => node.type === "quasicrystal")!;
  const frozenSwap = deepFreeze(structuredClone(swapped));
  replaceSource(frozenSwap, source.id, "silk");
  expect(frozenSwap).toEqual(swapped);

  const withMixer = performanceBank.find((preset) => preset.id === "crosscurrent")!.patch;
  const frozenMixer = deepFreeze(structuredClone(withMixer));
  replaceMixer(frozenMixer, "mix", "mixer");
  expect(frozenMixer).toEqual(withMixer);

  const crush = base.nodes.find((node) => node.type === "fx.crush")!;
  const frozenRemove = deepFreeze(structuredClone(base));
  removeNode(frozenRemove, crush.id);
  expect(frozenRemove).toEqual(base);
});
