import { spawn, type ChildProcess } from "node:child_process";
import { writeSync, type Stats } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:os";
import { AgentError } from "./errors.js";
import { present, readJob, repoRoot, toRecord, writeJob } from "./store.js";
import type { Job, JobView, SuperviseSpec } from "./types.js";

const READY_TIMEOUT_MS = 15_000;

interface ExitWatch {
  done: Promise<number | null>;
  settled: () => boolean;
  code: () => number | null;
}

export async function supervise(spec: SuperviseSpec, detach: boolean): Promise<number | null> {
  await assertCwd(spec.cwd);
  const commandName = spec.command[0];
  if (commandName === undefined || commandName.length === 0) {
    throw new AgentError(
      "exec requires a non-empty command after --",
      "re-run as `runtag exec [--cwd DIR] [--label NAME] [--detach] -- <cmd> [args...]`",
    );
  }

  const child = spawn(commandName, spec.command.slice(1), {
    cwd: spec.cwd,
    env: process.env,
    stdio: detach ? "ignore" : "inherit",
    shell: false,
  });
  const watched = watchChild(child);

  try {
    await waitUntilSpawned(child);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    throw new AgentError(
      `failed to start ${commandName}: ${error.message}`,
      "check the executable name, PATH, and that the file is executable",
      spawnFailureCode(error),
    );
  }
  child.on("error", () => {
    // A late spawn error must not crash the supervisor before it records the exit.
  });

  const pid = child.pid;
  if (pid === undefined) {
    throw new AgentError(
      `failed to start ${commandName}: no pid`,
      "check the executable name, PATH, and that the file is executable",
      127,
    );
  }

  const startedAt = new Date().toISOString();
  const repo_root = await repoRoot(spec.cwd);
  const running: Job = {
    id: spec.id,
    pid,
    supervisor_pid: process.pid,
    cwd: spec.cwd,
    repo_root,
    command: [...spec.command],
    label: spec.label,
    status: "running",
    exit_code: null,
    started_at: startedAt,
    ended_at: null,
  };

  if (watched.settled()) {
    const finished = finishJob(running, watched.code());
    await writeJob(finished);
    if (detach) emitReady(finished);
    return watched.code();
  }

  await writeJob(running);
  if (detach) emitReady(running);

  const code = await watched.done;
  await writeJob(finishJob(running, code));
  return code;
}

export async function startDetached(spec: SuperviseSpec, scriptPath: string): Promise<JobView> {
  const sup = spawn(process.execPath, [scriptPath, "__supervise"], {
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });
  sup.stdin?.on("error", () => {});
  sup.stdout?.on("error", () => {});
  sup.stderr?.on("error", () => {});

  const ready = readReady(sup);
  sup.stdin?.write(JSON.stringify(spec));
  sup.stdin?.end();

  let snapshot: Job;
  try {
    snapshot = await ready;
  } catch (err) {
    killGroup(sup.pid);
    throw err;
  }

  sup.stdout?.destroy();
  sup.stderr?.destroy();
  sup.stdin?.destroy();
  sup.unref();

  return present(await readJob(snapshot.id));
}

export function parseSuperviseSpec(text: string): SuperviseSpec {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new AgentError(
      "supervisor received invalid JSON on stdin",
      "this is an internal command; use `runtag exec`",
    );
  }
  if (typeof raw !== "object" || raw === null) {
    throw new AgentError(
      "supervisor received an invalid job spec",
      "this is an internal command; use `runtag exec`",
    );
  }
  const spec = raw as Partial<SuperviseSpec>;
  if (typeof spec.id !== "string" || typeof spec.cwd !== "string") {
    throw new AgentError(
      "supervisor received an invalid job spec",
      "this is an internal command; use `runtag exec`",
    );
  }
  if (!(spec.label === null || typeof spec.label === "string")) {
    throw new AgentError(
      "supervisor received an invalid job spec",
      "this is an internal command; use `runtag exec`",
    );
  }
  if (!Array.isArray(spec.command) || spec.command.length === 0 || spec.command.some((part) => typeof part !== "string")) {
    throw new AgentError(
      "supervisor received an invalid command",
      "this is an internal command; use `runtag exec`",
    );
  }
  return {
    id: spec.id,
    cwd: spec.cwd,
    label: spec.label,
    command: spec.command,
  };
}

function finishJob(job: Job, code: number | null): Job {
  return {
    ...job,
    status: "exited",
    exit_code: code,
    ended_at: new Date().toISOString(),
  };
}

function emitReady(job: Job): void {
  try {
    writeSync(1, `${JSON.stringify(toRecord(job))}\n`);
  } catch {
    // The parent went away. Keep waiting so the exit code is still recorded.
  }
}

