# Releasing

runtag stays on 0.x.0 versions for now. A release is the npm package, plus the git tag and the GitHub release the workflow creates after npm publish. The package ships compiled JavaScript in `dist/` (the `runtag` bin is `dist/cli.js`), plus `skills/`, `README.md`, `README.ja.md`, `CHANGELOG.md`, `LICENSE`, and `llms.txt`. `dist/` is gitignored. The publish workflow builds it from the commit that landed on `main` and publishes that tree. The tarball contains that compiled `dist/` and the files listed above.

`runtag@0.1.0` is on npm. That version was published once with a short-lived token. npm requires the package to exist before a Trusted Publisher can be added, and it does not support the first publish via OIDC. Trusted Publisher is the steady state after that.

A push to `main` that changes `package.json` runs [`.github/workflows/publish.yml`](../.github/workflows/publish.yml). Its `check` job reads the `package.json` version and looks for the tag `v<version>`. When that tag already exists, as it does after a dependency bump, the run releases nothing. Otherwise the publish job sets `environment: publish`, so the run waits until a required reviewer approves the GitHub Environment `publish`. npm then authenticates with that environment's OIDC token. The workflow installs the pushed commit, builds `dist/`, runs the release checks, and runs `npm publish`. Provenance is attached automatically because the repository and the package are public. The workflow calls `npm publish` directly. It does not stop at `npm stage publish`. It stores no `NPM_TOKEN`, and the repository secrets do not keep one either.

The `publish` job keeps `contents: read`. After `npm publish` succeeds, a separate `release` job creates the tag `v<version>` and the GitHub release on the published commit. Nobody pushes that tag by hand. That job is the only one with `contents: write`, so the npm OIDC token never sits on a job that can write repository contents. It checks out the commit the publish job checked out, then extracts only that version's section from `CHANGELOG.md`. Both jobs use the same pinned `actions/checkout` commit.

Registering the trusted publisher does not create a pending approval. The approval appears only when a release run enters the Environment `publish`.

As of 23 September 2026 the trusted publisher and the Environment `publish` (required reviewers) are already configured. Recreate either only if it is missing. The release run comes from the `main` branch, not from a tag. If the Environment limits its deployment branches and tags, that list must allow `main`; a list that allows only `v*` tags refuses the run. The owner sets this in the repository settings, under Environments. The trusted publisher fields are case-sensitive:

- Organization or user: `meganemura`
- Repository: `runtag`
- Workflow filename: `publish.yml` (the filename, including `.yml`)
- Environment name: `publish`
- Allowed action: `npm publish`

A trusted publisher created after 3 September 2026 starts with `npm stage publish` allowed. Select `npm publish` as well. `publish.yml` runs `npm publish`.

After an OIDC `npm publish` from `publish.yml` has succeeded, you can require two-factor authentication and disallow token publishing on the package. Revoke any leftover bootstrap token. The trusted publisher keeps working.

The repository has `sha_pinning_required` enabled. `publish.yml` and `ci.yml` pin each action to a full 40-character commit SHA and record the release tag in a comment: `uses: action@<40-hex> # vX.Y.Z`.

## Later versions

1. Move the notes under `## Unreleased` to a new `## 0.x.0 (YYYY-MM-DD)` heading and leave `## Unreleased` empty. Keep that heading shape: the release job extracts the section whose heading starts with `##`, the version, and a space. Set the same version in `package.json` and `package-lock.json`. The workflow creates the tag from that version.
2. `npm run check && npm run archstrict && npm test`.
3. `npm pack --dry-run` and read the file list: `dist/`, `skills/`, `README.md`, `README.ja.md`, `CHANGELOG.md`, `LICENSE`, `llms.txt`, and `package.json`. That list omits `src/`, `test/`, and `docs/`.
4. Commit the version bump and the changelog together as `chore: release 0.x.0`. Land that commit on `main` through the `queue` branch. Its arrival on `main` starts the workflow. Do not push a `v*` tag by hand: the workflow creates it. This publish is `publish.yml` only.
5. Approve the `publish` environment on that Actions run. The approval appears only when the job enters the Environment `publish`. The workflow uses Node 24.22.1 on `ubuntu-latest` with the npm registry URL set. It runs `npm ci`, `npm run build`, a check that the build did not modify tracked files, `npm run check`, `npm run archstrict`, and `npm test`, then `npm publish`. `dist/` is gitignored, so the new build output is expected and is what gets packed. `prepublishOnly` runs `build`, `check`, `archstrict`, and `test` again. `engines.node` is `^22.23.4 || ^24.22.1 || >=26.12.1`. People running the bin follow `engines.node`. The publish job installs Node 24.22.1.
6. After `npm publish` succeeds, the workflow's `release` job creates the tag `v0.x.0` and the GitHub release. It checks out the same commit the publish job checked out. It extracts only that version's section from `CHANGELOG.md` (the whole file would carry every version), runs `gh release create` with `--target` set to the published commit, which creates the tag there, and skips a release that already exists, so re-running the job is safe. If that job fails, re-run it from the Actions page. To create the release by hand instead, extract the section with `awk -v v=0.x.0 '$0 ~ "^## " v " " {in_version=1; next} /^## /{in_version=0} in_version' CHANGELOG.md > notes.md`, then run `gh release create v0.x.0 --title v0.x.0 --notes-file notes.md --target <published commit>`. GitHub creates the tag; nobody pushes it.
7. On a machine that already has runtag, install the published package (`npm install -g runtag`) or `npm link` the checkout again if the linked tree moved. The skill ships inside the package at `skills/runtag/SKILL.md`. From the public repository, `gh skill install meganemura/runtag runtag` installs that skill for an agent.

