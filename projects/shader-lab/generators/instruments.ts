import type { ParameterManifest } from '../core';

const p = (
  label: string, min: number, max: number, value: number,
  step = 0.01, modulatable = true,
): ParameterManifest => ({ label, min, max, default: value, step, modulatable });
// Integer turns per transport loop keep every source periodic at phase + 2π.
const turns = (label: string, min: number, max: number, value: number) => p(label, min, max, value, 1, false);

/**
 * Instruments: Doodle Lab pieces rebuilt as Visual Synth sources, so each one is playable in
 * the Player and patchable as a generator. Time enters only through phase.
 */
export const instrumentDefinitions = {
  complex: {
    category: 'Generators',
    label: 'Complex Kaleidoscope',
    description: 'Domain coloring of a rational function: hue is arg f, contours are log|f|, zeros and poles drift in closed orbits.',
    params: {
      arrangement: p('Zero / pole arrangement', 0, 4, 0, 1, false),
      style: p('Style', 0, 2, 2, 1, false),
      spread: p('Zero / pole spread', 0.3, 2, 1),
      lines: p('Phase lines', 0, 24, 12),
      warp: p('Warp z^k', 1, 6, 1, 1, false),
      iterate: p('Iterate f(f(z))', 0, 1, 0, 1, false),
      drift: p('Handle drift', 0, 1, 0.5),
      spin: turns('Phase spin turns per loop', -3, 3, 1),
      flow: turns('Contour flow per loop', -4, 4, 2),
      zoom: p('View half-height', 0.5, 4, 1.6),
      hue: p('Colour cycle', 0, 1, 0),
      offset: p('Phase offset', -Math.PI, Math.PI, 0),
    },
  },
  julia: {
    category: 'Generators',
    label: 'Breathing Julia',
    description: 'A sphere-traced quaternion Julia set (or Mandelbulb) whose constant breathes on a closed orbit while the camera circles it.',
    params: {
      shape: p('Quaternion Julia / Mandelbulb', 0, 1, 0, 1, false),
      cx: p('c real', -1, 1, -0.2),
      cy: p('c i', -1, 1, 0.6),
      cz: p('c j', -1, 1, 0.2),
      breathe: p('Breathing', 0, 1, 0.6),
      slice: p('4D slice', -1, 1, 0),
      power: p('Mandelbulb power', 2, 10, 8),
      orbit: turns('Camera turns per loop', -2, 2, 1),
      distance: p('Camera distance', 1.8, 5, 2.8),
      tilt: p('Camera tilt', -1.2, 1.2, 0.35),
      glow: p('Glow', 0, 2, 0.8),
      hue: p('Colour cycle', 0, 1, 0.1),
      spread: p('Colour spread', 0, 3, 1.2),
      offset: p('Phase offset', -Math.PI, Math.PI, 0),
    },
  },
  fizz: {
    category: 'Generators',
    label: 'Frost Fizz',
    description: 'A chilled white aluminium can: brushed metal, a sweeping glint, torn silver scratches, condensation beads and rising carbonation.',
    params: {
      palette: p('Finish: white / frost / chrome night', 0, 2, 0, 1, false),
      fizz: p('Carbonation', 0, 1, 0.35),
      bubbleSize: p('Bubble size', 0.4, 2, 1),
      rise: turns('Bubble rise per loop', 1, 6, 2),
      frost: p('Condensation', 0, 1, 0.4),
      claws: p('Scratches', 0, 5, 4, 1, false),
      clawDepth: p('Scratch depth', 0, 1, 0.7),
      slant: p('Scratch slant', -0.5, 0.5, 0.2),
      brushed: p('Brushed metal', 0, 1, 0.6),
      glint: turns('Glint sweeps per loop', -2, 2, 1),
      light: p('Light angle', -1.5, 1.5, -0.4),
      offset: p('Phase offset', -Math.PI, Math.PI, 0),
    },
  },
} as const;
