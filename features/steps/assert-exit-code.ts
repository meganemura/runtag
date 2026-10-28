import { defineStep, z } from "nukadoko";
import waitExited from "./wait-exited.ts";

// runtag reports the child's code as a number and never labels it, so the
// check is equality, not pass or fail.
export default defineStep({
  description: "Claims the exited job's exit_code is the number the scenario names.",
  pattern: "the job's exit code is {expected:int}",
  args: z.object({
    expected: z.number().int().describe("the exit code the scenario names"),
    exitCode: z.number().nullable(),
  }),
  from: { exitCode: [waitExited, "exitCode"] },
  claims: [{ actual: "exitCode", compare: "equal", expected: "expected" }],
});
