import type { ParameterManifest } from '../core';

const p = (
  label: string, min: number, max: number, value: number,
  step = 0.01, modulatable = true,
): ParameterManifest => ({ label, min, max, default: value, step, modulatable });

/** Numeric, renderer-independent contracts. Phase is radians; every source loops at 2π. */
export const divergentDefinitions = {
  pulse: {
    category: 'Generators',
    label: 'Pulse Foundry',
    params: {
      waveform: p('Triangle / saw / square / pulse', 0, 3, 0, 1, false),
      density: p('Stencil rows', 2, 12, 5, 1, false),
      duty: p('Rise / pulse duty', 0.15, 0.85, 0.38),
      hold: p('Ratchet hold', 0, 0.85, 0.4),
      cut: p('Cut size', 0, 1, 0.58),
      operation: p('Union / intersect / subtract', 0, 2, 2, 1, false),
      motion: p('Shutter travel', 0, 1, 0.72),
      angle: p('Stencil angle', -Math.PI, Math.PI, -0.18),
      palette: p('Palette', 0, 8, 1, 1, false),
      offset: p('Phase offset', -Math.PI, Math.PI, 0),
    },
  },
  cells: {
    category: 'Generators',
    label: 'Cell Press',
    params: {
      sites: p('Site count', 8, 48, 24, 1, false),
      seed: p('Site seed', 0, 65535, 17, 1, false),
      stretch: p('Cell stretch', 0.4, 2.5, 1.1),
      motion: p('Site motion', 0, 1, 0.48),
      law: p('Orbit / drift / counterflow', 0, 2, 0, 1, false),
      edge: p('Membrane width', 0, 0.05, 0.009),
      fill: p('Interior fill', 0, 1, 0.88),
      palette: p('Palette', 0, 8, 6, 1, false),
      offset: p('Phase offset', -Math.PI, Math.PI, 0),
    },
  },
  resonance: {
    category: 'Generators',
    label: 'Resonant Plate',
    params: {
      modeX: p('Mode X', 1, 12, 3, 1, false),
      modeY: p('Mode Y', 1, 12, 5, 1, false),
      balance: p('Mode balance', 0, 1.5, 1),
      exciteX: p('Excitation X', 0, 1, 0.31),
      exciteY: p('Excitation Y', 0, 1, 0.43),
      damping: p('High-mode damping', 0, 1, 0.25),
      width: p('Nodal width', 0.003, 0.09, 0.022, 0.001),
      gain: p('Excitation gain · ADSR', 0, 2, 1),
      palette: p('Palette', 0, 8, 5, 1, false),
      offset: p('Vibration phase', -Math.PI, Math.PI, 0),
    },
  },
};
