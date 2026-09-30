import {
  applyRack,
  applyRackEntries,
  createNode,
  frameInputs,
  isEffect,
  isGenerator,
  isMixer,
  isStatefulGenerator,
  manifests,
  validatePatch,
  type Connection,
  type NodeType,
  type Patch,
  type SynthNode,
} from "./core";
import { type BrowserItem } from "./browser-index";
import { insertEffect, replaceMixer, replaceSource, type GraphOpResult } from "./graph-ops";
import { planFrames } from "./render-plan";

export interface ActionContext {
  selectedNodeId?: string;
  cableId?: string;
  mode?: "insert" | "swap" | "add";
}

export type BrowserActionVerb = "Insert" | "Swap" | "Load" | "Apply" | "Add" | "Jump";

export interface BrowserAction {
  verb: BrowserActionVerb;
  target: string;
  valid: boolean;
  reason?: string;
  build(): GraphOpResult | { patch: Patch };
}

const clone = <T>(value: T): T => structuredClone(value);
const labelFor = (node: SynthNode | NodeType): string =>
  manifests[typeof node === "string" ? node : node.type].label;
const isFrameProcessor = (type: NodeType): boolean => isEffect(type) || isMixer(type);
const isModulator = (type: NodeType): boolean => type === "lfo" || type === "gate" || type === "adsr";
const invalid = (verb: BrowserActionVerb, target: string, reason: string): BrowserAction => ({
  verb,
  target,
  valid: false,
  reason,
  build() {
    throw new Error(reason);
  },
});

function validateBuilt(patch: Patch): void {
  const errors = validatePatch(patch);
  if (errors.length) throw new Error(errors.join("; "));
}

function nodeById(patch: Patch, id: string | undefined): SynthNode | undefined {
  return id ? patch.nodes.find((node) => node.id === id) : undefined;
}

function connectionLabel(patch: Patch, edge: Connection): string {
  const from = nodeById(patch, edge.from.node);
  const to = nodeById(patch, edge.to.node);
  return `${from ? labelFor(from) : edge.from.node} → ${to ? labelFor(to) : edge.to.node}`;
}

function primarySourceNode(patch: Patch): SynthNode | undefined {
  const byId = new Map(patch.nodes.map((node) => [node.id, node]));
  let node = patch.nodes.find((candidate) => candidate.type === "output");
  const seen = new Set<string>();
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    const input = frameInputs(node).find((port) =>
      patch.connections.some((edge) => edge.to.node === node!.id && edge.to.port === port && edge.from.port === "frame"));
    const edge = input
      ? patch.connections.find((candidate) => candidate.to.node === node!.id && candidate.to.port === input && candidate.from.port === "frame")
      : undefined;
    node = edge ? byId.get(edge.from.node) : undefined;
    if (node && isGenerator(node.type)) return node;
  }
  return undefined;
}

function outputInputEdge(patch: Patch): Connection | undefined {
  const output = patch.nodes.find((node) => node.type === "output");
  return output ? patch.connections.find((edge) => edge.to.node === output.id && edge.to.port === "in") : undefined;
}

function edgeFromSelectedToOutput(patch: Patch, node: SynthNode): Connection | undefined {
  const outgoing = patch.connections.filter((edge) => edge.from.node === node.id && edge.from.port === "frame");
  if (outgoing.length <= 1) return outgoing[0];
  const reachesOutput = (edge: Connection): boolean => {
    const queue = [edge.to.node];
    const seen = new Set<string>();
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (patch.nodes.find((candidate) => candidate.id === id)?.type === "output") return true;
      queue.push(...patch.connections
        .filter((candidate) => candidate.from.node === id && candidate.from.port === "frame")
        .map((candidate) => candidate.to.node));
    }
    return false;
  };
  return outgoing.find(reachesOutput) ?? outgoing[0];
}

function insertTarget(patch: Patch, context: ActionContext): {
  where: Parameters<typeof insertEffect>[2];
  target: string;
} {
  const cable = context.cableId ? patch.connections.find((edge) => edge.id === context.cableId) : undefined;
  if (cable) return { where: { onCable: cable.id }, target: `Insert on ${connectionLabel(patch, cable)}` };
  const selected = nodeById(patch, context.selectedNodeId);
  if (selected && selected.type !== "output") {
    const edge = edgeFromSelectedToOutput(patch, selected);
    const suffix = edge?.to.node === patch.nodes.find((node) => node.type === "output")?.id || !edge
      ? " (end of chain)"
      : "";
    return { where: { after: selected.id }, target: `Insert after ${labelFor(selected)}${suffix}` };
  }
  const outputEdge = outputInputEdge(patch);
  return {
    where: "beforeOutput",
    target: outputEdge ? `Insert before ${labelFor("output")}` : `Insert before ${labelFor("output")}`,
  };
}

