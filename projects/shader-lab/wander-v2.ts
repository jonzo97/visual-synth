import { isEffect, isGenerator, manifests, validatePatch, type Patch, type SynthNode } from './core';
import { generatorIds, type GeneratorType } from './generators/catalog';
import { presetCatalog } from './preset-catalog';
import { performanceBank } from './performance-bank';

export type WanderFamily = GeneratorType | 'all';
export const wanderFamilies: readonly WanderFamily[] = ['all', ...generatorIds];
export interface WanderV2Options { family?: WanderFamily; lockSource?: boolean }

function random(seed: string) {
  let state = 2166136261;
  for (const character of `wander-v2:${seed}`) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const familyOf = (patch: Patch): GeneratorType | undefined => patch.nodes.find((node) => isGenerator(node.type))?.type as GeneratorType | undefined;

function mutate(node: SynthNode, patch: Patch, r: () => number): boolean {
  let changed = false;
  for (const [key, spec] of Object.entries(manifests[node.type].params)) {
    // Modes, seeds, palettes, grids and recorded modulation targets keep their authored meaning.
    if (!spec.modulatable || ['palette', 'seed', 'grid'].includes(key) ||
      patch.connections.some((edge) => edge.to.node === node.id && edge.to.port === `param:${key}`)) continue;
    const current = node.params[key]!;
    const span = spec.max - spec.min;
    // Keep chemical regimes close to the auditioned recipe; topology/seed never changes here.
    const limit = node.type === 'chemical' ? Math.min(span * 0.04, spec.step) : span * 0.08;
    if (limit < spec.step) continue;
    const direction = r() < 0.5 ? -1 : 1;
    const distance = Math.max(spec.step, limit * (0.35 + 0.65 * r()));
    const quantize = (value: number) => {
      const snapped = spec.min + Math.round((value - spec.min) / spec.step) * spec.step;
      return Number(Math.max(spec.min, Math.min(spec.max, snapped)).toFixed(8));
    };
    let value = quantize(current + direction * distance);
    if (Math.abs(value - current) < 1e-8) value = quantize(current - direction * distance);
    // Quantization can add half a step. Enforce the promised bound after snapping.
    if (Math.abs(value - current) > limit + 1e-8) value = quantize(current + Math.sign(value - current) * Math.max(0, limit - spec.step * 0.5));
    if (Math.abs(value - current) > 1e-8 && Math.abs(value - current) <= limit + 1e-8) {
      node.params[key] = value;
      changed = true;
    }
  }
  return changed;
}

/**
 * Frozen Wander v2 algorithm. Locked: retain every source, wire, palette and event; vary existing FX.
 * Unlocked: choose a curated composition by its primary source family, then make bounded variations.
 * Family selection applies to unlocked exploration. Neither path rewires a selected composition.
 */
export function generatePatchV2(current: Patch, seed: string, options: WanderV2Options = {}): Patch {
  if (!seed.trim() || seed.length > 80) throw new Error('Enter a seed between 1 and 80 characters.');
  const requestedFamily = options.family ?? 'all';
  if (!wanderFamilies.includes(requestedFamily)) throw new Error('Choose an available source family.');
  const inputErrors = validatePatch(current);
  if (inputErrors.length) throw new Error(inputErrors.join(' '));
  const r = random(seed);
  const sourceLocked = options.lockSource ?? true;
  // Preserve existing seeded selections: families absent from the frozen catalog use the audition pool.
  const pool = requestedFamily === 'all' || presetCatalog.some((preset) => familyOf(preset.patch) === requestedFamily)
    ? presetCatalog : performanceBank;
  const candidates = pool.filter((preset) => requestedFamily === 'all' || familyOf(preset.patch) === requestedFamily);
  if (!candidates.length) throw new Error('No curated composition exists for this source family.');
  const chosen = sourceLocked ? current : candidates[Math.floor(r() * candidates.length)]!.patch;
  const patch = structuredClone(chosen);
  const family = familyOf(patch);
  if (!family) throw new Error('Add a source before exploring.');
  let changed = false;
  for (const node of patch.nodes) {
    if (!isEffect(node.type) && (sourceLocked || !isGenerator(node.type))) continue;
    changed = mutate(node, patch, r) || changed;
  }
  if (sourceLocked && !changed) throw new Error('Add an effect or unlock the source to explore a new composition.');
  patch.name = `Wander v2 · ${seed}`;
  patch.exploration = {
    version: 2, algorithm: 'wander-v2', seed, family, sourceLocked,
    generatedNodeIds: sourceLocked ? [...(current.exploration?.generatedNodeIds ?? [])] : patch.nodes.map((node) => node.id),
  };
  const errors = validatePatch(patch);
  if (errors.length) throw new Error(errors.join(' '));
  return patch;
}
