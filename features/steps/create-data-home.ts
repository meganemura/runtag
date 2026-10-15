import { defineStep, z } from "nukadoko";

export default defineStep({
  description: "Creates an empty scratch directory to use as XDG_DATA_HOME.",
  pattern: "an empty runtag data directory",
  args: z.object({}),
  returns: z.object({ dataHome: z.string().describe("the XDG_DATA_HOME every runtag call in this scenario gets") }),
  mutates: true,
  rationale: "runtag writes job files under XDG_DATA_HOME; a scratch one keeps the scenario away from the person's own jobs.",
  run({ scratch }) {
    return { dataHome: scratch.dir("runtag-scenario-data") };
  },
});
