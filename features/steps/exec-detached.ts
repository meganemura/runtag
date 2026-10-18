import { defineStep, z } from "nukadoko";
import { runRuntag } from "./runtag-cli.ts";
import createRepository from "./create-repository.ts";
import createDataHome from "./create-data-home.ts";

// node is the one executable the scenario can count on; runtag runs it without
// a shell, so the exit code is the child's own.
export default defineStep({
  description: "Runs `runtag exec --detach --cwd <repo> -- node -e 'process.exit(3)'` and parses the job JSON it prints.",
  pattern: "the agent starts a command that exits with code 3, detached, in that repository",
  args: z.object({ repo: z.string(), dataHome: z.string() }),
  returns: z.object({
    id: z.string().describe("the job id runtag printed"),
    repoRoot: z.string().nullable().describe("repo_root in the printed job"),
  }),
  from: { repo: [createRepository, "repo"], dataHome: [createDataHome, "dataHome"] },
  mutates: true,
  async run({}, { repo, dataHome }) {
    const { exitCode, stdout, stderr } = await runRuntag(["exec", "--detach", "--cwd", repo, "--", process.execPath, "-e", "process.exit(3)"], repo, dataHome);
    if (exitCode !== 0) throw new Error(`runtag exec --detach exited ${exitCode}: ${stderr}`);
    const job = JSON.parse(stdout) as { id: string; repo_root: string | null };
    return { id: job.id, repoRoot: job.repo_root };
  },
});
