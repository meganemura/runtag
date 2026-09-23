import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { isOlderThan, parseDuration } from "../src/duration.js";
import { AgentError } from "../src/errors.js";
import { isPidAlive, jobsDir, pathEqualsOrInside, present } from "../src/store.js";
import type { Job } from "../src/types.js";
import { ulid } from "../src/ulid.js";

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

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

function fakeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: ulid(1_700_000_000_000),
    pid: 4321,
    supervisor_pid: process.pid,
    cwd: "/work",
    repo_root: null,
    command: ["npm", "test"],
    label: null,
    status: "running",
    exit_code: null,
    started_at: "2026-09-23T00:00:00.000Z",
    ended_at: null,
    ...overrides,
  };
}

test("ulid is 26 Crockford characters and sorts by time", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 1000; i += 1) ids.add(ulid());
  assert.equal(ids.size, 1000);
  for (const id of ids) assert.match(id, ULID_RE);
  assert.ok(ulid(1_000) < ulid(2_000));
});

test("parseDuration accepts ms, s, m, h, and d", () => {
  assert.equal(parseDuration("0s"), 0);
  assert.equal(parseDuration("500ms"), 500);
  assert.equal(parseDuration("30s"), 30_000);
  assert.equal(parseDuration("15m"), 900_000);
  assert.equal(parseDuration("2h"), 7_200_000);
  assert.equal(parseDuration("7d"), 7 * 86_400_000);
  assert.equal(parseDuration(" 7d "), 7 * 86_400_000);
});

test("parseDuration rejects shapes agents might guess", () => {
  for (const bad of ["", "7", "7 days", "-1s", "1w", "1.5h", "+7d"]) {
    assert.throws(() => parseDuration(bad), AgentError);
  }
});

test("isOlderThan uses ended_at and keeps unknown or future times", () => {
  const now = Date.parse("2026-09-23T00:00:00.000Z");
  assert.equal(isOlderThan("2026-09-22T00:00:00.000Z", 0, now), true);
  assert.equal(isOlderThan("2026-09-23T00:00:00.000Z", 0, now), true);
  assert.equal(isOlderThan("2026-09-23T00:00:01.000Z", 0, now), false);
  assert.equal(isOlderThan(null, 0, now), false);
  assert.equal(isOlderThan("nope", 0, now), false);
  assert.equal(isOlderThan("2026-09-22T23:00:00.000Z", 3_600_000, now), true);
  assert.equal(isOlderThan("2026-09-22T23:30:00.000Z", 3_600_000, now), false);
});

test("pathEqualsOrInside matches a directory and its children only", () => {
  assert.equal(pathEqualsOrInside("/tmp/proj", "/tmp/proj"), true);
  assert.equal(pathEqualsOrInside("/tmp/proj/", "/tmp/proj"), true);
  assert.equal(pathEqualsOrInside("/tmp/proj", "/tmp/proj/pkg"), true);
  assert.equal(pathEqualsOrInside("/tmp/proj", "/tmp/proj-other"), false);
  assert.equal(pathEqualsOrInside("/tmp/proj", "/tmp"), false);
  assert.equal(pathEqualsOrInside("/tmp/proj", null), false);
  assert.equal(pathEqualsOrInside(".", process.cwd()), true);
});

test("isPidAlive does not signal pid 0 or negative process groups", () => {
  assert.equal(isPidAlive(process.pid), true);
  assert.equal(isPidAlive(0), false);
  assert.equal(isPidAlive(-1), false);
  assert.equal(isPidAlive(deadPid()), false);
});

test("present flags a dead supervisor without inventing an exit", () => {
  const running = fakeJob();
  const before = JSON.stringify(running);
  const live = present(running);
  assert.equal("orphan" in live, false);
  assert.equal(live.status, "running");
  assert.equal(live.exit_code, null);
  assert.equal(JSON.stringify(running), before);

  const orphan = present(fakeJob({ supervisor_pid: deadPid() }));
  assert.equal(orphan.status, "running");
  assert.equal(orphan.exit_code, null);
  assert.equal("orphan" in orphan && orphan.orphan, true);

  const exited = present(
    fakeJob({
      status: "exited",
      exit_code: 3,
      ended_at: "2026-09-23T00:00:02.000Z",
      supervisor_pid: deadPid(),
    }),
  );
  assert.equal("orphan" in exited, false);
  assert.equal(exited.status, "exited");
  assert.equal(exited.exit_code, 3);
});

test("jobsDir follows XDG_DATA_HOME and otherwise ~/.local/share", () => {
  const previous = process.env.XDG_DATA_HOME;
  try {
    process.env.XDG_DATA_HOME = "/tmp/runtag-xdg";
    assert.equal(jobsDir(), path.resolve("/tmp/runtag-xdg/runtag/jobs"));
    process.env.XDG_DATA_HOME = "   ";
    assert.equal(jobsDir(), path.resolve(os.homedir(), ".local", "share", "runtag", "jobs"));
    delete process.env.XDG_DATA_HOME;
    assert.equal(jobsDir(), path.resolve(os.homedir(), ".local", "share", "runtag", "jobs"));
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
  }
});
