import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Target } from 'vgpu/node';
import { createNode, type SimulationEvent, type SynthNode } from './core';
import { simulationDefinitions } from './generators/simulation';
import { createSimulationPass, type SimulationPass } from './simulation-runtime';

const readShader = (name: string) => readFileSync(new URL(`./generators/${name}.wgsl`, import.meta.url), 'utf8');

describe('simulation source contracts', () => {
  for (const [type, definition] of Object.entries(simulationDefinitions)) {
    it(`${type} matches its kernel/display uniform and integer-grid boundaries`, () => {
      const fields = (source: string) => [...source.match(/struct\s+Params\s*\{([^}]+)\}/s)![1]!.matchAll(/\b(\w+)\s*:\s*f32\b/g)].map((match) => match[1]).sort();
      expect(fields(readShader(type))).toEqual([...Object.keys(definition.params), 'phase', 'aspect'].sort());
      expect(fields(readShader(`${type}-step`))).toEqual([...Object.keys(definition.params), 'tick', 'initialize', 'injectX', 'injectY', 'radius', 'amount'].sort());
      expect(definition.params.grid).toMatchObject({ min: 128, max: 512, default: 256, modulatable: false });
      expect(definition.params.seed).toMatchObject({ min: 0, max: 65535, step: 1, modulatable: false });
      for (const spec of Object.values(definition.params)) {
        expect([spec.min, spec.max, spec.step, spec.default].every(Number.isFinite)).toBe(true);
        expect(spec.default).toBeGreaterThanOrEqual(spec.min);
        expect(spec.default).toBeLessThanOrEqual(spec.max);
      }
    });
  }
});

