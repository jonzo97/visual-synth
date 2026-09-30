import { expect, it } from "vitest";
import { createDefaultPatch, createNode, validatePatch } from "./core";
import { generatePatch, patchBank } from "./bank";
it("ships valid distinct curated patches", () => {
  for (const item of patchBank) expect(validatePatch(item.patch)).toEqual([]);
  expect(
    new Set(patchBank.map((p) => JSON.stringify(p.patch.nodes))).size,
  ).toBe(4);
});
it("reproduces seeds and preserves source knobs in effects mode", () => {
  const original = createDefaultPatch();
  original.nodes[0]!.params.palette = 4;
  const a = generatePatch(original, "fern");
  expect(generatePatch(original, "fern")).toEqual(a);
  expect(generatePatch(a, "fern")).toEqual(a);
  expect(a.nodes.find((n) => n.id === "silk")).toEqual(original.nodes[0]);
  expect(original.name).toBe("Untitled composition");
  expect(generatePatch(original, "other")).not.toEqual(a);
});
it("generates bounded valid graphs across many seeds and both scopes", () => {
  const original = createDefaultPatch();
  for (let i = 0; i < 150; i++)
    for (const scope of ["whole", "effects"] as const) {
      const p = generatePatch(original, String(i), scope);
      expect(validatePatch(p)).toEqual([]);
      expect(
        p.nodes.filter((n) => ["fx.delay", "fx.reverb"].includes(n.type))
          .length,
      ).toBeLessThanOrEqual(2);
    }
});

it("preserves user nodes with wander names and disconnected processors", () => {
  const original = createDefaultPatch();
  const user = createNode("lfo", "wander-user");
  const effect = createNode("fx.glow", "parked-effect");
  original.nodes.push(user, effect);
  const generated = generatePatch(original, "fern");
  expect(generated.nodes.find((n) => n.id === user.id)).toEqual(user);
  expect(generated.nodes.find((n) => n.id === effect.id)).toEqual(effect);
  expect(generated.exploration?.generatedNodeIds).not.toContain(user.id);
});

it("rejects branched and multi-source graphs without modifying the original", () => {
  for (const kind of ["fanout", "mixer", "source"] as const) {
    const patch = createDefaultPatch();
    if (kind === "source")
      patch.nodes.push(createNode("lattice", "second-source"));
    else if (kind === "fanout") {
      patch.nodes.push(createNode("fx.glow", "side-chain"));
      patch.connections.push({
        id: "branch",
        from: { node: "silk", port: "frame" },
        to: { node: "side-chain", port: "in" },
      });
    } else {
      const output = patch.nodes.find((n) => n.type === "output")!;
      const edge = patch.connections.find((e) => e.to.node === output.id)!;
      patch.nodes.push(createNode("mixer", "mix"));
      edge.to = { node: "mix", port: "a" };
      patch.connections.push({
        id: "mixed-out",
        from: { node: "mix", port: "frame" },
        to: { node: output.id, port: "in" },
      });
    }
    const before = structuredClone(patch);
    expect(() => generatePatch(patch, "fern")).toThrow(
      /Save this patch first.*Whole patch/,
    );
    expect(patch).toEqual(before);
  }
});

it("uses explicit ownership to keep regeneration bounded and drop stale IDs", () => {
  let patch = generatePatch(createDefaultPatch(), "first", "whole");
  const source = structuredClone(
    patch.nodes.find((n) => n.type === "silk" || n.type === "lattice")!,
  );
  patch.nodes.push(createNode("lfo", "wander-user"));
  patch.exploration!.generatedNodeIds.push("deleted-generated-node");
  for (let i = 0; i < 30; i++) {
    patch = generatePatch(patch, String(i));
    expect(validatePatch(patch)).toEqual([]);
    expect(patch.nodes.length).toBeLessThanOrEqual(9);
    expect(patch.nodes.find((n) => n.id === source.id)).toEqual(source);
    expect(patch.nodes.some((n) => n.id === "wander-user")).toBe(true);
    expect(patch.exploration!.generatedNodeIds).not.toContain(
      "deleted-generated-node",
    );
    expect(
      patch.exploration!.generatedNodeIds.every((id) =>
        patch.nodes.some((n) => n.id === id),
      ),
    ).toBe(true);
  }
});

it("preserves the Wander v1 known-seed source recipe", () => {
  const generated = generatePatch(createDefaultPatch(), "fern", "whole");
  const source = generated.nodes[0]!;
  expect(source.type).toBe("silk");
  expect(source.params).toMatchObject({
    palette: 3,
    density: 49,
    fold: 0.475,
    offset: -0.602,
    ratio: 0.942,
  });
});
