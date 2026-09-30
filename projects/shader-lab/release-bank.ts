import { createNode, isEffect, type NodeType, type Patch } from './core';
import type { CatalogPreset, PresetControl } from './preset-catalog';

type Device = [id: string, type: NodeType, params?: Record<string, number>];
type Wire = [from: string, to: string, port?: string];
const control = (node: string, param: string, label: string): PresetControl => ({ node, param, label });

function composition(
  id: string, bank: string, name: string, description: string,
  devices: Device[], wires: Wire[], controls: [PresetControl, PresetControl, PresetControl],
  loopable = true,
): CatalogPreset {
  let column = 0, sourceRow = 0;
  const nodes = devices.map(([key, type, params]) => {
    const node = createNode(type, key);
    Object.assign(node.params, params);
    if (isEffect(type)) node.position = { x: 260 * ++column, y: 80 };
    else node.position = { x: 0, y: 80 + 230 * sourceRow++ };
    return node;
  });
  const output = createNode('output', 'output');
  output.position = { x: 260 * (column + 1), y: 80 };
  nodes.push(output);
  const stateful = nodes.some((node) => node.type === 'rules' || node.type === 'chemical');
  const patch: Patch = {
    version: stateful ? 2 : 1, name, nodes,
    connections: wires.map(([from, to, port = 'in'], i) => ({
      id: `frame-${i}`, from: { node: from, port: 'frame' }, to: { node: to, port },
    })),
    transport: { bpm: 120, loopSeconds: 24 }, events: [],
    ...(stateful ? { simulation: { tickHz: 60 as const, warmupTicks: nodes.some((n) => n.type === 'chemical') ? 600 : 180, events: [] } } : {}),
  };
  return { id, bank, name, description, patch, duration: 24, loopable: loopable && !stateful, controls };
}

const cuts = 'Cuts & Crystals';
const resonant = 'Resonant Objects';
const living = 'Living Matter';

