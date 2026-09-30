import { beforeEach, expect, it, vi } from 'vitest';
import { createDefaultPatch, createNode, type Patch } from './core';

const gpuState = vi.hoisted(() => ({
  targets: [] as { size: number[]; format: string; destroy: ReturnType<typeof vi.fn>; resize: ReturnType<typeof vi.fn> }[],
  effects: [] as { values: Record<string, any> }[],
  draws: [] as Record<string, any>[],
  clears: 0,
  failLabShaders: false,
  labCompileError: "",
  disposed: vi.fn(),
  screenDisposed: vi.fn(),
}));

// Resource instrumentation, not a GPU emulator: real shader compilation and
// pixels remain the browser suite's responsibility.
vi.mock('vgpu', () => ({
  init: async () => ({
    // The lab preflight compiles on the raw GPUDevice (gpu.gpu), not vgpu's device wrapper.
    gpu: {
      limits: { maxTextureDimension2D: 8192 },
      queue: { onSubmittedWorkDone: async () => {} },
      pushErrorScope: () => {},
      popErrorScope: async () => null,
      createShaderModule: () => ({
        getCompilationInfo: async () => ({
          messages: gpuState.labCompileError
            ? [{ type: 'error', message: gpuState.labCompileError }]
            : [],
        }),
      }),
    },
    device: {},
    onError: () => () => {},
    settled: async () => {},
    dispose: gpuState.disposed,
  }),
  surface: () => ({ format: 'bgra8unorm', resize: vi.fn(), dispose: gpuState.screenDisposed }),
  sampler: () => ({}),
  target: (_gpu: unknown, options: { size: number[]; format?: string }) => {
    const value = { size: options.size, format: options.format ?? 'rgba16float', destroy: vi.fn(), resize: vi.fn((size: number[]) => { value.size = size; }) };
    gpuState.targets.push(value);
    return value;
  },
  effect: (_gpu: unknown, shader: string, options: { set?: Record<string, any> } = {}) => {
    const value = {
      values: { ...options.set },
      shader,
      set(values: Record<string, any>) { Object.assign(this.values, values); return this; },
      compile: async () => value,
      compileSync: () => {
        if (gpuState.failLabShaders && shader.includes('fn labParam')) throw new Error('mock lab compile failure');
        return value;
      },
    };
    gpuState.effects.push(value);
    return value;
  },
  frame: (_gpu: unknown, execute: (frame: { pass: (target: any, effect: any) => void }) => void) => {
    execute({ pass(target, effect) {
      if (target.clear) gpuState.clears++;
      if (effect?.values) gpuState.draws.push({ ...effect.values, __shader: effect.shader, __target: target.target ?? target, __effect: effect });
    } });
  },
}));

import { createRenderer } from './renderer';

beforeEach(() => {
  gpuState.targets = [];
  gpuState.effects = [];
  gpuState.draws = [];
  gpuState.clears = 0;
  gpuState.failLabShaders = false;
  gpuState.labCompileError = "";
  gpuState.disposed.mockClear();
  gpuState.screenDisposed.mockClear();
});

it('falls back to pass-through when a lab effect fails to compile', async () => {
  const source = createNode('silk', 'silk');
  const lab = createNode('lab.ripple', 'ripple');
  const output = createNode('output', 'output');
  const patch: Patch = {
    version: 2,
    name: 'Lab fallback',
    nodes: [source, lab, output],
    connections: [
      { id: 'a', from: { node: 'silk', port: 'frame' }, to: { node: 'ripple', port: 'in' } },
      { id: 'b', from: { node: 'ripple', port: 'frame' }, to: { node: 'output', port: 'in' } },
    ],
    transport: { bpm: 120, loopSeconds: 12 },
    events: [],
  };
  gpuState.failLabShaders = true;
  const renderer = await createRenderer(canvas());
  await expect(renderer.setPatch(patch)).resolves.toBeUndefined();
  expect(lab.labError).toMatch(/mock lab compile failure/);
  renderer.render(0);
  const fallback = gpuState.draws.find((draw) => draw.__shader.includes('textureSampleLevel(src,samp,uv,0)') && draw.src);
  expect(fallback).toBeDefined();
  renderer.dispose();
});

