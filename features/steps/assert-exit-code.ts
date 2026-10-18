import { defineStep, z } from "nukadoko";
import waitExited from "./wait-exited.ts";

// runtag reports the child's code as a number and never labels it, so the
// check is equality, not pass or fail.
export default defineStep({
  description: "Asserts the exited job's exit_code is the number the scenario names.",
  pattern: "the job's exit code is {expected:int}",
  args: z.object({ expected: z.number().int(), exitCode: z.number().nullable() }),
  from: { exitCode: [waitExited, "exitCode"] },
  mutates: false,
  run({}, { expected, exitCode }) {
    if (exitCode !== expected) throw new Error(`exit_code is ${exitCode}, expected ${expected}`);
  },
});
