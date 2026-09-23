# runtag

[![npm version](https://img.shields.io/npm/v/runtag)](https://www.npmjs.com/package/runtag)

runtag is a minimal agent-experience CLI. It wraps one child process and records the pid and exit code under XDG, outside the repository you are working in.

It does not decide pass or fail. A job is `running` or `exited`. When it has exited, `exit_code` is the number the process returned.

## Agent flow

1. Start the command and keep the id:

   ```sh
   runtag exec --detach --cwd <repo> -- npm test
   ```

2. Wait until that work has left the running set. runtag writes the job file. [spacequery](https://github.com/meganemura/spacequery) reads and watches it; this binary does not:

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

[runtag](https://www.npmjs.com/package/runtag) is published on npm:

```sh
npm i -g runtag
npx runtag --help
```

From a checkout of this repository:

```sh
npm install
node dist/cli.js --help
```

`npm install` in a checkout builds `dist/cli.js`. `npm link` puts `runtag` on `PATH`.

The skill at [`skills/runtag/SKILL.md`](skills/runtag/SKILL.md) ships in the package (`node_modules/runtag/skills/runtag/SKILL.md`). An agent can install it from the public repository:

```sh
gh skill install meganemura/runtag runtag --scope user --agent claude-code
```

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

runtag writes the job files. [spacequery](https://github.com/meganemura/spacequery) ([npm](https://www.npmjs.com/package/spacequery)) reads and watches them:

```sh
spacequery watch runs-in-dir --root <repo> --until status=exited
```

A job is in `<repo>` when `repo_root` or `cwd` equals that directory or is inside it, the same rule as `runtag list --root`. An orphan stays `running` with `orphan: true` and a null `exit_code`, so that watch does not finish on it. This repository does not implement spacequery, and spacequery does not run runtag.

## Non-goals

No daemon, queue, groups, or priorities. No pass/fail state. No job files in the working tree. No captured logs for detached processes in v0.

## Development

```sh
npm test
npm run check
```

`npm run check` is the typecheck the publish workflow runs.

Agent-facing docs: [`llms.txt`](llms.txt) and [`skills/runtag/SKILL.md`](skills/runtag/SKILL.md).

## Releasing

Later `v*` tags publish through GitHub Actions OIDC. The first release is a one-time short-lived publish token, then a Trusted Publisher; the repository does not keep an `NPM_TOKEN`. Steps are in [docs/releasing.md](docs/releasing.md).

---

## Japanese

# runtag

runtag は、エージェント向けの最小 CLI です。子プロセスを 1 つ包み、pid と終了コードを XDG 配下に記録します。作業中のリポジトリの中には書きません。

成功か失敗かは決めません。ジョブは `running` か `exited` だけです。終了していれば `exit_code` はプロセスが返した数値です。

## エージェントの手順

1. コマンドを起動し、`id` を残す。

   ```sh
   runtag exec --detach --cwd <repo> -- npm test
   ```

2. その作業が running を抜けるまで待つ。runtag はジョブファイルを書きます。[spacequery](https://github.com/meganemura/spacequery) がそれを読み、監視します。このバイナリは監視しません。

   ```sh
   spacequery watch runs-in-dir --root <repo> --until status=exited
   ```

3. 終了コードを読む。

   ```sh
   runtag status <id>
   ```

`exit_code` は数値です。runtag はそれを pass / fail とは呼びません。

## インストール

Node.js 20 以降が必要です。

[runtag](https://www.npmjs.com/package/runtag) は npm に公開されています。

```sh
npm i -g runtag
npx runtag --help
```

このリポジトリの checkout から使うときは次のとおりです。

```sh
npm install
node dist/cli.js --help
```

checkout で `npm install` すると `dist/cli.js` をビルドします。`PATH` に置くなら `npm link` です。

skill は [`skills/runtag/SKILL.md`](skills/runtag/SKILL.md) にあり、パッケージにも入ります（`node_modules/runtag/skills/runtag/SKILL.md`）。公開リポジトリからエージェントに渡せます。

```sh
gh skill install meganemura/runtag runtag --scope user --agent claude-code
```

## 状態

ジョブは JSON ファイルです。

```text
$XDG_DATA_HOME/runtag/jobs/<id>.json
```

`XDG_DATA_HOME` が未設定のときは `~/.local/share/runtag/jobs/` です。Linux でも macOS でもこの XDG のパスを使います。テスト対象の作業ツリーには何も書きません。

`<id>` は ULID です。`repo_root` は、そのジョブの `cwd` で実行した `git rev-parse --show-toplevel` です。失敗したときは `null` です。

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

`supervisor_pid` は子プロセスを wait するプロセスです。理由は [ADR 0001](docs/adr/0001-per-job-supervisor.md) にあります。

## コマンド

```text
runtag exec [--cwd DIR] [--label NAME] [--detach] -- <cmd>...
runtag status <id>
runtag list [--root DIR] [--status running|exited]
runtag gc [--older-than DURATION]
runtag --help
```

`exec` はシェルを通しません。コマンドとその引数は `--` の後ろに置きます。

フォアグラウンドの `exec` は子の stdio を引き継ぎ、プロセスの終了コードも子と同じです。ジョブファイルは更新されます。`--detach` はジョブ JSON（`id`、`pid`、`status` と残りの項目）を出して 0 で終了します。ジョブごとのスーパーバイザが待ち続け、`exit_code` を書きます。デタッチした子の標準出力と標準エラーは捨てます。出力が要るときはフォアグラウンドで実行します。

`list` は JSON 配列を、`started_at` が新しい順に出します。`--root` は、`repo_root` または `cwd` が DIR と等しいか、その中にあるジョブだけを残します。`--status` は `running` か `exited` です。

`gc` は、`ended_at` から DURATION 以上たっている exited ジョブだけを消します。running は残します。DURATION を省くと `0s` で、exited をすべて消します。単位は `ms`、`s`、`m`、`h`、`d` です（`7d`、`12h`、`30s`）。

`status`、`list`、`gc`、`exec --detach` は標準出力に JSON を出します。`--help` はテキストです。

## 終了コード

| コード | 意味 |
| --- | --- |
| 0 | ヘルプ、問い合わせの成功、ジョブ記録後の detach、または 0 で終わったフォアグラウンドの子 |
| 1 | runtag が依頼を実行できなかった。標準エラーは `{"error","do"}` |
| 126 | 実行ファイルを実行できなかった |
| 127 | 実行ファイルを起動できなかった |
| その他 | フォアグラウンドの子の終了コード。失敗エンベロープは出さない |

子がシグナルで死んだとき、`exit_code` は `128` にシグナル番号を足した値です。

対処できる失敗は、標準エラーに次の形で出ます。

```json
{
  "error": "unknown job id: 01JABCDEFGHJKMNPQRSTVWXYZA",
  "do": "run `runtag list` and pass an id from that array"
}
```

`do` に従います。子プロセスが 1 で終了したことは、このエンベロープではありません。子の終了コードです。

## オーファン

ジョブファイルが `running` なのにスーパーバイザが居ないとき、`status` と `list` は終了コードを作りません。`status` は `running` のまま、`exit_code` は `null` のまま、`orphan: true` を付けて返します。ディスク上のファイルは書き換えません。`gc` も消しません。`status=exited` だけを待つウォッチャは終わりません。`orphan: true` は「終了コードは不明」です。

## spacequery との境界

runtag はジョブファイルを書きます。[spacequery](https://github.com/meganemura/spacequery)（[npm](https://www.npmjs.com/package/spacequery)）がそれを読み、監視します。

```sh
spacequery watch runs-in-dir --root <repo> --until status=exited
```

`<repo>` に含まれるのは、`repo_root` または `cwd` がそのディレクトリと等しいか、その中にあるジョブです。`runtag list --root` と同じ規則です。オーファンは `running` のまま、`orphan: true`、`exit_code` は null なので、この watch はそのジョブでは終わりません。このリポジトリは spacequery を実装しません。spacequery は runtag を実行しません。

## やらないこと

デーモン、キュー、グループ、優先度はありません。pass / fail の状態はありません。作業ツリーにジョブファイルは置きません。v0 ではデタッチしたプロセスのログも残しません。

## 開発

```sh
npm test
npm run check
```

`npm run check` は、公開ワークフローが走らせる型チェックです。

エージェント向けの説明は [`llms.txt`](llms.txt) と [`skills/runtag/SKILL.md`](skills/runtag/SKILL.md) です。

## リリース

パッケージが npm に載ってからは、`v*` タグを GitHub Actions の OIDC で公開します。最初の 1 回だけ有効期限の短い公開トークンを使い、そのあと Trusted Publisher を設定します。長期間の `NPM_TOKEN` は置きません。手順は [docs/releasing.md](docs/releasing.md) にあります。手順の本文は英語です。
