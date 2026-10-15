// Runs the built CLI, the file npm installs as `runtag`, with XDG_DATA_HOME
// set to a scratch directory so the person's own job files are never read.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));

export function runRuntag(args: string[], cwd: string, dataHome: string): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: { ...process.env, XDG_DATA_HOME: dataHome } });
  if (result.error) throw result.error;
  return { exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}
