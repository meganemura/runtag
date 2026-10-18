// Runs the built CLI, the file npm installs as `runtag`, with XDG_DATA_HOME
// set to a scratch directory so the person's own job files are never read.
import { fileURLToPath } from "node:url";
import { runCommand } from "nukadoko";

const CLI = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));

export async function runRuntag(args: string[], cwd: string, dataHome: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const result = await runCommand(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, XDG_DATA_HOME: dataHome } });
  return { exitCode: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr };
}
