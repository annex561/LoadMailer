import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // NOTE: manualChunks was removed 2026-04-22. It kept producing broken
    // bundles (TDZ from split d3; "forwardRef of undefined" from splitting
    // react-core from radix-ui because chunks don't evaluate in dependency
    // order). Let Vite/Rollup handle splitting naturally — our React.lazy()
    // route imports already produce per-page chunks, which is where the
    // real cache-hit wins are.
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