function effectAction(item: BrowserItem, context: ActionContext, patch: Patch): BrowserAction {
  const type = item.id as NodeType;
  const target = insertTarget(patch, context);
  return {
    verb: "Insert",
    target: target.target,
    valid: true,
    build: () => insertEffect(patch, type, target.where),
  };
}

function swapAction(item: BrowserItem, context: ActionContext, patch: Patch): BrowserAction {
  const type = item.id as NodeType;
  const selected = nodeById(patch, context.selectedNodeId);
  const target = selected && isGenerator(selected.type) ? selected : primarySourceNode(patch);
  if (!target) return invalid("Swap", "Swap source", "No source to swap");
  if (isMixer(target.type)) {
    const result = type === "mixer" || type === "mixer4" ? replaceMixer(patch, target.id, type) : undefined;
    return result
      ? {
        verb: "Swap",
        target: `Swap ${labelFor(target)} · drops ${result.report.removedConnectionIds.length} wires`,
        valid: true,
        build: () => replaceMixer(patch, target.id, type as "mixer" | "mixer4"),
      }
      : invalid("Swap", `Swap ${labelFor(target)}`, "Select a source to swap it");
  }
  const preview = replaceSource(patch, target.id, type);
  const keptEffects = preview.patch.nodes.filter((node) => isEffect(node.type)).length;
  const dropped = preview.report.removedConnectionIds.length;
  return {
    verb: "Swap",
    target: `Swap ${labelFor(target)} · keeps ${keptEffects} effects · drops ${dropped} modulation ${dropped === 1 ? "wire" : "wires"}`,
    valid: true,
    build: () => replaceSource(patch, target.id, type),
  };
}

function uniqueId(patch: Patch, stem: string): string {
  const base = stem.replace(/[^a-zA-Z0-9_-]/g, "-");
  const random = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? String(Date.now());
  let id = `${base}-${random}`;
  for (let i = 2; patch.nodes.some((node) => node.id === id); i++) id = `${base}-${random}-${i}`;
  return id;
}

function uniqueConnectionId(patch: Patch, stem = "wire"): string {
  const random = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? String(Date.now());
  let id = `${stem}-${random}`;
  for (let i = 2; patch.connections.some((edge) => edge.id === id); i++) id = `${stem}-${random}-${i}`;
  return id;
}

function firstModulatableParam(node: SynthNode): string | undefined {
  return Object.entries(manifests[node.type].params).find(([, spec]) => spec.modulatable !== false)?.[0];
}

function modulationTarget(patch: Patch, context: ActionContext): { node: SynthNode; param: string } | undefined {
  const candidates = [
    nodeById(patch, context.selectedNodeId),
    primarySourceNode(patch),
    ...patch.nodes,
  ].filter((node): node is SynthNode => !!node);
  for (const node of candidates) {
    const param = firstModulatableParam(node);
    if (param) return { node, param };
  }
  return undefined;
}

function addModulatorPatch(patch: Patch, type: NodeType, context: ActionContext): Patch {
  const next = clone(patch);
  if (next.nodes.length >= 24) throw new Error("Patch requires at most 24 devices");
  if (type === "gate") {
    const adsr = nodeById(next, context.selectedNodeId);
    if (!adsr || adsr.type !== "adsr") throw new Error("Select an ADSR gate input");
    const gate = createNode("gate", uniqueId(next, "gate"));
    gate.position = { x: adsr.position.x - 180, y: adsr.position.y + 120 };
    next.nodes.push(gate);
    next.connections.push({
      id: uniqueConnectionId(next),
      from: { node: gate.id, port: "gate" },
      to: { node: adsr.id, port: "gate" },
    });
    validateBuilt(next);
    return next;
  }
  const target = modulationTarget(next, context);
  if (!target) throw new Error("No modulatable parameter");
  const mod = createNode(type, uniqueId(next, type));
  mod.position = { x: target.node.position.x, y: target.node.position.y + 150 };
  next.nodes.push(mod);
  if (type === "adsr") {
    if (next.nodes.length >= 24) throw new Error("Patch requires at most 24 devices");
    const gate = createNode("gate", uniqueId(next, "gate"));
    gate.position = { x: mod.position.x - 180, y: mod.position.y };
    next.nodes.push(gate);
    next.connections.push({
      id: uniqueConnectionId(next),
      from: { node: gate.id, port: "gate" },
      to: { node: mod.id, port: "gate" },
    });
  }
  next.connections.push({
    id: uniqueConnectionId(next),
    from: { node: mod.id, port: "value" },
    to: { node: target.node.id, port: `param:${target.param}` },
    depth: 0.25,
  });
  validateBuilt(next);
  return next;
}

