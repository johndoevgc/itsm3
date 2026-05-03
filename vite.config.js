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
          if (id.includes("src/modules/SelfServicePortal")) return "mod-selfservice";
          if (id.includes("src/modules/CustomersModule")) return "mod-customers";
          if (id.includes("src/modules/IncidentsModule")) return "mod-incidents";
          if (id.includes("src/modules/SLATrackerModule")) return "mod-sla";
          if (id.includes("src/modules/ServiceStatusModule")) return "mod-status";
          if (id.includes("src/modules/ArchitectureDiagram")) return "mod-architecture";
          if (id.includes("src/modules/ChangeCalendarModule")) return "mod-changecal";
          if (id.includes("src/modules/AIAssistModule")) return "mod-aiassist";
          if (id.includes("src/modules/AnalyticsModule")) return "mod-analytics";
          if (id.includes("src/modules/EngineerReviewHub")) return "mod-review";
          if (id.includes("src/modules/VendorPortalModule")) return "mod-vendor";
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