/** Deliberate multi-input compositions, independent of the original preset banks. */
export const releaseBank: CatalogPreset[] = [
  composition('broken-loom', cuts, 'Broken Loom',
    'Held copper stencils buckle against an irregular cell map, then break into ordered print dots.',
    [['pulse', 'pulse', { waveform: 1, density: 6, hold: 0.7, cut: 0.75, angle: -0.32, palette: 5 }],
      ['cells', 'cells', { sites: 32, seed: 11, motion: 0.3, edge: 0.003, fill: 1, palette: 5 }],
      ['warp', 'fx.warp', { strength: 0.025, mode: 0 }], ['print', 'fx.bayer', { amount: 0.52, scale: 2, threshold: 0.04 }]],
    [['pulse', 'warp'], ['cells', 'warp', 'field'], ['warp', 'print'], ['print', 'output']],
    [control('pulse', 'hold', 'Ratchet hold'), control('pulse', 'cut', 'Cut size'), control('warp', 'strength', 'Cell displacement')]),

  composition('paper-circuit', cuts, 'Paper Circuit',
    'Chartreuse shutters snap through fine etched outlines and a reduced print palette.',
    [['pulse', 'pulse', { waveform: 3, duty: 0.27, hold: 0.65, density: 8, cut: 0.4, operation: 0, angle: 0, palette: 4 }],
      ['etch', 'fx.morph', { mode: 2, kernel: 1, radius: 1, amount: 0.75 }], ['crush', 'fx.crush', { amount: 0.35 }]],
    [['pulse', 'etch'], ['etch', 'crush'], ['crush', 'output']],
    [control('pulse', 'duty', 'Shutter duty'), control('etch', 'amount', 'Etched outline'), control('crush', 'amount', 'Print reduction')]),

  composition('prismatic-fault', cuts, 'Prismatic Fault',
    'Stretched crystalline polygons turn metallic as a horizontal time scan separates their colors.',
    [['cells', 'cells', { sites: 16, seed: 91, stretch: 1.9, motion: 0.7, law: 1, fill: 1, palette: 7 }],
      ['fold', 'fx.fold', { amount: 0.66, folds: 2.4, offset: 0.15, channels: 1 }],
      ['chrono', 'fx.chrono', { amount: 0.75, seconds: 1.4, mode: 0, spread: 0.28 }]],
    [['cells', 'fold'], ['fold', 'chrono'], ['chrono', 'output']],
    [control('cells', 'stretch', 'Crystal stretch'), control('fold', 'folds', 'Prismatic folds'), control('chrono', 'seconds', 'Time fault')], false),

  composition('glass-counterpoint', cuts, 'Glass Counterpoint',
    'Counter-rotating glass cells and orbital petals meet through a geometric difference stencil.',
    [['cells', 'cells', { sites: 36, seed: 303, law: 2, motion: 0.6, stretch: 0.75, fill: 1, palette: 2 }],
      ['orbit', 'orbit', { density: 5, morph: 0.9, fold: 0.2, palette: 6 }],
      ['pulse', 'pulse', { density: 3, waveform: 2, cut: 0.75, operation: 2, palette: 2 }],
      ['mask', 'fx.mask', { mix: 0.75, threshold: 0.2, softness: 0.05, blend: 2 }], ['glow', 'fx.glow', { amount: 0.12 }]],
    [['cells', 'mask'], ['orbit', 'mask', 'b'], ['pulse', 'mask', 'mask'], ['mask', 'glow'], ['glow', 'output']],
    [control('cells', 'motion', 'Glass motion'), control('mask', 'mix', 'Petal difference'), control('mask', 'threshold', 'Stencil threshold')]),

  composition('copper-cathedral', resonant, 'Copper Cathedral',
    'Stationary standing-wave seams thicken into copper architecture with restrained tonal reversals.',
    [['resonance', 'resonance', { modeX: 3, modeY: 5, balance: 0.82, width: 0.018, gain: 1.6, palette: 5 }],
      ['ink', 'fx.morph', { mode: 0, kernel: 1, radius: 1, amount: 0.5 }],
      ['fold', 'fx.fold', { folds: 1.65, offset: -0.08, amount: 0.35 }], ['glow', 'fx.glow', { amount: 0.18 }]],
    [['resonance', 'ink'], ['ink', 'fold'], ['fold', 'glow'], ['glow', 'output']],
    [control('resonance', 'balance', 'Modal balance'), control('resonance', 'width', 'Nodal seam'), control('fold', 'amount', 'Copper reversal')]),

  composition('ghost-membrane', resonant, 'Ghost Membrane',
    'Recorded envelope strikes light a cool nodal plate; slowly turning feedback preserves its afterimage.',
    [['resonance', 'resonance', { modeX: 2, modeY: 7, balance: 1.2, width: 0.015, gain: 0, palette: 2 }],
      ['feedback', 'fx.feedback', { amount: 0.65, decay: 0.955, injection: 0.2, zoom: 1.004, rotate: -0.003 }],
      ['glow', 'fx.glow', { amount: 0.14 }]],
    [['resonance', 'feedback'], ['feedback', 'glow'], ['glow', 'output']],
    [control('resonance', 'exciteX', 'Strike position'), control('resonance', 'damping', 'Modal damping'), control('feedback', 'decay', 'Afterimage retention')], false),

  composition('nodal-veil', resonant, 'Nodal Veil',
    'Fixed resonant seams reveal liquid color pools inside a slow blue interference weave.',
    [['silk', 'silk', { palette: 2, density: 22, fold: 0.32, crossing: 1 }],
      ['contour', 'contour', { palette: 6, density: 7, fill: 0.8 }],
      ['resonance', 'resonance', { modeX: 4, modeY: 7, balance: 0.68, gain: 1.8, palette: 2, width: 0.05 }],
      ['mask', 'fx.mask', { blend: 0, mix: 0.9, threshold: 0.17, softness: 0.08 }], ['glow', 'fx.glow', { amount: 0.14 }]],
    [['silk', 'mask'], ['contour', 'mask', 'b'], ['resonance', 'mask', 'mask'], ['mask', 'glow'], ['glow', 'output']],
    [control('resonance', 'balance', 'Nodal architecture'), control('mask', 'threshold', 'Veil threshold'), control('mask', 'mix', 'Pool visibility')]),

  composition('shutter-choir', resonant, 'Shutter Choir',
    'Golden modal seams jump under held geometric displacement while vertical strips trail through time.',
    [['resonance', 'resonance', { modeX: 5, modeY: 8, balance: 0.92, width: 0.018, gain: 1.5, palette: 8 }],
      ['pulse', 'pulse', { waveform: 0, density: 4, hold: 0.78, cut: 0.8, operation: 1, motion: 0.9, palette: 8 }],
      ['warp', 'fx.warp', { mode: 1, strength: 0.025, boundary: 2 }],
      ['chrono', 'fx.chrono', { amount: 0.9, seconds: 1, mode: 1, spread: 0.13 }]],
    [['resonance', 'warp'], ['pulse', 'warp', 'field'], ['warp', 'chrono'], ['chrono', 'output']],
    [control('pulse', 'hold', 'Shutter hold'), control('warp', 'strength', 'Nodal displacement'), control('chrono', 'seconds', 'Strip age')], false),

  composition('alien-microfiche', living, 'Alien Microfiche',
    'A cyclic automaton reveals acid stencils and glass cells, then erodes the result into microprint.',
    [['rules', 'rules', { states: 9, threshold: 1, rate: 14, seed: 19, palette: 4 }],
      ['pulse', 'pulse', { density: 7, waveform: 3, cut: 0.65, palette: 4 }],
      ['cells', 'cells', { sites: 18, seed: 59, fill: 1, palette: 3 }],
      ['mask', 'fx.mask', { mix: 0.95, threshold: 0.35, softness: 0.04 }],
      ['ink', 'fx.morph', { mode: 1, amount: 0.6, kernel: 0, radius: 1 }], ['print', 'fx.bayer', { amount: 0.35, scale: 2 }]],
    [['pulse', 'mask'], ['cells', 'mask', 'b'], ['rules', 'mask', 'mask'], ['mask', 'ink'], ['ink', 'print'], ['print', 'output']],
    [control('rules', 'rate', 'Invasion speed'), control('mask', 'threshold', 'Cell reveal'), control('ink', 'amount', 'Print erosion')], false),

  composition('coral-bloom', living, 'Coral Bloom',
    'Warm reaction–diffusion islands grow with soft membranes and a quiet halo.',
    [['chemical', 'chemical', { feed: 0.029, kill: 0.057, steps: 5, seed: 21, palette: 1 }],
      ['glow', 'fx.glow', { amount: 0.18 }], ['ink', 'fx.morph', { mode: 0, amount: 0.25, radius: 1, kernel: 0 }]],
    [['chemical', 'glow'], ['glow', 'ink'], ['ink', 'output']],
    [control('chemical', 'feed', 'Nutrient feed'), control('chemical', 'kill', 'Reaction loss'), control('glow', 'amount', 'Warm halo')], false),

  composition('acid-mycelium', living, 'Acid Mycelium',
    'Green reaction fronts become brittle, solarized filaments and fine dithered spores.',
    [['chemical', 'chemical', { feed: 0.037, kill: 0.06, steps: 6, seed: 92, palette: 4 }],
      ['fold', 'fx.fold', { amount: 0.58, folds: 2.6, mode: 1, channels: 1, offset: 0.09 }],
      ['ink', 'fx.morph', { mode: 2, amount: 0.72, kernel: 1, radius: 1 }], ['print', 'fx.bayer', { amount: 0.4, scale: 1 }]],
    [['chemical', 'fold'], ['fold', 'ink'], ['ink', 'print'], ['print', 'output']],
    [control('chemical', 'feed', 'Growth regime'), control('fold', 'amount', 'Acid reversal'), control('ink', 'amount', 'Filament outline')], false),

  composition('memory-reef', living, 'Memory Reef',
    'Cool cellular fronts recirculate into a turning reef with a radial history scan and split color ages.',
    [['rules', 'rules', { states: 18, threshold: 1, rate: 8, seed: 73, palette: 2 }],
      ['feedback', 'fx.feedback', { zoom: 1.006, rotate: 0.002, shiftX: 0.001, amount: 0.55, decay: 0.958, injection: 0.18 }],
      ['chrono', 'fx.chrono', { amount: 0.55, seconds: 1.5, mode: 2, spread: 0.2 }], ['glow', 'fx.glow', { amount: 0.15 }]],
    [['rules', 'feedback'], ['feedback', 'chrono'], ['chrono', 'glow'], ['glow', 'output']],
    [control('rules', 'rate', 'Front speed'), control('feedback', 'decay', 'Reef retention'), control('chrono', 'seconds', 'Radial age')], false),
];

// A recorded, portable gain envelope; the source shader never invents strike time.
const ghost = releaseBank.find((preset) => preset.id === 'ghost-membrane')!.patch;
const gate = createNode('gate', 'strike');
gate.position = { x: 0, y: 350 };
const envelope = createNode('adsr', 'envelope');
envelope.position = { x: 260, y: 350 };
Object.assign(envelope.params, { attack: 0.015, decay: 0.9, sustain: 0.25, release: 3.8 });
ghost.nodes.push(gate, envelope);
ghost.connections.push(
  { id: 'strike-envelope', from: { node: 'strike', port: 'gate' }, to: { node: 'envelope', port: 'gate' } },
  { id: 'strike-gain', from: { node: 'envelope', port: 'value' }, to: { node: 'resonance', port: 'param:gain' }, depth: 1.8 },
);
for (let time = 0; time < 24; time += 3) {
  ghost.events.push({ time, node: 'strike', on: true }, { time: time + 0.18, node: 'strike', on: false });
}
