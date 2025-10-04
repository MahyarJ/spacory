import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { patchCssModules } from "vite-css-modules";

export default defineConfig({
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
    },
  },
});
