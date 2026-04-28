import { defineConfig } from "vite";

/**
 * Dev:
 * - `npm run dev` gives hot reload for `src/popup.html` (open in a normal tab).
 *
 * Extension build:
 * - `npm run build` outputs `dist/` which you can "Load unpacked" in Chrome.
 * - `npm run watch` continuously rebuilds `dist/` on file changes.
 */
export default defineConfig({
  root: "src",
  // Our `.env` lives in `frontend/extension/.env` (one level above `src/`).
  envDir: "..",
  base: "",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: new URL("./src/popup.html", import.meta.url).pathname,
        blocked: new URL("./src/blocked.html", import.meta.url).pathname,
        sw: new URL("./src/sw.ts", import.meta.url).pathname,
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "sw" ? "sw.js" : "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  // Copy MV3 files + bundled audio into dist
  plugins: [
    {
      name: "copy-extension-static",
      apply: "build",
      async closeBundle() {
        const fs = await import("node:fs/promises");
        const path = await import("node:path");

        const root = process.cwd();
        const dist = path.resolve(root, "dist");

        async function copyFile(from, to) {
          await fs.mkdir(path.dirname(to), { recursive: true });
          await fs.copyFile(from, to);
        }

        async function copyDir(fromDir, toDir) {
          await fs.mkdir(toDir, { recursive: true });
          const entries = await fs.readdir(fromDir, { withFileTypes: true });
          for (const e of entries) {
            const from = path.join(fromDir, e.name);
            const to = path.join(toDir, e.name);
            if (e.isDirectory()) await copyDir(from, to);
            else if (e.isFile()) await copyFile(from, to);
          }
        }

        // Root manifest
        await copyFile(path.resolve(root, "manifest.json"), path.join(dist, "manifest.json"));

        // Ambient sounds assets
        await copyDir(path.resolve(root, "assets"), path.join(dist, "assets"));
      },
    },
  ],
  server: {
    port: 5173,
    strictPort: true,
  },
});

