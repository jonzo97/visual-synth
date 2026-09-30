import { expect, it } from "vitest";
import { validatePatch, evaluateParameters, isGenerator } from "./core";
import { generatorBank } from "./generator-bank";

it("ships four distinct portable generator compositions", () => {
  expect(generatorBank).toHaveLength(4);
  expect(new Set(generatorBank.map((p) => p.name)).size).toBe(4);
  expect(new Set(generatorBank.map((p) => JSON.stringify(p.nodes))).size).toBe(
    4,
  );
  for (const patch of generatorBank) {
    expect(validatePatch(patch)).toEqual([]);
    expect(validatePatch(JSON.parse(JSON.stringify(patch)))).toEqual([]);
    expect(patch.nodes.filter((n) => isGenerator(n.type))).toHaveLength(1);
    expect(patch.nodes.filter((n) => n.type === "output")).toHaveLength(1);
  }
  expect(
    generatorBank.map((p) => p.nodes.find((n) => isGenerator(n.type))!.type),
  ).toEqual(["orbit", "orbit", "contour", "contour"]);
});

it("keeps the dry reference and assigns the intended filter recipes", () => {
  expect(generatorBank[0]!.nodes.map((n) => n.type)).toEqual([
    "orbit",
    "output",
  ]);
  expect(
    generatorBank[2]!.nodes
      .filter((n) => n.type.startsWith("fx."))
      .map((n) => [n.type, n.params.amount]),
  ).toEqual([["fx.glow", 0.2]]);
  expect(
    generatorBank[3]!.nodes
      .filter((n) => n.type.startsWith("fx."))
      .map((n) => [n.type, n.params.amount]),
  ).toEqual([
    ["fx.reverb", 0.45],
    ["fx.crush", 0.25],
  ]);
});

it("aligns Astrolabe's breathing modulation with its composition loop", () => {
  const patch = generatorBank[1]!;
  const start = evaluateParameters(patch, 0).orbit!.morph!;
  const end = evaluateParameters(patch, patch.transport.loopSeconds).orbit!
    .morph!;
  expect(end).toBeCloseTo(start, 8);
  expect(evaluateParameters(patch, 6).orbit!.morph).not.toBe(start);
});
