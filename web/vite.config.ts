import { defineConfig } from "vitest/config";

// COOP/COEP so the dev server matches the Cloudflare Pages `_headers` and
// SharedArrayBuffer (threaded Stockfish) is available in local dev too.
export default defineConfig({
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  test: {
    globals: true,
    environment: "node",
  },
});
