import { expect, it } from "vitest";
import { createDefaultPatch, createNode, migratePatch, validatePatch } from "./core";
import {
  performancePatchAt,
  migratePerformance,
  parsePerformance,
  validatePerformance,
  type PerformanceTake,
} from "./performance";

function take(): PerformanceTake {
  const patch = createDefaultPatch();
  const gate = createNode("gate", "manual");
  patch.nodes.push(gate);
  const silk = patch.nodes.find((node) => node.type === "silk")!;
  return {
    version: 1,
    patch,
    startTime: 12,
    duration: 3,
    controls: [
      { time: 1, node: silk.id, param: "fold", value: 0.4 },
      { time: 2, node: silk.id, param: "fold", value: 0.9 },
    ],
    gates: [
      { time: 0.5, node: gate.id, on: true },
      { time: 1.5, node: gate.id, on: false },
    ],
  };
}
it("reconstructs forward and backward seeks without mutating initial patch", () => {
  const recording = take();
  expect(validatePerformance(recording)).toEqual([]);
  const fold = (t: number) =>
    performancePatchAt(recording, t).nodes.find((n) => n.type === "silk")!
      .params.fold;
  expect(fold(2.5)).toBe(0.9);
  expect(fold(1.2)).toBe(0.4);
  expect(fold(-1)).toBe(0.65);
  expect(
    recording.patch.nodes.find((n) => n.type === "silk")!.params.fold,
  ).toBe(0.65);
  expect(performancePatchAt(recording, 1).events).toContainEqual({
    time: 12.5,
    node: "manual",
    on: true,
  });
  expect(performancePatchAt(recording, 1).events.some((e) => !e.on)).toBe(
    false,
  );
});

function simulationTake(): PerformanceTake {
  const recording = take();
  recording.version = 2;
  recording.patch = migratePatch(recording.patch);
  recording.patch.nodes[0] = createNode("chemical", "silk");
  recording.patch.simulation!.warmupTicks = 120;
  recording.patch.simulation!.events = [{ time: 0, node: "silk", kind: "reset" }];
  recording.controls = [];
  recording.simulation = [
    { time: 0.5, node: "silk", kind: "reset" },
    { time: 1.5, node: "silk", kind: "inject", x: 0.2, y: 0.8, radius: 0.1, amount: 0.75 },
  ];
  return recording;
}

it("migrates v1 takes to independent checked v2 copies without changing the original", () => {
  const recording = take();
  const original = structuredClone(recording);
  const migrated = migratePerformance(recording);
  expect(migrated).toEqual({ ...recording, version: 2, patch: migratePatch(recording.patch), simulation: [] });
  expect(validatePerformance(migrated)).toEqual([]);
  migrated.controls[0]!.value = 0.1;
  migrated.patch.nodes[0]!.params.fold = 0.1;
  expect(recording).toEqual(original);
  expect(parsePerformance(JSON.stringify(recording))).toEqual(migratePerformance(recording));
});

it("replays simulation events at absolute times with reproducible forward and backward seeks", () => {
  const recording = simulationTake();
  const original = structuredClone(recording);
  expect(validatePerformance(recording)).toEqual([]);
  const later = performancePatchAt(recording, 2);
  expect(later.simulation).toEqual({
    tickHz: 60,
    warmupTicks: 120,
    events: [
      { time: 0, node: "silk", kind: "reset" },
      { time: 12.5, node: "silk", kind: "reset" },
      { time: 13.5, node: "silk", kind: "inject", x: 0.2, y: 0.8, radius: 0.1, amount: 0.75 },
    ],
  });
  expect(validatePatch(later)).toEqual([]);
  expect(performancePatchAt(recording, 1).simulation!.events).toEqual(later.simulation!.events.slice(0, 2));
  expect(performancePatchAt(recording, -1).simulation!.events).toEqual(original.patch.simulation!.events);
  expect(performancePatchAt(recording, 2)).toEqual(later);
  expect(recording).toEqual(original);
  expect(parsePerformance(JSON.stringify(recording))).toEqual(recording);
});