it('falls back to pass-through when lab compile info reports a WGSL error', async () => {
  const source = createNode('silk', 'silk');
  const lab = createNode('lab.ripple', 'ripple');
  const output = createNode('output', 'output');
  const patch: Patch = {
    version: 2,
    name: 'Lab compile-info fallback',
    nodes: [source, lab, output],
    connections: [
      { id: 'a', from: { node: 'silk', port: 'frame' }, to: { node: 'ripple', port: 'in' } },
      { id: 'b', from: { node: 'ripple', port: 'frame' }, to: { node: 'output', port: 'in' } },
    ],
    transport: { bpm: 120, loopSeconds: 12 },
    events: [],
  };
  gpuState.labCompileError = 'mock lab compile-info failure';
  const renderer = await createRenderer(canvas());
  await renderer.setPatch(patch);
  expect(lab.labError).toMatch(/mock lab compile-info failure/);
  renderer.render(0);
  const fallback = gpuState.draws.find((draw) => draw.__shader.includes('textureSampleLevel(src,samp,uv,0)') && draw.src);
  expect(fallback).toBeDefined();
  renderer.dispose();
});

const canvas = () => ({}) as HTMLCanvasElement;
it('ignores disconnected mixer channels without changing saved faders',async()=>{
  const patch=createDefaultPatch();
  patch.nodes=[createNode('silk','silk'),createNode('mixer4','mix'),createNode('output','output')];
  patch.connections=[
    {id:'a',from:{node:'silk',port:'frame'},to:{node:'mix',port:'a'}},
    {id:'out',from:{node:'mix',port:'frame'},to:{node:'output',port:'in'}},
  ];
  const renderer=await createRenderer(canvas());renderer.setPatch(patch);await renderer.renderAt(0);
  const fx=gpuState.effects.find(e=>typeof e.values.params?.levelD==='number')!;
  expect(fx.values.params).toMatchObject({levelA:1,levelB:0,levelC:0,levelD:0});
  expect(patch.nodes[1]!.params.levelD).toBe(1);renderer.dispose();
});
function rename(patch: Patch, iteration: number): Patch {
  const next = structuredClone(patch);
  const ids = new Map(next.nodes.map(node => [node.id, `iteration-${iteration}-${node.id}`]));
  for (const node of next.nodes) node.id = ids.get(node.id)!;
  for (const edge of next.connections) {
    edge.from.node = ids.get(edge.from.node)!;
    edge.to.node = ids.get(edge.to.node)!;
  }
  return next;
}

it('allocates and executes only the frame graph that reaches Screen output', async () => {
  const patch = createDefaultPatch();
  const renderer = await createRenderer(canvas());
  renderer.setPatch(patch);
  renderer.render(0);
  const allocations = gpuState.targets.length;
  const effects = gpuState.effects.length;
  const clearCount = gpuState.clears;
  const next = structuredClone(patch);
  next.nodes.push(createNode('lattice', 'disconnected-source'), createNode('fx.reverb', 'disconnected-reverb'));
  next.connections.push({ id: 'disconnected-wire', from: { node: 'disconnected-source', port: 'frame' }, to: { node: 'disconnected-reverb', port: 'in' } });
  gpuState.draws = [];
  renderer.setPatch(next);
  renderer.render(0.01);
  expect(gpuState.targets).toHaveLength(allocations);
  expect(gpuState.effects).toHaveLength(effects);
  expect(gpuState.clears).toBe(clearCount);
  expect(gpuState.draws.filter(draw => draw.params)).toHaveLength(1);
  renderer.dispose();
});

it('preserves warm temporal history across control-only edits and modulation changes', async () => {
  const patch = createDefaultPatch();
  const renderer = await createRenderer(canvas());
  renderer.setPatch(patch);
  for (const time of [0, 0.12, 0.24, 0.36]) renderer.render(time);
  const allocations = gpuState.targets.length;
  const clearCount = gpuState.clears;
  const next = structuredClone(patch);
  next.nodes.push(createNode('lfo', 'new-control'));
  next.connections.push({ id: 'new-modulation', from: { node: 'new-control', port: 'value' }, to: { node: 'silk', port: 'param:fold' }, depth: 0.1 });
  gpuState.draws = [];
  renderer.setPatch(next);
  renderer.render(0.37);
  expect(gpuState.targets).toHaveLength(allocations);
  expect(gpuState.clears).toBe(clearCount);
  const reverbs = gpuState.draws.filter(draw => draw.fx?.kind === 4);
  expect(reverbs).toHaveLength(2);
  expect(reverbs.every(draw => draw.fx.valid === 1)).toBe(true);
  expect(gpuState.draws.find(draw => draw.params)?.params.fold).not.toBe(patch.nodes.find(node => node.id === 'silk')!.params.fold);
  renderer.dispose();
});

