import path from "node:path";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

const previewPort = 8080;

export default defineConfig(() => ({
  build: {
    outDir: "dist",
    sourcemap: false,
  },
  plugins: [react()],
  preview: {
    host: "0.0.0.0",
    port: previewPort,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // Previews are reached only through the token-checked sandbox edge, which
    // generates a fresh hostname per session.
    allowedHosts: true,
    // Off for candidates and the checks' browsers, which run this config as
    // is. The live preview turns it on through the image's live-preview/serve.mjs.
    hmr: false,
    host: "0.0.0.0",
    port: previewPort,
    strictPort: true,
  },
}));
