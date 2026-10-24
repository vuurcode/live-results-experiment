---
name: update-dependencies
description: Update all the dependencies of the project: the frontend npm packages, the Go modules of the backend and the mockserver, the base images in the Containerfiles, the pinned GitHub Actions and tool versions in CI. Use when asked to update, upgrade or refresh dependencies, to clear npm audit or Dependabot findings, or to bump Node, Go, Playwright or the linters.
---

# Update the dependencies

Dependabot proposes major versions only (see `.github/dependabot.yml`), so minor and patch updates are this skill's job,
and so are the majors when the user asks for them. Work inline (no subagents), one ecosystem at a time, and run the checks
of that ecosystem before going to the next. Report what changed in the end: package, old version, new version.

Dependabot waits 7 days after a release (`cooldown` in its config); do the same: hold back a version published less than a week ago and say so.

## 1. Frontend (`src/frontend`)

```bash
cd src/frontend
npm outdated                       # what is behind, and what the ranges allow
npm update                         # within the ranges of package.json
npm audit --audit-level=high       # what CI runs
```

- Majors: change the range in `package.json` and `npm install`. Take the Angular packages (`@angular/*`, `@angular/build`,
  `@angular/cli`, `typescript`) together: Angular's compiler pins its TypeScript range.
- `package.json` carries an `overrides` entry for `vite`, because `@angular/build` pins an exact vite version. After an
  update, check `npm view @angular/build dependencies.vite`; drop the override when the pinned version is no longer
  affected by an advisory, and raise it when `npm audit` names a newer fixed version.
- Checks: `npm run lint`, `npm run typecheck`, `npx ng build`, and the unit tests that cover what the update touches
  (`npx ng test --watch=false --include='<spec>'`). The e2e specs run only when the user asks, then in batches of a few
  files; the full suite never runs from here (CI does that).
- Playwright: its version is also pinned in the root `Containerfile` (`PLAYWRIGHT_VERSION`); keep the two equal.

## 2. Go modules (`src/backend/src` and `src/mockserver`)

```bash
cd src/backend/src   # then again in src/mockserver
go list -m -u all                  # what has a newer version
go get -u ./... && go mod tidy
go mod verify
```

- Checks in each module: `gofmt -l .` prints nothing, `go vet ./...`, `go test -race ./...`.
- `go.mod` states the Go version (`go 1.27`); CI reads it with `go-version-file`. Raise it only together with the images
  below.

## 3. Container images

- `Containerfile` (dev image): `NODE_VERSION`, `GO_VERSION`, `PYTHON_VERSION`, `PLAYWRIGHT_VERSION`.
- `prod/Containerfile` and `src/mockserver/Containerfile`: base images, the Go ones pinned by `@sha256` digest. Look up the
  new tag's digest (`docker buildx imagetools inspect <image>:<tag>` or the registry) and replace tag and digest together.
- Keep Go equal in the dev image, both prod stages and the mockserver image. Node: Angular supports only the even-numbered
  (long-term support) releases, so never move to an odd one (Dependabot ignores them too); the CI job's `node-version` must
  stay compatible with what the Containerfiles use.
- Check what can be checked without Docker: `hadolint` on the changed files when it is installed.

## 4. GitHub Actions and CI tools (`.github/workflows`)

- Actions are pinned by commit SHA with the version in a trailing comment (`uses: owner/repo@<sha> # v1.2.3`). Update both
  together, taking the SHA of the release tag, never of a branch. Find the latest with `gh release list -R owner/repo` and
  `gh api repos/owner/repo/git/ref/tags/<tag>`; resolve annotated tags to their commit.
- Tool versions given as inputs, such as the `golangci-lint` `version:` in both Go jobs, move together and with the Go version.
- Check with `actionlint` when it is installed.

## Finishing

- Review `git diff --stat` for files nobody expected (a lockfile that grew by thousands of lines deserves a look).
- Commit only when asked: separate commits per ecosystem, explicit paths, one short subject. A deploy commit only on request.
- Say what was not updated and why (held back for a major, a pinned override, no network).