function watchChild(child: ChildProcess): ExitWatch {
  let settled = false;
  let code: number | null = null;
  let resolveDone: (value: number | null) => void = () => {};
  const done = new Promise<number | null>((resolve) => {
    resolveDone = resolve;
  });

  const finish = (value: number | null) => {
    if (settled) return;
    settled = true;
    code = value;
    resolveDone(value);
  };

  const forward = (signal: NodeJS.Signals) => {
    if (child.pid === undefined || child.pid <= 0) return;
    try {
      process.kill(child.pid, signal);
    } catch {
      // The child already exited, or the terminal delivered the signal itself.
    }
  };

  process.on("SIGINT", () => {
    forward("SIGINT");
  });
  process.on("SIGTERM", () => {
    forward("SIGTERM");
  });
  process.on("SIGHUP", () => {
    forward("SIGHUP");
  });

  child.on("exit", (exitCode, signal) => {
    if (typeof exitCode === "number") {
      finish(exitCode);
      return;
    }
    if (signal !== null) {
      const signalNumber = constants.signals[signal];
      if (signalNumber !== undefined) {
        // Shell convention: a recorded signal, not a guessed status.
        finish(128 + signalNumber);
        return;
      }
    }
    finish(null);
  });

  return {
    done,
    settled: () => settled,
    code: () => code,
  };
}

function waitUntilSpawned(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onSpawn = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      child.off("error", onError);
      child.off("spawn", onSpawn);
    };
    child.on("error", onError);
    child.on("spawn", onSpawn);
  });
}

function readReady(sup: ChildProcess): Promise<Job> {
  return new Promise((resolve, reject) => {
    let out = "";
    let err = "";
    let settled = false;
    const timer = setTimeout(() => {
      fail(
        new AgentError(
          "timed out waiting for the per-job supervisor",
          "retry `runtag exec --detach`; if it persists, run without --detach so the child keeps your terminal",
        ),
      );
    }, READY_TIMEOUT_MS);
    timer.unref();

    const succeed = (job: Job) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      detachListeners();
      resolve(job);
    };
    const fail = (error: AgentError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      detachListeners();
      reject(error);
    };
    const onOut = (buf: Buffer) => {
      out += buf.toString("utf8");
      const idx = out.indexOf("\n");
      if (idx === -1) return;
      try {
        const job = JSON.parse(out.slice(0, idx)) as Partial<Job>;
        if (typeof job.id !== "string") {
          fail(new AgentError("supervisor returned an unusable ready message", "retry `runtag exec --detach`"));
          return;
        }
        succeed(job as Job);
      } catch {
        fail(new AgentError("supervisor returned invalid JSON", "retry `runtag exec --detach`"));
      }
    };
    const onErr = (buf: Buffer) => {
      err += buf.toString("utf8");
    };
    const onExit = (code: number | null) => {
      const envelope = parseEnvelope(err);
      if (envelope) {
        fail(new AgentError(envelope.error, envelope.do, normalizeExit(code, envelope)));
        return;
      }
      fail(
        new AgentError(
          `supervisor exited before the job was running (code ${code ?? "null"})`,
          "run the same command without --detach to see the child output",
          code !== null && code > 0 ? code : 1,
        ),
      );
    };
    const onError = (error: Error) => {
      fail(
        new AgentError(
          `could not start the supervisor: ${error.message}`,
          "check that the node binary used to launch runtag still exists",
        ),
      );
    };
    const detachListeners = () => {
      sup.stdout?.off("data", onOut);
      sup.stderr?.off("data", onErr);
      sup.off("exit", onExit);
      sup.off("error", onError);
    };

    sup.stdout?.on("data", onOut);
    sup.stderr?.on("data", onErr);
    sup.on("exit", onExit);
    sup.on("error", onError);
  });
}

function parseEnvelope(text: string): { error: string; do: string } | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  try {
    const value = JSON.parse(trimmed) as { error?: unknown; do?: unknown };
    if (typeof value.error === "string" && typeof value.do === "string") {
      return { error: value.error, do: value.do };
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeExit(code: number | null, envelope: { error: string }): number {
  if (code !== null && code > 0) return code;
  return envelope.error.startsWith("failed to start ") ? 127 : 1;
}

function killGroup(pid: number | undefined): void {
  if (pid === undefined || pid <= 0) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The supervisor already exited.
    }
  }
}

async function assertCwd(cwd: string): Promise<void> {
  let info: Stats;
  try {
    info = await stat(cwd);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new AgentError(
        `cwd does not exist: ${cwd}`,
        "pass an existing directory to --cwd, or create it first",
      );
    }
    throw new AgentError(
      `could not use cwd ${cwd}: ${err instanceof Error ? err.message : String(err)}`,
      "check that the directory is accessible",
    );
  }
  if (!info.isDirectory()) {
    throw new AgentError(`cwd is not a directory: ${cwd}`, "pass a directory to --cwd");
  }
}

function spawnFailureCode(err: Error): number {
  return (err as NodeJS.ErrnoException).code === "EACCES" ? 126 : 127;
}

export function resolveCwd(cwd: string | undefined): string {
  return path.resolve(cwd ?? process.cwd());
}
