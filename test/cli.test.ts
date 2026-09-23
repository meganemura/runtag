import { execFile, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Job } from "../src/types.js";
import { ulid } from "../src/ulid.js";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const cliPath = path.join(repoRoot, "dist", "cli.js");
const nodeBin = process.execPath;

const JOB_KEYS = [
  "id",
  "pid",
  "supervisor_pid",
  "cwd",
  "repo_root",
  "command",
  "label",
  "status",
  "exit_code",
  "started_at",
  "ended_at",
];

interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

interface Running {
  child: ChildProcess;
  closed: Promise<RunResult>;
}

function start(args: string[], options?: { env?: NodeJS.ProcessEnv; cwd?: string }): Running {
  const child = spawn(nodeBin, [cliPath, ...args], {
    cwd: options?.cwd,
    env: options?.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const closed = once(child, "close").then(([code, signal]) => ({
    code: code as number | null,
    signal: signal as NodeJS.Signals | null,
    stdout,
    stderr,
  }));
  return { child, closed };
}

function run(args: string[], options?: { env?: NodeJS.ProcessEnv; cwd?: string }): Promise<RunResult> {
  return start(args, options).closed;
}

async function poll(fn: () => Promise<boolean>, timeoutMs = 8_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

function envelope(stderr: string): { error: string; do: string } {
  const body = JSON.parse(stderr) as { error?: unknown; do?: unknown };
  assert.deepEqual(Object.keys(body), ["error", "do"]);
  assert.equal(typeof body.error, "string");
  assert.equal(typeof body.do, "string");
  assert.ok((body.do as string).length > 0);
  return body as { error: string; do: string };
}

function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function killPid(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // already gone
  }
}

function deadPid(): number {
  for (let pid = 2_147_483_646; pid > 2_147_480_000; pid -= 1) {
    try {
      process.kill(pid, 0);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ESRCH") return pid;
    }
  }
  throw new Error("could not find an unused pid");
}

async function makeEnv(): Promise<{ root: string; xdg: string; env: NodeJS.ProcessEnv }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "runtag-"));
  const xdg = path.join(root, "xdg");
  await mkdir(xdg, { recursive: true });
  return {
    root,
    xdg,
    env: {
      ...process.env,
      XDG_DATA_HOME: xdg,
      GIT_CEILING_DIRECTORIES: root,
    },
  };
}

