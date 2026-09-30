import {
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
  type RackDevice,
  type SynthNode,
} from "./core";

type InsertWhere = { after: string } | { onCable: string } | "beforeOutput";

export interface GraphOpReport {
  addedNodeIds: string[];
  removedNodeIds: string[];
  removedConnectionIds: string[];
  retargetedConnectionIds: string[];
  messages: string[];
}

export interface GraphOpResult {
  patch: Patch;
  report: GraphOpReport;
}

const emptyReport = (): GraphOpReport => ({
  addedNodeIds: [],
  removedNodeIds: [],
  removedConnectionIds: [],
  retargetedConnectionIds: [],
  messages: [],
});

function clone(patch: Patch): Patch {
  return structuredClone(patch);
}

function uniqueId(patch: Patch, type: NodeType): string {
  const stem = type.replace(/[^a-zA-Z0-9_-]/g, "-");
  const random = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? String(Date.now());
  let id = `${stem}-${random}`;
  for (let i = 2; patch.nodes.some((node) => node.id === id); i++) id = `${stem}-${random}-${i}`;
  return id;
}

function uniqueConnectionId(patch: Patch, stem = "wire"): string {
  const random = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? String(Date.now());
  let id = `${stem}-${random}`;
  for (let i = 2; patch.connections.some((edge) => edge.id === id); i++) id = `${stem}-${random}-${i}`;
  return id;
}

function validateResult(patch: Patch): void {
  const errors = validatePatch(patch);
  if (!errors.length) return;
  throw new Error(errors.join("; "));
}

function nodeById(patch: Patch, id: string): SynthNode {
  const node = patch.nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`Device "${id}" was not found`);
  return node;
}

function frameTargetInput(node: SynthNode): string {
  const inputs = frameInputs(node);
  if (!inputs.length) throw new Error(`${manifests[node.type].label} cannot receive frames`);
  return inputs.includes("in") ? "in" : inputs[0]!;
}

function primaryFrameInputEdge(patch: Patch, node: SynthNode): Connection | undefined {
  const input = frameTargetInput(node);
  return patch.connections.find((edge) => edge.to.node === node.id && edge.to.port === input);
}

function outputNode(patch: Patch): SynthNode {
  const output = patch.nodes.find((node) => node.type === "output");
  if (!output) throw new Error("Patch has no screen output");
  return output;
}

function positionBetween(a: SynthNode | undefined, b: SynthNode | undefined): { x: number; y: number } {
  if (a && b) return { x: (a.position.x + b.position.x) / 2, y: (a.position.y + b.position.y) / 2 };
  if (a) return { x: a.position.x + 240, y: a.position.y };
  if (b) return { x: b.position.x - 240, y: b.position.y };
  return { x: 240, y: 80 };
}

function isFrameProcessor(node: SynthNode): boolean {
  return isEffect(node.type) || isMixer(node.type);
}

function canCarryParam(type: NodeType, key: string, value: number): boolean {
  const spec = manifests[type].params[key];
  return !!spec && Number.isFinite(value) && value >= spec.min && value <= spec.max &&
    (spec.modulatable !== false || Number.isInteger(value));
}

function assertCanAddNode(patch: Patch, type: NodeType): void {
  if (patch.nodes.length >= 24) throw new Error("Patch requires at most 24 devices");
  if ((isEffect(type) || isMixer(type)) && patch.nodes.filter(isFrameProcessor).length >= 12)
    throw new Error("At most 12 frame processors are supported");
}

