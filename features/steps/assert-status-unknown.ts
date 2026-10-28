import { defineStep, z } from "nukadoko";
import { runRuntag } from "./runtag-cli.ts";
import createRepository from "./create-repository.ts";
import createDataHome from "./create-data-home.ts";
import execDetached from "./exec-detached.ts";

// A failure prints {error, do} so the agent knows the next command without
// reading docs. The README's exit code table gives 1 that meaning, so 1 is
// the one code that reads as "fails"; any other code is reported as it is.
export default defineStep({
  description: "Runs `runtag status <id>` and claims it exits 1 with a stderr envelope whose do names `runtag list`.",
  pattern: "runtag status for that id fails and says to run runtag list",
  args: z.object({ repo: z.string(), dataHome: z.string(), id: z.string() }),
  from: { repo: [createRepository, "repo"], dataHome: [createDataHome, "dataHome"], id: [execDetached, "id"] },
  async observe({}, { repo, dataHome, id }) {
    const { exitCode, stderr } = await runRuntag(["status", id], repo, dataHome);
    return { outcome: exitCode === 1 ? "fails" : `exits ${exitCode}`, stderr };
  },
  claims: [
    { actual: "outcome", compare: "equal", expected: { literal: "fails" } },
    { actual: "stderr", view: "json", at: "do", compare: "contains-text", expected: { literal: "runtag list" } },
  ],
});
