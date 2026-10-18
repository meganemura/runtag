import { defineStep, runCommand, z } from "nukadoko";
import { realpathSync } from "node:fs";

// runtag records repo_root from `git rev-parse --show-toplevel`, which
// resolves symlinks, so the root is compared in that form.
export default defineStep({
  description: "Creates a scratch git repository.",
  pattern: "a git repository to run a command in",
  args: z.object({}),
  returns: z.object({ repo: z.string().describe("the repository's root, with symlinks resolved") }),
  mutates: true,
  async run({ scratch }) {
    const repo = realpathSync(scratch.dir("runtag-scenario-repo"));
    const { exitCode, stderr } = await runCommand("git", ["init", "--quiet", repo]);
    if (exitCode !== 0) throw new Error(`git init exited ${exitCode}: ${stderr}`);
    return { repo };
  },
});