it("rejects unordered, out-of-range, malformed, and non-stateful simulation events", () => {
  const recording = simulationTake();
  for (const events of [
    null,
    [null],
    [...recording.simulation!].reverse(),
    [{ time: 4, node: "silk", kind: "reset" }],
    [{ time: 0, node: "manual", kind: "reset" }],
    [{ time: 0, node: "silk", kind: "inject", x: 1.1, y: 0.5 }],
    [{ time: 0, node: "silk", kind: "inject", x: 0.5, y: 0.5, radius: -1 }],
  ]) {
    const invalid = { ...recording, simulation: events };
    expect(validatePerformance(invalid).length).toBeGreaterThan(0);
    expect(() => migratePerformance(invalid)).toThrow();
  }
});

it("bounds replay to the portable absolute timeline and rejects fractional enum controls", () => {
  const recording = take();
  recording.startTime = 86400;
  expect(validatePerformance(recording)).toContain("Invalid performance start time.");
  recording.startTime = 86397;
  expect(validatePerformance(recording)).toEqual([]);
  recording.controls = [{ time: 1, node: "silk", param: "palette", value: 0.5 }];
  expect(validatePerformance(recording)).toContain("Invalid control event parameter or value.");
});
it("rejects malformed imports, invalid parameters, unordered or out-of-range events", () => {
  for (const input of [
    null,
    {},
    { ...take(), gates: null },
    { ...take(), controls: [null] },
    { ...take(), startTime: NaN },
  ])
    expect(validatePerformance(input).length).toBeGreaterThan(0);
  const wrong = take();
  wrong.controls[0]!.param = "__proto__";
  expect(validatePerformance(wrong).length).toBeGreaterThan(0);
  const unordered = take();
  unordered.controls.reverse();
  expect(validatePerformance(unordered).length).toBeGreaterThan(0);
  const later = take();
  later.gates[0]!.time = 99;
  expect(validatePerformance(later).length).toBeGreaterThan(0);
});

it('keeps simulation setup fixed during a take while accepting growth and palette controls',()=>{
 const recording=simulationTake();
 Object.assign(recording.patch.nodes.find(n=>n.id==='silk')!,createNode('rules','silk'));
 for(const [param,value] of [['grid',512],['seed',99],['states',8]] as const){
  recording.controls=[{time:.1,node:'silk',param,value}];
  expect(validatePerformance(recording).join(' ')).toContain('before recording');
  expect(()=>parsePerformance(JSON.stringify(recording))).toThrow('before recording');
 }
 recording.controls=[{time:.1,node:'silk',param:'palette',value:6},{time:.2,node:'silk',param:'rate',value:8}];
 expect(validatePerformance(recording)).toEqual([]);
});

it.each([0, 12.003])('includes simulation events at their quantized tick with start time %s', (startTime) => {
  const recording = simulationTake();
  recording.startTime = startTime;
  recording.patch.simulation!.events = [];
  const tick = Math.ceil(startTime * 60) + 6;
  const elapsed = tick / 60 - startTime;
  const event = { time: elapsed + 5e-8, node: 'silk', kind: 'inject' as const, x: 0.2, y: 0.8 };
  recording.simulation = [event];
  expect(validatePerformance(recording)).toEqual([]);
  expect(performancePatchAt(recording, elapsed - 2e-7).simulation!.events).toEqual([]);
  expect(performancePatchAt(recording, elapsed).simulation!.events).toEqual([
    { ...event, time: startTime + event.time },
  ]);
  const appliedTicks = [tick - 1, tick, tick + 1].flatMap((at) =>
    performancePatchAt(recording, at / 60 - startTime).simulation!.events
      .filter((item) => Math.ceil((item.time - 1e-7) * 60) === at)
      .map(() => at),
  );
  expect(appliedTicks).toEqual([tick]);
});
