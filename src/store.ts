import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { isOlderThan } from "./duration.js";
import { AgentError } from "./errors.js";
import type { Job, JobStatus, JobView } from "./types.js";
import { ulid } from "./ulid.js";

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function jobsDir(): string {
  const fromEnv = process.env.XDG_DATA_HOME?.trim();
  const base = fromEnv && fromEnv.length > 0 ? fromEnv : path.join(homedir(), ".local", "share");
  return path.resolve(base, "runtag", "jobs");
}

export function jobPath(id: string): string {
  return path.join(jobsDir(), `${id}.json`);
}

export function assertJobId(id: string): void {
  if (!ULID_RE.test(id)) {
    throw new AgentError(
      `invalid job id: ${id}`,
      "pass a 26-character ULID printed by `runtag exec --detach` or `runtag list`",
    );
  }
}

export async function allocateId(): Promise<string> {
  const dir = jobsDir();
  await mkdir(dir, { recursive: true });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = ulid();
    try {
      await stat(jobPath(id));
    } catch (err) {
      if (isEnoent(err)) return id;
      throw new AgentError(
        `could not allocate a job id: ${messageOf(err)}`,
        "check that the XDG state directory is writable",
      );
    }
  }
  throw new AgentError("could not allocate a unique job id", "retry `runtag exec`");
}

export function toRecord(job: Job): Job {
  return {
    id: job.id,
    pid: job.pid,
    supervisor_pid: job.supervisor_pid,
    cwd: job.cwd,
    repo_root: job.repo_root,
    command: [...job.command],
    label: job.label,
    status: job.status,
    exit_code: job.exit_code,
    started_at: job.started_at,
    ended_at: job.ended_at,
  };
}

export async function writeJob(job: Job): Promise<void> {
  const dir = jobsDir();
  await mkdir(dir, { recursive: true });
  const dest = jobPath(job.id);
  const tmp = `${dest}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(toRecord(job), null, 2)}\n`, "utf8");
  await rename(tmp, dest);
}

export async function readJob(id: string): Promise<Job> {
  assertJobId(id);
  const file = jobPath(id);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if (isEnoent(err)) {
      throw new AgentError(
        `unknown job id: ${id}`,
        "run `runtag list` and pass an id from that array",
      );
    }
    throw new AgentError(
      `could not read job ${id}: ${messageOf(err)}`,
      `check permissions on ${file}`,
    );
  }
  return parseJob(text, file);
}

export async function listJobs(filter: { root?: string; status?: JobStatus }): Promise<JobView[]> {
  const jobs = await readAllJobs();
  const root = filter.root === undefined ? undefined : path.resolve(filter.root);
  const views: JobView[] = [];
  for (const job of jobs) {
    if (filter.status !== undefined && job.status !== filter.status) continue;
    if (root !== undefined && !jobMatchesRoot(job, root)) continue;
    views.push(present(job));
  }
  views.sort(compareJobs);
  return views;
}

export async function gcJobs(olderThanMs: number): Promise<{ deleted: string[] }> {
  const jobs = await readAllJobs();
  const now = Date.now();
  const deleted: string[] = [];
  for (const job of jobs) {
    if (job.status !== "exited") continue;
    if (!isOlderThan(job.ended_at, olderThanMs, now)) continue;
    await rm(jobPath(job.id), { force: true });
    deleted.push(job.id);
  }
  deleted.sort();
  return { deleted };
}

export function present(job: Job): JobView {
  const clean = toRecord(job);
  if (clean.status === "running" && !isPidAlive(clean.supervisor_pid)) {
    return { ...clean, orphan: true };
  }
  return clean;
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function pathEqualsOrInside(root: string, candidate: string | null): boolean {
  if (candidate === null || candidate.length === 0) return false;
  const base = path.resolve(root);
  const target = path.resolve(candidate);
  const rel = path.relative(base, target);
  if (rel === "") return true;
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

export function repoRoot(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.GIT_DIR;
    delete env.GIT_WORK_TREE;
    delete env.GIT_INDEX_FILE;
    const child = spawn("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(null);
    }, 5_000);
    timer.unref();
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      out += chunk;
    });
    child.on("error", () => {
      finish(null);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        finish(null);
        return;
      }
      const line = out.trim();
      finish(line.length > 0 ? line : null);
    });
  });
}

function jobMatchesRoot(job: Job, root: string): boolean {
  return pathEqualsOrInside(root, job.repo_root) || pathEqualsOrInside(root, job.cwd);
}

async function readAllJobs(): Promise<Job[]> {
  let names: string[];
  try {
    names = await readdir(jobsDir());
  } catch (err) {
    if (isEnoent(err)) return [];
    throw new AgentError(
      `could not read the job directory: ${messageOf(err)}`,
      `check permissions on ${jobsDir()}`,
    );
  }
  const jobs: Job[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(jobsDir(), name);
    const text = await readFile(file, "utf8");
    jobs.push(parseJob(text, file));
  }
  return jobs;
}

function parseJob(text: string, file: string): Job {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw unreadable(file);
  }
  if (!isJob(raw)) throw unreadable(file);
  return toRecord(raw);
}

function unreadable(file: string): AgentError {
  return new AgentError(
    `unreadable job file: ${file}`,
    `fix or delete ${file}, then retry`,
  );
}

function isJob(value: unknown): value is Job {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || !ULID_RE.test(value.id)) return false;
  if (!isInteger(value.pid) || !isInteger(value.supervisor_pid)) return false;
  if (typeof value.cwd !== "string") return false;
  if (!(value.repo_root === null || typeof value.repo_root === "string")) return false;
  if (!Array.isArray(value.command) || value.command.length === 0) return false;
  if (!value.command.every((part) => typeof part === "string")) return false;
  if (!(value.label === null || typeof value.label === "string")) return false;
  if (value.status !== "running" && value.status !== "exited") return false;
  if (!(value.exit_code === null || isInteger(value.exit_code))) return false;
  if (typeof value.started_at !== "string" || value.started_at.length === 0) return false;
  if (!(value.ended_at === null || typeof value.ended_at === "string")) return false;
  return true;
}

function compareJobs(a: Job, b: Job): number {
  if (a.started_at !== b.started_at) return a.started_at < b.started_at ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isEnoent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === "ENOENT";
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
