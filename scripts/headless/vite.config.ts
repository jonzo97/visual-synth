// Config for scripts run with vite-node outside the browser (see scripts/render-tone.ts).
// Only the bare `vgpu` import is swapped; `vgpu/node` still resolves to the real package.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: [{ find: /^vgpu$/, replacement: fileURLToPath(new URL("./vgpu-node-shim.ts", import.meta.url)) }],
  },
});
