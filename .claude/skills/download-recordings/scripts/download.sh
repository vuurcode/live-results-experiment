#!/usr/bin/env bash
# Lists the recordings of the prod backend; with --fetch downloads the complete ones and deletes them on the server.
set -euo pipefail
cd "$(dirname "$0")/../../../.."

dest=src/mockserver/data/archive.d/recordings
scratch=.agents/recordings-download
fetch=0
[ "${1:-}" = "--fetch" ] && fetch=1

url=$(sed -n 's/^RECORDINGS_URL=//p' agents.local.md 2>/dev/null | head -1)
[ -n "$url" ] || { echo "RECORDINGS_URL missing in agents.local.md" >&2; exit 1; }

# the key is only handed to curl, never printed
key_header() {
  if [ -f .agents/recordings-api-key ]; then printf 'Authorization: Bearer %s' "$(cat .agents/recordings-api-key)"
  else printf 'Authorization: Bearer %s' "$(sed -n 's/^RECORDINGS_API_KEY=//p' agents.local.md | head -1)"; fi
}
api() { curl -sS --fail-with-body -H "$(key_header)" "$@"; }

list=$(api "$url/api/recordings")
python3 -I - "$list" <<'P'
import json, sys, datetime, zoneinfo
rows = json.loads(sys.argv[1])
if not rows:
    print("no recordings on the server")
for r in rows:
    t = datetime.datetime.fromisoformat(r["modified"].replace("Z", "+00:00")).astimezone(zoneinfo.ZoneInfo("Europe/Amsterdam"))
    print(f'{r["id"]}  {r["state"]}  {r["bytes"]} bytes  modified {t:%Y-%m-%d %H:%M %Z}')
P
[ "$fetch" = 1 ] || exit 0

mkdir -p "$dest" "$scratch"
python3 -I -c 'import json,sys; [print(r["id"]) for r in json.loads(sys.argv[1]) if r["state"]=="complete"]' "$list" | while read -r id; do
  tmp="$scratch/$id.tar.gz"; target="$dest/$id.tar.gz"
  api -o "$tmp" "$url/api/recordings/$id"
  gzip -t "$tmp" || { echo "$id: download is not a valid archive, kept on the server"; continue; }
  if [ -f "$target" ] && ! cmp -s "$tmp" "$target"; then
    echo "$id: a different local copy exists, kept on the server"; continue
  fi
  [ -f "$target" ] || cp "$tmp" "$target"
  cmp -s "$tmp" "$target" || { echo "$id: local copy differs from the download, kept on the server"; continue; }
  api -X DELETE -o /dev/null "$url/api/recordings/$id"
  rm -f "$tmp"
  echo "$id: downloaded and deleted on the server"
  sleep 1
done
