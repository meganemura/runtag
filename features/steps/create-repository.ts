import { defineStep, z } from "nukadoko";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";

export default defineStep({
  description: "Creates a scratch git repository.",
  pattern: "a git repository to run a command in",
  args: z.object({}),
  returns: z.object({ repo: z.string().describe("the repository's root, with symlinks resolved") }),
  mutates: true,
  rationale: "runtag records repo_root from `git rev-parse --show-toplevel`, which resolves symlinks, so the root is compared in that form.",
  run({ scratch }) {
    const repo = realpathSync(scratch.dir("runtag-scenario-repo"));
    execFileSync("git", ["init", "--quiet", repo]);
    return { repo };
  },
});
