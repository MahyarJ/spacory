import path from "node:path";
import { defineConfig } from "vitest/config";

// Dedicated test config: mirrors the path aliases from vite.config.ts but
// skips the React / CSS-modules plugins, which the (currently pure) unit tests
// don't need. Add `environment: "jsdom"` here if/when component tests arrive.
export default defineConfig({
  resolve: {
    alias: {
      "@app": path.resolve(__dirname, "src/app"),
      "@features": path.resolve(__dirname, "src/features"),
      "@geometry": path.resolve(__dirname, "src/geometry"),
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
