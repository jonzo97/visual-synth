import type { ParameterManifest } from '../core';

/** Stateless analytic source. Phase and aspect are supplied by the renderer. */
export const contourDefinition: {
  label: string;
  description: string;
  params: Record<string, ParameterManifest>;
} = {
  label: 'Contour Drift',
  description: 'Liquid topographic islands: drifting hills, luminous shorelines, and pools of color.',
  params: {
    density: { label: 'Contour density', min: 3, max: 24, step: 0.1, default: 11, modulatable: true },
    scale: { label: 'Landscape scale', min: 0.5, max: 3, step: 0.01, default: 1.4, modulatable: true },
    fold: { label: 'Liquid fold', min: 0, max: 1, step: 0.01, default: 0.55, modulatable: true },
    drift: { label: 'Island drift', min: 0, max: 1, step: 0.01, default: 0.6, modulatable: true },
    thickness: { label: 'Shoreline width', min: 0.025, max: 0.22, step: 0.005, default: 0.065, modulatable: true },
    fill: { label: 'Color pools', min: 0, max: 1, step: 0.01, default: 0.22, modulatable: true },
    offset: { label: 'Tide phase', min: -Math.PI, max: Math.PI, step: 0.01, default: 0, modulatable: true },
    palette: { label: 'Palette', min: 0, max: 8, step: 1, default: 2, modulatable: false },
  },
};
