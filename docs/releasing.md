# Releasing

runtag stays on 0.x.0 versions for now. A release is the npm package and a git tag. The package ships compiled JavaScript in `dist/` (the `runtag` bin is `dist/cli.js`), plus `skills/`, `README.md`, `README.ja.md`, `CHANGELOG.md`, `LICENSE`, and `llms.txt`. `dist/` is gitignored. The publish workflow builds it from the tagged commit and publishes that tree. The tarball contains that compiled `dist/` and the files listed above.

`runtag` has never been published. npm requires the package to exist before a Trusted Publisher can be added, and it does not support the first publish via OIDC. `0.1.0` is published once with a short-lived token. After that, pushing a `v*` tag runs [`.github/workflows/publish.yml`](../.github/workflows/publish.yml). The workflow installs the tagged commit, builds `dist/`, runs the release checks, and runs `npm publish`. npm authenticates with GitHub Actions OIDC. Provenance is attached automatically because the repository and the package are public. The GitHub Environment `publish` is the human gate: the job waits there until it is approved.

The workflow calls `npm publish` directly. It does not stop at `npm stage publish`. That workflow is the steady state. It stores no `NPM_TOKEN`, and the repository secrets do not keep one either.

## First release (0.1.0)

These are human steps. Nothing in this repository changes GitHub visibility, creates the Environment, publishes the package, or registers the trusted publisher.

Prepare the release commit first. The `## 0.1.0` changelog section is already written; on the day you tag, set the date in that heading to that day. `package.json` is already `0.1.0`. Run `npm run check && npm test`, then `npm pack --dry-run` and read the file list: `dist/`, `skills/`, `README.md`, `README.ja.md`, `CHANGELOG.md`, `LICENSE`, `llms.txt`, and `package.json`. It should omit `src/`, `test/`, and `docs/`. Commit as `chore: release 0.1.0` and tag `v0.1.0` on that commit. The tag without the leading `v` is the `package.json` version.

Then:

1. Make the GitHub repository `meganemura/runtag` public. Provenance requires a public repository.
2. On that repository, create a GitHub Environment named `publish` and require reviewers. The workflow job sets `environment: publish`, so later runs wait until a reviewer approves them.
3. Bootstrap `runtag@0.1.0` once with a short-lived granular npm token that can only publish. Give it a short expiration. Limit it to publishing `runtag` when the npm form can name a package that does not exist yet; otherwise limit it to the single new-package publish. Use a clean checkout of the release commit:

   ```sh
   npm ci
   npm run build
   npm run check
   npm test
   npm pack --dry-run
   npm publish --provenance --//registry.npmjs.org/:_authToken="$TOKEN"
   ```

   `$TOKEN` lives in that shell only. `--provenance` can sign the tarball because the repository is public. `package.json` `repository.url` stays `https://github.com/meganemura/runtag.git`; npm checks that URL when the trusted publisher is added.

   A one-shot CI run can publish that same commit instead. Give the job the token for that run and `id-token: write` so provenance is signed. That job is not `publish.yml`. When `runtag@0.1.0` is on the registry, delete the token from CI. Do not leave a long-lived `NPM_TOKEN` in repository secrets, and do not add one to `publish.yml`.

4. After `runtag@0.1.0` exists on the registry, add one GitHub Actions trusted publisher on the `runtag` package. The fields are case-sensitive:

   - Organization or user: `meganemura`
   - Repository: `runtag`
   - Workflow filename: `publish.yml` (the filename, including `.yml`)
   - Environment name: `publish`
   - Allowed action: `npm publish`

   A trusted publisher created after 3 September 2026 starts with `npm stage publish` allowed. Select `npm publish` as well. `publish.yml` runs `npm publish`.

5. Revoke or delete the bootstrap token. Optionally require two-factor authentication and disallow token publishing on the package. The trusted publisher keeps working. Every later `v*` tag is published by `publish.yml` with OIDC.

Pushing the `v0.1.0` tag starts `publish.yml`. Cancel that run. Before the package exists, npm has no Trusted Publisher that can accept the workflow's OIDC token. After the bootstrap, `0.1.0` is already on the registry, so that run's `npm publish` would be a second publish of the same version. The tag and the GitHub Release are still the record of `0.1.0`. Extract the notes with `awk '/^## 0.1.0/{f=1;next} /^## /{f=0} f' CHANGELOG.md > notes.md`, then `gh release create v0.1.0 --title v0.1.0 --notes-file notes.md`.

## Later versions

1. Move the notes under `## Unreleased` to a new `## 0.x.0 (YYYY-MM-DD)` heading and leave `## Unreleased` empty. Set the same version in `package.json`.
2. `npm run check && npm test`.
3. `npm pack --dry-run` and read the file list, the same files as the first release.
4. Commit as `chore: release 0.x.0`. Tag `v0.x.0`. The tag without the leading `v` is the `package.json` version; the workflow stops when they differ. Push the commit and the tag. The tag push starts the workflow. This publish is `publish.yml` only.
5. Approve the `publish` environment on that Actions run. The workflow uses Node 24 on `ubuntu-latest` with the npm registry URL set. It runs `npm ci`, `npm run build`, a check that the build did not modify tracked files, `npm run check`, and `npm test`, then `npm publish`. `dist/` is gitignored, so the new build output is expected and is what gets packed. `prepublishOnly` runs `build`, `check`, and `test` again. The package `engines` field stays `>=20`; Node 24 is the publish job, not a new requirement for people running the bin.
6. `--notes-file CHANGELOG.md` would paste every version's notes into the release, so extract the version's section first: `awk '/^## 0.x.0/{f=1;next} /^## /{f=0} f' CHANGELOG.md > notes.md`, then `gh release create v0.x.0 --title v0.x.0 --notes-file notes.md`.
7. On a machine that already has runtag, install the published package (`npm install -g runtag`) or `npm link` the checkout again if the linked tree moved. The skill ships inside the package at `skills/runtag/SKILL.md`. From the public repository, `gh skill install meganemura/runtag runtag` installs that skill for an agent.
