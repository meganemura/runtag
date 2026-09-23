#!/usr/bin/env node
import { writeSync } from "node:fs";
import path from "node:path";
import { parseDuration } from "./duration.js";
import { AgentError, printJson, report } from "./errors.js";
import { allocateId, gcJobs, listJobs, present, readJob } from "./store.js";
import { parseSuperviseSpec, resolveCwd, startDetached, supervise } from "./supervise.js";
import type { JobStatus } from "./types.js";

const HELP = `runtag records one child process under $XDG_DATA_HOME/runtag/jobs
(default ~/.local/share/runtag/jobs) so an agent can observe it later.
It does not judge pass or fail. Status is only running or exited.

Agent flow:
  1. runtag exec --detach --cwd <repo> -- npm test
  2. spacequery watch runs-in-dir --root <repo> --until status=exited
     (spacequery watches; runtag only records)
  3. runtag status <id>

Usage:
  runtag exec [--cwd DIR] [--label NAME] [--detach] -- <cmd>...
  runtag status <id>
  runtag list [--root DIR] [--status running|exited]
  runtag gc [--older-than DURATION]
  runtag --help

exec
  Run <cmd> without a shell. The command must follow --.
  Foreground inherits stdio and exits with the child code. State is still updated.
  --detach prints the job JSON and exits 0. A per-job supervisor keeps waiting
  and writes exit_code. Detached stdout and stderr are discarded.
  --cwd defaults to the current directory. --label is stored as text or null.

status
  Print one job JSON object. Unknown ids print {"error","do"} on stderr and exit 1.

list
  Print a JSON array, newest started_at first.
  --root keeps jobs whose repo_root or cwd equals DIR or is inside DIR.
  --status filters the persisted status (running or exited).

gc
  Delete exited jobs whose ended_at is at least DURATION ago.
  Running jobs, including orphans, are kept. Default DURATION is 0s (every exited job).
  DURATION is an integer plus ms, s, m, h, or d. Examples: 500ms, 30s, 12h, 7d.

Orphans:
  If a job file says running but the supervisor pid is gone, status and list keep
  status running and exit_code null, and add "orphan": true. No exit code is invented.
`;

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return 0;
  }
  if (command === "__supervise") return cmdSupervise();
  if (command === "exec") return cmdExec(rest);
  if (command === "status") {
    printJson(present(await readJob(parseStatus(rest))));
    return 0;
  }
  if (command === "list") {
    printJson(await listJobs(parseList(rest)));
    return 0;
  }
  if (command === "gc") {
    printJson(await gcJobs(parseDuration(parseGc(rest))));
    return 0;
  }
  throw new AgentError(
    `unknown command: ${command}`,
    "run `runtag --help` and use exec, status, list, or gc",
  );
}

async function cmdExec(argv: string[]): Promise<number> {
  const parsed = parseExec(argv);
  const cwd = resolveCwd(parsed.cwd);
  const spec = {
    id: await allocateId(),
    cwd,
    label: parsed.label ?? null,
    command: parsed.command,
  };
  if (parsed.detach) {
    const job = await startDetached(spec, scriptPath());
    printJson(job);
    process.exit(0);
  }
  const code = await supervise(spec, false);
  return code ?? 1;
}

async function cmdSupervise(): Promise<number> {
  if (process.stdin.isTTY) {
    throw new AgentError("`__supervise` is an internal command", "use `runtag exec` to start a job");
  }
  process.stdout.on("error", () => {});
  process.stderr.on("error", () => {});
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const spec = parseSuperviseSpec(Buffer.concat(chunks).toString("utf8"));
  const code = await supervise(spec, true);
  return code ?? 1;
}

interface ExecArgs {
  cwd?: string;
  label?: string;
  detach: boolean;
  command: string[];
}

