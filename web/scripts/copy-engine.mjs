// Copies the shipped Stockfish lite-single build (js glue + wasm) into
// public/engine/ so the dev server and Cloudflare Pages build can serve it.
// The copies are gitignored (7MB wasm) — this script recreates them.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "node_modules", "stockfish", "bin");
const destDir = join(here, "..", "public", "engine");
const files = ["stockfish-18-lite-single.js", "stockfish-18-lite-single.wasm"];

mkdirSync(destDir, { recursive: true });
for (const name of files) {
  copyFileSync(join(srcDir, name), join(destDir, name));
}

console.log(`copy-engine: copied ${files.join(", ")} -> ${destDir}`);