export function insertEffect(patch: Patch, type: NodeType, where: InsertWhere): GraphOpResult {
  const next = clone(patch);
  assertCanAddNode(next, type);
  const report = emptyReport();
  const node = createNode(type, uniqueId(next, type));
  const input = frameTargetInput(node);
  if (!isEffect(node.type) && !isMixer(node.type))
    throw new Error(`${manifests[node.type].label} is not a frame processor`);

  let cable: Connection | undefined;
  if (where === "beforeOutput") cable = primaryFrameInputEdge(next, outputNode(next));
  else if ("onCable" in where) cable = next.connections.find((edge) => edge.id === where.onCable);
  else {
    const from = nodeById(next, where.after);
    cable = next.connections.find((edge) => edge.from.node === from.id && edge.from.port === "frame");
    if (!cable) {
      node.position = positionBetween(from, undefined);
      next.nodes.push(node);
      next.connections.push({
        id: uniqueConnectionId(next),
        from: { node: from.id, port: "frame" },
        to: { node: node.id, port: input },
      });
      report.addedNodeIds.push(node.id);
      validateResult(next);
      return { patch: next, report };
    }
  }
  if (!cable) throw new Error("No frame cable was found for insertion");
  const from = nodeById(next, cable.from.node);
  const to = nodeById(next, cable.to.node);
  node.position = positionBetween(from, to);
  next.nodes.push(node);
  next.connections = next.connections.filter((edge) => edge.id !== cable!.id);
  next.connections.push(
    {
      id: uniqueConnectionId(next),
      from: { node: cable.from.node, port: cable.from.port },
      to: { node: node.id, port: input },
    },
    {
      id: uniqueConnectionId(next),
      from: { node: node.id, port: "frame" },
      to: { node: cable.to.node, port: cable.to.port },
    },
  );
  report.addedNodeIds.push(node.id);
  report.removedConnectionIds.push(cable.id);
  validateResult(next);
  return { patch: next, report };
}

export function insertRackAfter(patch: Patch, entries: readonly RackDevice[], afterNodeId: string): GraphOpResult {
  let next = patch;
  const report = emptyReport();
  let after = afterNodeId;
  for (const entry of entries) {
    const result = insertEffect(next, entry.type, { after });
    next = result.patch;
    const addedId = result.report.addedNodeIds[0]!;
    const node = next.nodes.find((candidate) => candidate.id === addedId)!;
    Object.assign(node.params, entry.params);
    validateResult(next);
    report.addedNodeIds.push(...result.report.addedNodeIds);
    report.removedNodeIds.push(...result.report.removedNodeIds);
    report.removedConnectionIds.push(...result.report.removedConnectionIds);
    report.retargetedConnectionIds.push(...result.report.retargetedConnectionIds);
    report.messages.push(...result.report.messages);
    after = addedId;
  }
  return { patch: next, report };
}

export function replaceSource(patch: Patch, sourceNodeId: string, newType: NodeType): GraphOpResult {
  if (!isGenerator(newType)) throw new Error(`${manifests[newType].label} is not a generator`);
  const next = clone(patch);
  const report = emptyReport();
  const index = next.nodes.findIndex((node) => node.id === sourceNodeId);
  if (index < 0) throw new Error(`Device "${sourceNodeId}" was not found`);
  const old = next.nodes[index]!;
  if (!isGenerator(old.type)) throw new Error(`${manifests[old.type].label} is not a generator`);
  const replacement = createNode(newType, uniqueId(next, newType));
  replacement.position = { ...old.position };
  for (const key of Object.keys(replacement.params))
    if (Object.hasOwn(old.params, key) && canCarryParam(newType, key, old.params[key]!))
      replacement.params[key] = old.params[key]!;
  next.nodes[index] = replacement;

  const params = manifests[newType].params;
  next.connections = next.connections.flatMap((edge) => {
    if (edge.from.node === old.id) {
      report.retargetedConnectionIds.push(edge.id);
      return [{ ...edge, from: { ...edge.from, node: replacement.id } }];
    }
    if (edge.to.node !== old.id) return [edge];
    if (edge.to.port.startsWith("param:") && Object.hasOwn(params, edge.to.port.slice(6))) {
      report.retargetedConnectionIds.push(edge.id);
      return [{ ...edge, to: { ...edge.to, node: replacement.id } }];
    }
    report.removedConnectionIds.push(edge.id);
    report.messages.push(`Dropped modulation to ${manifests[old.type].label} ${edge.to.port}`);
    return [];
  });

  next.events = next.events.filter((event) => event.node !== old.id);
  if (next.simulation) {
    if (isStatefulGenerator(newType))
      next.simulation.events = next.simulation.events.map((event) =>
        event.node === old.id ? { ...event, node: replacement.id } : event,
      );
    else {
      const before = next.simulation.events.length;
      next.simulation.events = next.simulation.events.filter((event) => event.node !== old.id);
      if (before !== next.simulation.events.length)
        report.messages.push("Dropped simulation events for the replaced source");
    }
  }
  if (next.exploration)
    next.exploration.generatedNodeIds = next.exploration.generatedNodeIds.map((id) =>
      id === old.id ? replacement.id : id,
    );
  report.addedNodeIds.push(replacement.id);
  report.removedNodeIds.push(old.id);
  validateResult(next);
  return { patch: next, report };
}

