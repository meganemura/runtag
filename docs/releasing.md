# Releasing

runtag stays on 0.x.0 versions for now. A release is the npm package and a git tag. The package ships compiled JavaScript in `dist/` (the `runtag` bin is `dist/cli.js`), plus `skills/`, `README.md`, `README.ja.md`, `CHANGELOG.md`, `LICENSE`, and `llms.txt`. `dist/` is gitignored. The publish workflow builds it from the tagged commit and publishes that tree. It does not publish the TypeScript source.

Pushing a `v*` tag runs [`.github/workflows/publish.yml`](../.github/workflows/publish.yml). The workflow installs the tagged commit, builds `dist/`, runs the release checks, and runs `npm publish`. npm authenticates with GitHub Actions OIDC. Provenance is attached automatically because the repository and the package are public. The GitHub Environment `publish` is the human gate: the job waits there until it is approved.

The workflow calls `npm publish` directly. It does not stop at `npm stage publish`.

This repository stores no `NPM_TOKEN`.

## One-time setup

Do these once, before the first tag. They are human steps. This repository's automation does not change GitHub visibility, create the Environment, or register the trusted publisher.

1. Make the GitHub repository `meganemura/runtag` public. Trusted publishing and provenance expect a public repository and a public package.
2. On that repository, create a GitHub Environment named `publish` and require reviewers. The workflow job sets `environment: publish`, so the run waits until a reviewer approves it.
3. On npmjs.com, for the `runtag` package, add one GitHub Actions trusted publisher. The fields are case-sensitive:

- Organization or user: `meganemura`
- Repository: `runtag`
- Workflow filename: `publish.yml` (the filename, including `.yml`)
- Environment name: `publish`
- Allowed action: `npm publish`

A trusted publisher created after 3 September 2026 starts with `npm stage publish` allowed. Select `npm publish` as well. This workflow runs `npm publish`.

`package.json` `repository.url` points at `https://github.com/meganemura/runtag.git`. npm checks that URL against the workflow repository.

After the first publish from Actions succeeds, the package settings can require two-factor authentication and disallow token publishing. The trusted publisher keeps working.

## Each version

1. For 0.1.0, the changelog section is already written. On the day you tag, set the date in the `## 0.1.0` heading to that day. For a later version, move the notes under `## Unreleased` to a new `## 0.x.0 (YYYY-MM-DD)` heading and leave `## Unreleased` empty. Set the same version in `package.json`. The release-prep change leaves the version at `0.1.0` and does not create the tag.
2. `npm run check && npm test`.
3. `npm pack --dry-run` and read the file list. It should contain `dist/` (the compiled bin and the rest of the build), `skills/`, `README.md`, `README.ja.md`, `CHANGELOG.md`, `LICENSE`, `llms.txt`, and `package.json`. It should not contain `src/`, `test/`, or `docs/`.
4. Commit as `chore: release 0.x.0`. Tag `v0.x.0`. The tag without the leading `v` is the `package.json` version; the workflow stops when they differ. Push the commit and the tag. The tag push starts the workflow. Do not run `npm publish` from a laptop, and do not create an `NPM_TOKEN`.
5. Approve the `publish` environment on that Actions run. The workflow uses Node 24 on `ubuntu-latest` with the npm registry URL set. It runs `npm ci`, `npm run build`, a check that the build did not modify tracked files, `npm run check`, and `npm test`, then `npm publish`. `dist/` is gitignored, so the new build output is expected and is what gets packed. `prepublishOnly` runs `build`, `check`, and `test` again. The package `engines` field stays `>=20`; Node 24 is the publish job, not a new requirement for people running the bin.
6. `--notes-file CHANGELOG.md` would paste every version's notes into the release, so extract the version's section first: `awk '/^## 0.x.0/{f=1;next} /^## /{f=0} f' CHANGELOG.md > notes.md`, then `gh release create v0.x.0 --title v0.x.0 --notes-file notes.md`.
7. On a machine that already has runtag, install the published package (`npm install -g runtag`) or `npm link` the checkout again if the linked tree moved. The skill ships inside the package at `skills/runtag/SKILL.md`. From the public repository, `gh skill install meganemura/runtag runtag` installs that skill for an agent.
