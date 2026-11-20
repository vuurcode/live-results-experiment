#!/usr/bin/env bash
# Runs the production nginx config (config/nginx.conf.template, filled in the way prod/.../prepare.sh does) in front of the built
# frontend (npm run build) and a stub for the DTS service, and checks what the config promises: the login on /dts-admin/ and
# /dts-api/admin/, the secret nginx adds, the old addresses, the file rules and the upload size. Needs nginx and envsubst.
# Writes the generated files to /etc/nginx like the container does, so run it in the dev container (or CI), not on a workstation.
set -euo pipefail

cd "$(dirname "$0")/.."
work="$(mktemp -d "${NGINX_CHECK_DIR:-/app/.agents}/nginx-check.XXXXXX")"
PORT=18090
STUB=15099
PASS='correct-horse'
SECRET='admin-secret-value'
pids=()
fails=0
cleanup() {
  [ -f "$work/nginx.pid" ] && kill "$(cat "$work/nginx.pid")" 2>/dev/null || true
  for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done
  rm -rf "$work"
}
trap cleanup EXIT
chmod 755 "$work" # the workers run as another user

for d in dashboard dts dts-admin; do
  [ -d "dist/$d/browser" ] || { echo "dist/$d/browser is missing: run npm run build" >&2; exit 2; }
done

# the html root as the image lays it out
mkdir -p "$work/html" "$work/conf.d" "$work/logs"
cp -r dist/dashboard/browser/. "$work/html/"
mkdir -p "$work/html/dts" "$work/html/dts-admin"
cp -r dist/dts/browser/. "$work/html/dts/"
cp -r dist/dts-admin/browser/. "$work/html/dts-admin/"

render() { # $1 = password ('' for none)
  export FRONTEND_LISTEN_PORT=$PORT FRONTEND_BACKEND_UPSTREAM=127.0.0.1:5000 FRONTEND_CLIENT_IP_VAR='$remote_addr'
  export FRONTEND_CSP_CONNECT_SRC="'self'" FRONTEND_CSP_FRAME_ANCESTORS="'none'"
  envsubst '${FRONTEND_LISTEN_PORT} ${FRONTEND_BACKEND_UPSTREAM} ${FRONTEND_CLIENT_IP_VAR}' < config/nginx.conf.template \
    | sed -e "s#root /usr/share/nginx/html;#root $work/html;#" -e "s#127.0.0.1:5002#127.0.0.1:$STUB#" > "$work/conf.d/default.conf"
  envsubst '${FRONTEND_CSP_CONNECT_SRC} ${FRONTEND_CSP_FRAME_ANCESTORS}' < config/security-headers.conf > /etc/nginx/security-headers.conf
  if [ -n "$1" ]; then
    printf 'admin:{PLAIN}%s\n' "$1" > /etc/nginx/dts-admin.htpasswd
    chmod 644 /etc/nginx/dts-admin.htpasswd
    printf 'auth_basic "DTS admin";\nauth_basic_user_file /etc/nginx/dts-admin.htpasswd;\n' > /etc/nginx/dts-admin-auth.conf
  else
    printf 'deny all;\n' > /etc/nginx/dts-admin-auth.conf
  fi
  printf 'proxy_set_header Authorization "Bearer %s";\n' "$SECRET" > /etc/nginx/dts-admin-secret.conf
  cat > "$work/nginx.conf" <<EOF
pid $work/nginx.pid;
error_log $work/logs/error.log;
events {}
http {
  include /etc/nginx/mime.types;
  access_log off;
  client_body_temp_path $work/tmp/body;
  proxy_temp_path $work/tmp/proxy;
  fastcgi_temp_path $work/tmp/fcgi;
  uwsgi_temp_path $work/tmp/uwsgi;
  scgi_temp_path $work/tmp/scgi;
  include $work/conf.d/default.conf;
}
EOF
  mkdir -p "$work/tmp"
}

started=0
start() {
  if [ $started = 1 ]; then nginx -p "$work" -c "$work/nginx.conf" -s reload; else nginx -p "$work" -c "$work/nginx.conf"; started=1; fi
  sleep 1
}

# a stub for the DTS service: answers 200 and says what it was asked and with which Authorization header
cat > "$work/stub.py" <<'EOF'
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
class H(BaseHTTPRequestHandler):
    def handle_any(self):
        n = int(self.headers.get('Content-Length') or 0)
        self.rfile.read(n)
        body = f"{self.command} {self.path} auth={self.headers.get('Authorization', '')}".encode()
        self.send_response(200)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    do_GET = do_POST = do_PUT = do_DELETE = handle_any
    def log_message(self, *a): pass
ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
EOF
python3 -I "$work/stub.py" $STUB &
pids+=($!)

render "$PASS"
nginx -t -p "$work" -c "$work/nginx.conf" 2>&1 | sed 's/^/nginx: /'
start

base="http://127.0.0.1:$PORT"
auth=(-u "admin:$PASS")

