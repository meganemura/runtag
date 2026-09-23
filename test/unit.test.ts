import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { isOlderThan, parseDuration } from "../src/duration.js";
import { AgentError, failureBody } from "../src/errors.js";
import { gcJobs, isPidAlive, jobsDir, listJobs, pathEqualsOrInside, present, writeJob } from "../src/store.js";
import type { Job, JobStatus } from "../src/types.js";
import { ulid } from "../src/ulid.js";

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const ULID_TIME_MAX = 0xffffffffffff;
const settings = { database: hegel.Database.disabled };
const segment = gs.fromRegex("[a-z][a-z0-9]{0,6}");

const UNITS = [
  ["ms", 1],
  ["s", 1_000],
  ["m", 60_000],
  ["h", 3_600_000],
  ["d", 86_400_000],
] as const;

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

function contained(root: string, candidate: string | null): boolean {
  if (candidate === null || candidate.length === 0) return false;
  const base = path.resolve(root);
  const target = path.resolve(candidate);
  if (target === base) return true;
  const prefix = base.endsWith(path.sep) ? base : `${base}${path.sep}`;
  return target.startsWith(prefix);
}

function jobAt(index: number, fields: {
  cwd: string;
  repo_root: string | null;
  status: JobStatus;
  supervisor_pid: number;
  ended_at: string | null;
  exit_code: number | null;
}): Job {
  return {
    id: ulid(1_710_000_000_000 + index),
    pid: 1_000 + index,
    supervisor_pid: fields.supervisor_pid,
    cwd: fields.cwd,
    repo_root: fields.repo_root,
    command: ["echo", String(index)],
    label: null,
    status: fields.status,
    exit_code: fields.exit_code,
    started_at: new Date(1_710_000_000_000 + index).toISOString(),
    ended_at: fields.ended_at,
  };
}

async function withJobs(jobs: Job[], body: () => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "runtag-hegel-"));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = root;
  try {
    for (const job of jobs) await writeJob(job);
    await body();
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
}

