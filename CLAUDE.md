# Commit messages

- One short subject line per commit (imperative, under ~70 characters). No body, no bullet lists.
- No Co-Authored-By or "Generated with" attribution lines in commits or PR descriptions.
- Don't name protected paths (container-data, mockserver data, .env) in message text; the deny rules in `.claude/settings.json` match command text and will block the commit.
- Pushes to main publish the image but only deploy when the newest commit's subject contains `[deploy]` (or the workflow is run by hand). Add it only when the user asks for a deploy.
- A deploy restarts the server and interrupts a live recording. Before pushing or adding `[deploy]`, check `GET https://live-results-experiment.vuurcode.dev/api/competitions/today` (public, no key) for entries with `"live": true`, and the recordings list (see the download-recordings skill) for a recording that is not `complete`. While any is live or recording, don't suggest a push or a deploy commit and don't make one; say what is live and offer to do it once it has finished. The user's explicit instruction to deploy anyway overrides this.
- Never mention the model name or version (e.g. in README, docs, commits or PRs).

# Testing and committing

- While working, run only the tests that cover the change (a single e2e spec, a filtered run, the relevant unit tests). Lint and tsc are fine to run.
- Never commit files you did not touch or expect: stage explicit paths (never `git add -A` or `.`), check `git diff --cached --stat` before every commit, and leave stray or user-added files (screenshots, scratch files) unstaged. Verify an unstage actually worked instead of silencing its errors.
- Don't commit after each task. Commit only when asked, and make all the separate commits in one go.
- Run e2e specs in batches (a few spec files per run), not as one long run over the whole suite.
- Don't run the full suite when committing. It runs in CI, and manually only when the user asks for it; if you think a full run is warranted, ask first.

# CI

- CI only runs checks, linters and builds, never measurements. Performance, Lighthouse and soak runs happen locally, on demand.

# Subagents

- Never spawn subagents (too expensive). Do the work inline, also for reviews and `/simplify`-style passes.

# Where directives go

- Generic development directives (workflow, testing, commits, conventions) belong in this file, not in personal memory. Use memory only for things specific to the user or session context.

# Code comments

- Comments describe what the code is and why it is that way, never the change that produced it. Don't write what was added, removed, renamed or fixed, what it used to do, or what an earlier version did ("no longer", "now", "instead of the old ...", "as before"); that belongs in the commit history. When editing code, also drop comments of that kind that you find.

# Personal data

- Never commit or mention personal data (PII) in committed files, data, commit messages or PR descriptions: no real names of skaters, officials or clubs, no contact details, no payment data. Sample and test data is anonymized.
