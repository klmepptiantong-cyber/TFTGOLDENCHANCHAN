import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022"
  },
  server: {
    port: 1420,
    strictPort: true,
    fs: {
      allow: [".."]
    }
  }
});