describe("runtag properties", { concurrency: false }, () => {
  const unusedPid = deadPid();

  test("a ulid is a 26-character Crockford id and sorts by time", () => {
    hegel.test((tc) => {
      const earlier = tc.draw(gs.integers({ minValue: 0, maxValue: ULID_TIME_MAX - 1 }));
      const room = Math.min(1_000_000, ULID_TIME_MAX - earlier);
      const step = tc.draw(gs.integers({ minValue: 1, maxValue: room }));
      const left = ulid(earlier);
      const right = ulid(earlier + step);
      assert.match(left, ULID_RE);
      assert.match(right, ULID_RE);
      assert.ok(left < right, `${left} sorted after ${right} for ${earlier} then ${earlier + step}`);
    }, settings);
  });

  test("parseDuration is the count times the unit, including surrounding spaces", () => {
    hegel.test((tc) => {
      const count = tc.draw(gs.integers({ minValue: 0, maxValue: 10_000 }));
      const unit = tc.draw(gs.sampledFrom(UNITS));
      const pad = tc.draw(gs.sampledFrom(["", " ", "  "]));
      assert.equal(parseDuration(`${pad}${count}${unit[0]}${pad}`), count * unit[1]);
    }, settings);
  });

  test("parseDuration rejects text that is not an integer and a unit", () => {
    hegel.test((tc) => {
      const input = tc.draw(gs.oneOf(
        gs.text({ minSize: 0, maxSize: 16, alphabet: "abcwxyz .+-" }),
        gs.sampledFrom(["", "7", "7 days", "-1s", "1w", "1.5h", "+7d"]),
        gs.fromRegex("[1-9][0-9]{16,18}").map((digits) => `${digits}d`),
      ));
      assert.throws(
        () => parseDuration(input),
        (err: unknown) => {
          assert.ok(err instanceof AgentError);
          const body = failureBody(err);
          assert.deepEqual(Object.keys(body), ["error", "do"]);
          assert.ok(body.do.length > 0);
          return true;
        },
      );
    }, settings);
  });

  test("isOlderThan follows ended_at and keeps null or unparseable times", () => {
    hegel.test((tc) => {
      const now = tc.draw(gs.integers({ minValue: 1_500_000_000_000, maxValue: 2_000_000_000_000 }));
      const ended = tc.draw(gs.integers({ minValue: 1_500_000_000_000, maxValue: 2_000_000_000_000 }));
      const duration = tc.draw(gs.integers({ minValue: 0, maxValue: 86_400_000 }));
      assert.equal(isOlderThan(new Date(ended).toISOString(), duration, now), now - ended >= duration);
      assert.equal(isOlderThan(null, duration, now), false);
      assert.equal(isOlderThan("not-a-date", duration, now), false);
    }, settings);
  });

  test("a directory contains itself and its children, not a prefix sibling", () => {
    hegel.test((tc) => {
      const rootSegs = tc.draw(gs.arrays(segment, { minSize: 1, maxSize: 4 }));
      const childSegs = tc.draw(gs.arrays(segment, { minSize: 1, maxSize: 3 }));
      const root = path.join("/runtag-prop", ...rootSegs);
      const child = path.join(root, ...childSegs);
      const sibling = `${root}${tc.draw(gs.fromRegex("[a-z]{1,4}"))}`;
      const escaped = path.join(root, "..", "outside");
      const cases: Array<[string, string | null, boolean]> = [
        [root, root, true],
        [`${root}/`, child, true],
        [root, sibling, false],
        [root, escaped, false],
        [root, null, false],
        [root, "", false],
        [child, root, false],
      ];
      for (const [base, candidate, expected] of cases) {
        assert.equal(pathEqualsOrInside(base, candidate), expected);
        assert.equal(pathEqualsOrInside(base, candidate), contained(base, candidate));
      }
      const rel = tc.draw(gs.fromRegex("[a-z]{1,8}"));
      assert.equal(pathEqualsOrInside(rel, path.resolve(rel)), true);
      assert.equal(pathEqualsOrInside(rel, path.resolve(rel, "child")), true);
      assert.equal(pathEqualsOrInside(rel, `${path.resolve(rel)}x`), false);
    }, settings);
  });

  test("jobsDir uses XDG_DATA_HOME and otherwise ~/.local/share", () => {
    hegel.test((tc) => {
      const previous = process.env.XDG_DATA_HOME;
      try {
        const named = tc.draw(gs.booleans());
        if (named) {
          const dir = path.join("/tmp", tc.draw(segment));
          process.env.XDG_DATA_HOME = dir;
          assert.equal(jobsDir(), path.resolve(dir, "runtag", "jobs"));
        } else {
          process.env.XDG_DATA_HOME = tc.draw(gs.sampledFrom(["", " ", "   "]));
          assert.equal(jobsDir(), path.resolve(os.homedir(), ".local", "share", "runtag", "jobs"));
        }
      } finally {
        if (previous === undefined) delete process.env.XDG_DATA_HOME;
        else process.env.XDG_DATA_HOME = previous;
      }
    }, settings);
  });

  test("non-positive pids are not treated as live processes", () => {
    hegel.test((tc) => {
      const pid = tc.draw(gs.integers({ minValue: -32, maxValue: 0 }));
      assert.equal(isPidAlive(pid), false);
    }, settings);
  });

  test("present keeps exit_code and marks orphan only for a dead running supervisor", () => {
    assert.equal(isPidAlive(process.pid), true);
    assert.equal(isPidAlive(unusedPid), false);
    hegel.test((tc) => {
      const status = tc.draw(gs.sampledFrom(["running", "exited"] as const));
      const exitCode = tc.draw(gs.integers({ minValue: 0, maxValue: 255 }));
      const which = tc.draw(gs.sampledFrom(["self", "unused", "nonpositive"] as const));
      const supervisor = which === "self"
        ? process.pid
        : which === "unused"
          ? unusedPid
          : tc.draw(gs.integers({ minValue: -8, maxValue: 0 }));
      const record = jobAt(1, {
        cwd: "/work",
        repo_root: null,
        status,
        supervisor_pid: supervisor,
        ended_at: status === "exited" ? "2026-09-23T00:00:01.000Z" : null,
        exit_code: status === "exited" ? exitCode : null,
      });
      const before = JSON.stringify(record);
      const view = present(record);
      assert.equal(JSON.stringify(record), before);
      assert.equal(view.status, status);
      assert.equal(view.exit_code, record.exit_code);
      const orphan = status === "running" && !isPidAlive(supervisor);
      if (orphan) assert.equal("orphan" in view && view.orphan, true);
      else assert.equal("orphan" in view, false);
    }, settings);
  });

  test("failure bodies are exactly {error, do}", () => {
    hegel.test((tc) => {
      const message = tc.draw(gs.text({ minSize: 1, maxSize: 40, alphabet: "abcdefghijklmnopqrstuvwxyz " }));
      const hint = tc.draw(gs.text({ minSize: 1, maxSize: 40, alphabet: "abcdefghijklmnopqrstuvwxyz " }));
      const code = tc.draw(gs.integers({ minValue: 1, maxValue: 127 }));
      const err = new AgentError(message, hint, code);
      assert.equal(err.exitCode, code);
      assert.deepEqual(failureBody(err), { error: message, do: hint });
      assert.deepEqual(Object.keys(failureBody(err)), ["error", "do"]);
    }, settings);
  });

  test("list --root keeps a job only when repo_root or cwd is the directory or inside it", () => {
    return hegel.testAsync(async (tc) => {
      const rootSegs = tc.draw(gs.arrays(segment, { minSize: 1, maxSize: 3 }));
      const childSegs = tc.draw(gs.arrays(segment, { minSize: 1, maxSize: 2 }));
      const root = path.join("/runtag-prop", ...rootSegs);
      const child = path.join(root, ...childSegs);
      const sibling = `${root}${tc.draw(gs.fromRegex("[a-z]{1,3}"))}`;
      const elsewhere = path.join("/runtag-other", ...childSegs);
      const filter = tc.draw(gs.sampledFrom(["running", "exited", "any"] as const));
      const jobs = [
        jobAt(10, { cwd: root, repo_root: root, status: "running", supervisor_pid: process.pid, ended_at: null, exit_code: null }),
        jobAt(11, { cwd: child, repo_root: root, status: "exited", supervisor_pid: unusedPid, ended_at: "2026-09-23T00:00:02.000Z", exit_code: 2 }),
        jobAt(12, { cwd: sibling, repo_root: sibling, status: "running", supervisor_pid: unusedPid, ended_at: null, exit_code: null }),
        jobAt(13, { cwd: elsewhere, repo_root: null, status: "exited", supervisor_pid: process.pid, ended_at: "2026-09-23T00:00:03.000Z", exit_code: 0 }),
      ];
      await withJobs(jobs, async () => {
        const listed = await listJobs(filter === "any" ? { root } : { root, status: filter });
        const expected = jobs.filter((item) => {
          const inRoot = contained(root, item.repo_root) || contained(root, item.cwd);
          return inRoot && (filter === "any" || item.status === filter);
        });
        assert.deepEqual(listed.map((item) => item.id), expected.map((item) => item.id).reverse());
        assert.ok(listed.every((item) => item.cwd !== sibling && item.repo_root !== sibling));
        const siblingHit = listed.find((item) => item.cwd === sibling);
        assert.equal(siblingHit, undefined);
        const orphan = (await listJobs({ status: "running" })).find((item) => item.id === jobs[2]?.id);
        assert.ok(orphan);
        assert.equal(orphan.status, "running");
        assert.equal(orphan.exit_code, null);
        assert.equal("orphan" in orphan && orphan.orphan, true);
      });
    }, settings);
  });

  test("gc deletes exited jobs that are old enough and leaves every running job", () => {
    return hegel.testAsync(async (tc) => {
      const now = Date.now();
      const duration = tc.draw(gs.sampledFrom([0, 60_000, 24 * 3_600_000]));
      const count = tc.draw(gs.integers({ minValue: 0, maxValue: 6 }));
      const jobs: Job[] = [];
      for (let index = 0; index < count; index += 1) {
        const status = tc.draw(gs.sampledFrom(["running", "exited"] as const));
        const age = tc.draw(gs.sampledFrom(["old", "recent", "future", "missing"] as const));
        const ended = age === "old"
          ? new Date(now - 48 * 3_600_000).toISOString()
          : age === "recent"
            ? new Date(now - 1_000).toISOString()
            : age === "future"
              ? new Date(now + 48 * 3_600_000).toISOString()
              : null;
        jobs.push(jobAt(20 + index, {
          cwd: `/work/${index}`,
          repo_root: null,
          status,
          supervisor_pid: status === "running" ? unusedPid : process.pid,
          ended_at: ended,
          exit_code: status === "exited" ? index : null,
        }));
      }
      await withJobs(jobs, async () => {
        const deleted = await gcJobs(duration);
        const expected = jobs
          .filter((item) => item.status === "exited" && isOlderThan(item.ended_at, duration, Date.now()))
          .map((item) => item.id)
          .sort();
        assert.deepEqual(deleted.deleted, expected);
        const left = await listJobs({});
        assert.deepEqual(
          left.map((item) => item.id).sort(),
          jobs.filter((item) => !expected.includes(item.id)).map((item) => item.id).sort(),
        );
        assert.ok(left.filter((item) => item.status === "running").every((item) => !deleted.deleted.includes(item.id)));
      });
    }, settings);
  });
});
