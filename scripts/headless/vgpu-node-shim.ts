// Headless stand-in for `vgpu`: the same API, with a native Dawn adapter (the `webgpu` npm
// package) and an offscreen rgba8 target where the browser would use a canvas swapchain.
// Mirrors the mock in projects/shader-lab/renderer-native.test.ts, so the full renderer runs.
import * as api from "vgpu/node";
import type { Gpu, Target } from "vgpu/node";

export * from "vgpu/node";

/** Every offscreen screen target the renderer has asked for, newest last. */
export const screens: (Target & { destroy(): void })[] = [];

export async function init() {
  // "auto" picks the GPU and falls back to a CPU renderer; vgpu's own VGPU_ADAPTER=hardware|software
  // overrides it, and VGPU_DAWN_FLAGS picks a Dawn backend (see PORT.md).
  const gpu = await api.init({ adapter: "auto" });
  console.info(`GPU adapter: ${gpu.adapter.name} (${gpu.adapter.type})`);
  return gpu;
}

export function surface(gpu: Gpu, _canvas: unknown, options: { size: [number, number] }) {
  const screen = api.target(gpu, { size: options.size, format: "rgba8unorm" }) as Target & { destroy(): void };
  screens.push(screen);
  return Object.assign(screen, {
    dispose: () => {
      screens.splice(screens.indexOf(screen), 1);
      screen.destroy();
    },
  });
}
