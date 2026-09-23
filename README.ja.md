# runtag

runtag は、エージェント向けの最小 CLI です。子プロセスを 1 つ包み、pid と終了コードを XDG 配下に記録します。作業中のリポジトリの中には書きません。

成功か失敗かは決めません。ジョブは `running` か `exited` だけです。終了していれば `exit_code` はプロセスが返した数値です。

## エージェントの手順

1. コマンドを起動し、`id` を残す。

   ```sh
   runtag exec --detach --cwd <repo> -- npm test
   ```

2. その作業が running を抜けるまで待つ。監視は [spacequery](https://github.com/meganemura/spacequery) が行い、このバイナリには入っていません。

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

npm に公開されたあとは、次で入ります。

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

skill は [`skills/runtag/SKILL.md`](skills/runtag/SKILL.md) にあり、パッケージにも入ります（`node_modules/runtag/skills/runtag/SKILL.md`）。GitHub リポジトリが公開されたあとは、リポジトリからエージェントに渡せます。

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

runtag は記録するだけです。[spacequery](https://github.com/meganemura/spacequery) がジョブファイルを読み、待つことができます。

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

`v*` タグでパッケージを公開します。一度きりの準備（リポジトリの公開、GitHub Environment `publish`、npm の trusted publisher）と、バージョンごとの手順は [docs/releasing.md](docs/releasing.md) にあります。手順の本文は英語です。
