import { defineConfig } from "vite";

export default defineConfig({
  esbuild: {
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
  },
  build: {
    // Split vendor libraries into a separate chunk so the browser
    // can cache them independently from your app code.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          // Split MSAL (auth) — large, only loaded for prod login flow
          if (id.includes("@azure/msal-browser") || id.includes("@azure/msal-common")) return "msal";
          // React core
          if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/") || id.includes("node_modules/scheduler/")) return "vendor";
          // Other node_modules → shared vendor-misc bucket (stays cacheable across deploys)
          return "vendor-misc";
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
