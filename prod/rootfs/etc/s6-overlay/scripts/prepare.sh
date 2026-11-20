#!/command/with-contenv sh
# Fills the nginx templates from the container environment and refuses to start on a broken config.
set -eu

# The client address comes from the header BACKEND_CLIENT_IP_HEADER names (the hosting is shared with the live results);
# without one it is the connection's address. nginx reads a header as $http_<lowercase name with underscores>.
if [ -n "${BACKEND_CLIENT_IP_HEADER:-}" ]; then
    FRONTEND_CLIENT_IP_VAR="\$http_$(printf '%s' "$BACKEND_CLIENT_IP_HEADER" | tr 'A-Z-' 'a-z_')"
else
    FRONTEND_CLIENT_IP_VAR='$remote_addr'
fi
export FRONTEND_CLIENT_IP_VAR
envsubst '${FRONTEND_LISTEN_PORT} ${FRONTEND_BACKEND_UPSTREAM} ${FRONTEND_CLIENT_IP_VAR}' < /etc/nginx/default.conf.template > /etc/nginx/conf.d/default.conf
envsubst '${FRONTEND_CSP_CONNECT_SRC} ${FRONTEND_CSP_FRAME_ANCESTORS}' < /etc/nginx/security-headers.conf.template > /etc/nginx/security-headers.conf
envsubst '${FRONTEND_BACKEND_URL}' < /etc/nginx/env-inject.js.template > /usr/share/nginx/html/env-inject.js
# The DTS passwords guard personal data and are only rate limited, not locked out: a short one is refused at start.
for name in DTS_ADMIN_PASSWORD DTS_ADMIN_SECRET; do
    eval "value=\${$name:-}"
    if [ -n "$value" ] && [ "${#value}" -lt 8 ]; then
        echo "$name must be at least 8 characters" >&2
        exit 1
    fi
done
# The DTS admin, manage and list pages and the admin API share one login: basic auth (user DTS_ADMIN_USERNAME, default admin) and the secret nginx adds to the API calls.
# Without a password nobody gets in; without a secret the service has the admin API off.
if [ -n "${DTS_ADMIN_PASSWORD:-}" ]; then
    printf '%s:{PLAIN}%s\n' "${DTS_ADMIN_USERNAME:-admin}" "$DTS_ADMIN_PASSWORD" > /etc/nginx/dts-admin.htpasswd
    chown nginx /etc/nginx/dts-admin.htpasswd
    chmod 600 /etc/nginx/dts-admin.htpasswd
    printf 'auth_basic "DTS admin";\nauth_basic_user_file /etc/nginx/dts-admin.htpasswd;\n' > /etc/nginx/dts-admin-auth.conf
else
    printf 'deny all;\n' > /etc/nginx/dts-admin-auth.conf
fi
if [ -n "${DTS_ADMIN_SECRET:-}" ]; then
    escaped=$(printf '%s' "$DTS_ADMIN_SECRET" | sed 's/[\\"$]/\\&/g')
    printf 'proxy_set_header Authorization "Bearer %s";\n' "$escaped" > /etc/nginx/dts-admin-secret.conf
else
    printf 'proxy_set_header Authorization "";\n' > /etc/nginx/dts-admin-secret.conf
fi
chmod 600 /etc/nginx/dts-admin-secret.conf
nginx -t

# the backend runs as nobody and writes its recordings here
if [ -n "${BACKEND_RECORDINGS_DIR:-}" ]; then
    mkdir -p "$BACKEND_RECORDINGS_DIR"
    chown nobody "$BACKEND_RECORDINGS_DIR"
fi

# the sign-in service runs as nobody and keeps its sessions here
if [ -n "${DTS_DATA_DIR:-}" ]; then
    mkdir -p "$DTS_DATA_DIR"
    chown nobody "$DTS_DATA_DIR"
fi
