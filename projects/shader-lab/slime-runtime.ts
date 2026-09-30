import { compute, effect, frame, storage, target, type Compute, type Effect, type Gpu, type StorageBuffer, type Target } from "vgpu";
import type { SynthNode } from "./core";
import type { SimulationPass } from "./simulation-runtime";
import agentsSource from "./generators/slime-agents.wgsl?raw";
import stepSource from "./generators/slime-step.wgsl?raw";

type Owned = Target & { destroy(): void };
type OwnedStorage = StorageBuffer & { destroy(): void };
type Pool = (family: string, create: () => Effect, preferred?: Effect) => Effect;

/** Agents per grid cell at the largest grid; the agent buffer is sized for the grid. */
export const SLIME_AGENTS_PER_CELL = 1;
export const slimeAgentCount = (grid: number) => grid * grid * SLIME_AGENTS_PER_CELL;
/** Storage bytes beside the two trail textures: agents (vec4f) and three u32 deposits per cell. */
export const slimeStorageBytes = (grid: number) => slimeAgentCount(grid) * 16 + grid * grid * 3 * 4;

/**
 * Slime Mold Wars as a Visual Synth simulation: agents (compute) and a three-species trail
 * texture (fragment diffuse/decay) advance once per 60 Hz tick, so seek, export and preview
 * replay the same history from the seed. Inject events lay down food at x/y.
 */
export function createSlimePass(gpu: Gpu, node: SynthNode, pooled: Pool): SimulationPass {
  const grid = node.params.grid ?? 256;
  const maxAgents = slimeAgentCount(grid);
  const targets: Owned[] = [];
  const buffers: OwnedStorage[] = [];
  try {
    for (let i = 0; i < 2; i++) targets.push(target(gpu, { size: [grid, grid], format: "rgba16float" }) as Owned);
    const agents = storage(gpu, maxAgents * 16) as OwnedStorage;
    const deposits = storage(gpu, grid * grid * 3 * 4) as OwnedStorage;
    buffers.push(agents, deposits);
    const kernel = (entry: string) => compute(gpu, agentsSource, { entry, label: `slime-${entry}` });
    const init = kernel("init_agents"), clear = kernel("clear_deposits");
    // One move kernel per trail parity keeps each kernel's texture binding stable.
    const moves: Compute[] = [kernel("move_agents"), kernel("move_agents")];
    const base = { ...node.params, tick: 0, initialize: 0, injectX: 0.5, injectY: 0.5, radius: 0, amount: 0 };
    const steps = targets.map((_, i) => {
      const fx = pooled(`slime-step-${i}`, () => effect(gpu, stepSource, { set: { state: targets[1 - i]!, deposits, params: base } }));
      fx.set({ state: targets[1 - i]!, deposits, params: base });
      fx.compileSync(targets[i]!);
      return fx;
    });
    let head = 0, initialized = false, disposed = false;
    const agentParams = (params: Record<string, number>, tick: number) => ({ ...params, tick, maxAgents });
    const groups = (n: number) => Math.ceil(n / 256);
    // Render into the other target from the current one; `extra` overrides the step params.
    const trailPass = (params: Record<string, number>, tick: number, extra: Record<string, number>) => {
      const next = 1 - head, fx = steps[next]!;
      fx.set({ params: { ...params, tick, initialize: 0, injectX: 0.5, injectY: 0.5, radius: 0, amount: 0, ...extra } });
      frame(gpu, (f) => f.pass(targets[next]!, fx));
      head = next;
    };
    const zero = (params: Record<string, number>, tick: number) => {
      for (let i = 0; i < 2; i++) {
        steps[i]!.set({ params: { ...params, tick, initialize: 1, injectX: 0.5, injectY: 0.5, radius: 0, amount: 0 } });
        frame(gpu, (f) => f.pass(targets[i]!, steps[i]!));
      }
    };
    const initialize = (params: Record<string, number>, tick: number) => {
      // Both trail textures, every deposit and every agent start from a known state.
      zero(params, tick);
      head = 0;
      init.set({ agents, deposits, trail: targets[0]!, params: agentParams(params, tick) });
      init.dispatch(groups(maxAgents));
      clear.set({ agents, deposits, trail: targets[0]!, params: agentParams(params, tick) });
      clear.dispatch(groups(grid * grid * 3));
      initialized = true;
    };
    return {
      targets,
      current: () => targets[head]!,
      reserve(pool) {
        steps.forEach((fx, i) => pool(`slime-step-${i}`, () => fx, fx));
      },
      reset() { initialized = false; head = 0; },
      step(params, tick, events, aspect = 1) {
        if (!initialized) initialize(params, tick);
        // The display crops the square field to the frame; map screen-space points back into it.
        const field = (x: number, y: number) =>
          aspect > 1 ? [x, 0.5 + (y - 0.5) / aspect] : [0.5 + (x - 0.5) * aspect, y];
        for (const event of events) {
          if (event.kind === "reset") { initialize(params, tick); continue; }
          if (event.kind !== "inject" || !Number.isFinite(event.x) || !Number.isFinite(event.y)) continue;
          const [fx, fy] = field(event.x!, event.y!);
          trailPass(params, tick, { initialize: 2, injectX: fx!, injectY: fy!, radius: event.radius ?? 0.04, amount: event.amount ?? 1 });
        }
        const n = Math.max(1, Math.round(params.steps ?? 1));
        for (let s = 0; s < n; s++) {
          const move = moves[head]!;
          move.set({ agents, deposits, trail: targets[head]!, params: agentParams(params, tick * 4 + s) });
          move.dispatch(groups(maxAgents));
          trailPass(params, tick, {});
          clear.set({ agents, deposits, trail: targets[head]!, params: agentParams(params, tick) });
          clear.dispatch(groups(grid * grid * 3));
        }
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const t of targets) t.destroy();
        for (const b of buffers) b.destroy();
      },
    };
  } catch (e) {
    for (const t of targets) t.destroy();
    for (const b of buffers) b.destroy();
    throw e;
  }
}
