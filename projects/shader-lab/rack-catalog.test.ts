import { describe, expect, it } from "vitest";
import { applyRackEntries, createNode, manifests, validatePatch, type NodeType, type Patch } from "./core";
import { insertRackAfter } from "./graph-ops";
import { buildDeviceCatalog, countDeviceUsage, type UsageSource } from "./rack-catalog";
import { extractRackCandidates, extractRacks, type ExtractedRack } from "./rack-export";
import breathingPhosphor from "./presets/breathing-phosphor.json";
import magneticReverie from "./presets/magnetic-reverie.json";

function serialPatch(name: string, id: string, devices: ExtractedRack["devices"]): Patch {
  const source = createNode("silk", "source");
  const output = createNode("output", "output");
  const nodes = [source, ...devices.map((entry, i) => {
    const node = createNode(entry.type, `${id}-fx-${i}`);
    Object.assign(node.params, entry.params);
    return node;
  }), output];
  const chain = nodes.map((node) => node.id);
  return {
    version: 2,
    name,
    nodes,
    connections: chain.slice(0, -1).map((from, i) => ({
      id: `${id}-wire-${i}`,
      from: { node: from, port: "frame" },
      to: { node: chain[i + 1]!, port: "in" },
    })),
    transport: { bpm: 120, loopSeconds: 12 },
    events: [],
  };
}

function basePatch(): Patch {
  return {
    version: 2,
    name: "Base",
    nodes: [createNode("silk", "source"), createNode("output", "output")],
    connections: [{ id: "wire", from: { node: "source", port: "frame" }, to: { node: "output", port: "in" } }],
    transport: { bpm: 120, loopSeconds: 12 },
    events: [],
  };
}

function fxOrder(patch: Patch): NodeType[] {
  const byId = new Map(patch.nodes.map((node) => [node.id, node]));
  const order: NodeType[] = [];
  let id = "source";
  const seen = new Set<string>();
  while (!seen.has(id)) {
    seen.add(id);
    const edge = patch.connections.find((candidate) => candidate.from.node === id && candidate.from.port === "frame");
    if (!edge) break;
    const next = byId.get(edge.to.node);
    if (!next || next.type === "output") break;
    if (next.type.startsWith("fx.")) order.push(next.type);
    id = next.id;
  }
  return order;
}

describe("rack catalog", () => {
  it("covers every registered device type", () => {
    const catalog = buildDeviceCatalog();
    expect(catalog.map((entry) => entry.type).sort()).toEqual(Object.keys(manifests).sort());
  });

  it("keeps every parameter default inside its bounds", () => {
    for (const device of buildDeviceCatalog()) {
      for (const param of device.params) {
        expect(param.min, `${device.type}.${param.key}`).toBeLessThanOrEqual(param.default);
        expect(param.default, `${device.type}.${param.key}`).toBeLessThanOrEqual(param.max);
      }
    }
  });

  it("counts usage against a hand count for two named presets", () => {
    const sources: UsageSource[] = [
      { id: "breathing-phosphor", name: "Breathing Phosphor", patch: breathingPhosphor as unknown as Patch },
      { id: "magnetic-reverie", name: "Magnetic Reverie", patch: magneticReverie as unknown as Patch },
    ];
    expect(countDeviceUsage(sources)).toMatchObject({
      silk: 2,
      output: 2,
      lfo: 2,
      "fx.reverb": 2,
      "fx.bayer": 1,
      "fx.glow": 1,
      "fx.crush": 1,
    });
  });

  it("inserts every extracted rack after a generator with graph ops and preserves fx order", () => {
    for (const rack of extractRacks()) {
      const result = insertRackAfter(basePatch(), rack.devices, "source");
      expect(validatePatch(result.patch), rack.id).toEqual([]);
      expect(fxOrder(result.patch), rack.id).toEqual(rack.devices.map((device) => device.type));
    }
  });

  it("deduplicates identical chains and merges their sources", () => {
    const devices: ExtractedRack["devices"] = [
      { type: "fx.glow", params: { amount: 0.25 } },
      { type: "fx.crush", params: { amount: 0.4 } },
    ];
    const presets = [
      { id: "one", bank: "Test", name: "One", description: "", patch: serialPatch("One", "one", devices), duration: 12, loopable: true, controls: [{ node: "source", param: "fold", label: "A" }, { node: "source", param: "density", label: "B" }, { node: "source", param: "palette", label: "C" }] },
      { id: "two", bank: "Test", name: "Two", description: "", patch: serialPatch("Two", "two", devices), duration: 12, loopable: true, controls: [{ node: "source", param: "fold", label: "A" }, { node: "source", param: "density", label: "B" }, { node: "source", param: "palette", label: "C" }] },
    ] as Parameters<typeof extractRacks>[0];
    expect(extractRackCandidates(presets)).toHaveLength(2);
    const racks = extractRacks(presets);
    expect(racks).toHaveLength(1);
    expect(racks[0]!.sourcePresetIds).toEqual(["one", "two"]);
  });

  it("applies extracted racks through the shared rack replacement core", () => {
    const rack = extractRacks()[0]!;
    const patch = applyRackEntries(basePatch(), rack.devices);
    expect(validatePatch(patch)).toEqual([]);
    expect(fxOrder(patch)).toEqual(rack.devices.map((device) => device.type));
  });
});
