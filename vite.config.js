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
          if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/")) {
            return "vendor";
          }
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
});
