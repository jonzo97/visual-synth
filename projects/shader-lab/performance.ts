import {
  manifests,
  migratePatch,
  validatePatch,
  validSimulationEvent,
  isStatefulGenerator,
  type GateEvent,
  type Patch,
  type SimulationEvent,
} from "./core";

export interface PerformanceTake {
  version: 1 | 2;
  patch: Patch;
  startTime: number;
  duration: number;
  controls: { time: number; node: string; param: string; value: number }[];
  gates: GateEvent[];
  simulation?: SimulationEvent[];
}

export function validatePerformance(value: unknown): string[] {
  try {
    return validate(value);
  } catch {
    return ["Performance contains unreadable data."];
  }
}

function validate(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return ["Performance must be an object."];
  const take = value as PerformanceTake;
  const errors = validatePatch(take.patch).map(
    (error) => `Initial patch: ${error}`,
  );
  if (take.version !== 1 && take.version !== 2)
    errors.push("Unsupported performance version.");
  if (!Number.isFinite(take.startTime) || take.startTime < 0 || take.startTime + take.duration > 86400)
    errors.push("Invalid performance start time.");
  if (
    !Number.isFinite(take.duration) ||
    take.duration <= 0 ||
    take.duration > 60.5
  )
    errors.push("Performance duration must be between zero and 60 seconds.");
  if (errors.length) return errors;
  const nodes = new Map(take.patch.nodes.map((node) => [node.id, node]));
  for (const key of ["controls", "gates", "simulation"] as const) {
    const events = take[key];
    if (key === "simulation" && events === undefined) continue;
    if (!Array.isArray(events) || events.length > 20000) {
      errors.push(`Invalid or oversized ${key} event list.`);
      continue;
    }
    let previous = -Infinity;
    for (const event of events) {
      if (!event || typeof event !== "object" || Array.isArray(event)) {
        errors.push(`Invalid ${key} event.`);
        break;
      }
      if (
        !Number.isFinite(event.time) ||
        event.time < 0 ||
        event.time > take.duration ||
        event.time < previous
      ) {
        errors.push(
          `${key} event times must be ordered and within the recording.`,
        );
        break;
      }
      previous = event.time;
      const node = nodes.get(event.node);
      if (!node) {
        errors.push(`${key} event references a missing device.`);
        break;
      }
      if (key === "simulation") {
        if (!validSimulationEvent(event, nodes, take.duration)) {
          errors.push("Invalid simulation event.");
          break;
        }
      } else if (key === "gates") {
        if (
          node.type !== "gate" ||
          typeof (event as GateEvent).on !== "boolean"
        ) {
          errors.push("Invalid gate event.");
          break;
        }
      } else {
        const control = event as PerformanceTake["controls"][number];
        if (typeof control.param !== "string") {
          errors.push("Invalid control parameter name.");
          break;
        }
        const manifest = manifests[node.type]!.params[control.param];
        if(manifest?.recordable===false){errors.push(`Configure ${manifest.label} before recording; it cannot change during a take.`);break;}
        if (
          !manifest ||
          !Object.prototype.hasOwnProperty.call(
            manifests[node.type]!.params,
            control.param,
          ) ||
          !Number.isFinite(control.value) ||
          control.value < manifest.min ||
          control.value > manifest.max ||
          (manifest.modulatable === false && !Number.isInteger(control.value)) ||
          (control.param === "grid" && isStatefulGenerator(node.type) && ![128, 256, 512].includes(control.value))
        ) {
          errors.push("Invalid control event parameter or value.");
          break;
        }
      }
    }
  }
  return errors;
}

/** Upgrade an imported take only after checking the complete recording. */
export function migratePerformance(value: unknown): PerformanceTake {
  const errors = validatePerformance(value);
  if (errors.length) throw new Error(errors.join("; "));
  const take = structuredClone(value as PerformanceTake);
  take.version = 2;
  take.patch = migratePatch(take.patch);
  take.simulation ??= [];
  return take;
}

export function parsePerformance(text: string): PerformanceTake {
  return migratePerformance(JSON.parse(text));
}

/** Pure reconstruction, including backward seeks. Caller validates once when importing. */
export function performancePatchAt(
  take: PerformanceTake,
  elapsed: number,
): Patch {
  const patch = structuredClone(take.patch);
  const until = Math.min(take.duration, elapsed);
  for (const event of take.controls) {
    if (event.time > until) break;
    const node = patch.nodes.find((node) => node.id === event.node);
    if (node) node.params[event.param] = event.value;
  }
  patch.events.push(
    ...take.gates
      .filter((event) => event.time <= until)
      .map((event) => ({ ...event, time: take.startTime + event.time })),
  );
  patch.events.sort((a, b) => a.time - b.time);
  const simulationEvents = take.simulation?.filter((event) => event.time <= until + 1e-7);
  if (simulationEvents?.length) {
    patch.version = 2;
    patch.simulation ??= { tickHz: 60, warmupTicks: 0, events: [] };
    patch.simulation.events.push(
      ...simulationEvents.map((event) => ({ ...event, time: take.startTime + event.time })),
    );
    patch.simulation.events.sort((a, b) => a.time - b.time);
  }
  return patch;
}