## First publish of a new package name

`runtag@0.1.0` was published this way on 23 September 2026. On this repository the package, the Environment `publish`, and the trusted publisher already exist. Use the steps below again only for a brand-new package name, or to recreate a missing Environment or trusted publisher. npm requires the package to exist before a Trusted Publisher can be added, and it does not support the first publish via OIDC.

These are human steps. Nothing in this repository changes GitHub visibility, creates the Environment, publishes the package, or registers the trusted publisher.

For `0.1.0`, the release commit was prepared first. The `## 0.1.0` changelog section was already written; on the day of the tag, the date in that heading was set to that day. `package.json` was already `0.1.0`. The checks were `npm run check && npm test`, then `npm pack --dry-run`, reading the file list: `dist/`, `skills/`, `README.md`, `README.ja.md`, `CHANGELOG.md`, `LICENSE`, `llms.txt`, and `package.json`. That list omits `src/`, `test/`, and `docs/`. The commit was `chore: release 0.1.0`, and the tag was `v0.1.0` on that commit. At that time a pushed `v*` tag started the workflow; today the tag comes from the release, as below. A new package name uses the same checks and commit message for its first version.

Then:

1. Make the GitHub repository public. Provenance requires a public repository. `meganemura/runtag` is already public.
2. On that repository, create a GitHub Environment named `publish` and require reviewers. Allow deployments from the `main` branch. The workflow job sets `environment: publish`, so a release run from `main` waits until a reviewer approves it. This repository already has that Environment. Recreate it only if it is missing. Creating the Environment does not open an approval. The approval appears only when a release run enters `publish`.
3. Bootstrap the first version once with a short-lived granular npm token that can only publish. `runtag@0.1.0` was that publish. Give the token a short expiration. Limit it to publishing the new package name when the npm form can name a package that does not exist yet; otherwise limit it to the single new-package publish. Use a clean checkout of the release commit:

   ```sh
   npm ci
   npm run build
   npm run check
   npm run archstrict
   npm test
   npm pack --dry-run
   npm publish --provenance --//registry.npmjs.org/:_authToken="$TOKEN"
   ```

   `$TOKEN` lives in that shell only. `--provenance` can sign the tarball because the repository is public. `package.json` `repository.url` stays `https://github.com/meganemura/runtag.git`; npm checks that URL when the trusted publisher is added.

   A one-shot CI run can publish that same commit instead. Give the job the token for that run and `id-token: write` so provenance is signed. That job is not `publish.yml`. When the version is on the registry, delete the token from CI. Do not leave a long-lived `NPM_TOKEN` in repository secrets, and do not add one to `publish.yml`.

4. After the package exists on the registry, add one GitHub Actions trusted publisher on the package. The fields are case-sensitive. `runtag` already has this publisher; recreate it only if it is missing. A brand-new package name from this repository uses the same fields:

   - Organization or user: `meganemura`
   - Repository: `runtag`
   - Workflow filename: `publish.yml` (the filename, including `.yml`)
   - Environment name: `publish`
   - Allowed action: `npm publish`

   A trusted publisher created after 3 September 2026 starts with `npm stage publish` allowed. Select `npm publish` as well. `publish.yml` runs `npm publish`.

5. Revoke or delete the bootstrap token. Every later version bump that lands on `main` is published by `publish.yml` with OIDC. After that OIDC publish has succeeded, you can require two-factor authentication and disallow token publishing on the package. The trusted publisher keeps working.

Landing the first release commit on `main` starts `publish.yml`, because no `v<version>` tag exists yet. Reject or cancel that run at the `publish` approval when it is the same version the bootstrap just published. Before the package exists, npm has no Trusted Publisher that can accept the workflow's OIDC token. After the bootstrap, that version is already on the registry, so that run's `npm publish` would be a second publish of the same version. Cancelling the run also skips the `release` job, so that version's tag and GitHub release are created by hand. The tag and the GitHub Release are still the record of that version. Extract the notes with `awk -v v=0.1.0 '$0 ~ "^## " v " " {in_version=1; next} /^## /{in_version=0} in_version' CHANGELOG.md > notes.md`, then run `gh release create v0.1.0 --title v0.1.0 --notes-file notes.md --target <release commit>`. GitHub creates the tag on that commit, so the next push to `main` that changes `package.json` finds it and releases nothing.
