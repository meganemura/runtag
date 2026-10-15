import { defineStep, z } from "nukadoko";
import { runRuntag } from "./runtag-cli.ts";
import createRepository from "./create-repository.ts";
import createDataHome from "./create-data-home.ts";

export default defineStep({
  description: "Runs `runtag gc`, which deletes every exited job by default.",
  pattern: "the agent collects exited jobs with runtag gc",
  args: z.object({ repo: z.string(), dataHome: z.string() }),
  returns: z.object({}),
  from: { repo: [createRepository, "repo"], dataHome: [createDataHome, "dataHome"] },
  mutates: true,
  rationale: "The default --older-than is 0s, so the exited job is due at once.",
  run({}, { repo, dataHome }) {
    const { exitCode, stderr } = runRuntag(["gc"], repo, dataHome);
    if (exitCode !== 0) throw new Error(`runtag gc exited ${exitCode}: ${stderr}`);
    return {};
  },
});
