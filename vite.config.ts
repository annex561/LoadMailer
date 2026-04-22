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
    // Split large vendors into separate cacheable chunks
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Core React runtime — tiny, always needed
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/")) {
            return "react-core";
          }
          // Radix UI primitives — large, but stable between deploys
          if (id.includes("node_modules/@radix-ui/")) {
            return "radix-ui";
          }
          // Routing
          if (id.includes("node_modules/wouter")) {
            return "router";
          }
          // NOTE: recharts + d3 are intentionally NOT split into their own
          // chunk. d3 has circular imports (d3-scale ↔ d3-time etc.) that
          // break with a TDZ error ("Cannot access 'S' before initialization")
          // when split from their consumers. Keep them in the vendor chunk
          // so the whole graph initializes as one unit.
          if (id.includes("node_modules/")) {
            return "vendor";
          }
        },
      },
    },
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
