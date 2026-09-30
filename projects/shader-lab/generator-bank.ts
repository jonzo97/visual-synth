import { createNode, type NodeType, type Patch } from "./core";

function recipe(
  name: string,
  sourceType: "orbit" | "contour",
  params: Record<string, number>,
  loopSeconds: number,
  effects: { type: NodeType; amount: number }[] = [],
  modulation?: { param: string; depth: number; beats: number },
): Patch {
  const source = createNode(sourceType, sourceType);
  source.position = { x: 0, y: 80 };
  Object.assign(source.params, params);
  const output = createNode("output", "output");
  output.position = { x: 240 * (effects.length + 1), y: 80 };
  const patch: Patch = {
    version: 1,
    name,
    nodes: [source],
    connections: [],
    transport: { bpm: 120, loopSeconds },
    events: [],
  };
  let previous = source.id;
  effects.forEach((effect, index) => {
    const node = createNode(effect.type, `effect-${index}`);
    node.params.amount = effect.amount;
    node.position = { x: 240 * (index + 1), y: 80 };
    patch.nodes.push(node);
    patch.connections.push({
      id: `wire-${index}`,
      from: { node: previous, port: "frame" },
      to: { node: node.id, port: "in" },
    });
    previous = node.id;
  });
  patch.nodes.push(output);
  patch.connections.push({
    id: "wire-output",
    from: { node: previous, port: "frame" },
    to: { node: output.id, port: "in" },
  });
  if (modulation) {
    const lfo = createNode("lfo", "breath");
    lfo.position = { x: 0, y: 360 };
    lfo.params.beats = modulation.beats;
    patch.nodes.push(lfo);
    patch.connections.push({
      id: "wire-breath",
      from: { node: lfo.id, port: "value" },
      to: { node: source.id, port: `param:${modulation.param}` },
      depth: modulation.depth,
    });
  }
  return patch;
}

/** Full portable compositions; separate from the frozen Wander v1 algorithm. */
export const generatorBank: Patch[] = [
  recipe(
    "Neon Conservatory",
    "orbit",
    {
      density: 12,
      petals: 5,
      morph: 0.65,
      fold: 0.35,
      orbit: 0.3,
      glow: 0.45,
      palette: 6,
      offset: 0,
    },
    24,
  ),
  recipe(
    "Amber Astrolabe",
    "orbit",
    {
      density: 7,
      petals: 8,
      morph: 0.9,
      fold: 0.12,
      orbit: 0.65,
      glow: 0.7,
      palette: 8,
      offset: 1.2,
    },
    24,
    [],
    { param: "morph", depth: 0.12, beats: 48 },
  ),
  recipe(
    "Pelagic Atlas",
    "contour",
    {
      density: 11,
      scale: 1.4,
      fold: 0.55,
      drift: 0.6,
      thickness: 0.065,
      fill: 0.22,
      offset: 0,
      palette: 2,
    },
    18,
    [{ type: "fx.glow", amount: 0.2 }],
  ),
  recipe(
    "Bubblegum Estuary",
    "contour",
    {
      density: 7.5,
      scale: 0.85,
      fold: 0.82,
      drift: 0.75,
      thickness: 0.11,
      fill: 0.75,
      offset: 0.8,
      palette: 6,
    },
    24,
    [
      { type: "fx.reverb", amount: 0.45 },
      { type: "fx.crush", amount: 0.25 },
    ],
  ),
];
