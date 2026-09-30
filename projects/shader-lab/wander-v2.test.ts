import { performanceBank } from './performance-bank';
import { expect, it } from 'vitest';
import { createDefaultPatch, isGenerator, manifests, validatePatch } from './core';
import { generatorIds } from './generators/catalog';
import { presetCatalog } from './preset-catalog';
import { generatePatchV2, wanderFamilies } from './wander-v2';

it('reproduces seeded v2 settings and keeps the input intact', () => {
  const start = presetCatalog.find((preset) => preset.id === 'glass-counterpoint')!.patch;
  const snapshot = structuredClone(start);
  const first = generatePatchV2(start, 'counterpoint');
  expect(generatePatchV2(start, 'counterpoint')).toEqual(first);
  expect(start).toEqual(snapshot);
  expect(first.exploration).toMatchObject({ version: 2, algorithm: 'wander-v2', seed: 'counterpoint', family: 'cells', sourceLocked: true });
  expect(first.nodes).not.toEqual(generatePatchV2(start, 'another-seed').nodes);
  expect(validatePatch(first)).toEqual([]);
  expect(JSON.parse(JSON.stringify(first))).toEqual(first);
});

it('source lock preserves a branched graph, every source parameter, palette, event and modulation target', () => {
  for (const preset of presetCatalog.filter((item) => item.patch.nodes.some((node) => node.type.startsWith('fx.')))) {
    const first = generatePatchV2(preset.patch, 'locked-family');
    expect(first.connections, preset.id).toEqual(preset.patch.connections);
    expect(first.events, preset.id).toEqual(preset.patch.events);
    expect(first.simulation, preset.id).toEqual(preset.patch.simulation);
    expect(first.transport, preset.id).toEqual(preset.patch.transport);
    expect(first.nodes.map(({ id, type, position }) => ({ id, type, position }))).toEqual(preset.patch.nodes.map(({ id, type, position }) => ({ id, type, position })));
    for (const node of preset.patch.nodes) {
      const next = first.nodes.find((item) => item.id === node.id)!;
      if (!node.type.startsWith('fx.')) expect(next).toEqual(node);
      for (const key of Object.keys(node.params)) {
        const spec = manifests[node.type].params[key]!;
        if (!spec.modulatable || preset.patch.connections.some((edge) => edge.to.node === node.id && edge.to.port === `param:${key}`)) {
          expect(next.params[key], `${preset.id}:${node.id}:${key}`).toBe(node.params[key]);
        }
        expect(Math.abs(next.params[key]! - node.params[key]!), `${preset.id}:${node.id}:${key}`).toBeLessThanOrEqual((spec.max - spec.min) * 0.08 + 1e-8);
      }
    }
  }
});

it('offers every source family through validated curated topology when unlocked', () => {
  expect(wanderFamilies).toEqual(['all', ...generatorIds]);
  for (const family of generatorIds) for (const seed of ['family-a', 'family-b', 'family-c']) {
    const patch = generatePatchV2(createDefaultPatch(), seed, { family, lockSource: false });
    expect(patch.nodes.find((node) => isGenerator(node.type))!.type).toBe(family);
    expect(patch.exploration).toMatchObject({ algorithm: 'wander-v2', version: 2, family, sourceLocked: false });
    expect(validatePatch(patch), `${family}:${seed}`).toEqual([]);
    expect([...presetCatalog, ...performanceBank].some((preset) => JSON.stringify(preset.patch.connections) === JSON.stringify(patch.connections))).toBe(true);
  }
});

it('rejects invalid choices and explains a dry source lock without modifying input', () => {
  const current = createDefaultPatch();
  const snapshot = structuredClone(current);
  expect(() => generatePatchV2(current, '')).toThrow('seed');
  expect(() => generatePatchV2(current, 'x'.repeat(81))).toThrow('seed');
  expect(() => generatePatchV2(current, 'valid', { family: 'missing' as never })).toThrow('family');
  const dry = presetCatalog.find((preset) => preset.id === 'neon-conservatory')!.patch;
  expect(() => generatePatchV2(dry, 'locked')).toThrow('Add an effect or unlock');
  expect(current).toEqual(snapshot);
});

