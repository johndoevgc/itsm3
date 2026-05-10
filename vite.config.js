import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
let VERSION_META = { version: "0.0.0", build: "unknown" };
try { VERSION_META = JSON.parse(readFileSync(resolve(__dirname, "VERSION.json"), "utf8")); } catch { /* ignore */ }

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(VERSION_META.version),
    __APP_BUILD__: JSON.stringify(VERSION_META.build),
  },
  build: {
    // Split vendor libraries into a separate chunk so the browser
    // can cache them independently from your app code.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("@azure/msal-browser") || id.includes("@azure/msal-common") || id.includes("@azure/msal-react")) return "msal";
            if (id.includes("react-dom") || id.includes("/react/") || id.includes("\\react\\") || id.includes("scheduler")) return "vendor";
            return "vendor-misc";
          }
        },
      },
    },
    // Target modern browsers for smaller output
    target: "es2020",
    // Generate source maps for production debugging.
    // "hidden" = maps are emitted to /assets but NOT referenced from the
    // bundle (no //# sourceMappingURL footer). Browsers don't fetch them so
    // source isn't exposed on the wire, but devs can upload to error trackers
    // for stack-trace symbolication when reproducing React #310-class issues.
    sourcemap: "hidden",
    // Increase warning threshold (single-file SPA is large)
    chunkSizeWarningLimit: 2000,
  },
  // Optimise dependency pre-bundling
  optimizeDeps: {
    include: ["react", "react-dom"],
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.{js,mjs}"],
  },
});
