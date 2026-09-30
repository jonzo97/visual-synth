import { describe, it, expect } from "vitest";
import {
  applyRack,
  createDefaultPatch,
  createNode,
  evaluateParameters,
  savePatch,
  topologicalNodes,
  validatePatch,
  type Patch,
} from "../../projects/shader-lab/core";
import breathing from "../../projects/shader-lab/presets/breathing-phosphor.json";
import magnetic from "../../projects/shader-lab/presets/magnetic-reverie.json";

function modulated(): Patch {
  const patch = createDefaultPatch(),
    lfo = createNode("lfo", "lfo");
  patch.nodes.push(lfo);
  patch.connections.push({
    id: "mod",
    from: { node: "lfo", port: "value" },
    to: { node: "silk", port: "param:fold" },
    depth: 0.5,
  });
  return patch;
}
describe("portable visual synth patches", () => {
  it("ships valid full compositions with audible-style modulation and the unaltered favorite rack", () => {
    expect(validatePatch(breathing)).toEqual([]);
    expect(validatePatch(magnetic)).toEqual([]);
    const pulse = breathing as unknown as Patch,
      pull = magnetic as unknown as Patch;
    expect(evaluateParameters(pulse, 2).bayer!.threshold).toBeCloseTo(0.22);
    expect(evaluateParameters(pull, 3).silk!.strength).toBeCloseTo(0.52);
    expect(
      pull.nodes
        .filter((n) => n.type.startsWith("fx."))
        .map((n) => [n.type, n.params.amount]),
    ).toEqual([
      ["fx.reverb", 1],
      ["fx.crush", 0.65],
      ["fx.reverb", 1],
    ]);
  });
  it("preserves the effects discovery independently of generator settings", () => {
    const patch = createDefaultPatch();
    patch.nodes[0]!.params.palette = 4;
    patch.nodes[0]!.params.ratio = 3;
    const next = applyRack(patch, "Crushed Reverie");
    expect(next.nodes[0]!.params).toEqual(patch.nodes[0]!.params);
    expect(
      next.nodes
        .filter((n) => n.type.startsWith("fx."))
        .map((n) => [n.type, n.params.amount]),
    ).toEqual([
      ["fx.reverb", 1],
      ["fx.crush", 0.65],
      ["fx.reverb", 1],
    ]);
    expect(validatePatch(next)).toEqual([]);
    expect(next).not.toBe(patch);
  });
  it("removes dangling modulation when replacing effects but retains source modulation", () => {
    const patch = modulated(),
      fx = patch.nodes.find((n) => n.type.startsWith("fx."))!;
    patch.connections.push({
      id: "mod-fx",
      from: { node: "lfo", port: "value" },
      to: { node: fx.id, port: "param:amount" },
      depth: 0.1,
    });
    const next = applyRack(patch, "Dream Tape");
    expect(next.connections.some((e) => e.id === "mod")).toBe(true);
    expect(next.connections.some((e) => e.id === "mod-fx")).toBe(false);
    expect(validatePatch(next)).toEqual([]);
  });
  it.each([
    null,
    [],
    42,
    "bad",
    { version: 1 },
    JSON.parse('{"nodes":[{"id":"__proto__","type":"constructor"}]}'),
  ])("rejects hostile or malformed imports without throwing (%j)", (value) => {
    expect(() => validatePatch(value)).not.toThrow();
    expect(validatePatch(value).length).toBeGreaterThan(0);
  });
  it("rejects nonfinite settings, enum fractions, unknown params and invalid ranges", () => {
    for (const [key, value] of [
      ["fold", NaN],
      ["density", 200],
      ["palette", 1.5],
      ["fake", 0],
    ] as const) {
      const patch = createDefaultPatch();
      patch.nodes[0]!.params[key] = value;
      expect(validatePatch(patch).length).toBeGreaterThan(0);
    }
  });
  it("enforces typed ports, one cable per input and no feedback", () => {
    const wrong = modulated();
    wrong.connections.find((e) => e.id === "mod")!.to.port = "in";
    expect(validatePatch(wrong).join()).toContain("matching signal");
    const duplicate = modulated();
    duplicate.connections.push({
      ...duplicate.connections.find((e) => e.id === "mod")!,
      id: "duplicate",
    });
    expect(validatePatch(duplicate).join()).toContain("one connection");
    const cycle = modulated();
    cycle.connections.push({
      id: "cycle",
      from: { node: "lfo", port: "value" },
      to: { node: "lfo", port: "param:rate" },
    });
    expect(validatePatch(cycle).join()).toContain("cycles");
    expect(() => topologicalNodes(cycle)).toThrow();
  });
  it("sorts every dependency before its consumer", () => {
    const patch = modulated(),
      order = topologicalNodes(patch).map((n) => n.id);
    for (const edge of patch.connections)
      expect(order.indexOf(edge.from.node)).toBeLessThan(
        order.indexOf(edge.to.node),
      );
  });
  it("evaluates tempo synced LFO from absolute time without overwriting knobs", () => {
    const patch = modulated();
    expect(evaluateParameters(patch, 1).silk!.fold).toBe(1);
    expect(evaluateParameters(patch, 3).silk!.fold).toBeCloseTo(0.15);
    expect(evaluateParameters(patch, -1).silk!.fold).toBeCloseTo(0.15);
    expect(patch.nodes[0]!.params.fold).toBe(0.65);
  });
  it("reconstructs ADSR release and retrigger levels from gate history", () => {
    const patch = createDefaultPatch(),
      gate = createNode("gate", "gate"),
      adsr = createNode("adsr", "adsr");
    Object.assign(adsr.params, {
      attack: 1,
      decay: 1,
      sustain: 0.5,
      release: 1,
    });
    patch.nodes.push(gate, adsr);
    patch.nodes[0]!.params.fold = 0;
    patch.connections.push(
      {
        id: "gate-link",
        from: { node: "gate", port: "gate" },
        to: { node: "adsr", port: "gate" },
      },
      {
        id: "envelope",
        from: { node: "adsr", port: "value" },
        to: { node: "silk", port: "param:fold" },
        depth: 1,
      },
    );
    patch.events = [
      { time: 0, node: "gate", on: true },
      { time: 2, node: "gate", on: false },
      { time: 2.5, node: "gate", on: true },
    ];
    expect(evaluateParameters(patch, -1).silk!.fold).toBe(0);
    expect(evaluateParameters(patch, 0.5).silk!.fold).toBeCloseTo(0.5);
    expect(evaluateParameters(patch, 1.5).silk!.fold).toBeCloseTo(0.75);
    expect(evaluateParameters(patch, 2.25).silk!.fold).toBeCloseTo(0.375);
    expect(evaluateParameters(patch, 3).silk!.fold).toBeCloseTo(0.625);
  });
  it("surfaces unavailable persistence rather than claiming a save", async () => {
    await expect(savePatch(createDefaultPatch())).rejects.toThrow(
      "storage is unavailable",
    );
  });
});