async function putJob(xdg: string, job: Job): Promise<void> {
  const dir = path.join(xdg, "runtag", "jobs");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${job.id}.json`), `${JSON.stringify(job, null, 2)}\n`);
}

function crafted(fields: {
  id?: string;
  cwd: string;
  status: Job["status"];
  repo_root?: string | null;
  started_at?: string;
  ended_at?: string | null;
  exit_code?: number | null;
  supervisor_pid?: number;
  label?: string | null;
}): Job {
  const exited = fields.status === "exited";
  return {
    id: fields.id ?? ulid(),
    pid: 4321,
    supervisor_pid: fields.supervisor_pid ?? process.pid,
    cwd: fields.cwd,
    repo_root: fields.repo_root ?? null,
    command: ["echo", "hi"],
    label: fields.label ?? null,
    status: fields.status,
    exit_code: fields.exit_code === undefined ? (exited ? 0 : null) : fields.exit_code,
    started_at: fields.started_at ?? "2026-09-23T00:00:00.000Z",
    ended_at: fields.ended_at === undefined ? (exited ? "2026-09-23T00:00:01.000Z" : null) : fields.ended_at,
  };
}

test("help is plain text and mentions the agent flow", async () => {
  for (const args of [[], ["--help"], ["help"], ["exec", "--help"]]) {
    const result = await run(args);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /XDG_DATA_HOME/);
    assert.match(result.stdout, /spacequery watch runs-in-dir --root <repo> --until status=exited/);
  }
});

test("unknown commands and missing exec separators return {error,do}", async () => {
  const unknown = await run(["nope"]);
  assert.equal(unknown.code, 1);
  assert.match(envelope(unknown.stderr).error, /unknown command: nope/);

  const missingDash = await run(["exec", "npm", "test"]);
  assert.equal(missingDash.code, 1);
  assert.match(envelope(missingDash.stderr).do, /--/);

  const missingId = await run(["status"]);
  assert.equal(missingId.code, 1);
  assert.match(envelope(missingId.stderr).error, /exactly one job id/);

  const badStatus = await run(["list", "--status", "passed"]);
  assert.equal(badStatus.code, 1);
  assert.match(envelope(badStatus.stderr).do, /running or --status exited/);

  const badDuration = await run(["gc", "--older-than", "yesterday"]);
  assert.equal(badDuration.code, 1);
  assert.match(envelope(badDuration.stderr).do, /7d/);
});

test("foreground relays stdio and the child exit code, and records the job outside cwd", async () => {
  const { root, xdg, env } = await makeEnv();
  const work = path.join(root, "work");
  await mkdir(work);
  try {
    const before = await readdir(work);
    const ok = await run(["exec", "--cwd", work, "--label", "unit", "--", nodeBin, "-e", "console.log('hello-from-child'); console.error('child-err')"], {
      env,
    });
    assert.equal(ok.code, 0, ok.stderr);
    assert.match(ok.stdout, /hello-from-child/);
    assert.match(ok.stderr, /child-err/);
    assert.equal(ok.stderr.includes('"do"'), false);
    assert.deepEqual(await readdir(work), before);

    const failed = await run(["exec", "--cwd", work, "--", nodeBin, "-e", "process.exit(3)"], { env });
    assert.equal(failed.code, 3);
    assert.equal(failed.stderr, "");

    const listed = JSON.parse((await run(["list"], { env })).stdout) as Job[];
    assert.equal(listed.length, 2);
    const exit3 = listed.find((job) => job.exit_code === 3);
    const exit0 = listed.find((job) => job.exit_code === 0);
    assert.ok(exit3);
    assert.ok(exit0);
    assert.deepEqual(Object.keys(exit0), JOB_KEYS);
    assert.equal(exit0.status, "exited");
    assert.equal(exit0.label, "unit");
    assert.equal(exit0.cwd, work);
    assert.deepEqual(exit0.command, [nodeBin, "-e", "console.log('hello-from-child'); console.error('child-err')"]);
    assert.match(exit0.started_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(exit0.ended_at ?? "", /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(exit3.label, null);

    const jobs = await readdir(path.join(xdg, "runtag", "jobs"));
    assert.equal(jobs.length, 2);
    assert.ok(jobs.every((name) => /^[0-9A-HJKMNP-TV-Z]{26}\.json$/.test(name)));

    const relative = path.join(root, "rel");
    await mkdir(relative);
    const rel = await run(["exec", "--cwd", "rel", "--", nodeBin, "-e", "process.exit(0)"], {
      env,
      cwd: root,
    });
    assert.equal(rel.code, 0, rel.stderr);
    const relJobs = JSON.parse((await run(["list", "--root", relative], { env })).stdout) as Job[];
    assert.equal(relJobs.length, 1);
    assert.equal(relJobs[0]?.cwd, path.resolve(relative));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("foreground forwards SIGINT and records 128+signal", async () => {
  const { root, env } = await makeEnv();
  const work = path.join(root, "work");
  await mkdir(work);
  const running = start(["exec", "--cwd", work, "--", nodeBin, "-e", "setInterval(() => {}, 1000)"], { env });
  try {
    await poll(async () => {
      const listed = JSON.parse((await run(["list"], { env })).stdout) as Job[];
      return listed.length === 1 && listed[0]?.supervisor_pid === running.child.pid;
    });
    assert.ok(running.child.pid);
    process.kill(running.child.pid, "SIGINT");
    const closed = await running.closed;
    assert.equal(closed.code, 130, closed.stderr);
    const listed = JSON.parse((await run(["list"], { env })).stdout) as Job[];
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.status, "exited");
    assert.equal(listed[0]?.exit_code, 130);
    assert.equal("orphan" in (listed[0] ?? {}), false);
  } finally {
    killPid(running.child.pid ?? 0);
    await rm(root, { recursive: true, force: true });
  }
});

test("detach returns before the child exits and the supervisor records exit_code", async () => {
  const { root, env } = await makeEnv();
  const work = path.join(root, "work");
  await mkdir(work);
  let supervisorPid = 0;
  let childPid = 0;
  let failed = true;
  try {
    const result = await run(
      ["exec", "--detach", "--cwd", work, "--label=slow", "--", nodeBin, "-e", "setTimeout(() => process.exit(4), 1200)"],
      { env },
    );
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, "");
    const summary = JSON.parse(result.stdout) as Job;
    supervisorPid = summary.supervisor_pid;
    childPid = summary.pid;
    assert.deepEqual(Object.keys(summary), JOB_KEYS);
    assert.equal(summary.status, "running");
    assert.equal(summary.exit_code, null);
    assert.equal(summary.label, "slow");
    assert.equal(summary.cwd, work);
    assert.notEqual(summary.supervisor_pid, summary.pid);
    assert.equal(alive(summary.supervisor_pid), true);
    assert.match(summary.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);

    await poll(async () => {
      const status = await run(["status", summary.id], { env });
      if (status.code !== 0) return false;
      const job = JSON.parse(status.stdout) as Job;
      return job.status === "exited";
    });
    const status = await run(["status", summary.id], { env });
    const job = JSON.parse(status.stdout) as Job;
    assert.equal(job.status, "exited");
    assert.equal(job.exit_code, 4);
    assert.equal(job.ended_at === null, false);
    assert.equal("orphan" in job, false);
    failed = false;
  } finally {
    if (failed) {
      killPid(supervisorPid);
      killPid(childPid);
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("a dead supervisor stays running with exit_code null and orphan true", async () => {
  const { root, xdg, env } = await makeEnv();
  const work = path.join(root, "work");
  await mkdir(work);
  let childPid = 0;
  let supervisorPid = 0;
  try {
    const result = await run(
      ["exec", "--detach", "--cwd", work, "--", nodeBin, "-e", "setInterval(() => {}, 1000)"],
      { env },
    );
    assert.equal(result.code, 0, result.stderr);
    const summary = JSON.parse(result.stdout) as Job;
    childPid = summary.pid;
    supervisorPid = summary.supervisor_pid;
    assert.equal(alive(supervisorPid), true);
    process.kill(supervisorPid, "SIGKILL");
    await poll(async () => !alive(supervisorPid));

    const status = await run(["status", summary.id], { env });
    assert.equal(status.code, 0, status.stderr);
    const view = JSON.parse(status.stdout) as Job & { orphan?: boolean };
    assert.equal(view.status, "running");
    assert.equal(view.exit_code, null);
    assert.equal(view.orphan, true);
    assert.equal(view.ended_at, null);

    const file = path.join(xdg, "runtag", "jobs", `${summary.id}.json`);
    const before = await readFile(file, "utf8");
    const stored = JSON.parse(before) as Job & { orphan?: boolean };
    assert.equal(stored.status, "running");
    assert.equal(stored.exit_code, null);
    assert.equal("orphan" in stored, false);

    await run(["status", summary.id], { env });
    assert.equal(await readFile(file, "utf8"), before);

    const gc = JSON.parse((await run(["gc"], { env })).stdout) as { deleted: string[] };
    assert.deepEqual(gc.deleted, []);
    assert.equal(await readFile(file, "utf8"), before);
  } finally {
    killPid(supervisorPid);
    killPid(childPid);
    await rm(root, { recursive: true, force: true });
  }
});

test("missing executables return an envelope and do not write a job", async () => {
  const { root, xdg, env } = await makeEnv();
  const work = path.join(root, "work");
  await mkdir(work);
  try {
    for (const args of [
      ["exec", "--cwd", work, "--", "runtag-missing-bin-xyz"],
      ["exec", "--detach", "--cwd", work, "--", "runtag-missing-bin-xyz"],
    ]) {
      const result = await run(args, { env });
      assert.equal(result.code, 127, result.stderr);
      assert.match(envelope(result.stderr).error, /failed to start runtag-missing-bin-xyz/);
      assert.equal(result.stdout, "");
    }
    const dir = path.join(xdg, "runtag", "jobs");
    const names = await readdir(dir).catch(() => [] as string[]);
    assert.deepEqual(names.filter((name) => name.endsWith(".json")), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repo_root comes from git and is null outside a repository", async () => {
  const { root, env } = await makeEnv();
  const repo = path.join(root, "repo");
  const nested = path.join(repo, "pkg");
  const nogit = path.join(root, "nogit");
  await mkdir(nested, { recursive: true });
  await mkdir(nogit);
  try {
    await execFileAsync("git", ["init", "-q"], { cwd: repo });
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: nested });
    const toplevel = stdout.trim();

    const inside = await run(["exec", "--cwd", nested, "--", nodeBin, "-e", "process.exit(0)"], { env });
    assert.equal(inside.code, 0, inside.stderr);
    const outside = await run(["exec", "--cwd", nogit, "--", nodeBin, "-e", "process.exit(0)"], { env });
    assert.equal(outside.code, 0, outside.stderr);

    const inRepo = JSON.parse((await run(["list", "--root", toplevel], { env })).stdout) as Job[];
    assert.equal(inRepo.length, 1);
    assert.equal(inRepo[0]?.repo_root, toplevel);
    assert.equal(inRepo[0]?.cwd, path.resolve(nested));

    const inNested = JSON.parse((await run(["list", "--root", nested], { env })).stdout) as Job[];
    assert.equal(inNested.length, 1);

    const bare = JSON.parse((await run(["list", "--root", nogit], { env })).stdout) as Job[];
    assert.equal(bare.length, 1);
    assert.equal(bare[0]?.repo_root, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("list filters by root and status; gc deletes only old exited jobs", async () => {
  const { root, xdg, env } = await makeEnv();
  const repo = path.join(root, "repo");
  const nested = path.join(repo, "pkg");
  const sibling = path.join(root, "repo-other");
  const elsewhere = path.join(root, "other");
  try {
    const now = Date.now();
    const old = crafted({
      cwd: nested,
      repo_root: repo,
      status: "exited",
      started_at: new Date(now - 3 * 3_600_000).toISOString(),
      ended_at: new Date(now - 2 * 3_600_000).toISOString(),
      exit_code: 0,
    });
    const recent = crafted({
      cwd: nested,
      repo_root: repo,
      status: "exited",
      started_at: new Date(now - 120_000).toISOString(),
      ended_at: new Date(now - 60_000).toISOString(),
      exit_code: 2,
      label: "recent",
    });
    const running = crafted({
      cwd: sibling,
      status: "running",
      started_at: new Date(now - 10 * 86_400_000).toISOString(),
      ended_at: null,
      exit_code: null,
      supervisor_pid: process.pid,
    });
    const orphan = crafted({
      cwd: elsewhere,
      repo_root: elsewhere,
      status: "running",
      started_at: new Date(now - 10 * 86_400_000).toISOString(),
      ended_at: null,
      exit_code: null,
      supervisor_pid: deadPid(),
    });
    await putJob(xdg, old);
    await putJob(xdg, recent);
    await putJob(xdg, running);
    await putJob(xdg, orphan);

    const empty = JSON.parse((await run(["list", "--root", path.join(root, "missing")], { env })).stdout) as Job[];
    assert.deepEqual(empty, []);

    const underRepo = JSON.parse((await run(["list", "--root", repo], { env })).stdout) as Array<Job & { orphan?: true }>;
    assert.deepEqual(underRepo.map((job) => job.id), [recent.id, old.id]);

    const prefix = JSON.parse((await run(["list", "--root", sibling], { env })).stdout) as Job[];
    assert.deepEqual(prefix.map((job) => job.id), [running.id]);

    const exited = JSON.parse((await run(["list", "--root", repo, "--status", "exited"], { env })).stdout) as Job[];
    assert.deepEqual(exited.map((job) => job.id), [recent.id, old.id]);

    const runningList = JSON.parse((await run(["list", "--status=running"], { env })).stdout) as Array<Job & { orphan?: true }>;
    assert.deepEqual(
      runningList.map((job) => job.id).sort(),
      [orphan.id, running.id].sort(),
    );
    const orphanView = runningList.find((job) => job.id === orphan.id);
    assert.equal(orphanView?.orphan, true);
    assert.equal(orphanView?.exit_code, null);
    const liveView = runningList.find((job) => job.id === running.id);
    assert.equal("orphan" in (liveView ?? {}), false);

    const unknown = await run(["status", ulid()], { env });
    assert.equal(unknown.code, 1);
    assert.match(envelope(unknown.stderr).error, /unknown job id/);

    const invalid = await run(["status", "../secret"], { env });
    assert.equal(invalid.code, 1);
    assert.match(envelope(invalid.stderr).error, /invalid job id/);

    const gcHour = JSON.parse((await run(["gc", "--older-than", "1h"], { env })).stdout) as { deleted: string[] };
    assert.deepEqual(gcHour.deleted, [old.id].sort());
    const gcAll = JSON.parse((await run(["gc"], { env })).stdout) as { deleted: string[] };
    assert.deepEqual(gcAll.deleted, [recent.id]);
    const left = JSON.parse((await run(["list"], { env })).stdout) as Job[];
    assert.deepEqual(left.map((job) => job.id).sort(), [orphan.id, running.id].sort());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("arguments after -- belong to the child, and a fast detach still records exit", async () => {
  const { root, env } = await makeEnv();
  const work = path.join(root, "work");
  await mkdir(work);
  let supervisorPid = 0;
  let childPid = 0;
  let failed = true;
  try {
    const version = await run(["exec", "--cwd", work, "--", nodeBin, "--version"], { env });
    assert.equal(version.code, 0, version.stderr);
    assert.match(version.stdout, /^v\d+/);
    const listed = JSON.parse((await run(["list"], { env })).stdout) as Job[];
    assert.deepEqual(listed[0]?.command, [nodeBin, "--version"]);

    const detached = await run(["exec", "--detach", "--cwd", work, "--", nodeBin, "-e", "process.exit(0)"], { env });
    assert.equal(detached.code, 0, detached.stderr);
    const summary = JSON.parse(detached.stdout) as Job;
    supervisorPid = summary.supervisor_pid;
    childPid = summary.pid;
    await poll(async () => {
      const status = await run(["status", summary.id], { env });
      if (status.code !== 0) return false;
      const job = JSON.parse(status.stdout) as Job;
      return job.status === "exited" && job.exit_code === 0;
    });
    failed = false;
  } finally {
    if (failed) {
      killPid(supervisorPid);
      killPid(childPid);
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("bad cwd and a non-directory are actionable failures", async () => {
  const { root, env } = await makeEnv();
  const file = path.join(root, "not-a-dir");
  await writeFile(file, "x");
  try {
    const missing = await run(["exec", "--cwd", path.join(root, "missing"), "--", nodeBin, "-e", "process.exit(0)"], { env });
    assert.equal(missing.code, 1);
    assert.match(envelope(missing.stderr).do, /--cwd/);

    const notDir = await run(["exec", "--cwd", file, "--", nodeBin, "-e", "process.exit(0)"], { env });
    assert.equal(notDir.code, 1);
    assert.match(envelope(notDir.stderr).error, /not a directory/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("list and gc succeed when no jobs exist", async () => {
  const { root, env } = await makeEnv();
  try {
    const listed = await run(["list"], { env });
    assert.equal(listed.code, 0, listed.stderr);
    assert.deepEqual(JSON.parse(listed.stdout), []);
    const gc = await run(["gc", "--older-than=7d"], { env });
    assert.equal(gc.code, 0, gc.stderr);
    assert.deepEqual(JSON.parse(gc.stdout), { deleted: [] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
