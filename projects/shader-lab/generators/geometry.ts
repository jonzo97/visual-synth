import type { ParameterManifest } from '../core';

const p = (
  label: string, min: number, max: number, value: number,
  step = 0.01, modulatable = true,
): ParameterManifest => ({ label, min, max, default: value, step, modulatable });

// Palettes 0–8 are the instrument's shared stops; 9–11 are each page's own set: the
// Geometry Oscillator's gradients (iridescent, stained glass, luma only) or Multigrid's
// glazes (zellige, Delft, terracotta). Luma only is dry signal
// for effects that recolor downstream.
const palette = (value: number) => p('Palette', 0, 11, value, 1, false);
// Integer turns per transport loop keep every source periodic at phase + 2π.
const turns = (label: string, min: number, max: number, value: number) => p(label, min, max, value, 1, false);

/**
 * Ported from the 2026-09-22 Geometry Oscillator page (WebGL2, wall-clock loop).
 * Here each is an analytic WGSL source driven only by phase; the page's mirror folds
 * are the existing Kaleidoscope effect.
 */
export const geometryDefinitions = {
  hyperbolic: {
    category: 'Generators',
    label: 'Hyperbolic Tiling',
    description: 'A {p,q} tiling of the Poincaré disk, drifted through by a Möbius translation.',
    params: {
      sides: p('Polygon sides p', 3, 12, 7, 1, false),
      meet: p('Polygons per vertex q', 3, 12, 3, 1, false),
      drift: p('Möbius drift', 0, 0.65, 0.5),
      spin: turns('Spin turns per loop', -3, 3, 0),
      rotation: p('Rotation', -Math.PI, Math.PI, 0),
      zoom: p('Disk zoom', 0.5, 3, 1),
      edge: p('Edge width', 0.2, 4, 1),
      spread: p('Depth color spread', 0, 0.4, 0.07),
      cycles: turns('Color cycles per loop', 0, 4, 1),
      palette: palette(9),
      offset: p('Phase offset', -Math.PI, Math.PI, 0),
    },
  },
  quasicrystal: {
    category: 'Generators',
    label: 'Quasicrystal',
    description: 'N plane waves at equal angles interfere into a pattern that never repeats.',
    params: {
      symmetry: p('Wave count', 3, 15, 7, 1, false),
      scale: p('Wave frequency', 4, 60, 22),
      flow: turns('Wave cycles per loop', -6, 6, 2),
      twist: p('Wave phase spread', 0, 1, 0),
      bands: p('Contour bands', 0, 32, 16),
      spread: p('Color spread', 0, 2, 0.9),
      rotation: p('Rotation', -Math.PI, Math.PI, 0),
      cycles: turns('Color cycles per loop', 0, 4, 1),
      palette: palette(9),
      offset: p('Phase offset', -Math.PI, Math.PI, 0),
    },
  },
  multigrid: {
    category: 'Generators',
    label: 'Multigrid Zellige',
    description: 'Exact de Bruijn 3–11-fold rhomb tilings with glazed tiles, strapwork or arcs, and phason flips.',
    params: {
      symmetry: p('Symmetry N', 3, 11, 5, 1, false),
      seed: p('Grid seed', 0, 65535, 7, 1, false),
      size: p('Tiles per screen height', 3, 40, 12),
      phasonX: p('Phason X', -1, 1, 0),
      phasonY: p('Phason Y', -1, 1, 0),
      flip: p('Phason orbit (tile flips)', 0, 1, 0.35),
      pan: p('Pan orbit (tiles)', 0, 12, 2),
      color: p('Color by shape / orientation / structure', 0, 2, 0, 1, false),
      lines: p('Lines: none / strapwork / arcs', 0, 2, 1, 1, false),
      grout: p('Grout width', 0, 0.3, 0.07),
      palette: palette(9),
      offset: p('Phase offset', -Math.PI, Math.PI, 0),
    },
  },
  attractor: {
    category: 'Generators',
    label: 'Attractor Exposure',
    description: 'Clifford / de Jong strange attractors as density prints, recomputed on the GPU every frame while their constants orbit.',
    params: {
      kind: p('Clifford / de Jong', 0, 1, 0, 1, false),
      a: p('a', -3, 3, -1.4),
      b: p('b', -3, 3, 1.6),
      c: p('c', -3, 3, 1.0),
      d: p('d', -3, 3, 0.7),
      orbit: p('Constant orbit', 0, 0.5, 0.08),
      zoom: p('Zoom', 0.5, 3, 1),
      exposure: p('Exposure', 0.3, 3, 1.2),
      print: p('Print process', 0, 5, 0, 1, false),
      offset: p('Phase offset', -Math.PI, Math.PI, 0),
    },
  },
  polytope: {
    category: 'Generators',
    label: '4D Polytope',
    description: 'A 16-cell, tesseract or 24-cell rotating through the fourth dimension, drawn as glowing edges.',
    params: {
      shape: p('16-cell / tesseract / 24-cell', 0, 2, 1, 1, false),
      turns: turns('4D turns per loop', 0, 4, 1),
      tumble: turns('3D turns per loop', -3, 3, 0),
      tilt: p('4D tilt', -Math.PI, Math.PI, 0.6),
      perspective: p('4D camera distance', 1.4, 5, 2.6),
      zoom: p('Zoom', 0.4, 3, 1.6),
      thickness: p('Line sharpness', 0.3, 3, 1),
      halo: p('Halo', 0, 1, 0.22),
      depth: p('W depth cue', 0, 1, 0.65),
      cycles: turns('Color cycles per loop', 0, 4, 1),
      palette: palette(9),
      offset: p('Phase offset', -Math.PI, Math.PI, 0),
    },
  },
};
