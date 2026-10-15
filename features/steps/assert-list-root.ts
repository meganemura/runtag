import { defineStep, z } from "nukadoko";
import { runRuntag } from "./runtag-cli.ts";
import createRepository from "./create-repository.ts";
import createDataHome from "./create-data-home.ts";
import execDetached from "./exec-detached.ts";

export default defineStep({
  description: "Runs `runtag list --root <repo>` and asserts the array holds the job id.",
  pattern: "runtag list for that repository includes the job",
  args: z.object({ repo: z.string(), dataHome: z.string(), id: z.string() }),
  returns: z.object({}),
  from: { repo: [createRepository, "repo"], dataHome: [createDataHome, "dataHome"], id: [execDetached, "id"] },
  mutates: false,
  rationale: "--root is how an agent finds the jobs of the repository it is in without keeping ids.",
  run({}, { repo, dataHome, id }) {
    const { exitCode, stdout, stderr } = runRuntag(["list", "--root", repo], repo, dataHome);
    if (exitCode !== 0) throw new Error(`runtag list exited ${exitCode}: ${stderr}`);
    const ids = (JSON.parse(stdout) as { id: string }[]).map(job => job.id);
    if (!ids.includes(id)) throw new Error(`runtag list --root ${repo} returned ${JSON.stringify(ids)}, without ${id}`);
    return {};
  },
});
