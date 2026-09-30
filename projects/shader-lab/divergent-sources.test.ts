import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { divergentDefinitions } from './generators/divergent';

// Test this pure contract before/without importing the shared registry or renderer.
const readShader = (name: string) => readFileSync(new URL(`./generators/${name}.wgsl`, import.meta.url), 'utf8');

for (const [type, definition] of Object.entries(divergentDefinitions)) {
  it(`${type} has precisely the renderer's numeric uniform contract`, () => {
    const source = readShader(type);
    const body = source.match(/struct\s+Params\s*\{([^}]+)\}/s)?.[1];
    expect(body).toBeDefined();
    const members = body!.split(',').map((entry) => entry.trim()).filter(Boolean);
    expect(members.every((member) => /^\w+\s*:\s*f32$/.test(member))).toBe(true);
    const fields = members.map((member) => member.split(':')[0]!.trim());
    expect(fields.sort()).toEqual(['phase', 'aspect', ...Object.keys(definition.params)].sort());
    expect(new Set(fields).size).toBe(fields.length);
    expect(definition.category).toBe('Generators');
    expect(definition.label.length).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(definition))).toEqual(definition);

    for (const [key, param] of Object.entries(definition.params)) {
      expect([param.min, param.max, param.default, param.step].every(Number.isFinite), key).toBe(true);
      expect(param.min, key).toBeLessThan(param.max);
      expect(param.default, key).toBeGreaterThanOrEqual(param.min);
      expect(param.default, key).toBeLessThanOrEqual(param.max);
      expect(param.step, key).toBeGreaterThan(0);
      expect(typeof param.modulatable, key).toBe('boolean');
    }
  });

  it(`${type} reuses all nine established palettes without changing their IDs`, () => {
    const palette = (source: string) => source.match(/fn colors\(layer:u32\)->vec3f\s*\{([\s\S]*?return c\[layer\]\/255\.0;\s*)\}/)?.[1]?.replace(/\s/g, '');
    expect(palette(readShader('contour'))).toBeDefined();
    expect(palette(readShader(type))).toBe(palette(readShader('contour')));
    expect(definition.params.palette).toMatchObject({ min: 0, max: 8, step: 1, modulatable: false });
  });
}

it('keeps bounded topology choices discrete and envelope gain available', () => {
  const { pulse, cells, resonance } = divergentDefinitions;
  for (const param of [pulse.params.waveform, pulse.params.density, pulse.params.operation,
    cells.params.sites, cells.params.seed, cells.params.law, resonance.params.modeX, resonance.params.modeY]) {
    expect(param.step).toBe(1);
    expect(param.modulatable).toBe(false);
    expect([param.min, param.max, param.default].every(Number.isInteger)).toBe(true);
  }
  expect(pulse.params.waveform).toMatchObject({ min: 0, max: 3 });
  expect(pulse.params.operation).toMatchObject({ min: 0, max: 2, default: 2 });
  expect(cells.params.sites.max).toBe(48);
  expect(cells.params.seed.max).toBe(65535);
  expect(resonance.params.gain).toMatchObject({ min: 0, max: 2, default: 1, modulatable: true });
});
