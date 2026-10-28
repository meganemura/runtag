import { defineStep, z } from "nukadoko";
import createRepository from "./create-repository.ts";
import execDetached from "./exec-detached.ts";

// repo_root is what `list --root` and spacequery's runs-in-dir match on.
export default defineStep({
  description: "Claims the printed job's repo_root is the scratch repository.",
  pattern: "the job is recorded with that repository as its root",
  args: z.object({ repo: z.string(), repoRoot: z.string().nullable() }),
  from: { repo: [createRepository, "repo"], repoRoot: [execDetached, "repoRoot"] },
  claims: [{ actual: "repoRoot", compare: "equal", expected: { from: "repo" } }],
});