// Explicit native-hardware checkpoint; CPU-only CI still checks portable contracts.
// PowerShell: $env:DIVERGENT_GPU_TESTS='1'; npx vitest run --config vitest.config.ts projects/shader-lab/simulation-runtime.test.ts
describe.skipIf(process.env.DIVERGENT_GPU_TESTS !== '1')('native simulation state and pixels', () => {
  let api: typeof import('vgpu/node');
  let gpu: Awaited<ReturnType<typeof import('vgpu/node').init>>;
  const errors: Error[] = [];
  const simulations: SimulationPass[] = [];
  const displays: Target[] = [];

  beforeAll(async () => {
    api = await import('vgpu/node');
    gpu = await api.init({ adapter: 'hardware' });
    gpu.onError((error) => errors.push(error));
    console.info('Simulation GPU:', gpu.adapter.name, gpu.adapter.type);
  }, 30_000);
  afterAll(async () => {
    await gpu?.settled();
    for (const simulation of simulations) simulation.dispose();
    gpu?.dispose();
  });

  function create(type: 'rules' | 'chemical', overrides: Record<string, number> = {}) {
    const node = createNode(type, `${type}-${simulations.length}`);
    Object.assign(node.params, { grid: 128, ...overrides });
    const pass = createSimulationPass(gpu, node, (_family, factory) => factory());
    simulations.push(pass);
    return { node, pass };
  }

  async function advance(pass: SimulationPass, node: SynthNode, from: number, to: number, events: SimulationEvent[] = []) {
    for (let tick = from; tick <= to; tick++) {
      pass.step(node.params, tick, tick === to ? events : []);
      if (tick % 60 === 0) await gpu.gpu.queue.onSubmittedWorkDone();
    }
    await gpu.settled();
    expect(errors).toEqual([]);
  }

  const different = (a: ArrayLike<number>, b: ArrayLike<number>) => {
    let count = 0;
    for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) count++;
    return count;
  };
  const sameBytes = (a: Uint8Array, b: Uint8Array) => expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  async function readState(target: Target): Promise<Uint8Array> {
    if (target.format !== 'r32uint') return target.read();
    // vgpu intentionally omits integer readback. Use its public GPU texture handle and
    // standard WebGPU copy/map APIs to compare the original integer bits without a color pass.
    const [width, height] = target.size;
    const rowBytes = width * 4;
    const bytesPerRow = Math.ceil(rowBytes / 256) * 256;
    const staging = gpu.gpu.createBuffer({ size: bytesPerRow * height, usage: 0x0001 | 0x0008 }); // MAP_READ | COPY_DST
    try {
      const encoder = gpu.gpu.createCommandEncoder();
      encoder.copyTextureToBuffer({ texture: target.color.gpu }, { buffer: staging, bytesPerRow, rowsPerImage: height }, { width, height });
      gpu.gpu.queue.submit([encoder.finish()]);
      await staging.mapAsync(0x0001); // READ
      const mapped = new Uint8Array(staging.getMappedRange());
      const bytes = new Uint8Array(rowBytes * height);
      for (let row = 0; row < height; row++) bytes.set(mapped.subarray(row * bytesPerRow, row * bytesPerRow + rowBytes), row * rowBytes);
      return bytes;
    } finally {
      staging.unmap();
      staging.destroy();
    }
  }
  const components = async (target: Target) => {
    const bytes = await target.read();
    return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  };
  async function saveDisplay(name: string, pass: SimulationPass, node: SynthNode) {
    const directory = process.env.DIVERGENT_GPU_ARTIFACTS;
    if (!directory) return;
    const target = api.target(gpu, { size: [640, 360], format: 'rgba8unorm' });
    displays.push(target);
    const painter = api.effect(gpu, readShader(node.type), { set: { state: pass.current(), params: { ...node.params, phase: 0, aspect: 16 / 9 } } });
    await painter.compile(target);
    api.frame(gpu, (frame) => frame.pass(target, painter));
    const { PNG } = createRequire(import.meta.url)('pngjs');
    mkdirSync(directory, { recursive: true });
    const path = join(directory, `${name}.png`);
    writeFileSync(path, PNG.sync.write({ width: 640, height: 360, data: Buffer.from(await target.read()) }));
    console.info('Native simulation image:', path);
  }

  it('repeats seeded integer evolution exactly and changes when the seed changes', async () => {
    const { node, pass } = create('rules', { seed: 19, states: 9, threshold: 1, rate: 14 });
    await advance(pass, node, 0, 0);
    const initial = await readState(pass.current());
    await advance(pass, node, 1, 180);
    const evolved = await readState(pass.current());
    expect(different(initial, evolved)).toBeGreaterThan(0);
    await saveDisplay('rules-after-180-ticks', pass, node);
    pass.reset();
    await advance(pass, node, 0, 180);
    sameBytes(await readState(pass.current()), evolved);
    const other = create('rules', { seed: 20, states: 9, threshold: 1, rate: 14 });
    await advance(other.pass, other.node, 0, 180);
    expect(different(await readState(other.pass.current()), evolved)).toBeGreaterThan(0);
  }, 60_000);

  it('honors one update per second without advancing between fixed tick boundaries', async () => {
    const { node, pass } = create('rules', { threshold: 1, rate: 1 });
    await advance(pass, node, 0, 0);
    const initial = await readState(pass.current());
    await advance(pass, node, 1, 59);
    sameBytes(await readState(pass.current()), initial);
    await advance(pass, node, 60, 60);
    const evolved = await readState(pass.current());
    expect(different(initial, evolved)).toBeGreaterThan(0);
    await advance(pass, node, 61, 119);
    sameBytes(await readState(pass.current()), evolved);
  }, 60_000);

  it('keeps palette and display resizing independent of internal grid evolution', async () => {
    const a = create('rules', { threshold: 1, palette: 2 });
    const b = create('rules', { threshold: 1, palette: 6 });
    await advance(a.pass, a.node, 0, 180);
    await advance(b.pass, b.node, 0, 180);
    const before = await readState(a.pass.current());
    sameBytes(before, await readState(b.pass.current()));
    const target = api.target(gpu, { size: [80, 45], format: 'rgba16float' });
    displays.push(target);
    const painter = api.effect(gpu, readShader('rules'), { set: { state: a.pass.current(), params: { ...a.node.params, phase: 0, aspect: 80 / 45 } } });
    await painter.compile(target);
    api.frame(gpu, (frame) => frame.pass(target, painter));
    const first = await target.readFloats();
    painter.set({ params: { ...a.node.params, palette: 6, phase: 0, aspect: 80 / 45 } });
    api.frame(gpu, (frame) => frame.pass(target, painter));
    expect(different(first, await target.readFloats())).toBeGreaterThan(0);
    target.resize([160, 90]);
    api.frame(gpu, (frame) => frame.pass(target, painter));
    expect((await target.readFloats()).length).toBe(160 * 90 * 4);
    expect(a.pass.current().size).toEqual([128, 128]);
    sameBytes(await readState(a.pass.current()), before);
    expect(errors).toEqual([]);
  }, 60_000);

  it('keeps chemical concentrations finite and evolving through a 600-tick warmup and repeat', async () => {
    const { node, pass } = create('chemical', { seed: 21, feed: 0.029, kill: 0.057, steps: 5 });
    await advance(pass, node, 0, 0);
    const initial = await components(pass.current());
    await advance(pass, node, 1, 600);
    const warmBytes = await pass.current().read();
    const warm = await components(pass.current());
    expect(warm.length).toBe(128 * 128 * 2);
    expect(Array.from(warm).every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
    expect(different(initial, warm)).toBeGreaterThan(0);
    let active = 0, meanV = 0;
    for (let index = 1; index < warm.length; index += 2) {
      meanV += warm[index]!;
      if (warm[index]! > 0.05) active++;
    }
    expect(active).toBeGreaterThan(0);
    console.info('Chemical 600-tick warmup:', { grid: 128, steps: 5, activeV: active, meanV: meanV / (128 * 128) });
    await saveDisplay('chemical-after-600-ticks', pass, node);
    await advance(pass, node, 601, 660);
    expect(different(warm, await components(pass.current()))).toBeGreaterThan(0);
    pass.reset();
    await advance(pass, node, 0, 600);
    sameBytes(await pass.current().read(), warmBytes);
  }, 60_000);

  it('applies every injection on the same tick and preserves deterministic replay', async () => {
    const { node, pass } = create('chemical', { seed: 21, steps: 1 });
    const events: SimulationEvent[] = [
      { time: 0, node: node.id, kind: 'inject', x: 0.2, y: 0.5, radius: 0.06, amount: 1 },
      { time: 0, node: node.id, kind: 'inject', x: 0.8, y: 0.5, radius: 0.06, amount: 1 },
    ];
    await advance(pass, node, 0, 0, events);
    const paintedBytes = await pass.current().read();
    const painted = await components(pass.current());
    for (const x of [0.2, 0.8]) {
      const index = (64 * 128 + Math.floor(x * 128)) * 2;
      expect(painted[index]).toBeCloseTo(0.45, 5);
      expect(painted[index + 1]).toBeCloseTo(0.5, 5);
    }
    pass.reset();
    await advance(pass, node, 0, 0, events);
    sameBytes(await pass.current().read(), paintedBytes);
  }, 60_000);

  it('measures whether the default Rule Garden continues to evolve after its warmup', async () => {
    const { node, pass } = create('rules');
    await advance(pass, node, 0, 180);
    const warm = await readState(pass.current());
    await advance(pass, node, 181, 360);
    const changed = different(warm, await readState(pass.current()));
    console.info('Default Rule Garden late evolution:', { threshold: node.params.threshold, changedBytes: changed });
    // The default is an auditioned evolving source, so a frozen late state is a release regression.
    expect(changed).toBeGreaterThan(0);
  }, 60_000);
});
