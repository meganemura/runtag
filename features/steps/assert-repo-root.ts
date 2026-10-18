import { defineStep, z } from "nukadoko";
import createRepository from "./create-repository.ts";
import execDetached from "./exec-detached.ts";

// repo_root is what `list --root` and spacequery's runs-in-dir match on.
export default defineStep({
  description: "Asserts the printed job's repo_root is the scratch repository.",
  pattern: "the job is recorded with that repository as its root",
  args: z.object({ repo: z.string(), repoRoot: z.string().nullable() }),
  from: { repo: [createRepository, "repo"], repoRoot: [execDetached, "repoRoot"] },
  mutates: false,
  run({}, { repo, repoRoot }) {
    if (repoRoot !== repo) throw new Error(`repo_root is ${JSON.stringify(repoRoot)}, expected ${JSON.stringify(repo)}`);
  },
});
