import type { Config } from "./archstrict.types.js";

// src/ is flat: each file is imported by its own name, so each file is a
// module. Folding src/ into one directory module would stop checking those
// imports. test/ reaches into internals on purpose and is not a module.
// features/ and nukadoko.config.ts run the built CLI as a child process and
// import nothing from src/, so they are not modules either.
export default {
  schemaVersion: 1,
  surface: ["index.ts", "index.tsx", "index.mts", "index.cts"],
  exclude: [
    "archstrict.config.ts",
    "archstrict.types.ts",
    ".*/**",
    "**/.*/**",
    "test/**",
    "features/**",
    "nukadoko.config.ts",
    // tsc output. Not source, and a built tree must not change the check.
    "dist/**",
    "dist-test/**",
  ],
  // Most specific glob wins. Each file carries one layer.
  classify: [
    { glob: "src/types.ts", tags: ["layer:leaf"] },
    { glob: "src/errors.ts", tags: ["layer:leaf"] },
    { glob: "src/ulid.ts", tags: ["layer:leaf"] },
    { glob: "src/duration.ts", tags: ["layer:duration"] },
    { glob: "src/store.ts", tags: ["layer:store"] },
    { glob: "src/supervise.ts", tags: ["layer:supervise"] },
    { glob: "src/cli.ts", tags: ["layer:cli"] },
  ],
  declaredModules: [
    { name: "cli.ts", glob: "src/cli.ts", surface: "cli.ts" },
    { name: "duration.ts", glob: "src/duration.ts", surface: "duration.ts" },
    { name: "errors.ts", glob: "src/errors.ts", surface: "errors.ts" },
    { name: "store.ts", glob: "src/store.ts", surface: "store.ts" },
    { name: "supervise.ts", glob: "src/supervise.ts", surface: "supervise.ts" },
    { name: "types.ts", glob: "src/types.ts", surface: "types.ts" },
    { name: "ulid.ts", glob: "src/ulid.ts", surface: "ulid.ts" },
  ],
  // No frozen debt. A later violation in one of these files fails check
  // rather than landing in the todo file.
  strict: [
    "cli.ts",
    "duration.ts",
    "errors.ts",
    "store.ts",
    "supervise.ts",
    "types.ts",
    "ulid.ts",
  ],
  edges: {
    order: [
      {
        tagNamespace: "layer",
        sequence: { "": ["leaf", "duration", "store", "supervise", "cli"] },
        direction: "downward-only",
        because:
          "types, errors, and ulid import no sibling; duration parses intervals; store writes the job file; supervise waits on the child; cli.ts only dispatches",
      },
    ],
  },
  because:
    "src/ is one module per file. types, errors, and ulid are leaves; duration depends on errors; store depends on those and duration; supervise depends on the store; cli.ts is the only process entry",
} satisfies Config;
