import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Target } from "vgpu/node";
import { effectDefinitions, type EffectType } from "./effects/catalog";

const hostFields = ["phase", "width", "height", "valid", "hasField", "hasMask", "head", "count"];
const bindings: Record<string, number> = { src: 0, field: 1, b: 2, mask: 3, history: 4, samp: 5, params: 6 };

describe("divergent effects release contract", () => {
  for (const [type, definition] of Object.entries(effectDefinitions)) {
    const source = readFileSync(new URL(`./effects/${type.slice(3)}.wgsl`, import.meta.url), "utf8");

    it(`${type} declares exactly its numeric public and host uniform fields`, () => {
      const body = source.match(/struct\s+Params\s*\{([^}]+)\}/s)?.[1];
      expect(body).toBeDefined();
      const fields = [...body!.matchAll(/\b(\w+)\s*:\s*f32\b/g)].map(match => match[1]);
      expect(fields.sort()).toEqual([...Object.keys(definition.params), ...hostFields].sort());
      for (const parameter of Object.values(definition.params)) {
        expect([parameter.min, parameter.max, parameter.step, parameter.default].every(Number.isFinite)).toBe(true);
        expect(parameter.default).toBeGreaterThanOrEqual(parameter.min);
        expect(parameter.default).toBeLessThanOrEqual(parameter.max);
        expect(parameter.step).toBeGreaterThan(0);
      }
      expect(definition.params.amount.min).toBe(0);
      expect(definition.params.amount.max).toBe(1);
      expect(definition.frameInputs[0]).toBe("in");
    });

    it(`${type} retains fixed binding slots for independently wired inputs`, () => {
      const declarations = [...source.matchAll(/@group\(0\)\s+@binding\((\d+)\)\s+var(?:<uniform>)?\s+(\w+):/g)];
      expect(declarations.length).toBeGreaterThanOrEqual(3);
      expect(new Set(declarations.map(match => match[1])).size).toBe(declarations.length);
      for (const [, slot, name] of declarations) expect(Number(slot), name).toBe(bindings[name!]);
      expect(declarations.map(match => match[2])).toEqual(expect.arrayContaining(["src", "samp", "params"]));
    });
  }

  it("exposes only the explicit image-control ports", () => {
    expect(Object.fromEntries(Object.entries(effectDefinitions).map(([type, value]) => [type, value.frameInputs]))).toEqual({
      "fx.warp": ["in", "field"], "fx.mask": ["in", "b", "mask"],
      "fx.fold": ["in"], "fx.kaleido": ["in"], "fx.morph": ["in"], "fx.chrono": ["in"], "fx.feedback": ["in"], "fx.hyperbolic": ["in"], "fx.marble": ["in"], "fx.droste": ["in"],
    });
  });

  it("keeps mode switches discrete and temporal controls bounded to retained history", () => {
    for (const definition of Object.values(effectDefinitions)) {
      for (const [key, parameter] of Object.entries(definition.params)) {
        if (["mode", "boundary", "invert", "blend", "channels", "kernel", "lumaOnly"].includes(key)) {
          expect(parameter.step).toBe(1);
          expect(parameter.modulatable).toBe(false);
        }
      }
    }
    expect(effectDefinitions["fx.chrono"].params.seconds.max).toBe(31 / 15);
    expect(effectDefinitions["fx.feedback"].params.decay.max).toBeLessThan(1);
    expect(effectDefinitions["fx.feedback"].params.injection.min).toBe(0);
    expect(effectDefinitions["fx.feedback"].params.injection.max).toBe(1);
    expect(effectDefinitions["fx.mask"].params.blend.default).toBe(0);
    expect(effectDefinitions["fx.mask"].params.invert.default).toBe(0);
  });
});

