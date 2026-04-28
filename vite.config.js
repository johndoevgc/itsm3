import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // Split vendor libraries into a separate chunk so the browser
    // can cache them independently from your app code.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            // Split MSAL (auth) — large, only loaded for prod login flow
            if (id.includes("@azure/msal-browser") || id.includes("@azure/msal-common")) return "msal";
            // React core
            if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/") || id.includes("node_modules/scheduler/")) return "vendor";
            // Other node_modules → shared vendor-misc bucket
            return "vendor-misc";
          }
          // App-level code splitting for lazy-loaded modules
          if (id.includes("src/modules/AdminSettingsModule")) return "mod-admin";
          if (id.includes("src/modules/DashboardModule")) return "mod-dashboard";
          if (id.includes("src/modules/ModalsModule")) return "mod-modals";
          if (id.includes("src/modules/ZendeskModule")) return "mod-zendesk";
          if (id.includes("src/modules/ReportingModule")) return "mod-reporting";
          if (id.includes("src/modules/KnowledgeModule")) return "mod-knowledge";
          if (id.includes("src/modules/CyberNewsModule")) return "mod-cybernews";
          if (id.includes("src/modules/ProductivityDashboard")) return "mod-productivity";
        },
      },
    },
    // Target modern browsers for smaller output
    target: "es2020",
    // Generate source maps for production debugging
    sourcemap: false,
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
