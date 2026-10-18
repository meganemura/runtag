import { defineStep, z } from "nukadoko";
import { setTimeout as sleep } from "node:timers/promises";
import { runRuntag } from "./runtag-cli.ts";
import createRepository from "./create-repository.ts";
import createDataHome from "./create-data-home.ts";
import execDetached from "./exec-detached.ts";

// The supervisor writes exit_code after the child exits, so the first status
// can still say running. The 10 s bound turns a lost supervisor into a failure
// instead of a hang.
export default defineStep({
  description: "Polls `runtag status <id>` every 100 ms, for at most 10 s, until status is exited.",
  pattern: "the agent waits until runtag status reports the job exited",
  args: z.object({ repo: z.string(), dataHome: z.string(), id: z.string() }),
  returns: z.object({ exitCode: z.number().nullable().describe("exit_code in the last status") }),
  from: { repo: [createRepository, "repo"], dataHome: [createDataHome, "dataHome"], id: [execDetached, "id"] },
  mutates: false,
  async run({}, { repo, dataHome, id }) {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const { exitCode, stdout, stderr } = await runRuntag(["status", id], repo, dataHome);
      if (exitCode !== 0) throw new Error(`runtag status exited ${exitCode}: ${stderr}`);
      const job = JSON.parse(stdout) as { status: string; exit_code: number | null };
      if (job.status === "exited") return { exitCode: job.exit_code };
      if (Date.now() > deadline) throw new Error(`job ${id} still ${job.status} after 10 s: ${stdout}`);
      await sleep(100);
    }
  },
});
