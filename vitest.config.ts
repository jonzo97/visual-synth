import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Native GPU pixel tests skip themselves unless DIVERGENT_GPU_TESTS=1.
    include: ["tests/unit/**/*.test.ts", "projects/shader-lab/**/*.test.ts"],
  },
});
