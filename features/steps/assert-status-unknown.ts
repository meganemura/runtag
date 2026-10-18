import { defineStep, z } from "nukadoko";
import { runRuntag } from "./runtag-cli.ts";
import createRepository from "./create-repository.ts";
import createDataHome from "./create-data-home.ts";
import execDetached from "./exec-detached.ts";

// A failure prints {error, do} so the agent knows the next command without
// reading docs.
export default defineStep({
  description: "Runs `runtag status <id>` and asserts exit 1 with a stderr envelope whose do names `runtag list`.",
  pattern: "runtag status for that id fails and says to run runtag list",
  args: z.object({ repo: z.string(), dataHome: z.string(), id: z.string() }),
  from: { repo: [createRepository, "repo"], dataHome: [createDataHome, "dataHome"], id: [execDetached, "id"] },
  mutates: false,
  async run({}, { repo, dataHome, id }) {
    const { exitCode, stderr } = await runRuntag(["status", id], repo, dataHome);
    if (exitCode !== 1) throw new Error(`runtag status exited ${exitCode}, expected 1`);
    const envelope = JSON.parse(stderr) as { error?: string; do?: string };
    if (!envelope.do?.includes("runtag list")) throw new Error(`do does not name runtag list: ${stderr}`);
  },
});
