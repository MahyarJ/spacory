import path from "node:path";
import { defineConfig } from "vitest/config";

// Dedicated test config: mirrors the path aliases from vite.config.ts but
// skips the React / CSS-modules plugins, which the tests don't need (esbuild
// already transforms JSX per tsconfig, and Vitest stubs CSS imports). `node`
// stays the default environment for the pure unit tests; component tests opt
// into jsdom with a `@vitest-environment jsdom` docblock, so a DOM is only spun
// up where an interaction actually needs one.
export default defineConfig({
  resolve: {
    alias: {
      "@app": path.resolve(__dirname, "src/app"),
      "@features": path.resolve(__dirname, "src/features"),
      "@geometry": path.resolve(__dirname, "src/geometry"),
      "@ui": path.resolve(__dirname, "src/ui"),
    },
  },
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    environment: "node",
    // Randomize file and test order so any hidden order-dependence (e.g. a
    // shared fixture mutated in place) fails fast instead of passing by luck.
    sequence: { shuffle: true },
  },
});