it('bounds effect instances across repeated regeneration with new node identities', async () => {
  const patch = createDefaultPatch();
  const renderer = await createRenderer(canvas());
  for (let i = 0; i < 4; i++) { renderer.setPatch(rename(patch, i)); renderer.render(i); }
  const warmEffects = gpuState.effects.length;
  for (let i = 4; i < 104; i++) { renderer.setPatch(rename(patch, i)); renderer.render(i); }
  expect(gpuState.effects).toHaveLength(warmEffects);
  renderer.dispose();
  expect(gpuState.targets.every(resource => resource.destroy.mock.calls.length === 1)).toBe(true);
});

it('disposes all targets and the device once, including after topology replacement', async () => {
  const renderer = await createRenderer(canvas());
  renderer.setPatch(createDefaultPatch());
  renderer.render(0);
  renderer.setPatch(rename(createDefaultPatch(), 1));
  renderer.dispose();
  renderer.dispose();
  expect(gpuState.targets.length).toBeGreaterThan(1);
  for (const resource of gpuState.targets) expect(resource.destroy).toHaveBeenCalledTimes(1);
  expect(gpuState.disposed).toHaveBeenCalledTimes(1);
  expect(gpuState.screenDisposed).toHaveBeenCalledTimes(1);
  expect(() => renderer.render(1)).toThrow(/disposed/i);
});

function simulationPatch(type: 'rules' | 'chemical' = 'chemical', warmupTicks = 0): Patch {
  const source = createNode(type, 'simulation');
  Object.assign(source.params, { grid: 128, ...(type === 'chemical' ? { steps: 1 } : {}) });
  return {
    version: 2, name: 'Simulation protocol', nodes: [source, createNode('output', 'output')],
    connections: [{ id: 'output-wire', from: { node: source.id, port: 'frame' }, to: { node: 'output', port: 'in' } }],
    events: [], transport: { bpm: 120, loopSeconds: 12 }, simulation: { tickHz: 60, warmupTicks, events: [] },
  };
}
const kernels = () => gpuState.draws.filter((draw) => draw.params && Object.hasOwn(draw.params, 'initialize'));
const trace = () => kernels().map((draw) => ({ ...draw.params }));

it('uses the declared simulation warmup including a genuinely zero-tick warmup', async () => {
  for (const warmup of [0, 12]) {
    const renderer = await createRenderer(canvas());
    renderer.setPatch(simulationPatch('chemical', warmup));
    gpuState.draws = [];
    await renderer.renderAt(0);
    const steps = trace();
    expect(steps.map((params) => params.tick)).toEqual(Array.from({ length: warmup + 1 }, (_, index) => index - warmup));
    expect(steps[0]!.initialize).toBe(1);
    expect(steps.slice(1).every((params) => params.initialize === 0)).toBe(true);
    renderer.dispose();
  }
});

it('submits identical simulation ticks for 30fps, 60fps, and direct seek to the same time', async () => {
  const traces: Record<string, any>[][] = [];
  for (const fps of [30, 60, 0]) {
    const renderer = await createRenderer(canvas());
    renderer.setPatch(simulationPatch('chemical', 12));
    gpuState.draws = [];
    if (fps) for (let index = 0; index <= fps; index++) await renderer.renderAt(index / fps);
    else await renderer.renderAt(1);
    traces.push(trace());
    renderer.dispose();
  }
  expect(traces[1]).toEqual(traces[0]);
  expect(traces[2]).toEqual(traces[0]);
  expect(traces[0]!.map((params) => params.tick)).toEqual(Array.from({ length: 73 }, (_, index) => index - 12));
});

it('does no new work when a stateful frame is requested again at the same tick', async () => {
  const patch = simulationPatch();
  patch.nodes.push(createNode('fx.feedback', 'feedback'), createNode('fx.chrono', 'chrono'));
  patch.connections = [
    { id: 'a', from: { node: 'simulation', port: 'frame' }, to: { node: 'feedback', port: 'in' } },
    { id: 'b', from: { node: 'feedback', port: 'frame' }, to: { node: 'chrono', port: 'in' } },
    { id: 'c', from: { node: 'chrono', port: 'frame' }, to: { node: 'output', port: 'in' } },
  ];
  const renderer = await createRenderer(canvas());
  renderer.setPatch(patch);
  await renderer.renderAt(0.2);
  const draws = gpuState.draws.length;
  const clears = gpuState.clears;
  await renderer.renderAt(0.2);
  expect(gpuState.draws).toHaveLength(draws);
  expect(gpuState.clears).toBe(clears);
  renderer.dispose();
});

