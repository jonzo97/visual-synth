import { type Patch, isStatefulGenerator, validatePatch } from './core';
import { patchBank } from './bank';
import { generatorBank } from './generator-bank';
import breathingPhosphor from './presets/breathing-phosphor.json';
import magneticReverie from './presets/magnetic-reverie.json';
import latticeChoir from './presets/lattice-choir.json';
import { releaseBank } from './release-bank';

export interface PresetControl { node: string; param: string; label: string }
/** Player touch/XY: dragging on the picture sets params and/or injects into a simulation. */
export interface PresetTouch {
  x?: { node: string; param: string };
  y?: { node: string; param: string };
  inject?: string;
  hint: string;
}
export interface CatalogPreset {
  id: string;
  bank: string;
  name: string;
  description: string;
  patch: Patch;
  duration: number;
  loopable: boolean;
  controls: [PresetControl, PresetControl, PresetControl];
  touch?: PresetTouch;
}

/** Conservative metadata: history, state and one-shot events never advertise seamless replay. */
export function isLoopablePreset(patch: Patch): boolean {
  if (patch.events.length || patch.simulation?.events.length) return false;
  if (patch.nodes.some((node) => isStatefulGenerator(node.type) ||
    ['fx.delay', 'fx.reverb', 'fx.chrono', 'fx.feedback', 'fx.vhs'].includes(node.type))) return false;
  return patch.nodes.filter((node) => node.type === 'lfo').every((node) => {
    const rate = node.params.sync ? patch.transport.bpm / 60 / node.params.beats! : node.params.rate!;
    const cycles = patch.transport.loopSeconds * rate;
    return Math.abs(cycles - Math.round(cycles)) < 1e-8;
  });
}

const knob = (node: string, param: string, label: string): PresetControl => ({ node, param, label });
function checkedOriginal(input: unknown): Patch {
  const errors = validatePatch(input);
  if (errors.length) throw new Error(errors.join('; '));
  // Preserve the original schema/data here; explicit import migration belongs to the editor.
  return structuredClone(input as Patch);
}
function existing(id: string, bank: string, patch: Patch, description: string,
  controls: [PresetControl, PresetControl, PresetControl]): CatalogPreset {
  return { id, bank, name: patch.name, description, patch: structuredClone(patch),
    duration: patch.transport.loopSeconds, loopable: isLoopablePreset(patch), controls };
}

const silkKnobs = (): [PresetControl, PresetControl, PresetControl] => [
  knob('silk', 'fold', 'Fabric fold'), knob('silk', 'density', 'Thread density'), knob('silk', 'ratio', 'Frequency ratio'),
];

/** The one public, curated source of truth; the original eleven patches are copied unchanged. */
export const presetCatalog: CatalogPreset[] = [
  existing('breathing-phosphor', 'Original Studies', checkedOriginal(breathingPhosphor),
    'A luminous interference weave with a tempo-synced dither breath.', silkKnobs()),
  existing('magnetic-reverie', 'Original Studies', checkedOriginal(magneticReverie),
    'Magnetic poles bend a cool weave through crushed, staggered echoes.', silkKnobs()),
  existing('lattice-choir', 'Original Studies', checkedOriginal(latticeChoir),
    'Breathing lattice cells with a bright halo and restrained echo.',
    [knob('lattice', 'density', 'Cell density'), knob('lattice', 'fold', 'Field warp'), knob('lattice', 'morph', 'Cell shape')]),
  ...patchBank.map((item) => existing(item.name.toLowerCase().replaceAll(' ', '-'), 'Silk Studies', item.patch, item.description, silkKnobs())),
  ...generatorBank.map((patch) => {
    const orbit = patch.nodes.some((node) => node.type === 'orbit');
    return existing(patch.name.toLowerCase().replaceAll(' ', '-'), 'Orbital & Coastal', patch,
      orbit ? 'Orbital shells and breathing petals in a portable analytic composition.' : 'Drifting topographic islands with luminous shorelines and color pools.',
      orbit ? [knob('orbit', 'density', 'Orbital shells'), knob('orbit', 'morph', 'Petal opening'), knob('orbit', 'orbit', 'Center separation')]
        : [knob('contour', 'density', 'Contour density'), knob('contour', 'fold', 'Liquid fold'), knob('contour', 'fill', 'Color pools')]);
  }),
  ...releaseBank,
];
