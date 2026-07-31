import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { patchCssModules } from "vite-css-modules";

export default defineConfig({
  // Relative asset base so a build runs unchanged at the Pages root
  // (https://<user>.github.io/spacory/) and inside a PR-preview subfolder
  // (…/spacory/pr-preview/pr-N/). See docs/DECISIONS.md.
  base: "./",
  plugins: [
    react(),
    patchCssModules({
      // Generate .d.ts next to each *.module.css during dev/build
      generateSourceTypes: true,
      // Optional export style; default 'both' (named + default)
      exportMode: "both",
    }),
  ],
  resolve: {
    alias: {
      "@app": path.resolve(__dirname, "src/app"),
      "@features": path.resolve(__dirname, "src/features"),
      "@geometry": path.resolve(__dirname, "src/geometry"),
      "@ui": path.resolve(__dirname, "src/ui"),
    },
  },
});
