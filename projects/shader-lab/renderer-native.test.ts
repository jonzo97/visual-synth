import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Gpu, Target } from 'vgpu/node';
import { createNode, type Patch, type SimulationEvent } from './core';
import { performancePatchAt, type PerformanceTake } from './performance';

const nativeState = vi.hoisted(() => ({ announced: false }));
vi.mock('vgpu', async () => {
  const api = await import('vgpu/node');
  return {
    ...api,
    init: async () => {
      const gpu = await api.init({ adapter: 'hardware' });
      if (!nativeState.announced) {
        console.info('Renderer GPU:', gpu.adapter.name, gpu.adapter.type);
        nativeState.announced = true;
      }
      return gpu;
    },
    // Keep the complete renderer/GPU path, replacing only the DOM swapchain.
    surface: (gpu: Gpu, _canvas: HTMLCanvasElement, options: { size: [number, number] }) => {
      const screen = api.target(gpu, { size: options.size, format: 'rgba8unorm' }) as Target & { destroy(): void };
      return Object.assign(screen, { dispose: () => screen.destroy() });
    },
  };
});

import { createRenderer, type SynthRenderer } from './renderer';

// Opt in explicitly; ordinary CI never requests a native GPU adapter.
// PowerShell: $env:DIVERGENT_GPU_TESTS='1'; npx vitest run --config vitest.config.ts projects/shader-lab/renderer-native.test.ts
describe.skipIf(process.env.DIVERGENT_GPU_TESTS !== '1')('native renderer replay pixels', () => {
  const renderers: SynthRenderer[] = [];
  afterEach(async () => {
    for (const renderer of renderers.splice(0)) {
      try {
        await renderer.settled();
      } finally {
        renderer.dispose();
      }
    }
  });

  function chemicalPatch(history?: 'fx.delay' | 'fx.reverb'): Patch {
    const chemical = createNode('chemical', 'chemical');
    Object.assign(chemical.params, { grid: 128, steps: 1, seed: 21, feed: 0.029, kill: 0.057 });
    const patch: Patch = {
      version: 2,
      name: 'Native replay checkpoint',
      nodes: [chemical, createNode('output', 'output')],
      connections: [{ id: 'screen', from: { node: chemical.id, port: 'frame' }, to: { node: 'output', port: 'in' } }],
      events: [],
      transport: { bpm: 120, loopSeconds: 12 },
      simulation: { tickHz: 60, warmupTicks: 0, events: [] },
    };
    if (history) {
      const temporal = createNode(history, 'history');
      temporal.params.amount = 0.9;
      patch.nodes.push(temporal);
      patch.connections = [
        { id: 'source', from: { node: chemical.id, port: 'frame' }, to: { node: temporal.id, port: 'in' } },
        { id: 'screen', from: { node: temporal.id, port: 'frame' }, to: { node: 'output', port: 'in' } },
      ];
    }
    return patch;
  }

  async function open(patch: Patch, width = 160, height = 90) {
    const renderer = await createRenderer({} as HTMLCanvasElement, { width, height, preview: false });
    renderers.push(renderer);
    renderer.setPatch(patch);
    return renderer;
  }
  const equalPixels = (a: Uint8Array, b: Uint8Array) => {
    expect(a.length).toBeGreaterThan(0);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  };
  const differentPixels = (a: Uint8Array, b: Uint8Array) => {
    expect(a.length).toEqual(b.length);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  };

  it.each(['fx.delay', 'fx.reverb'] as const)('matches fractional and direct seeks through chemical → %s', async (history) => {
    const patch = chemicalPatch(history);
    const fractional = await open(patch);
    for (const time of [0.125, 0.14, 0.28]) await fractional.renderAt(time);
    const expected = await open(patch);
    await expected.renderAt(0.28);
    const pixels = await fractional.readFrame();
    equalPixels(pixels, await expected.readFrame());

    // .28 is after three captures, so legacy history is actually visible.
    const bypass = structuredClone(patch);
    bypass.nodes.find((node) => node.id === 'history')!.params.amount = 0;
    const plain = await open(bypass);
    await plain.renderAt(0.28);
    differentPixels(pixels, await plain.readFrame());
  }, 60_000);

  it.each([0, 0.203])('matches static and recorded boundary injections with start time %s', async (startTime) => {
    const patch = chemicalPatch();
    const boundaryTick = Math.ceil(startTime * 60) + 6;
    const event: SimulationEvent = {
      time: boundaryTick / 60 - startTime + 5e-8,
      node: 'chemical', kind: 'inject', x: 0.5, y: 0.5, radius: 0.18, amount: 1,
    };
    const take: PerformanceTake = {
      version: 2, patch, startTime, duration: 1, controls: [], gates: [], simulation: [event],
    };
    const absolute = structuredClone(patch);
    absolute.simulation!.events = [{ ...event, time: startTime + event.time }];
    const finalTime = (boundaryTick + 6) / 60;
    const recorded = await open(patch);
    await recorded.renderAt(finalTime, { patchAt: (time) => performancePatchAt(take, time - startTime) });
    const fixed = await open(absolute);
    await fixed.renderAt(finalTime);
    const pixels = await recorded.readFrame();
    equalPixels(pixels, await fixed.readFrame());

    const untouched = await open(patch);
    await untouched.renderAt(finalTime);
    differentPixels(pixels, await untouched.readFrame());
  }, 60_000);

  it('reconstructs an edited pre-record simulation to the same pixels as a fresh recipe', async () => {
    const original = chemicalPatch();
    const edited = structuredClone(original);
    Object.assign(edited.nodes[0]!.params, { feed: 0.043, kill: 0.061 });
    const live = await open(original);
    await live.renderAt(0.25);
    live.setPatch(edited);
    await live.renderAt(0.5);
    const carriedState = await live.readFrame();

    live.reset();
    live.resize(192, 108);
    await live.renderAt(0.5);
    const fresh = await open(edited, 192, 108);
    await fresh.renderAt(0.5);
    equalPixels(await live.readFrame(), await fresh.readFrame());

    // At the original dimensions, reconstruction also removes the unsaved history.
    const baseline = await open(edited);
    await baseline.renderAt(0.5);
    differentPixels(carriedState, await baseline.readFrame());
  }, 60_000);
});