it('preserves the simulation grid across palette edits and display resizing', async () => {
  const patch = simulationPatch('rules');
  const renderer = await createRenderer(canvas(), { width: 640, height: 360 });
  renderer.setPatch(patch);
  await renderer.renderAt(0.2);
  const state = gpuState.targets.filter((target) => target.format === 'r32uint');
  expect(state).toHaveLength(2);
  const allocations = gpuState.targets.length;
  const stepCount = kernels().length;
  const edited = structuredClone(patch);
  edited.nodes[0]!.params.palette = 2;
  renderer.setPatch(edited);
  await renderer.renderAt(0.2);
  renderer.resize(800, 450);
  await renderer.renderAt(0.2);
  expect(kernels()).toHaveLength(stepCount);
  expect(gpuState.targets).toHaveLength(allocations);
  for (const target of state) {
    expect(target.resize).not.toHaveBeenCalled();
    expect(target.destroy).not.toHaveBeenCalled();
    expect(target.size).toEqual([128, 128]);
  }
  expect(gpuState.draws.some((draw) => draw.params?.palette === 2 && draw.params?.aspect === 800 / 450)).toBe(true);
  renderer.dispose();
});

it('reconstructs seeded state and changed rule state counts without reallocating a fixed grid', async () => {
  const patch = simulationPatch('rules');
  const renderer = await createRenderer(canvas());
  renderer.setPatch(patch);
  await renderer.renderAt(0.2);
  const allocations = gpuState.targets.length;
  for (const edit of [{ seed: 93 }, { states: 6 }]) {
    Object.assign(patch.nodes[0]!.params, edit);
    gpuState.draws = [];
    renderer.setPatch(patch);
    await renderer.renderAt(0.2);
    expect(trace()[0]).toMatchObject({ tick: 0, initialize: 1, ...edit });
    expect(gpuState.targets).toHaveLength(allocations);
  }
  renderer.dispose();
});

it('quantizes and preserves ordered events while evaluating the recorded patch at every tick', async () => {
  const patch = simulationPatch();
  patch.simulation!.events = [
    { time: 0.1009, node: 'simulation', kind: 'inject', x: 0.2, y: 0.4, radius: 0.04, amount: 0.7 },
    { time: 0.1009, node: 'simulation', kind: 'inject', x: 0.8, y: 0.6, radius: 0.08, amount: 0.9 },
  ];
  const renderer = await createRenderer(canvas());
  renderer.setPatch(patch);
  const patchAt = vi.fn((time: number) => {
    const at = structuredClone(patch);
    at.nodes[0]!.params.feed = 0.02 + 0.001 * time;
    return at;
  });
  await renderer.renderAt(0.2, { patchAt });
  const injections = trace().filter((params) => params.initialize === 2);
  // Apply at the first tick at/after the timestamp; a performance prefix at tick 6
  // cannot contain an event that does not occur until 0.1009 seconds.
  expect(injections.map((params) => [params.tick, params.injectX, params.injectY, params.radius, params.amount])).toEqual([
    [7, 0.2, 0.4, 0.04, 0.7], [7, 0.8, 0.6, 0.08, 0.9],
  ]);
  expect(patchAt.mock.calls.map(([time]) => time)).toEqual(Array.from({ length: 13 }, (_, index) => index / 60));
  for (const params of trace()) expect(params.feed).toBeCloseTo(0.02 + 0.001 * params.tick / 60, 10);
  renderer.dispose();
});

it('cancels a long rebuild at a completed tick and resumes without skipping or duplicating ticks', async () => {
  const renderer = await createRenderer(canvas());
  renderer.setPatch(simulationPatch());
  const controller = new AbortController();
  const progress: number[] = [];
  await expect(renderer.renderAt(10, { signal: controller.signal, onProgress(fraction) { progress.push(fraction); controller.abort(); } })).rejects.toMatchObject({ name: 'AbortError' });
  const cancelledTicks = trace().map((params) => params.tick);
  expect(cancelledTicks).toEqual(Array.from({ length: 8 }, (_, index) => index));
  expect(progress[0]).toBeGreaterThan(0);
  expect(progress[0]).toBeLessThan(1);
  await renderer.renderAt(0.25);
  expect(trace().map((params) => params.tick)).toEqual(Array.from({ length: 16 }, (_, index) => index));
  renderer.dispose();
});

