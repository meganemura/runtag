import { defineStep, z } from "nukadoko";
import { runRuntag } from "./runtag-cli.ts";
import createRepository from "./create-repository.ts";
import createDataHome from "./create-data-home.ts";
import execDetached from "./exec-detached.ts";

// --root is how an agent finds the jobs of the repository it is in without
// keeping ids.
export default defineStep({
  description: "Runs `runtag list --root <repo>` and claims the array holds the job id.",
  pattern: "runtag list for that repository includes the job",
  args: z.object({ repo: z.string(), dataHome: z.string(), id: z.string() }),
  from: { repo: [createRepository, "repo"], dataHome: [createDataHome, "dataHome"], id: [execDetached, "id"] },
  async observe({}, { repo, dataHome }) {
    const { exitCode, stdout, stderr } = await runRuntag(["list", "--root", repo], repo, dataHome);
    if (exitCode !== 0) throw new Error(`runtag list exited ${exitCode}: ${stderr}`);
    return { ids: (JSON.parse(stdout) as { id: string }[]).map(job => job.id) };
  },
  claims: [{ actual: "ids", compare: "has-item", expected: { from: "id" } }],
});
