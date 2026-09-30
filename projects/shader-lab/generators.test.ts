import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createNode, manifests } from "./core";
import { generatorIds, type GeneratorType } from "./generators/catalog";

const shaderPaths: Record<GeneratorType, string> = {
  operator: './generators/operator.wgsl',
  pulse: "./generators/pulse.wgsl",
  cells: "./generators/cells.wgsl",
  resonance: "./generators/resonance.wgsl",
  rules: "./generators/rules.wgsl",
  chemical: "./generators/chemical.wgsl",
  silk: "./silk.wgsl",
  lattice: "./lattice.wgsl",
  orbit: "./generators/orbit.wgsl",
  contour: "./generators/contour.wgsl",
  hyperbolic: "./generators/hyperbolic.wgsl",
  quasicrystal: "./generators/quasicrystal.wgsl",
  polytope: "./generators/polytope.wgsl",
  multigrid: "./generators/multigrid.wgsl",
  attractor: "./generators/attractor.wgsl",
  complex: "./generators/complex.wgsl",
  julia: "./generators/julia.wgsl",
  slime: "./generators/slime.wgsl",
  ink: "./generators/ink.wgsl",
  fizz: "./generators/fizz.wgsl",
};

for (const type of generatorIds) {
  it(`${type} exposes exactly the shader's parameters with usable defaults`, () => {
    const source = readFileSync(
      new URL(shaderPaths[type], import.meta.url),
      "utf8",
    );
    const body = source.match(/struct\s+Params\s*\{([^}]+)\}/s)?.[1];
    expect(body, "source must declare its Params contract").toBeDefined();
    const fields = [...body!.matchAll(/\b(\w+)\s*:\s*f32\b/g)].map(
      (m) => m[1]!,
    );
    expect(new Set(fields).size).toBe(fields.length);
    expect(fields).toContain("phase");
    expect(fields).toContain("aspect");
    const params = manifests[type].params;
    expect(
      fields.filter((key) => key !== "phase" && key !== "aspect").sort(),
    ).toEqual(Object.keys(params).sort());
    const node = createNode(type, `contract-${type}`);
    for (const [key, param] of Object.entries(params)) {
      expect(
        [param.min, param.max, param.default, param.step].every(
          Number.isFinite,
        ),
        key,
      ).toBe(true);
      expect(param.min, key).toBeLessThanOrEqual(param.max);
      expect(param.default, key).toBeGreaterThanOrEqual(param.min);
      expect(param.default, key).toBeLessThanOrEqual(param.max);
      expect(param.step, key).toBeGreaterThan(0);
      expect(node.params[key], key).toBe(param.default);
    }
  });
}

it("retains original silk and lattice numeric and modulation contracts", () => {
  // [minimum, maximum, default, step, modulatable], frozen before registry extraction.
  const original = {
    silk: {
      fold: [0, 1, 0.65, 0.01, true],
      density: [12, 100, 34, 1, true],
      palette: [0, 8, 6, 1, false],
      layers: [1, 3, 3, 1, false],
      offset: [-Math.PI, Math.PI, 0, 0.01, true],
      ratio: [0.25, 4, 8.2 / 4.8, 0.01, true],
      strength: [0, 1, 0.35, 0.01, true],
      mode: [0, 3, 0, 1, false],
      ax: [0, 1, 0.35, 0.01, true],
      ay: [0, 1, 0.45, 0.01, true],
      bx: [0, 1, 0.65, 0.01, true],
      by: [0, 1, 0.55, 0.01, true],
      crossing: [0, 3, 3, 1, false],
      angle: [
        (5 * Math.PI) / 180,
        (175 * Math.PI) / 180,
        (55 * Math.PI) / 180,
        0.01,
        true,
      ],
      mixAmount: [0, 1, 1, 0.01, true],
    },
    lattice: {
      density: [4, 48, 18, 1, true],
      fold: [0, 1, 0.45, 0.01, true],
      palette: [0, 8, 7, 1, false],
      offset: [-Math.PI, Math.PI, 0, 0.01, true],
      ratio: [0.25, 4, 1.5, 0.01, true],
      morph: [0, 1, 0.55, 0.01, true],
    },
  };
  for (const type of ["silk", "lattice"] as const) {
    const actual = Object.fromEntries(
      Object.entries(manifests[type].params).map(([key, p]) => [
        key,
        [p.min, p.max, p.default, p.step, p.modulatable],
      ]),
    );
    expect(actual).toEqual(original[type]);
  }
});
