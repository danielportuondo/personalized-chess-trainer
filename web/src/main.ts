// Entry point. Screens are wired here in Phase 4.
export {};

// TEMP (Phase 2 E2E): controller removes after verifying. Dynamic import keeps
// the engine/wasm out of the eager bundle until actually invoked from the console.
(window as any).runPipeline = (username: string, opts?: any) =>
  import("./pipeline").then((m) => m.runPipeline(username, opts));
