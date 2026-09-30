import { describe, expect, it, vi } from "vitest";
import {
  createDefaultPatch,
  createNode,
  isGenerator,
  isStatefulGenerator,
  validatePatch,
  type Patch,
} from "./core";
import { actionsFor, needsReplay } from "./browser-actions";
import { buildIndex, type BrowserItem } from "./browser-index";
import { insertEffect, replaceSource } from "./graph-ops";
import { performanceBank } from "./performance-bank";
import { presetCatalog } from "./preset-catalog";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function item(id: string): BrowserItem {
  const found = buildIndex({ patch: createDefaultPatch(), saved: [{ id: "saved", name: "Saved One", patch: createDefaultPatch() }] })
    .items.find((candidate) => candidate.id === id || candidate.key === id);
  if (!found) throw new Error(`Missing ${id}`);
  return found;
}

function withUuidSeed<T>(run: () => T): T {
  let next = 0;
  const spy = vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() =>
    `${String(++next).padStart(8, "0")}-0000-4000-8000-000000000000`);
  try {
    return run();
  } finally {
    spy.mockRestore();
  }
}

function expectValidPatch(result: { patch: Patch }): void {
  expect(validatePatch(result.patch)).toEqual([]);
}

describe("browser actions", () => {
  it("returns effect insert verbs and targets with and without a selected node", () => {
    const patch = createDefaultPatch();
    const glow = item("fx.glow");
    expect(actionsFor(glow, {}, patch)).toMatchObject({
      verb: "Insert",
      target: "Insert before Screen output",
      valid: true,
    });
    const reverb = patch.nodes.find((node) =>
      node.type === "fx.reverb" && patch.connections.some((edge) => edge.from.node === node.id && edge.to.node === "output"))!;
    expect(actionsFor(glow, { selectedNodeId: reverb.id }, patch)).toMatchObject({
      verb: "Insert",
      target: "Insert after Impulse reverb (end of chain)",
      valid: true,
    });
    const cable = patch.connections.find((edge) => edge.to.node === reverb.id)!;
    expect(actionsFor(glow, { cableId: cable.id }, patch)).toMatchObject({
      verb: "Insert",
      target: "Insert on Color crush → Impulse reverb",
      valid: true,
    });
  });

  it("uses graph ops for effect insertion and source swapping", () => {
    const patch = deepFreeze(createDefaultPatch());
    const glow = item("fx.glow");
    const insertBuilt = withUuidSeed(() => actionsFor(glow, {}, patch).build());
    const insertDirect = withUuidSeed(() => insertEffect(patch, "fx.glow", "beforeOutput"));
    expect(insertBuilt).toEqual(insertDirect);
    expectValidPatch(insertBuilt as { patch: Patch });

    const quasi = item("quasicrystal");
    const swapAction = actionsFor(quasi, {}, patch);
    const swapBuilt = withUuidSeed(() => swapAction.build());
    const swapDirect = withUuidSeed(() => replaceSource(patch, "silk", "quasicrystal"));
    expect(swapBuilt).toEqual(swapDirect);
    expectValidPatch(swapBuilt as { patch: Patch });
  });

  it("returns generator swap verbs and selected-node targets", () => {
    const patch = createDefaultPatch();
    expect(actionsFor(item("quasicrystal"), {}, patch)).toMatchObject({
      verb: "Swap",
      target: "Swap Interference Silk · keeps 3 effects · drops 0 modulation wires",
      valid: true,
    });
    const source = patch.nodes.find((node) => node.id === "silk")!;
    expect(actionsFor(item("orbit"), { selectedNodeId: source.id }, patch)).toMatchObject({
      verb: "Swap",
      target: "Swap Interference Silk · keeps 3 effects · drops 0 modulation wires",
      valid: true,
    });
  });

  it("adds modulators to sensible targets and reports invalid adds", () => {
    const patch = createDefaultPatch();
    const lfo = actionsFor(item("lfo"), {}, deepFreeze(structuredClone(patch)));
    expect(lfo).toMatchObject({
      verb: "Add",
      target: "Add LFO → Interference Silk Fold",
      valid: true,
    });
    expectValidPatch(lfo.build() as { patch: Patch });

    const gate = actionsFor(item("gate"), {}, deepFreeze(structuredClone(patch)));
    expect(gate).toMatchObject({
      verb: "Add",
      target: "Add Manual gate",
      valid: false,
      reason: "Select an ADSR gate input",
    });
  });

  it("loads presets, instruments and saved patches", () => {
    const composition = item("breathing-phosphor");
    const instrument = item("escher-garden");
    const saved = item("saved:saved");
    for (const candidate of [composition, instrument, saved]) {
      const action = actionsFor(candidate, {}, createDefaultPatch());
      expect(action).toMatchObject({
        verb: "Load",
        target: "Load · replaces the patch (Ctrl+Z undoes)",
        valid: true,
      });
      expectValidPatch(action.build() as { patch: Patch });
    }
  });

  it("applies racks only to serial chains", () => {
    const rack = item("Crushed Reverie");
    const action = actionsFor(rack, {}, createDefaultPatch());
    expect(action).toMatchObject({
      verb: "Apply",
      target: "Apply rack · replaces 3 effects",
      valid: true,
    });
    expectValidPatch(action.build() as { patch: Patch });

    const extracted = buildIndex().items.find((candidate) => candidate.kind === "rack" && candidate.path === "Racks/From the presets")!;
    const extractedAction = actionsFor(extracted, {}, createDefaultPatch());
    expect(extractedAction).toMatchObject({ verb: "Apply", valid: true });
    expectValidPatch(extractedAction.build() as { patch: Patch });

    const gemini = buildIndex().items.find((candidate) => candidate.id === "gemini-twin-kaleidoscope")!;
    const geminiAction = actionsFor(gemini, {}, createDefaultPatch());
    expect(geminiAction).toMatchObject({ verb: "Apply", valid: true });
    expectValidPatch(geminiAction.build() as { patch: Patch });

    const sourceA = createNode("silk", "a");
    const sourceB = createNode("orbit", "b");
    const mix = createNode("mixer", "mix");
    const output = createNode("output", "output");
    const branched: Patch = {
      version: 2,
      name: "Layered",
      nodes: [sourceA, sourceB, mix, output],
      connections: [
        { id: "a-mix", from: { node: "a", port: "frame" }, to: { node: "mix", port: "a" } },
        { id: "b-mix", from: { node: "b", port: "frame" }, to: { node: "mix", port: "b" } },
        { id: "mix-out", from: { node: "mix", port: "frame" }, to: { node: "output", port: "in" } },
      ],
      transport: { bpm: 120, loopSeconds: 12 },
      events: [],
    };
    expect(actionsFor(rack, {}, branched)).toMatchObject({
      verb: "Apply",
      target: "Apply rack",
      valid: false,
      reason: "Rack needs a serial chain",
    });
  });

  it("jumps to patch nodes and params", () => {
    const patch = createDefaultPatch();
    const index = buildIndex({ patch });
    const node = index.items.find((candidate) => candidate.kind === "patch-node" && candidate.id === "silk")!;
    const param = index.items.find((candidate) => candidate.kind === "patch-param" && candidate.id === "silk:fold")!;
    expect(actionsFor(node, {}, patch)).toMatchObject({ verb: "Jump", target: "Jump to Interference Silk", valid: true });
    expect(actionsFor(param, {}, patch)).toMatchObject({ verb: "Jump", target: "Jump to Fold - Interference Silk", valid: true });
  });

  it("does not mutate inputs", () => {
    const patch = createDefaultPatch();
    const frozen = deepFreeze(structuredClone(patch));
    actionsFor(item("fx.glow"), {}, frozen).build();
    actionsFor(item("quasicrystal"), {}, frozen).build();
    actionsFor(item("lfo"), {}, frozen).build();
    actionsFor(item("Crushed Reverie"), {}, frozen).build();
    expect(frozen).toEqual(patch);
  });
});

