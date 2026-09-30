import { expect, it } from "vitest";
import { createDefaultPatch, createNode } from "./core";
import { checkTextureBudget, planFrames, textureSpecs, textureBytes, nodeTextureBytes, historySize, FRAME_TEXTURE_BUDGET, frameTextureBudget } from "./render-plan";
it("ignores disconnected generators and control edits in the GPU signature", () => {
  const p = createDefaultPatch(),
    before = planFrames(p);
  p.nodes.push(createNode("contour", "unused"), createNode("lfo", "new-lfo"));
  p.connections.push({
    id: "new-mod",
    from: { node: "new-lfo", port: "value" },
    to: { node: "silk", port: "param:fold" },
    depth: 0.1,
  });
  p.nodes[0]!.params.fold = 0.2;
  p.nodes.reverse();
  p.connections.reverse();
  expect(planFrames(p).signature).toBe(before.signature);
  expect(planFrames(p).nodes.map((n) => n.id)).not.toContain("unused");
});
it("plans both mixer inputs once, in dependency order", () => {
  const p = createDefaultPatch(),
    mix = createNode("mixer", "mix");
  p.nodes.push(mix, createNode("lattice", "second"));
  const out = p.connections.find((e) => e.to.node === "output")!;
  out.to = { node: "mix", port: "a" };
  p.connections.push(
    {
      id: "b",
      from: { node: "second", port: "frame" },
      to: { node: "mix", port: "b" },
    },
    {
      id: "out",
      from: { node: "mix", port: "frame" },
      to: { node: "output", port: "in" },
    },
  );
  const plan = planFrames(p);
  expect(plan.nodes.at(-1)?.id).toBe("mix");
  expect(plan.nodes.filter((n) => n.id === "silk")).toHaveLength(1);
  expect(plan.nodes.map((n) => n.id)).toContain("second");
});
it("rejects oversized texture allocations before creating GPU resources", () => {
  const nodes = Array.from({ length: 12 }, (_, i) =>
    createNode("fx.reverb", `r${i}`),
  );
  expect(() => checkTextureBudget(nodes, 1920, 1080)).toThrow("Choose 720p");
  expect(() =>
    checkTextureBudget(planFrames(createDefaultPatch()).nodes, 1920, 1080),
  ).not.toThrow();
});

it('declares native simulation formats and fixed state grids independently of display pixels', () => {
  for (const [type, format, stateBytes] of [['rules', 'r32uint', 4], ['chemical', 'rg32float', 8]] as const) {
    const node = createNode(type, type);
    node.params.grid = 256;
    expect(textureSpecs(node, 1920, 1080)).toEqual([
      { width: 1920, height: 1080, format: 'rgba16float', count: 1 },
      { width: 256, height: 256, format, count: 2 },
    ]);
    expect(nodeTextureBytes(node, 1920, 1080)).toBe(1920 * 1080 * 8 + 256 * 256 * stateBytes * 2);
    expect(textureSpecs(node, 640, 360)[1]).toEqual(textureSpecs(node, 1920, 1080)[1]);
  }
});

it('caps temporal storage to a 32-tile atlas and one small feedback image', () => {
  expect(historySize(1920, 1080)).toEqual([640, 360]);
  expect(historySize(320, 180)).toEqual([320, 180]);
  expect(historySize(100, 1000)).toEqual([36, 360]);
  const atlas = textureSpecs(createNode('fx.chrono', 'chrono'), 1920, 1080)[1]!;
  expect(atlas).toEqual({ width: 5120, height: 1440, format: 'rgba16float', count: 1 });
  expect(textureBytes(atlas)).toBe(640 * 360 * 32 * 8);
  expect(textureSpecs(createNode('fx.feedback', 'feedback'), 1920, 1080)[1]).toEqual({ width: 640, height: 360, format: 'rgba16float', count: 1 });
});

it('accounts for replacement overlap before admitting a graph to the texture budget', () => {
  const node = createNode('rules', 'rules');
  const needed = nodeTextureBytes(node, 1920, 1080);
  expect(checkTextureBudget([node], 1920, 1080, 0, FRAME_TEXTURE_BUDGET - needed)).toBe(FRAME_TEXTURE_BUDGET);
  expect(() => checkTextureBudget([node], 1920, 1080, 0, FRAME_TEXTURE_BUDGET - needed + 1)).toThrow('512 MiB');
});

it('scales the frame texture budget by resolution and mode', () => {
  expect(frameTextureBudget(1920, 1080)).toBe(FRAME_TEXTURE_BUDGET);
  expect(frameTextureBudget(1280, 720)).toBe(FRAME_TEXTURE_BUDGET);
  expect(frameTextureBudget(2560, 1440)).toBe(Math.round((FRAME_TEXTURE_BUDGET * 2560 * 1440) / (1920 * 1080)));
  expect(frameTextureBudget(2560, 1440) / 1024 / 1024).toBeCloseTo(910, 0);
  expect(frameTextureBudget(3840, 2160)).toBe(1024 * 1024 * 1024);
  expect(frameTextureBudget(3840, 2160, 'offline')).toBe(2 * 1024 * 1024 * 1024);
});

it('plans all mask and field branches once while omitting an unused simulation', () => {
  const a = createNode('pulse', 'a'), b = createNode('cells', 'b'), mask = createNode('resonance', 'mask');
  const warp = createNode('fx.warp', 'warp'), mixer = createNode('fx.mask', 'mix');
  const patch = {
    version: 2 as const, name: 'Branches', nodes: [a, b, mask, warp, mixer, createNode('rules', 'unused'), createNode('output', 'output')],
    connections: [
      { id: 'a', from: { node: 'a', port: 'frame' }, to: { node: 'warp', port: 'in' } },
      { id: 'field', from: { node: 'b', port: 'frame' }, to: { node: 'warp', port: 'field' } },
      { id: 'in', from: { node: 'warp', port: 'frame' }, to: { node: 'mix', port: 'in' } },
      { id: 'b', from: { node: 'b', port: 'frame' }, to: { node: 'mix', port: 'b' } },
      { id: 'mask', from: { node: 'mask', port: 'frame' }, to: { node: 'mix', port: 'mask' } },
      { id: 'out', from: { node: 'mix', port: 'frame' }, to: { node: 'output', port: 'in' } },
    ], events: [], transport: { bpm: 120, loopSeconds: 24 },
  };
  const ids = planFrames(patch).nodes.map((node) => node.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).not.toContain('unused');
  expect(ids.indexOf('b')).toBeLessThan(ids.indexOf('warp'));
  expect(ids.indexOf('mask')).toBeLessThan(ids.indexOf('mix'));
  expect(ids.at(-1)).toBe('mix');
});
