---
name: download-recordings
description: Download the recordings of the production backend into the mockserver archive and remove them from the server. Use when asked to check prod for new recordings, to fetch or download recordings or matches that were not downloaded yet, or to clean up the recordings on the server.
---

# Download the prod recordings

The backend records live competitions (see `docs/backend-configuration.md`, "Recordings") and serves them through
a bearer-protected API. They are kept in `src/mockserver/data/archive.d/recordings/` so the mockserver can replay them.

## Run

```bash
.claude/skills/download-recordings/scripts/download.sh          # list only, changes nothing
.claude/skills/download-recordings/scripts/download.sh --fetch  # download, verify, then delete on the server
```

The script reads the host from `RECORDINGS_URL` and the key from `RECORDINGS_API_KEY` in `agents.local.md` (gitignored), or
the key from `.agents/recordings-api-key`. It never prints the key.

## Rules it follows

- Only recordings in state `complete` are taken; one still `recording` is left alone by the script. When the list has any recording that is not complete, ask the user what to do with it (wait, download it anyway as a partial copy, or leave it) before finishing, and do nothing to it without the answer.
- Each download goes to a scratch folder in `.agents/`, is checked with `gzip -t`, and is compared with the local copy
  when one exists. A server recording is deleted only after the local copy is byte-identical to the download. A different
  local copy with the same name is never overwritten and the server one is kept.
- The API allows 20 requests a minute; the script stays well under.

## Afterwards

- Report what was downloaded, skipped and deleted. Show times (the `modified` field is UTC) in Europe/Amsterdam.
- Recordings hold anonymised data only, but never put names of real skaters, officials or clubs in commits or messages.
- The new archives are untracked files: stage them by explicit path, and only when asked to commit.
