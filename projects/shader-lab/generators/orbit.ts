import type { ParameterManifest } from '../core';

/** An analytic source: no history, host clock, or renderer dependencies. */
export const orbitDefinition = {
  label: 'Orbital Bloom',
  description: 'Luminous rosette shells orbit three breathing centers, opening into nested petals.',
  params: {
    density: { label: 'Orbital shells', min: 3, max: 28, default: 12, step: 0.1, modulatable: true },
    petals: { label: 'Petal count', min: 2, max: 12, default: 5, step: 1, modulatable: false },
    morph: { label: 'Circle / rosette', min: 0, max: 1, default: 0.65, step: 0.01, modulatable: true },
    fold: { label: 'Petal curl', min: 0, max: 1, default: 0.35, step: 0.01, modulatable: true },
    orbit: { label: 'Center separation', min: 0, max: 1, default: 0.3, step: 0.01, modulatable: true },
    glow: { label: 'Halo', min: 0, max: 1, default: 0.45, step: 0.01, modulatable: true },
    palette: { label: 'Palette', min: 0, max: 8, default: 6, step: 1, modulatable: false },
    offset: { label: 'Phase offset', min: -Math.PI, max: Math.PI, default: 0, step: 0.01, modulatable: true },
  } satisfies Record<string, ParameterManifest>,
};