export function replaceMixer(patch: Patch, mixerNodeId: string, newType: "mixer" | "mixer4"): GraphOpResult {
  const next = clone(patch);
  const report = emptyReport();
  const index = next.nodes.findIndex((node) => node.id === mixerNodeId);
  if (index < 0) throw new Error(`Device "${mixerNodeId}" was not found`);
  const old = next.nodes[index]!;
  if (!isMixer(old.type)) throw new Error(`${manifests[old.type].label} is not a mixer`);
  const replacement = createNode(newType, uniqueId(next, newType));
  replacement.position = { ...old.position };
  for (const key of Object.keys(replacement.params))
    if (Object.hasOwn(old.params, key) && canCarryParam(newType, key, old.params[key]!))
      replacement.params[key] = old.params[key]!;
  next.nodes[index] = replacement;
  const allowedInputs = new Set(frameInputs(replacement));
  const params = manifests[newType].params;
  next.connections = next.connections.flatMap((edge) => {
    if (edge.from.node === old.id) {
      report.retargetedConnectionIds.push(edge.id);
      return [{ ...edge, from: { ...edge.from, node: replacement.id } }];
    }
    if (edge.to.node !== old.id) return [edge];
    if (allowedInputs.has(edge.to.port) || edge.to.port.startsWith("param:") && Object.hasOwn(params, edge.to.port.slice(6))) {
      report.retargetedConnectionIds.push(edge.id);
      return [{ ...edge, to: { ...edge.to, node: replacement.id } }];
    }
    report.removedConnectionIds.push(edge.id);
    report.messages.push(`Dropped ${edge.to.port} cable from ${manifests[old.type].label}`);
    return [];
  });
  report.addedNodeIds.push(replacement.id);
  report.removedNodeIds.push(old.id);
  validateResult(next);
  return { patch: next, report };
}

export function removeNode(patch: Patch, nodeId: string): GraphOpResult {
  const next = clone(patch);
  const report = emptyReport();
  const target = nodeById(next, nodeId);
  if (target.type === "output") throw new Error("Screen output cannot be removed");
  const input = frameInputs(target).includes("in") ? "in" : frameInputs(target)[0];
  const incoming = input
    ? next.connections.find((edge) => edge.to.node === target.id && edge.to.port === input)
    : undefined;
  const outgoing = next.connections.filter((edge) => edge.from.node === target.id && edge.from.port === "frame");
  const removed = next.connections.filter((edge) => edge.from.node === target.id || edge.to.node === target.id);
  next.nodes = next.nodes.filter((node) => node.id !== target.id);
  next.connections = next.connections.filter((edge) => edge.from.node !== target.id && edge.to.node !== target.id);
  if (incoming) {
    for (const edge of outgoing) {
      const exists = next.connections.some((candidate) =>
        candidate.to.node === edge.to.node && candidate.to.port === edge.to.port,
      );
      if (!exists) {
        next.connections.push({
          id: uniqueConnectionId(next),
          from: { ...incoming.from },
          to: { ...edge.to },
        });
      }
    }
  }
  next.events = next.events.filter((event) => event.node !== target.id);
  if (next.simulation) next.simulation.events = next.simulation.events.filter((event) => event.node !== target.id);
  if (next.exploration)
    next.exploration.generatedNodeIds = next.exploration.generatedNodeIds.filter((id) => id !== target.id);
  report.removedNodeIds.push(target.id);
  report.removedConnectionIds.push(...removed.map((edge) => edge.id));
  validateResult(next);
  return { patch: next, report };
}
