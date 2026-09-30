import {
  createNode,
  isEffect,
  isGenerator,
  validatePatch,
  type NodeType,
  type Patch,
} from "./core";

/** Versioned algorithm: same seed + same starting patch + scope reproduces the recipe. */
function random(seed: string) {
  let state = 2166136261;
  for (const c of `wander-v1:${seed}`) {
    state ^= c.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const round = (v: number) => Math.round(v * 1000) / 1000;
type Recipe = { type: NodeType; amount: number };
/** A rack replacement must not silently flatten a user's routing graph. */
function activeEffects(patch: Patch): Set<string> {
  const guidance =
    "Effects-only exploration requires one serial generator → effects → output chain. Save this patch first, then use Whole patch mode to explore branched or mixed compositions.";
  if (patch.nodes.filter((n) => isGenerator(n.type)).length !== 1)
    throw new Error(guidance);
  const output = patch.nodes.find((n) => n.type === "output");
  if (!output) throw new Error(guidance);
  const effects = new Set<string>();
  const visited = new Set([output.id]);
  let destination = output.id;
  while (true) {
    const incoming = patch.connections.filter(
      (e) => e.to.node === destination && e.from.port === "frame",
    );
    if (incoming.length !== 1) throw new Error(guidance);
    const edge = incoming[0]!;
    const source = patch.nodes.find((n) => n.id === edge.from.node);
    if (!source || visited.has(source.id)) throw new Error(guidance);
    if (
      patch.connections.filter(
        (e) => e.from.node === source.id && e.from.port === "frame",
      ).length !== 1
    )
      throw new Error(guidance);
    if (isGenerator(source.type)) return effects;
    if (!isEffect(source.type)) throw new Error(guidance);
    visited.add(source.id);
    effects.add(source.id);
    destination = source.id;
  }
}
function chain(
  patch: Patch,
  recipes: Recipe[],
  prefix: string,
  replace = new Set<string>(),
) {
  const source = patch.nodes.find((n) => isGenerator(n.type)),
    output = patch.nodes.find((n) => n.type === "output");
  if (!source || !output)
    throw new Error("Add a generator and output before exploring effects.");
  patch.nodes = patch.nodes.filter((n) => !replace.has(n.id));
  const retained = new Set(patch.nodes.map((n) => n.id));
  patch.connections = patch.connections.filter(
    (e) =>
      retained.has(e.from.node) &&
      retained.has(e.to.node) &&
      e.to.node !== output.id,
  );
  patch.events = patch.events.filter((e) => retained.has(e.node));
  const reserved = new Set([
    ...retained,
    ...patch.connections.map((e) => e.id),
  ]);
  const id = (base: string) => {
    let key = base,
      i = 1;
    while (reserved.has(key)) key = `${base}-${i++}`;
    reserved.add(key);
    return key;
  };
  let previous = source.id;
  const effects = recipes.map((recipe, i) => {
    const n = createNode(recipe.type, id(`${prefix}-fx-${i}`));
    n.params.amount = recipe.amount;
    n.position = { x: 240 * (i + 1), y: 80 };
    patch.nodes.push(n);
    patch.connections.push({
      id: id(`${prefix}-wire-${i}`),
      from: { node: previous, port: "frame" },
      to: { node: n.id, port: "in" },
    });
    previous = n.id;
    return n;
  });
  output.position = { x: 240 * (recipes.length + 1), y: 80 };
  patch.connections.push({
    id: id(`${prefix}-out`),
    from: { node: previous, port: "frame" },
    to: { node: output.id, port: "in" },
  });
  return { effects, id };
}
function base(name: string, type: NodeType = "silk"): Patch {
  const source = createNode(type, type);
  source.position = { x: 0, y: 80 };
  return {
    version: 1,
    name,
    nodes: [source, createNode("output", "output")],
    connections: [],
    events: [],
    transport: { bpm: 120, loopSeconds: 12 },
  };
}
function curated(
  name: string,
  description: string,
  params: Record<string, number>,
  recipes: Recipe[],
  mod?: { param: string; depth: number; beats: number },
) {
  const patch = base(name);
  Object.assign(patch.nodes[0]!.params, params);
  chain(patch, recipes, "bank");
  if (mod) {
    const lfo = createNode("lfo", "bank-lfo");
    lfo.params.beats = mod.beats;
    lfo.position = { x: 0, y: 470 };
    patch.nodes.push(lfo);
    patch.connections.push({
      id: "bank-mod",
      from: { node: lfo.id, port: "value" },
      to: { node: "silk", port: `param:${mod.param}` },
      depth: mod.depth,
    });
  }
  return { name, description, patch };
}
export const patchBank = [
  curated(
    "Velvet Undertow",
    "Slow pink/cyan folds, soft halos and drifting echoes.",
    {
      palette: 6,
      density: 22,
      fold: 0.42,
      crossing: 3,
      angle: 1.24,
      ratio: 1.35,
    },
    [
      { type: "fx.reverb", amount: 0.58 },
      { type: "fx.glow", amount: 0.32 },
      { type: "fx.delay", amount: 0.28 },
    ],
    { param: "offset", depth: 0.55, beats: 32 },
  ),
  curated(
    "Acid Fax",
    "Chartreuse weave through chunky dither and torn tape.",
    {
      palette: 4,
      density: 42,
      fold: 0.7,
      crossing: 1,
      angle: 0.65,
      ratio: 2.2,
    },
    [
      { type: "fx.bayer", amount: 0.8 },
      { type: "fx.crush", amount: 0.32 },
      { type: "fx.vhs", amount: 0.24 },
    ],
  ),
  curated(
    "Solar Ghosts",
    "Apricot crossings with luminous, staggered afterimages.",
    {
      palette: 8,
      density: 26,
      fold: 0.57,
      crossing: 2,
      angle: 2.15,
      mode: 3,
      strength: 0.23,
    },
    [
      { type: "fx.delay", amount: 0.4 },
      { type: "fx.reverb", amount: 0.65 },
      { type: "fx.glow", amount: 0.25 },
    ],
    { param: "strength", depth: 0.16, beats: 24 },
  ),
  curated(
    "Midnight Relay",
    "Electric lines broken into a restless broadcast.",
    {
      palette: 7,
      density: 54,
      fold: 0.76,
      crossing: 2,
      angle: 0.38,
      ratio: 2.6,
    },
    [
      { type: "fx.vhs", amount: 0.53 },
      { type: "fx.delay", amount: 0.42 },
      { type: "fx.crush", amount: 0.28 },
    ],
    { param: "offset", depth: 0.3, beats: 8 },
  ),
];

export function generatePatch(
  current: Patch,
  seed: string,
  scope: "effects" | "whole" = "effects",
): Patch {
  if (!seed.trim() || seed.length > 80)
    throw new Error("Enter a seed between 1 and 80 characters.");
  const replacing =
    scope === "effects" ? activeEffects(current) : new Set<string>();
  if (scope === "effects") {
    // Explicit provenance, never a naming convention, establishes ownership.
    for (const key of current.exploration?.generatedNodeIds ?? []) {
      const node = current.nodes.find((n) => n.id === key);
      if (node && (node.type === "lfo" || isEffect(node.type)))
        replacing.add(key);
    }
  }
  const r = random(seed),
    pick = <T>(items: readonly T[]) => items[Math.floor(r() * items.length)]!;
  const patch =
    scope === "whole"
      ? base(`Wander v1 · ${seed}`, pick(["silk", "lattice"] as const))
      : structuredClone(current);
  patch.name = `Wander v1 · ${seed}`;
  if (scope === "whole") {
    const lattice = patch.nodes[0]!.type === "lattice";
    Object.assign(patch.nodes[0]!.params, {
      palette: pick([3, 4, 5, 6, 7, 8]),
      density: Math.round(lattice ? 8 + r() * 20 : 18 + r() * 42),
      fold: round(0.25 + r() * 0.6),
      offset: round((r() - 0.5) * 3),
      ratio: round(0.7 + r() * 2),
      ...(lattice
        ? { morph: round(r()) }
        : {
            crossing: pick([1, 2, 3]),
            angle: round(0.3 + r() * 2.4),
            mode: pick([0, 0, 2, 3]),
            strength: round(0.15 + r() * 0.35),
          }),
    });
  }
  const count = 3 + Math.floor(r() * 3),
    recipes: Recipe[] = [];
  let temporals = 0;
  for (let i = 0; i < count; i++) {
    const type = pick(
      (temporals < 2
        ? ["fx.glow", "fx.bayer", "fx.delay", "fx.reverb", "fx.crush", "fx.vhs"]
        : ["fx.glow", "fx.bayer", "fx.crush", "fx.vhs"]) as NodeType[],
    );
    if (type === "fx.delay" || type === "fx.reverb") temporals++;
    recipes.push({
      type,
      amount: round(0.2 + r() * (type === "fx.glow" ? 0.4 : 0.65)),
    });
  }
  const { effects, id } = chain(patch, recipes, "wander", replacing);
  for (const n of effects)
    if (n.type === "fx.bayer") {
      n.params.scale = pick([1, 2, 3, 4, 6]);
      n.params.threshold = round((r() - 0.5) * 0.25);
    }
  const lfo = createNode("lfo", id("wander-lfo"));
  lfo.params.beats = pick([8, 16, 24, 32]);
  lfo.params.shape = pick([0, 1]);
  lfo.position = { x: 240, y: 470 };
  patch.nodes.push(lfo);
  const mod = pick(effects);
  patch.connections.push({
    id: id("wander-mod"),
    from: { node: lfo.id, port: "value" },
    to: { node: mod.id, port: "param:amount" },
    depth: round(0.08 + r() * 0.15),
  });
  patch.exploration = {
    version: 1,
    seed,
    scope,
    generatedNodeIds:
      scope === "whole"
        ? patch.nodes.map((n) => n.id)
        : [...effects.map((n) => n.id), lfo.id],
  };
  const errors = validatePatch(patch);
  if (errors.length) throw new Error(errors.join(" "));
  return patch;
}
