# runtag

runtag is a minimal agent-experience CLI. It wraps one child process and records the pid and exit code under XDG, outside the repository you are working in.

It does not decide pass or fail. A job is `running` or `exited`. When it has exited, `exit_code` is the number the process returned.

## Agent flow

1. Start the command and keep the id:

   ```sh
   runtag exec --detach --cwd <repo> -- npm test
   ```

2. Wait until that work has left the running set. This command is planned in spacequery and is not part of this binary:

   ```sh
   spacequery watch runs-in-dir --root <repo> --until status=exited
   ```

3. Read the code:

   ```sh
   runtag status <id>
   ```

`exit_code` is a number. runtag does not label it pass or fail.

## Install

Requires Node.js 20 or newer.

```sh
npm install
node dist/cli.js --help
```

`npm install` builds `dist/cli.js`. You can also run `npx runtag` from this checkout, or `npm link` if you want `runtag` on `PATH`.

## State

Jobs are JSON files:

```text
$XDG_DATA_HOME/runtag/jobs/<id>.json
```

When `XDG_DATA_HOME` is unset, that is `~/.local/share/runtag/jobs/`. Linux and macOS both use this XDG path. Nothing is written into the working tree under test.

`<id>` is a ULID. `repo_root` is `git rev-parse --show-toplevel` from the job's `cwd`, or `null` if that fails.

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

`supervisor_pid` is the process that waits on the child. See [ADR 0001](docs/adr/0001-per-job-supervisor.md).

## Commands

```text
runtag exec [--cwd DIR] [--label NAME] [--detach] -- <cmd>...
runtag status <id>
runtag list [--root DIR] [--status running|exited]
runtag gc [--older-than DURATION]
runtag --help
```

`exec` does not use a shell. Put the command and its arguments after `--`.

Foreground `exec` inherits the child's stdio and exits with the child's code. The job file is still updated. `--detach` prints the job JSON (`id`, `pid`, `status`, and the rest of the record) and exits 0. A per-job supervisor keeps waiting and writes `exit_code`. Detached stdout and stderr are discarded; use foreground when you need the output.

`list` prints a JSON array, newest `started_at` first. `--root` keeps jobs whose `repo_root` or `cwd` equals DIR or is inside DIR. `--status` is `running` or `exited`.

`gc` deletes exited jobs whose `ended_at` is at least DURATION ago. Running jobs are kept. The default duration is `0s`, which deletes every exited job. Duration units are `ms`, `s`, `m`, `h`, and `d` (`7d`, `12h`, `30s`).

`status`, `list`, `gc`, and `exec --detach` print JSON on stdout. `--help` is plain text.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | help, a successful query, detach after the job is recorded, or a foreground child that exited 0 |
| 1 | runtag could not do what you asked. stderr is `{"error","do"}` |
| 126 | the executable could not be executed |
| 127 | the executable could not be started |
| other | the foreground child's exit code, with no failure envelope |

If the child dies from a signal, `exit_code` is `128` plus the signal number.

Actionable failures look like this on stderr:

```json
{
  "error": "unknown job id: 01JABCDEFGHJKMNPQRSTVWXYZA",
  "do": "run `runtag list` and pass an id from that array"
}
```

Follow `do`. A child that exits 1 is not this envelope; it is the child's code.

## Orphans

If a job file says `running` but the supervisor process is gone, `status` and `list` do not invent an exit code. They return the record with `status` still `running`, `exit_code` still `null`, and `orphan: true`. The file on disk is not rewritten. `gc` will not delete it. A watcher waiting only for `status=exited` will not finish; treat `orphan: true` as "exit code unknown".

## Boundary with spacequery

runtag only records. spacequery is expected to watch:

```sh
spacequery watch runs-in-dir --root <repo> --until status=exited
```

A job is in `<repo>` when `repo_root` or `cwd` equals that directory or is inside it, the same rule as `runtag list --root`. This repository does not implement spacequery.

## Non-goals

No daemon, queue, groups, or priorities. No pass/fail state. No job files in the working tree. No captured logs for detached processes in v0.

## Development

```sh
npm test
npm run typecheck
```

Agent-facing docs: [`llms.txt`](llms.txt) and [`skills/runtag/SKILL.md`](skills/runtag/SKILL.md).