# check NAME EXPECTED_STATUS [EXPECTED_BODY_OR_HEADER_REGEX] -- curl args
check() {
  local name=$1 want=$2 pattern=$3
  shift 4
  local out status
  out="$(curl -s -i -m 10 -H 'Expect:' "$@" || true)"
  status="$(awk 'NR==1 {print $2}' <<<"$out")"
  if [ "$status" != "$want" ] || { [ -n "$pattern" ] && ! grep -qiE -- "$pattern" <<<"$out"; }; then
    echo "FAIL $name: wanted $want ${pattern:+matching /$pattern/}, got ${status:-nothing}"
    sed -n '1,12p;s/^/    /' <<<"$out" | cut -c1-200
    fails=$((fails + 1))
  else
    echo "ok   $name"
  fi
}

admin_js="$(cd "$work/html/dts-admin" && ls | grep -E -- '-[A-Z0-9]{8}\.js$' | head -1)"
sign_js="$(cd "$work/html/dts" && ls | grep -E -- '-[A-Z0-9]{8}\.js$' | head -1)"

check "admin path gets a trailing slash"            302 'location: /dts-admin/' -- "$base/dts-admin"
check "admin page asks for the login"               401 'www-authenticate' -- "$base/dts-admin/"
check "admin page with a wrong password"            401 '' -- -u "admin:wrong" "$base/dts-admin/"
check "admin page with the password"                200 'app-dts-admin-root' -- "${auth[@]}" "$base/dts-admin/"
check "admin page is not cached"                    200 'cache-control: no-cache' -- "${auth[@]}" "$base/dts-admin/list?s=abc"
check "admin spa route falls back to the page"      200 'app-dts-admin-root' -- "${auth[@]}" "$base/dts-admin/list?s=abc"
check "admin bundle needs the login"                401 '' -- "$base/dts-admin/$admin_js"
check "admin bundle is cached for good"             200 'immutable' -- "${auth[@]}" "$base/dts-admin/$admin_js"
check "missing admin file is a 404"                 404 '' -- "${auth[@]}" "$base/dts-admin/chunk-NOPE12345.js"
check "missing admin file needs the login first"    401 '' -- "$base/dts-admin/missing.js"
check "admin worker script is served without the login" 200 'cache-control: no-cache' -- "$base/dts-admin-sw.js"
check "sign app is open"                            200 'app-dts-root|<app-' -- "$base/dts/"
check "sign bundle is open and cached for good"     200 'immutable' -- "$base/dts/$sign_js"
check "sign route falls back to the sign app"       200 '<app-' -- "$base/dts/sign"
check "old list address moves to management"        302 'location: /dts-admin/list\?s=abc' -- "$base/dts/list?s=abc"
check "old manage address moves to management"      302 'location: /dts-admin/list\?s=abc' -- "$base/dts/manage?s=abc"
check "admin api needs the login"                   401 '' -- -X POST "$base/dts-api/admin/sessions"
check "admin api gets the secret"                   200 "auth=Bearer $SECRET" -- "${auth[@]}" -X POST "$base/dts-api/admin/sessions"
check "admin api refuses a bearer sent by the client" 401 '' -- -H 'Authorization: Bearer from-browser' -X POST "$base/dts-api/admin/sessions"
check "public api is open, with no secret added"    200 'auth=$' -- "$base/dts-api/sessions/abc"

head -c $((3 * 1024 * 1024)) /dev/zero > "$work/3m"
head -c $((7 * 1024 * 1024)) /dev/zero > "$work/7m"
check "admin upload of 3 MB passes"                 200 '' -- "${auth[@]}" -X POST --data-binary "@$work/3m" "$base/dts-api/admin/sessions"
check "admin upload of 7 MB is refused"             413 '' -- "${auth[@]}" -X POST --data-binary "@$work/7m" "$base/dts-api/admin/sessions"
check "public upload of 7 MB is refused"            413 '' -- -X POST --data-binary "@$work/7m" "$base/dts-api/sessions/abc/operations"

# without a password nobody gets in
render ''
start
check "no password: admin page is denied"           403 '' -- "$base/dts-admin/"
check "no password: admin api is denied"            403 '' -- -X POST "$base/dts-api/admin/sessions"
check "no password: the sign app stays open"        200 '<app-' -- "$base/dts/"

# the password locations allow a steady 30 a minute and a burst of 60 per client address
render "$PASS"
nginx -p "$work" -c "$work/nginx.conf" -s stop; sleep 1; started=0; start
limited=0
for _ in $(seq 1 90); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "${auth[@]}" "$base/dts-admin/")" = 429 ] && limited=1
done
if [ $limited = 1 ]; then echo "ok   admin pages are rate limited"; else echo "FAIL admin pages are rate limited"; fails=$((fails + 1)); fi

if [ $fails -gt 0 ]; then echo "$fails check(s) failed; nginx error log:"; tail -n 15 "$work/logs/error.log"; exit 1; fi
echo "all nginx checks passed"
