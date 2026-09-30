import type { Patch, SynthNode } from "./core";

/** Only frames that contribute to Screen output need GPU resources. Controls stay in CPU evaluation. */
export function planFrames(patch: Patch) {
  const byId = new Map(patch.nodes.map((n) => [n.id, n]));
  const output = patch.nodes.find((n) => n.type === "output");
  const order: SynthNode[] = [],
    done = new Set<string>(),
    visiting = new Set<string>();
  const edges = patch.connections.filter((e) => e.from.port === "frame");
  function visit(id: string) {
    if (done.has(id)) return;
    if (visiting.has(id)) throw new Error("Frame graph contains a cycle");
    const n = byId.get(id);
    if (!n) throw new Error("Missing frame device");
    visiting.add(id);
    for (const e of edges
      .filter((e) => e.to.node === id)
      .sort((a, b) => a.to.port.localeCompare(b.to.port)))
      visit(e.from.node);
    visiting.delete(id);
    done.add(id);
    if (n.type !== "output") order.push(n);
  }
  if (output) visit(output.id);
  const signature = JSON.stringify([
    order.map((n) => [n.id, n.type]),
    edges
      .filter((e) => done.has(e.to.node))
      .map((e) => [e.from.node, e.to.node, e.to.port])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  ]);
  return { nodes: order, signature };
}
export const targetCount = (node: SynthNode) =>
  node.type === "fx.delay" || node.type === "fx.reverb" ? 5 : 1;
export const FRAME_TEXTURE_BUDGET = 512 * 1024 * 1024;
export type TextureBudgetMode = "interactive" | "offline";
export function frameTextureBudget(
  width: number,
  height: number,
  mode: TextureBudgetMode = "interactive",
) {
  const base = FRAME_TEXTURE_BUDGET * Math.max(1, (width * height) / (1920 * 1080));
  const cap = (mode === "offline" ? 2 : 1) * 1024 * 1024 * 1024;
  return Math.round(Math.min(cap, base));
}
export interface TextureSpec {
  width: number;
  height: number;
  format: GPUTextureFormat;
  count: number;
}
export function historySize(width: number, height: number): [number, number] {
  const scale = Math.min(1, 640 / width, 360 / height);
  return [
    Math.max(1, Math.round(width * scale)),
    Math.max(1, Math.round(height * scale)),
  ];
}
export function textureSpecs(
  node: SynthNode,
  width: number,
  height: number,
): TextureSpec[] {
  const result: TextureSpec[] = [
    { width, height, format: "rgba16float", count: 1 },
  ];
  if (node.type === "video") result.push({ width, height, format: "rgba8unorm", count: 1 });
  if (node.type === "fx.delay" || node.type === "fx.reverb")
    result.push({ width, height, format: "rgba16float", count: 4 });
  if (node.type === "rules" || node.type === "chemical")
    result.push({
      width: node.params.grid ?? 256,
      height: node.params.grid ?? 256,
      format: node.type === "rules" ? "r32uint" : "rg32float",
      count: 2,
    });
  // Ink in Water: velocity/pressure and dye, each an rgba16float ping-pong pair.
  if (node.type === "ink") {
    const g = node.params.grid ?? 256;
    result.push({ width: g, height: g, format: "rgba16float", count: 4 });
  }
  // Slime Mold Wars: two rgba16float trail textures, plus agents (vec4f per cell) and three u32
  // deposits per cell in storage, budgeted as an equivalent 8-byte-per-texel square.
  if (node.type === "slime") {
    const g = node.params.grid ?? 256;
    result.push({ width: g, height: g, format: "rgba16float", count: 2 });
    result.push({ width: g, height: g, format: "rg32float", count: 4 });
  }
  // Attractor density bins are a storage buffer (hits + speed, u32 each), budgeted as the
  // equivalent 8-byte-per-texel square.
  if (node.type === "attractor")
    result.push({ width: 1024, height: 1024, format: "rg32float", count: 1 });
  const [w, h] = historySize(width, height);
  if (node.type === "fx.chrono")
    result.push({
      width: w * 8,
      height: h * 4,
      format: "rgba16float",
      count: 1,
    });
  if (node.type === "fx.feedback")
    result.push({ width: w, height: h, format: "rgba16float", count: 1 });
  return result;
}
export const textureBytes = (spec: TextureSpec) =>
  spec.width * spec.height * spec.count * (["r32uint", "rgba8unorm"].includes(spec.format) ? 4 : 8);
export const nodeTextureBytes = (node: SynthNode, w: number, h: number) =>
  textureSpecs(node, w, h).reduce((sum, s) => sum + textureBytes(s), 0);
export function checkTextureBudget(
  nodes: SynthNode[],
  width: number,
  height: number,
  extraTargets = 0,
  extraBytes = 0,
  mode: TextureBudgetMode = "interactive",
) {
  const budget = frameTextureBudget(width, height, mode);
  const bytes =
    nodes.reduce((sum, n) => sum + nodeTextureBytes(n, width, height), 0) +
    extraTargets * width * height * 8 +
    extraBytes;
  if (bytes > budget)
    throw new Error(
      `This graph needs about ${Math.ceil(bytes / 1024 / 1024)} MiB of frame textures. Choose 720p or reduce temporal effects (${Math.round(budget / 1024 / 1024)} MiB budget).`,
    );
  return bytes;
}
