import {
  effect,
  target,
  frame,
  type Effect,
  type Target,
  type Gpu,
} from "vgpu";
import type { SynthNode, SimulationEvent } from "./core";
import { isSimulation } from "./generators/simulation";
import rulesStep from "./generators/rules-step.wgsl?raw";
import chemicalStep from "./generators/chemical-step.wgsl?raw";
import { createSlimePass } from "./slime-runtime";
import { createInkPass } from "./ink-runtime";
type Owned = Target & { destroy(): void };
type Pool = (
  family: string,
  create: () => Effect,
  preferred?: Effect,
) => Effect;
export interface SimulationPass {
  readonly targets: Owned[];
  current(): Target;
  reserve(pooled: Pool): void;
  reset(): void;
  step(
    params: Record<string, number>,
    tick: number,
    events: SimulationEvent[],
    /** Output width / height, for mapping screen-space events into the field. */
    aspect?: number,
  ): void;
  dispose(): void;
}
/** Integer grid state / chemical concentration, deliberately separate from display colors. */
export function createSimulationPass(
  gpu: Gpu,
  node: SynthNode,
  pooled: Pool,
): SimulationPass {
  if (!isSimulation(node.type)) throw new Error("Not a simulation source");
  if (node.type === "slime") return createSlimePass(gpu, node, pooled);
  if (node.type === "ink") return createInkPass(gpu, node, pooled);
  const size = node.params.grid ?? 256,
    format = node.type === "rules" ? "r32uint" : "rg32float";
  const targets: Owned[] = [];
  try {
    for (let i = 0; i < 2; i++)
      targets.push(target(gpu, { size: [size, size], format }) as Owned);
    const base = {
      ...node.params,
      tick: 0,
      initialize: 1,
      injectX: 0.5,
      injectY: 0.5,
      radius: 0,
      amount: 0,
    };
    const shader = node.type === "rules" ? rulesStep : chemicalStep;
    const kernels = targets.map((_, i) => {
      const fx = pooled(`${node.type}-step-${i}`, () =>
        effect(gpu, shader, { set: { state: targets[1 - i]!, params: base } }),
      );
      fx.set({ state: targets[1 - i]!, params: base });
      fx.compileSync(targets[i]!);
      return fx;
    });
    const initializer = pooled(`${node.type}-initialize`, () =>
      effect(gpu, shader, { set: { state: targets[1]!, params: base } }),
    );
    initializer.set({ state: targets[1]!, params: base });
    initializer.compileSync(targets[0]!);
    let head = 0,
      initialized = false,
      lastRuleStep = -1;
    return {
      targets,
      current: () => targets[head]!,
      reserve(pool) {
        kernels.forEach((fx, i) =>
          pool(`${node.type}-step-${i}`, () => fx, fx),
        );
        pool(`${node.type}-initialize`, () => initializer, initializer);
      },
      reset() {
        initialized = false;
        head = 0;
        lastRuleStep = -1;
      },
      step(params, tick, events) {
        const common = {
          ...params,
          tick,
          initialize: 0,
          injectX: 0.5,
          injectY: 0.5,
          radius: 0,
          amount: 0,
        };
        const initialize = () => {
          initializer.set({ params: { ...common, initialize: 1 } });
          frame(gpu, (f) => f.pass(targets[0]!, initializer));
          head = 0;
          initialized = true;
          lastRuleStep = Math.floor((tick * (params.rate ?? 10)) / 60);
        };
        const wasInitialized = initialized;
        if (!initialized) initialize();
        for (const event of events) {
          if (event.kind === "reset") {
            initialize();
            continue;
          }
          head = 1 - head;
          const fx = kernels[head]!;
          fx.set({
            params: {
              ...common,
              initialize: 2,
              injectX: event.x!,
              injectY: event.y!,
              radius: event.radius ?? 0.04,
              amount: event.amount ?? 1,
            },
          });
          frame(gpu, (f) => f.pass(targets[head]!, fx));
        }
        if (!wasInitialized) return;
        let steps = Math.round(params.steps ?? 1);
        if (node.type === "rules") {
          const next = Math.floor((tick * (params.rate ?? 10)) / 60);
          if (next === lastRuleStep) return;
          lastRuleStep = next;
          steps = 1;
        }
        // Separate effects for ping-pong destinations keep bindings stable within an encoded frame.
        for (const fx of kernels) fx.set({ params: common });
        frame(gpu, (f) => {
          for (let n = 0; n < steps; n++) {
            head = 1 - head;
            f.pass(targets[head]!, kernels[head]!);
          }
        });
      },
      dispose() {
        for (const t of targets) t.destroy();
      },
    };
  } catch (e) {
    for (const t of targets) t.destroy();
    throw e;
  }
}
