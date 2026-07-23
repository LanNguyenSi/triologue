import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Node >=22.4 ships its own experimental global `localStorage`/
// `sessionStorage` (non-functional unless `--localstorage-file` is passed).
// Vitest's jsdom environment only overrides globals that are NOT already
// present on the Node global object (see vitest-dev/vitest#8757), so on
// these Node versions the broken native accessor shadows jsdom's real
// Storage implementation and any `@vitest-environment jsdom` file that
// touches localStorage at module load (e.g. via authStore) throws
// `Cannot read properties of undefined (reading 'getItem')` during
// collection. Disabling Node's native Web Storage API for the test workers
// lets jsdom's own implementation populate the global as before.
// The flag doesn't exist on older Node (e.g. the Node 20 CI runner), where
// passing an unrecognized flag makes the process exit immediately with
// "bad option" -- so only add it when the running Node actually supports it.
const nodeSupportsNoExperimentalWebstorage = process.allowedNodeEnvironmentFlags.has(
  "--no-experimental-webstorage",
);

export default defineConfig({
  plugins: [react()],
  test: {
    execArgv: nodeSupportsNoExperimentalWebstorage
      ? ["--no-experimental-webstorage"]
      : [],
  },
  server: {
    port: 4000,
    proxy: {
      "/api": {
        target: "http://localhost:4001",
        changeOrigin: true,
      },
      "/socket.io": {
        target: "http://localhost:4001",
        ws: true,
      },
      "/uploads": {
        target: "http://localhost:4001",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
