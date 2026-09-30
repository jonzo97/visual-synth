import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { visualSynthExportPlugin } from "./projects/shader-lab/export-server";

const root = dirname(fileURLToPath(import.meta.url));

// The pages Vite bundles. The landing page links to each of them.
const pages = {
  main: "index.html",
  synth: "projects/shader-lab/index.html",
  player: "projects/shader-lab/player.html",
  doodleLab: "projects/doodle-lab/index.html",
};

// Self-contained pages, posters and the shared shim that the Doodle Lab opens by URL at
// runtime. They sit outside the module graph, so the production build copies them unchanged.
// The dev server reads them straight from disk and ignores this list.
const copiedAsIs: { dir: string; match: RegExp; recursive?: boolean }[] = [
  { dir: "projects/doodle-lab/doodles", match: /\.(html|png)$/ },
  { dir: "projects/doodle-lab/pack", match: /\.(html|png)$/ },
  { dir: "projects/doodle-lab/snapshots", match: /\.png$/ },
  { dir: "projects/doodle-lab/gemini", match: /\.png$/ },
  { dir: "projects/doodle-lab/tools", match: /^lab-shim\.js$/ },
  { dir: "projects/doodle-lab", match: /^CONTRIBUTING\.md$/ },
  { dir: "projects/gemini-lab/experiments", match: /^index\.html$/, recursive: true },
];

function listFiles(dir: string, match: RegExp, recursive: boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return recursive ? listFiles(path, match, true) : [];
    return entry.isFile() && match.test(entry.name) ? [path] : [];
  });
}

function copyLinkedPages(): Plugin {
  return {
    name: "copy-linked-pages",
    apply: "build",
    generateBundle() {
      for (const { dir, match, recursive = false } of copiedAsIs) {
        for (const file of listFiles(resolve(root, dir), match, recursive)) {
          this.emitFile({
            type: "asset",
            fileName: relative(root, file).split(sep).join("/"),
            source: readFileSync(file),
          });
        }
      }
    },
  };
}

export default defineConfig({
  // Several independent pages: a missing file is a real 404, not the landing page.
  appType: "mpa",
  // visualSynthExportPlugin adds the dev server's FFmpeg export fallback, used only when browser
  // encoding fails. It accepts same-origin requests from this machine and needs ffmpeg on PATH.
  plugins: [visualSynthExportPlugin(), copyLinkedPages()],
  // Loopback is a secure context, which WebGPU and Web MIDI require. A LAN address over plain
  // http is not, so `--host` will serve other devices but the Visual Synth will not start there.
  server: { host: "127.0.0.1", port: 4173 },
  preview: { host: "127.0.0.1", port: 4174 },
  build: {
    rollupOptions: {
      input: Object.fromEntries(
        Object.entries(pages).map(([name, page]) => [name, resolve(root, page)]),
      ),
    },
  },
});
