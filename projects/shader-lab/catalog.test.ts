import { expect, it } from 'vitest';
import { evaluateParameters, manifests, validatePatch } from './core';
import { patchBank } from './bank';
import { generatorBank } from './generator-bank';
import { presetCatalog, isLoopablePreset } from './preset-catalog';
import { releaseBank } from './release-bank';
import breathingPhosphor from './presets/breathing-phosphor.json';
import magneticReverie from './presets/magnetic-reverie.json';
import latticeChoir from './presets/lattice-choir.json';

it('publishes 23 distinct valid portable presets with exactly three usable controls', () => {
  expect(presetCatalog).toHaveLength(23);
  expect(new Set(presetCatalog.map((preset) => preset.id)).size).toBe(23);
  expect(new Set(presetCatalog.map((preset) => preset.name)).size).toBe(23);
  for (const preset of presetCatalog) {
    expect(preset.id).toMatch(/^[a-z0-9-]+$/);
    expect(preset.name).toBe(preset.patch.name);
    expect(preset.bank.length).toBeGreaterThan(0);
    expect(preset.description.length).toBeGreaterThan(20);
    expect(validatePatch(preset.patch), preset.id).toEqual([]);
    expect(validatePatch(JSON.parse(JSON.stringify(preset.patch))), preset.id).toEqual([]);
    expect(preset.duration).toBe(preset.patch.transport.loopSeconds);
    expect(preset.controls).toHaveLength(3);
    expect(new Set(preset.controls.map(({ node, param }) => `${node}:${param}`)).size).toBe(3);
    for (const control of preset.controls) {
      const node = preset.patch.nodes.find((item) => item.id === control.node)!;
      expect(node, `${preset.id}: ${control.node}`).toBeDefined();
      expect(manifests[node.type].params[control.param], `${preset.id}: ${control.param}`).toBeDefined();
      expect(Number.isFinite(node.params[control.param])).toBe(true);
      expect(control.label.length).toBeGreaterThan(0);
    }
  }
});

it('retains all eleven existing recipes without changing their saved data', () => {
  const originals = [breathingPhosphor, magneticReverie, latticeChoir, ...patchBank.map((item) => item.patch), ...generatorBank];
  expect(presetCatalog.slice(0, 11).map((preset) => preset.patch)).toEqual(originals);
  for (let i = 0; i < originals.length; i++) expect(presetCatalog[i]!.patch).not.toBe(originals[i]);
});

it('ships the agreed three banks of four and uses every new source and effect', () => {
  expect(releaseBank.map((preset) => preset.name)).toEqual([
    'Broken Loom', 'Paper Circuit', 'Prismatic Fault', 'Glass Counterpoint',
    'Copper Cathedral', 'Ghost Membrane', 'Nodal Veil', 'Shutter Choir',
    'Alien Microfiche', 'Coral Bloom', 'Acid Mycelium', 'Memory Reef',
  ]);
  for (const bank of ['Cuts & Crystals', 'Resonant Objects', 'Living Matter']) {
    expect(releaseBank.filter((preset) => preset.bank === bank)).toHaveLength(4);
  }
  const types = new Set<string>(releaseBank.flatMap((preset) => preset.patch.nodes.map((node) => node.type)));
  for (const type of ['pulse', 'cells', 'resonance', 'rules', 'chemical', 'fx.warp', 'fx.mask', 'fx.fold', 'fx.morph', 'fx.chrono', 'fx.feedback']) {
    expect(types.has(type), type).toBe(true);
  }
});

it('declares deterministic simulation origins and conservative loop metadata', () => {
  for (const preset of presetCatalog) {
    const chemical = preset.patch.nodes.some((node) => node.type === 'chemical');
    const rules = preset.patch.nodes.some((node) => node.type === 'rules');
    if (chemical || rules) {
      expect(preset.patch.version).toBe(2);
      expect(preset.patch.simulation).toEqual({ tickHz: 60, warmupTicks: chemical ? 600 : 180, events: [] });
      expect(preset.duration).toBe(24);
      expect(preset.loopable).toBe(false);
    }
    if (preset.loopable) {
      expect(isLoopablePreset(preset.patch)).toBe(true);
      const start = evaluateParameters(preset.patch, 0);
      const end = evaluateParameters(preset.patch, preset.duration);
      for (const node of preset.patch.nodes) for (const key of Object.keys(node.params)) {
        expect(end[node.id]![key], `${preset.id} ${node.id}:${key}`).toBeCloseTo(start[node.id]![key]!, 7);
      }
    }
  }
  expect(presetCatalog.find((preset) => preset.id === 'amber-astrolabe')!.loopable).toBe(true);
  expect(presetCatalog.find((preset) => preset.id === 'breathing-phosphor')!.loopable).toBe(false);
});

it('Ghost Membrane strikes are saved gate events driving zero-base resonance gain', () => {
  const patch = releaseBank.find((preset) => preset.id === 'ghost-membrane')!.patch;
  expect(patch.events).toHaveLength(16);
  expect(patch.nodes.find((node) => node.id === 'resonance')!.params.gain).toBe(0);
  expect(evaluateParameters(patch, 0).resonance!.gain).toBe(0);
  expect(evaluateParameters(patch, 0.02).resonance!.gain).toBeGreaterThan(1);
  const restored = JSON.parse(JSON.stringify(patch));
  expect(evaluateParameters(restored, 7)).toEqual(evaluateParameters(patch, 7));
});
