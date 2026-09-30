import { effect, frame, target, type Effect, type Gpu, type Target } from "vgpu";
import type { SynthNode } from "./core";
import type { SimulationPass } from "./simulation-runtime";
import fluidSource from "./generators/ink-fluid.wgsl?raw";
import dyeSource from "./generators/ink-step.wgsl?raw";

type Owned = Target & { destroy(): void };
type Pool = (family: string, create: () => Effect, preferred?: Effect) => Effect;

/** Pressure starts from last tick's solution (a deterministic warm start), so 12 Jacobi
 * iterations suffice; a tick is 1 advect + 12 Jacobi + 1 projection + 1 dye = 15 passes. */
const JACOBI = 12;

/**
 * Ink in Water: stable fluids on the 60 Hz tick. Each tick advects velocity (with orbiting
 * stirrers and vorticity confinement), relaxes pressure with Jacobi iterations, projects, then
 * advects the dye through the result. Everything is fragment passes over ping-pong textures,
 * so a seed replays exactly; inject events (touch) swirl the water and release ink.
 */
export function createInkPass(gpu: Gpu, node: SynthNode, pooled: Pool): SimulationPass {
  const grid = node.params.grid ?? 256;
  const vel: Owned[] = [], dye: Owned[] = [];
  try {
    for (let i = 0; i < 2; i++) {
      vel.push(target(gpu, { size: [grid, grid], format: "rgba16float" }) as Owned);
      dye.push(target(gpu, { size: [grid, grid], format: "rgba16float" }) as Owned);
    }
    const none = { injectX: 0.5, injectY: 0.5, radius: 0, amount: 0 };
    const base = { ...node.params, tick: 0, initialize: 0, mode: 0, ...none };
    // One effect per destination keeps each one's source binding stable.
    const fluid = vel.map((_, i) => {
      const fx = pooled(`ink-fluid-${i}`, () => effect(gpu, fluidSource, { set: { vel: vel[1 - i]!, params: base } }));
      fx.set({ vel: vel[1 - i]!, params: base });
      fx.compileSync(vel[i]!);
      return fx;
    });
    const ink = dye.map((_, i) => {
      const fx = pooled(`ink-dye-${i}`, () => effect(gpu, dyeSource, { set: { state: dye[1 - i]!, vel: vel[0]!, params: base } }));
      fx.set({ state: dye[1 - i]!, vel: vel[0]!, params: base });
      fx.compileSync(dye[i]!);
      return fx;
    });
    let v = 0, d = 0, initialized = false, disposed = false;
    const velPass = (params: Record<string, number>, mode: number, extra: Record<string, number> = none) => {
      const next = 1 - v;
      fluid[next]!.set({ params: { ...params, mode, ...extra } });
      frame(gpu, (f) => f.pass(vel[next]!, fluid[next]!));
      v = next;
    };
    const dyePass = (params: Record<string, number>, initialize: number, extra: Record<string, number> = none) => {
      const next = 1 - d;
      ink[next]!.set({ vel: vel[v]!, params: { ...params, initialize, ...extra } });
      frame(gpu, (f) => f.pass(dye[next]!, ink[next]!));
      d = next;
    };
    const initialize = (params: Record<string, number>) => {
      // Clear both copies of velocity and dye so every replay starts from still, clean water.
      for (let i = 0; i < 2; i++) { velPass(params, 3); dyePass(params, 1); }
      v = 0; d = 0;
      initialized = true;
    };
    return {
      targets: [...vel, ...dye],
      current: () => dye[d]!,
      reserve(pool) {
        fluid.forEach((fx, i) => pool(`ink-fluid-${i}`, () => fx, fx));
        ink.forEach((fx, i) => pool(`ink-dye-${i}`, () => fx, fx));
      },
      reset() { initialized = false; v = 0; d = 0; },
      step(values, tick, events, aspect = 1) {
        const params = { ...values, tick };
        if (!initialized) initialize(params);
        // The display crops the square tank to the frame; map screen-space points back into it.
        const field = (x: number, y: number) =>
          aspect > 1 ? [x, 0.5 + (y - 0.5) / aspect] : [0.5 + (x - 0.5) * aspect, y];
        let touch = none;
        for (const event of events) {
          // Reset clears the tank and this tick then advances from still water.
          if (event.kind === "reset") { initialize(params); continue; }
          if (event.kind !== "inject" || !Number.isFinite(event.x) || !Number.isFinite(event.y)) continue;
          const [x, y] = field(event.x!, event.y!);
          touch = { injectX: x!, injectY: y!, radius: event.radius ?? 0.04, amount: event.amount ?? 1 };
        }
        velPass(params, 0, touch);
        for (let i = 0; i < JACOBI; i++) velPass(params, 1);
        velPass(params, 2);
        dyePass(params, 0, touch);
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const t of [...vel, ...dye]) t.destroy();
      },
    };
  } catch (e) {
    for (const t of [...vel, ...dye]) t.destroy();
    throw e;
  }
}