// Run explicitly on a host with a native WebGPU adapter:
// DIVERGENT_GPU_TESTS=1 npx vitest run projects/shader-lab/divergent-effects.test.ts
// Keeping this opt-in lets the ordinary manifest suite run on CPU-only CI.
describe.skipIf(process.env.DIVERGENT_GPU_TESTS !== "1")("divergent effects GPU pixels", () => {
  let api: typeof import("vgpu/node");
  let gpu: Awaited<ReturnType<typeof import("vgpu/node").init>>;
  let samp: ReturnType<typeof import("vgpu/node").sampler>;
  const errors: Error[] = [];

  beforeAll(async () => {
    api = await import("vgpu/node");
    gpu = await api.init();
    gpu.onError(error => errors.push(error));
    samp = api.sampler(gpu, { minFilter: "linear", magFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
  }, 30_000);
  afterAll(() => { gpu?.dispose(); });

  async function paint(expression: string, size: readonly [number, number] = [9, 9]): Promise<Target> {
    const output = api.target(gpu, { size, format: "rgba16float" });
    const painter = api.effect(gpu, `@fragment fn fs_main(@location(0) uv:vec2f)->@location(0) vec4f { return ${expression}; }`);
    await painter.compile(output);
    api.frame(gpu, current => current.pass({ target: output }, encoder => encoder.draw(painter)));
    return output;
  }

  async function render(type: EffectType, src: Target, params: Record<string, number> = {}, inputs: Record<string, Target> = {}): Promise<Target> {
    const source = readFileSync(new URL(`./effects/${type.slice(3)}.wgsl`, import.meta.url), "utf8");
    const output = api.target(gpu, { size: src.size, format: "rgba16float" });
    const defaults = Object.fromEntries(Object.entries(effectDefinitions[type].params).map(([key, parameter]) => [key, parameter.default]));
    const available = { src, field: src, b: src, mask: src, history: src, ...inputs };
    const declared = Object.fromEntries(Object.entries(available).filter(([name]) => new RegExp(`var ${name}:`).test(source)));
    const fx = api.effect(gpu, source, { set: {
      ...declared, samp,
      params: { ...defaults, phase: 0, width: src.size[0], height: src.size[1], valid: 1, hasField: 1, hasMask: 1, head: 0, count: 32, ...params },
    } });
    await fx.compile(output);
    api.frame(gpu, current => current.pass({ target: output }, encoder => encoder.draw(fx)));
    return output;
  }

  function near(actual: ArrayLike<number>, expected: ArrayLike<number>, epsilon = 0.002) {
    expect(actual.length).toBe(expected.length);
    for (let index = 0; index < actual.length; index++) expect(Math.abs(actual[index]! - expected[index]!), `component ${index}`).toBeLessThanOrEqual(epsilon);
  }

  it("preserves HDR RGB and alpha exactly with amount zero for all six effects", async () => {
    const src = await paint("vec4f(uv.x*4.0,uv.y*2.0,0.6,0.35)");
    const expected = await src.readFloats();
    for (const type of Object.keys(effectDefinitions) as EffectType[]) {
      near(await (await render(type, src, { amount: 0 })).readFloats(), expected, 0);
    }
    expect(errors).toEqual([]);
  });

  it("returns source when a warp field or temporal history is unavailable", async () => {
    const src = await paint("vec4f(uv,0.6,0.35)");
    const expected = await src.readFloats();
    near(await (await render("fx.warp", src, { hasField: 0 })).readFloats(), expected, 0);
    for (const type of ["fx.chrono", "fx.feedback"] as const) {
      near(await (await render(type, src, { valid: 0 })).readFloats(), expected, 0);
    }
  });

  it("decodes centered RG, luma gradients, and each spatial boundary mode", async () => {
    const src = await paint("vec4f(uv.x,uv.x,uv.x,1)", [8, 1]);
    const field = await paint("vec4f(1,0.5,0,1)", [8, 1]);
    for (const [boundary, expected] of [[0, 0.9375], [1, 0.1875], [2, 0.8125]] as const) {
      const pixels = await (await render("fx.warp", src, { amount: 1, strength: 0.25, mode: 1, boundary }, { field })).readFloats();
      near(pixels.slice(7 * 4, 8 * 4), [expected, expected, expected, 1], 0);
    }
    const neutral = await paint("vec4f(0.5,0.5,0,1)", [8, 1]);
    near(await (await render("fx.warp", src, { mode: 1 }, { field: neutral })).readFloats(), await src.readFloats(), 0);
    const gradient = await (await render("fx.warp", src, { amount: 1, strength: 0.25, mode: 0, boundary: 0 }, { field: src })).readFloats();
    near(gradient.slice(3 * 4, 4 * 4), [0.6875, 0.6875, 0.6875, 1]);
  });

  it("crossfades straight RGB and alpha without a mask and honors hard/inverted masks", async () => {
    const src = await paint("vec4f(0.2,0.4,0.8,0.25)");
    const b = await paint("vec4f(0.8,0.2,0.1,0.75)");
    const mask = await paint("vec4f(0,0,0,1)");
    const crossfade = await (await render("fx.mask", src, { hasMask: 0 }, { b, mask })).readFloats();
    near(crossfade.slice(0, 4), [0.5, 0.3, 0.45, 0.5]);
    near(await (await render("fx.mask", src, { mix: 1, softness: 0 }, { b, mask })).readFloats(), await src.readFloats(), 0);
    near(await (await render("fx.mask", src, { mix: 1, softness: 0, invert: 1 }, { b, mask })).readFloats(), await b.readFloats(), 0);
  });

  it("keeps tonal folds continuous and retains source alpha", async () => {
    const src = await paint("vec4f(vec3f(uv.x),0.375)", [63, 1]);
    const pixels = await (await render("fx.fold", src, { amount: 1, mode: 1, folds: 2, channels: 1 })).readFloats();
    const tones = Array.from({ length: 63 }, (_, index) => pixels[index * 4]!);
    expect(new Set(tones.map(value => Math.round(value * 512))).size).toBeGreaterThan(20);
    expect(Math.max(...tones.slice(1).map((value, index) => Math.abs(value - tones[index]!)))).toBeLessThan(0.07);
    for (let index = 3; index < pixels.length; index += 4) expect(pixels[index]).toBe(0.375);
  });

  it("kaleidoscope makes an asymmetric source mirror-symmetric across both axes and keeps alpha", async () => {
    // Odd size so a centre pixel exists; the source is a plain left-to-right ramp with no symmetry of its own.
    const size = 33;
    const src = await paint("vec4f(uv.x, uv.y*0.5, 0.25, 0.75)", [size, size]);
    const raw = await src.readFloats();
    const rawAsym = Math.abs(raw[(16 * size + 2) * 4]! - raw[(16 * size + 30) * 4]!);
    expect(rawAsym).toBeGreaterThan(0.5);
    const out = await (await render("fx.kaleido", src, { amount: 1, segments: 4, rotation: 0, zoom: 1, twist: 0 })).readFloats();
    let worst = 0;
    for (let y = 2; y < size - 2; y++) for (let x = 2; x < size - 2; x++) {
      const a = (y * size + x) * 4, h = (y * size + (size - 1 - x)) * 4, v = ((size - 1 - y) * size + x) * 4;
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(out[a + c]! - out[h + c]!), Math.abs(out[a + c]! - out[v + c]!));
      expect(out[a + 3]).toBe(0.75);
    }
    expect(worst).toBeLessThan(0.03);
    // Segment count and rotation both change the picture (rotating the lens over a fixed source
    // reveals different source regions, as a physical kaleidoscope does); a full turn is identity.
    const six = await (await render("fx.kaleido", src, { amount: 1, segments: 6 })).readFloats();
    const eighth = await (await render("fx.kaleido", src, { amount: 1, segments: 4, rotation: Math.PI / 4 })).readFloats();
    const full = await (await render("fx.kaleido", src, { amount: 1, segments: 4, rotation: 2 * Math.PI })).readFloats();
    let diffSix = 0, diffEighth = 0;
    for (let i = 0; i < out.length; i += 4) { diffSix += Math.abs(out[i]! - six[i]!); diffEighth += Math.abs(out[i]! - eighth[i]!); }
    expect(diffSix / (size * size)).toBeGreaterThan(0.02);
    expect(diffEighth / (size * size)).toBeGreaterThan(0.02);
    near(full, out, 0.01);
  });

  it("grows luma-selected ink by the declared 3×3 or 5×5 neighborhood", async () => {
    const src = await paint("vec4f(select(vec3f(0),vec3f(1,0.5,0.25),all(abs(uv-0.5)<vec2f(0.055))),1)");
    for (const [kernel, expected] of [[0, 9], [1, 25]] as const) {
      const pixels = await (await render("fx.morph", src, { amount: 1, mode: 0, kernel })).readFloats();
      const ink = Array.from({ length: 81 }, (_, index) => Array.from(pixels.slice(index * 4, index * 4 + 3))).filter(rgb => rgb[0]! > 0.5);
      expect(ink).toHaveLength(expected);
      for (const rgb of ink) near(rgb, [1, 0.5, 0.25], 0);
    }
  });

  it("addresses the next-write atlas ring and clamps warmup ages without tile bleed", async () => {
    const src = await paint("vec4f(1,0,1,1)", [8, 8]);
    const history = await paint("vec4f(vec3f((floor(uv.x*8.0)+floor(uv.y*4.0)*8.0)/32.0),0.5)", [64, 32]);
    // 0.001 s rounds to newest (head-1 = tile 4); large ages with count=3
    // clamp to tile 2, even at the oldest edge of the spatial age field.
    const newest = await (await render("fx.chrono", src, { amount: 1, seconds: 0.001, head: 5, count: 3 }, { history })).readFloats();
    for (let index = 0; index < newest.length; index += 4) near(newest.slice(index, index + 4), [4 / 32, 4 / 32, 4 / 32, 0.5], 0);
    const oldest = await (await render("fx.chrono", src, { amount: 1, seconds: 31 / 15, head: 5, count: 3 }, { history })).readFloats();
    near(oldest.slice(7 * 4, 8 * 4), [2 / 32, 2 / 32, 2 / 32, 0.5], 0);
    const wrapped = await (await render("fx.chrono", src, { amount: 1, seconds: 0.001, head: 0, count: 32 }, { history })).readFloats();
    near(wrapped.slice(0, 4), [31 / 32, 31 / 32, 31 / 32, 0.5], 0);
  });

  it("attenuates prior output, injects source predictably, and bounds HDR", async () => {
    const src = await paint("vec4f(0.25,0.5,1,0.375)");
    const history = await paint("vec4f(1,0.5,0.25,1)");
    const params = { amount: 1, zoom: 1, rotate: 0, decay: 0.8, injection: 0.25 };
    const result = await (await render("fx.feedback", src, params, { history })).readFloats();
    near(result.slice(0, 4), [0.6625, 0.425, 0.4, 0.375]);
    const intense = await paint("vec4f(64,64,64,1)");
    const bounded = await (await render("fx.feedback", src, { ...params, decay: 0.999, injection: 0 }, { history: intense })).readFloats();
    near(bounded.slice(0, 4), [16, 16, 16, 0.375], 0);
    expect(errors).toEqual([]);
  });
});