describe("needsReplay", () => {
  const presets = [...presetCatalog, ...performanceBank];

  it("agrees with the renderer replay predicate over all 52 presets", () => {
    expect(presets).toHaveLength(52);
    const defaultPatch = createDefaultPatch();
    for (const preset of presets) {
      const loadedExpected = preset.patch.nodes.some((node) =>
        isStatefulGenerator(node.type) || node.type === "fx.chrono" || node.type === "fx.feedback");
      expect(needsReplay(defaultPatch, preset.patch), `${preset.id}:load`).toBe(loadedExpected);

      const source = preset.patch.nodes.find((node) => isGenerator(node.type));
      if (!source) continue;
      const replacement = source.type === "silk" ? "quasicrystal" : "silk";
      const swapped = withUuidSeed(() => replaceSource(preset.patch, source.id, replacement).patch);
      const swapExpected = swapped.nodes.some((node) =>
        isStatefulGenerator(node.type) || node.type === "fx.chrono" || node.type === "fx.feedback");
      expect(needsReplay(preset.patch, swapped), `${preset.id}:swap`).toBe(swapExpected);
    }
  });

  it("stays live for stateless topology changes", () => {
    const patch = createDefaultPatch();
    const swapped = withUuidSeed(() => replaceSource(patch, "silk", "quasicrystal").patch);
    expect(needsReplay(patch, swapped)).toBe(false);
  });
});
