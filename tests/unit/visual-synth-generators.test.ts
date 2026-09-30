import { describe, it, expect } from "vitest";
import { applyRack, createNode, evaluateParameters, isGenerator, portType, validatePatch, type Patch } from "../../projects/shader-lab/core";
import lattice from "../../projects/shader-lab/presets/lattice-choir.json";

describe("Lattice Choir generator interoperability", () => {
  it("publishes a frame source with valid portable preset", () => {
    expect(isGenerator("lattice")).toBe(true);
    expect(isGenerator("silk")).toBe(true);
    expect(isGenerator("fx.glow")).toBe(false);
    const source = createNode("lattice", "source");
    expect(portType(source, "frame", "out")).toBe("frame");
    expect(portType(source, "in", "in")).toBeUndefined();
    expect(validatePatch(lattice)).toEqual([]);
  });
  it("keeps source and modulation when replacing the effects rack", () => {
    const patch = lattice as unknown as Patch;
    const replacement = applyRack(patch, "Crushed Reverie");
    expect(validatePatch(replacement)).toEqual([]);
    expect(replacement.nodes.find(n => n.id === "lattice")).toEqual(patch.nodes[0]);
    expect(replacement.connections.find(e => e.id === "breath-morph")).toEqual(patch.connections[3]);
    expect(replacement.nodes.filter(n => n.type.startsWith("fx.")).map(n => [n.type,n.params.amount])).toEqual([["fx.reverb",1],["fx.crush",0.65],["fx.reverb",1]]);
  });
  it("evaluates its modulation deterministically within the manifest bounds", () => {
    const patch = lattice as unknown as Patch;
    expect(evaluateParameters(patch, 2.4).lattice!.morph).toBeCloseTo(1);
    expect(evaluateParameters(patch, 7.2).lattice!.morph).toBeCloseTo(0.6);
    expect(evaluateParameters(patch, 2.4)).toEqual(evaluateParameters(patch, 2.4));
  });
});

