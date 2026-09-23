---
name: runtag
description: Record one child process under XDG and later read whether it is running or exited, plus its numeric exit code. Use when starting a command an agent must observe. Do not use it as a queue, a pass/fail runner, or a log collector.
---

# runtag

runtag wraps one command and writes pid and exit outside the repository. It does not decide pass or fail. It does not watch a directory. [spacequery](https://github.com/meganemura/spacequery) reads the job file and watches.

## When to use

- Start a command in a repo and come back later for `running` or `exited` and `exit_code`.
- Keep job files out of the tree under test.

## When not to use

- You need a queue, retries, groups, or priorities.
- You need stdout from a detached command. v0 discards it. Use foreground instead.
- You need something to block until exit. That is `spacequery watch`, not this binary.

## Flow

1. `runtag exec --detach --cwd <repo> -- npm test`
   Read stdout JSON. Keep `id`.
2. `spacequery watch runs-in-dir --root <repo> --until status=exited`
   spacequery reads the job file and watches. Not implemented here. Same root rule as `runtag list --root`. An orphan stays `running` and does not satisfy `status=exited`.
3. `runtag status <id>`
   Read `exit_code`. Interpret the number yourself. `0` is not a pass label.

## Commands

```
runtag exec [--cwd DIR] [--label NAME] [--detach] -- <cmd>...
runtag status <id>
runtag list [--root DIR] [--status running|exited]
runtag gc [--older-than DURATION]
runtag --help
```

There is no shell. Put the argv after `--`, including arguments that start with `-`.

| Command | stdout | exit |
| --- | --- | --- |
| `exec` foreground | the child's stdout | the child's code |
| `exec --detach` | job JSON once the supervisor has the job | `0` after the job is recorded |
| `status` | one job object | `0` |
| `list` | JSON array, newest `started_at` first | `0` |
| `gc` | `{ "deleted": ["<id>", ...] }` | `0` |
| `--help` | plain text | `0` |

`--cwd` defaults to the current directory and is stored absolute. `--label` is stored as a string, or `null` when omitted.

`--root` keeps a job when `repo_root` or `cwd` equals DIR or is a directory inside DIR. `repo/pkg` matches `repo`. `repo-other` does not.

`--status` filters the persisted status: `running` or `exited`.

`gc` deletes exited jobs whose `ended_at` is at least DURATION old. It never deletes `running` jobs, including orphans. Omitting `--older-than` means `0s` (every exited job). Say `7d` unless you mean that. Units are `ms`, `s`, `m`, `h`, `d` (`30s`, `12h`, `7d`).

## State

`$XDG_DATA_HOME/runtag/jobs/<id>.json`

Default when `XDG_DATA_HOME` is unset: `~/.local/share/runtag/jobs/`. Linux and macOS both use that path.

```json
{
  "id": "01JABCDEFGHJKMNPQRSTVWXYZA",
  "pid": 123,
  "supervisor_pid": 120,
  "cwd": "/abs",
  "repo_root": "/abs-or-null",
  "command": ["npm", "test"],
  "label": null,
  "status": "running",
  "exit_code": null,
  "started_at": "2026-09-23T00:00:00.000Z",
  "ended_at": null
}
```

`id` is a ULID. `repo_root` is `git rev-parse --show-toplevel` from `cwd`, or `null` when that fails. `supervisor_pid` is the process that waits. In the foreground that is the `runtag` process. With `--detach` it is a separate process that survives the CLI returning.

A signalled child stores `exit_code` as `128` plus the signal number (shell convention). That number is the signal that was observed, not a guessed result.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | help, status, list, gc, or detach once the job is recorded; also a child that exited 0 |
| `1` | runtag failure. stderr is `{ "error", "do" }` |
| `126` | executable exists but could not be executed (`EACCES`). stderr is the envelope. No job file |
| `127` | executable could not be started (`ENOENT` and other spawn failures). stderr is the envelope. No job file |
| other | foreground child exit code. No envelope |

Detach exits `0` even when the child later exits non-zero. Read `exit_code` from `status`.

## Failures

Actionable failures print this on stderr and do not print a job on stdout:

```json
{
  "error": "unknown job id: 01JABCDEFGHJKMNPQRSTVWXYZA",
  "do": "run `runtag list` and pass an id from that array"
}
```

Do what `do` says. Do not retry a different command until you have followed it.

| Situation | What to do |
| --- | --- |
| unknown id | `runtag list`, then `status` with an id from that array |
| invalid id | pass the 26-character ULID, not a path |
| missing `--` | `runtag exec [--detach] [--cwd DIR] -- <cmd> [args...]` |
| bad `--status` | `running` or `exited` only |
| bad duration | `500ms`, `30s`, `15m`, `12h`, or `7d` |
| cwd missing | create the directory or fix `--cwd` |
| failed to start | fix the executable name, `PATH`, or permissions |

## Orphans

If the job file says `running` but `supervisor_pid` is not alive, `status` and `list` still return:

- `status`: `"running"`
- `exit_code`: `null`
- `orphan`: `true`

They do not rewrite the file and do not invent an exit code. `gc` will not delete that file. Stop waiting for `status=exited`. The exit code is unknown because the supervisor was killed before it could record one.

A live supervisor is not an orphan. An exited job is not an orphan, even if its supervisor has since quit.

## Detach

`--detach` prints the job and returns while the supervisor waits. A fast child may already show `status: "exited"` in that JSON; otherwise it says `running` and you call `status` after it finishes. Detached stdout and stderr are discarded.
