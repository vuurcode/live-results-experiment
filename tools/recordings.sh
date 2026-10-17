#!/bin/sh
# Reads the recordings API of a running backend (see docs/backend-configuration.md, "Recordings").
#
#   RECORDINGS_URL=https://<host> RECORDINGS_API_KEY=<key> tools/recordings.sh            list the recordings
#   RECORDINGS_URL=https://<host> RECORDINGS_API_KEY=<key> tools/recordings.sh get <id> [file]   download one (default <id>.tar.gz)
set -eu

# Values missing from the environment come from agents.local.md at the project root (gitignored).
settings="$(dirname "$0")/../agents.local.md"
for name in RECORDINGS_URL RECORDINGS_API_KEY; do
  eval "current=\${$name:-}"
  if [ -z "$current" ] && [ -f "$settings" ]; then
    value="$(sed -n "s/^$name=//p" "$settings" | head -n 1)"
    [ -n "$value" ] && export "$name=$value"
  fi
done

: "${RECORDINGS_URL:?set RECORDINGS_URL to the base URL of the app, e.g. https://example.com}"
: "${RECORDINGS_API_KEY:?set RECORDINGS_API_KEY to the backend recordings API key}"

base="${RECORDINGS_URL%/}/api/recordings"
auth="Authorization: Bearer ${RECORDINGS_API_KEY}"

case "${1:-list}" in
  list)
    curl -fsS -H "$auth" "$base" | { if command -v jq >/dev/null 2>&1; then jq .; else cat; echo; fi }
    ;;
  get)
    id="${2:?usage: recordings.sh get <id> [file]}"
    curl -fsS -H "$auth" -o "${3:-$id.tar.gz}" "$base/$id"
    ;;
  *)
    echo "usage: recordings.sh [list | get <id> [file]]" >&2
    exit 2
    ;;
esac
