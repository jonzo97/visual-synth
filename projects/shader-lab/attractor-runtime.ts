import { compute, storage, type Compute, type Gpu, type StorageBuffer } from "vgpu";
import splatSource from "./generators/attractor-splat.wgsl?raw";

// vgpu's storage buffers expose an idempotent destroy() at runtime, as renderer targets do.
type OwnedStorage = StorageBuffer & { destroy(): void };

/** Must match RES in generators/attractor.wgsl. */
export const ATTRACTOR_RES = 1024;
const WALKERS = 65536;
/** Density bins (hits + fixed-point speed) plus the peak cell; budgeted beside textures. */
export const ATTRACTOR_BYTES = ATTRACTOR_RES * ATTRACTOR_RES * 2 * 4 + 8;

export interface AttractorPass {
  readonly bins: StorageBuffer;
  readonly peak: StorageBuffer;
  /** Recompute the whole exposure for these evaluated params; no history is kept. */
  run(params: Record<string, number>, phase: number): void;
  dispose(): void;
}

/**
 * Stateless exposure: each frame clears, splats and reduces from the evaluated params, so seek,
 * export and preview agree without reset or warm-up semantics. Parameters orbit with phase
 * (whole turns per loop), so the source repeats exactly at phase + 2π.
 */
export function createAttractorPass(gpu: Gpu): AttractorPass {
  const bins = storage(gpu, ATTRACTOR_RES * ATTRACTOR_RES * 2 * 4) as OwnedStorage;
  const peak = storage(gpu, 4) as OwnedStorage;
  let disposed = false;
  const kernels: Compute[] = [];
  try {
    for (const entry of ["clear_bins", "walk", "find_peak"])
      kernels.push(compute(gpu, splatSource, { entry, label: `attractor-${entry}` }));
  } catch (e) {
    bins.destroy(); peak.destroy();
    throw e;
  }
  const [clear, walk, reduce] = kernels as [Compute, Compute, Compute];
  return {
    bins,
    peak,
    run(params, phase) {
      const t = phase + (params.offset ?? 0);
      const orbit = params.orbit ?? 0;
      const splat = {
        a: params.a! + orbit * Math.cos(t),
        b: params.b! + orbit * Math.sin(t),
        c: params.c! + orbit * 0.5 * Math.cos(2 * t),
        d: params.d! + orbit * 0.5 * Math.sin(2 * t),
        kind: params.kind ?? 0,
        zoom: params.zoom ?? 1,
        res: ATTRACTOR_RES,
        seed: 1,
      };
      for (const k of kernels) k.set({ bins, peak, splat });
      clear.dispatch(Math.ceil((ATTRACTOR_RES * ATTRACTOR_RES * 2) / 256));
      walk.dispatch(WALKERS / 256);
      reduce.dispatch(Math.ceil((ATTRACTOR_RES * ATTRACTOR_RES) / 256));
    },
    dispose() {
      // Passes can be torn down from both destroy() and the build error path; free once.
      if (disposed) return;
      disposed = true;
      bins.destroy();
      peak.destroy();
    },
  };
}
