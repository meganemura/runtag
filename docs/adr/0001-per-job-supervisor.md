# ADR 0001: Per-job supervisor, XDG state, and an observe-only status

## Status

Accepted

## Context

Agents need to start a command in a repository and later read whether it is still running and which exit code it produced. A machine-wide daemon (a pueue-style queue) implies a long-lived service, groups, and priorities. That is a different product. Writing pid files into the working tree puts job state in `git status` and in the directory under test.

The exit code has to survive `runtag exec --detach`, which returns before the child finishes. Something other than the returning CLI process has to `wait` and write the result.

spacequery will later grow `runs-in-dir` and `watch --until`. Those are queries over this record. They are not part of runtag.

## Decision

1. **Per-job supervisor, not a machine daemon.** Each `exec` has one supervisor whose only job is to spawn that command, wait, and write `status`, `exit_code`, and `ended_at`. In the foreground the CLI process is the supervisor: it inherits the child's stdio and exits with the child's code. With `--detach`, the CLI starts a separate supervisor in its own session, prints the job JSON, and exits 0. The supervisor stays until the child exits. There is no daemon to install, ping, or restart.

2. **State lives under XDG, never in the target repo.** Job files are `$XDG_DATA_HOME/runtag/jobs/<id>.json`. When `XDG_DATA_HOME` is unset, the directory is `~/.local/share/runtag/jobs` on both Linux and macOS. macOS Application Support is intentionally not used. The id is a ULID. `repo_root` is a best-effort `git rev-parse --show-toplevel` and may be null.

3. **Status vocabulary is only `running` and `exited`.** runtag does not store pass or fail. `exit_code` is the number the child returned. If the child dies from a signal, `exit_code` is `128` plus the signal number, the shell convention for a signal that was actually observed. `list --root` selects jobs whose `repo_root` or `cwd` equals the directory or sits inside it. `gc` deletes exited jobs only.

4. **Orphan rule.** If a file still says `running` and `supervisor_pid` is not a live process, `status` and `list` leave `status` as `running`, leave `exit_code` null, and add `orphan: true` on output. They do not rewrite the file. A missing supervisor is not evidence of any particular exit code. `gc` does not reap orphans.

5. **spacequery owns watching.** The planned command is `spacequery watch runs-in-dir --root <repo> --until status=exited`. It should use the same root rule as `runtag list --root` and read these XDG files (or invoke `runtag list`). runtag does not block, poll, or implement that subcommand. A watcher that only waits for `status=exited` will not finish for an orphan; `orphan: true` means the exit code is unknown.

## Consequences

- `--detach` keeps `exit_code` only while that job's supervisor survives. `SIGKILL` on the supervisor is the orphan case.
- Detached children do not inherit the caller's terminal. v0 discards their stdout and stderr. Foreground is how you see output.
- Agents must not look in the target working tree for job state.
- `runtag gc` with no `--older-than` deletes every exited job (`0s`). Running records stay.
- PID-liveness is `kill(pid, 0)`. PID reuse can hide an orphan; v0 does not record process start times to close that gap.
