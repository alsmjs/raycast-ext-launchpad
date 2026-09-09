import { defineConfig } from "vitest/config";

// Only `src/core/**` is unit-tested: it is the layer with zero `@raycast/api`
// and zero React imports, so it runs under plain Node without a Raycast
// runtime. Everything under `src/services` and `src/ui` is a side-effect or
// rendering boundary and is verified by hand via `npm run dev`.
export default defineConfig({
  test: {
    include: ["src/core/**/*.test.ts"],
    environment: "node",
  },
});
