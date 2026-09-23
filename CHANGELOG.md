# Changelog

The format follows Keep a Changelog, and the versions follow SemVer. Before 1.0 a minor version may change the commands or the job file; the entry says what changed.

## Unreleased

## 0.1.0 (2026-09-23)

runtag records one child process for a coding agent. The record is a JSON file under XDG (`$XDG_DATA_HOME/runtag/jobs/`, or `~/.local/share/runtag/jobs/` when that variable is unset). Nothing is written into the repository the command runs in.

A job is only `running` or `exited`. `exit_code` is the number the process returned, and it stays null while the job is running. runtag does not turn that number into a pass or fail label. If the child dies from a signal, `exit_code` is `128` plus the signal number.

When the file still says `running` but the supervisor process is gone, `status` and `list` leave the job `running`, leave `exit_code` null, and add `orphan: true`. They do not invent an exit code, and they do not rewrite the file. `gc` does not delete that job.

The CLI is `exec`, `status`, `list`, and `gc`. `exec` does not use a shell. Foreground `exec` inherits the child's stdio and exits with the child's code. `exec --detach` prints the job JSON and returns while a per-job supervisor waits and writes `exit_code`. `list` prints jobs newest first, and `--root` keeps jobs whose `repo_root` or `cwd` is that directory or inside it. `gc` deletes exited jobs older than a duration.

Waiting until the work has left the running set is [spacequery](https://github.com/meganemura/spacequery), not this binary: `spacequery watch runs-in-dir --root <repo> --until status=exited`. The directory rule matches `runtag list --root`. An orphan does not satisfy `status=exited`.

Property tests use Hegel.