function modulatorAction(item: BrowserItem, context: ActionContext, patch: Patch): BrowserAction {
  const type = item.id as NodeType;
  try {
    const preview = addModulatorPatch(patch, type, context);
    const added = preview.nodes.find((node) => !patch.nodes.some((old) => old.id === node.id) && node.type === type);
    const wire = preview.connections.find((edge) => edge.from.node === added?.id);
    const targetNode = wire ? nodeById(preview, wire.to.node) : undefined;
    const param = wire?.to.port.startsWith("param:") ? manifests[targetNode!.type].params[wire.to.port.slice(6)]?.label : undefined;
    return {
      verb: "Add",
      target: param && targetNode ? `Add ${item.name} → ${labelFor(targetNode)} ${param}` : `Add ${item.name}`,
      valid: true,
      build: () => ({ patch: addModulatorPatch(patch, type, context) }),
    };
  } catch (error) {
    return invalid("Add", `Add ${item.name}`, error instanceof Error ? error.message : "Cannot add modulator");
  }
}

function loadAction(item: BrowserItem): BrowserAction {
  const patch = item.patch;
  if (!patch) return invalid("Load", "Load · replaces the patch (Ctrl+Z undoes)", "No patch to load");
  return {
    verb: "Load",
    target: "Load · replaces the patch (Ctrl+Z undoes)",
    valid: true,
    build: () => ({ patch: clone(patch) }),
  };
}

function rackAction(item: BrowserItem, patch: Patch): BrowserAction {
  try {
    const preview = item.rackDevices ? applyRackEntries(patch, item.rackDevices) : applyRack(patch, item.id);
    const count = patch.nodes.filter((node) => isEffect(node.type)).length;
    return {
      verb: "Apply",
      target: `Apply rack · replaces ${count} effects`,
      valid: true,
      build: () => ({ patch: clone(preview) }),
    };
  } catch {
    return invalid("Apply", "Apply rack", "Rack needs a serial chain");
  }
}

function jumpAction(item: BrowserItem): BrowserAction {
  return {
    verb: "Jump",
    target: `Jump to ${item.name}`,
    valid: true,
    build: () => ({ patch: undefined as never }),
  };
}

export function actionsFor(item: BrowserItem, context: ActionContext, patch: Patch): BrowserAction {
  if (item.kind === "preset" || item.kind === "saved") return loadAction(item);
  if (item.kind === "rack") return rackAction(item, patch);
  if (item.kind === "patch-param" || item.kind === "patch-node" || item.kind === "place") return jumpAction(item);
  if (item.kind !== "device") return invalid("Jump", `Jump to ${item.name}`, "Unsupported browser item");

  const type = item.id as NodeType;
  if (isGenerator(type)) return swapAction(item, context, patch);
  if (isFrameProcessor(type)) return effectAction(item, context, patch);
  if (isModulator(type)) return modulatorAction(item, context, patch);
  return invalid("Add", `Add ${item.name}`, "Screen output is not insertable");
}

function replayTopologyKey(patch: Patch): string {
  const plan = planFrames(patch);
  return plan.signature + JSON.stringify(
    plan.nodes
      .filter((node) => isStatefulGenerator(node.type))
      .map((node) => [node.id, node.params.grid]),
  );
}

function replayInitialKey(patch: Patch): string {
  const plan = planFrames(patch);
  return JSON.stringify([
    patch.simulation ?? null,
    plan.nodes.filter((node) => node.type === "video").map((node) => [node.id, node.media?.id]),
    plan.nodes
      .filter((node) => isStatefulGenerator(node.type))
      .map((node) => [node.id, node.params.seed, node.params.grid, node.params.states]),
  ]);
}

function hasReplayState(patch: Patch): boolean {
  return planFrames(patch).nodes.some((node) =>
    isStatefulGenerator(node.type) || node.type === "fx.chrono" || node.type === "fx.feedback");
}

// Mirrors renderer rebuild/replay state: setPatch keys topology from planFrames plus
// simulation grid and resets on changes (renderer.ts:206-225, 440); renderAt replays
// from origin only when a pass has simulation state, fx.chrono or fx.feedback
// (renderer.ts:634-653). Stateful generators are core.ts:180-182. Delay/reverb have
// history buffers (renderer.ts:301-303) but are not in renderAt's replay predicate.
export function needsReplay(fromPatch: Patch, toPatch: Patch): boolean {
  if (!hasReplayState(toPatch)) return false;
  return replayTopologyKey(fromPatch) !== replayTopologyKey(toPatch) ||
    replayInitialKey(fromPatch) !== replayInitialKey(toPatch);
}