function parseExec(argv: string[]): ExecArgs {
  let cwd: string | undefined;
  let label: string | undefined;
  let detach = false;
  let command: string[] | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--") {
      command = argv.slice(i + 1);
      break;
    }
    if (arg === "--detach") {
      detach = true;
      continue;
    }
    if (arg === "--cwd" || arg.startsWith("--cwd=")) {
      cwd = readValue(arg, "--cwd", argv, i);
      if (!arg.startsWith("--cwd=")) i += 1;
      continue;
    }
    if (arg === "--label" || arg.startsWith("--label=")) {
      label = readValue(arg, "--label", argv, i);
      if (!arg.startsWith("--label=")) i += 1;
      continue;
    }
    throw new AgentError(
      `unknown exec option: ${arg}`,
      "run `runtag exec --help`, or pass the command after --",
    );
  }

  if (command === undefined) {
    throw new AgentError(
      "exec requires a command after --",
      "re-run as `runtag exec [--cwd DIR] [--label NAME] [--detach] -- <cmd> [args...]`",
    );
  }
  if (command.length === 0 || command[0] === undefined || command[0].length === 0) {
    throw new AgentError(
      "exec requires a non-empty command after --",
      "re-run as `runtag exec [--cwd DIR] [--label NAME] [--detach] -- <cmd> [args...]`",
    );
  }
  return { cwd, label, detach, command };
}

function parseStatus(argv: string[]): string {
  const positional: string[] = [];
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg.startsWith("-")) {
      throw new AgentError(`unknown status option: ${arg}`, "run `runtag status <id>`");
    }
    positional.push(arg);
  }
  if (positional.length !== 1 || positional[0] === undefined) {
    throw new AgentError(
      "status requires exactly one job id",
      "run `runtag status <id>` using an id from `runtag list` or `runtag exec --detach`",
    );
  }
  return positional[0];
}

function parseList(argv: string[]): { root?: string; status?: JobStatus } {
  let root: string | undefined;
  let status: JobStatus | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--root" || arg.startsWith("--root=")) {
      root = readValue(arg, "--root", argv, i);
      if (!arg.startsWith("--root=")) i += 1;
      continue;
    }
    if (arg === "--status" || arg.startsWith("--status=")) {
      const value = readValue(arg, "--status", argv, i);
      if (!arg.startsWith("--status=")) i += 1;
      if (value !== "running" && value !== "exited") {
        throw new AgentError(
          `invalid status: ${value}`,
          "pass --status running or --status exited",
        );
      }
      status = value;
      continue;
    }
    throw new AgentError(
      `unknown list option: ${arg}`,
      "supported options are --root DIR and --status running|exited",
    );
  }
  return { root, status };
}

function parseGc(argv: string[]): string {
  let olderThan = "0s";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--older-than" || arg.startsWith("--older-than=")) {
      olderThan = readValue(arg, "--older-than", argv, i);
      if (!arg.startsWith("--older-than=")) i += 1;
      continue;
    }
    throw new AgentError(
      `unknown gc option: ${arg}`,
      "run `runtag gc --older-than 7d` (units: ms, s, m, h, d)",
    );
  }
  return olderThan;
}

function readValue(arg: string, flag: string, argv: string[], index: number): string {
  if (arg.startsWith(`${flag}=`)) {
    const value = arg.slice(flag.length + 1);
    if (value.length === 0) {
      throw new AgentError(`${flag} requires a value`, `pass ${flag} <value> or ${flag}=<value>`);
    }
    return value;
  }
  const value = argv[index + 1];
  if (value === undefined || value === "--" || value.startsWith("--")) {
    throw new AgentError(`${flag} requires a value`, `pass ${flag} <value>`);
  }
  return value;
}

function scriptPath(): string {
  const arg = process.argv[1];
  if (arg === undefined || arg.length === 0) {
    throw new AgentError(
      "cannot locate the runtag script to supervise the child",
      "invoke runtag with node, for example `node dist/cli.js exec --detach -- <cmd>`",
    );
  }
  return path.resolve(arg);
}

function printHelp(): void {
  writeSync(1, HELP);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    if (err instanceof AgentError) report(err);
    report(
      new AgentError(
        err instanceof Error ? err.message : String(err),
        "this is an unexpected runtag failure; re-run the same command and keep stderr",
      ),
    );
  });