it('rejects overlapping advancement and replays backward seeks from the explicit origin', async () => {
  const renderer = await createRenderer(canvas());
  renderer.setPatch(simulationPatch('chemical', 8));
  const pending = renderer.renderAt(0.4);
  await expect(renderer.renderAt(0.2)).rejects.toThrow('one frame at a time');
  await pending;
  gpuState.draws = [];
  await renderer.renderAt(0.1);
  expect(trace().map((params) => params.tick)).toEqual(Array.from({ length: 15 }, (_, index) => index - 8));
  expect(trace()[0]!.initialize).toBe(1);
  renderer.dispose();
});

it('allocates bounded temporal atlases and destroys simulation targets exactly once', async () => {
  const patch = simulationPatch();
  patch.nodes.push(createNode('fx.chrono', 'chrono'), createNode('fx.feedback', 'feedback'));
  patch.connections = [
    { id: 'a', from: { node: 'simulation', port: 'frame' }, to: { node: 'chrono', port: 'in' } },
    { id: 'b', from: { node: 'chrono', port: 'frame' }, to: { node: 'feedback', port: 'in' } },
    { id: 'c', from: { node: 'feedback', port: 'frame' }, to: { node: 'output', port: 'in' } },
  ];
  const renderer = await createRenderer(canvas(), { width: 1920, height: 1080, preview: false });
  renderer.setPatch(patch);
  expect(gpuState.targets.filter((target) => target.format === 'rg32float').map((target) => target.size)).toEqual([[128, 128], [128, 128]]);
  expect(gpuState.targets.some((target) => target.size[0] === 5120 && target.size[1] === 1440)).toBe(true);
  expect(gpuState.targets.some((target) => target.size[0] === 640 && target.size[1] === 360)).toBe(true);
  await renderer.renderAt(0);
  renderer.setPatch(createDefaultPatch());
  renderer.dispose();
  renderer.dispose();
  for (const target of gpuState.targets) expect(target.destroy).toHaveBeenCalledTimes(1);
});

it('holds temporal output at fractional display times while updating the analytic display phase', async () => {
  const patch = simulationPatch();
  patch.nodes.push(createNode('fx.feedback', 'feedback'));
  patch.connections = [
    { id: 'a', from: { node: 'simulation', port: 'frame' }, to: { node: 'feedback', port: 'in' } },
    { id: 'b', from: { node: 'feedback', port: 'frame' }, to: { node: 'output', port: 'in' } },
  ];
  const renderer = await createRenderer(canvas());
  renderer.setPatch(patch);
  await renderer.renderAt(1 / 24);
  expect(trace().map((params) => params.tick)).toEqual([0, 1, 2]);
  const feedbackDraws = gpuState.draws.filter((draw) => draw.params && Object.hasOwn(draw.params, 'decay'));
  expect(feedbackDraws).toHaveLength(3);
  const displays = gpuState.draws.filter((draw) => draw.params && Object.hasOwn(draw.params, 'aspect') && !Object.hasOwn(draw.params, 'initialize'));
  expect(displays.at(-1)!.params.phase).toBeCloseTo((1 / 24) / 12 * Math.PI * 2, 8);
  renderer.dispose();
});

it.each(['fx.delay', 'fx.reverb'] as const)('preserves %s capture boundaries across fractional display draws', async (type) => {
  const patch = simulationPatch();
  patch.nodes.push(createNode(type, 'history'));
  patch.connections = [
    { id: 'a', from: { node: 'simulation', port: 'frame' }, to: { node: 'history', port: 'in' } },
    { id: 'b', from: { node: 'history', port: 'frame' }, to: { node: 'output', port: 'in' } },
  ];
  const capturesAt = async (times: number[]) => {
    gpuState.draws = [];
    const renderer = await createRenderer(canvas());
    renderer.setPatch(patch);
    for (const time of times) await renderer.renderAt(time);
    const sourceDisplay = gpuState.draws.find((draw) => draw.state && Object.hasOwn(draw.params ?? {}, 'aspect'))!.__target;
    const captures = gpuState.draws.filter((draw) => draw.src === sourceDisplay && !draw.fx);
    const result = { captures: captures.length, destinations: new Set(captures.map((draw) => draw.__target)).size };
    renderer.dispose();
    return result;
  };
  // The display at .125 crosses the .12 capture boundary between fixed ticks.
  const fractional = await capturesAt([0.125, 0.14]);
  const direct = await capturesAt([0.14]);
  expect(fractional).toEqual(direct);
  expect(direct).toEqual({ captures: 2, destinations: 2 });
});
