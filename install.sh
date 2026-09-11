#!/usr/bin/env bash
# ==============================================================================
# TRAFO 360 v2 - Automated installer for a fresh Ubuntu 24.04 LTS server
# (aaPanel-fronted variant - this server is meant to sit behind aaPanel for
#  its web-facing layer: reverse proxy, SSL, the site itself. This script
#  does NOT install or configure Nginx/SSL itself - see step 7 below.)
# ==============================================================================
# Run as root, from inside the extracted application directory (the folder
# containing package.json, apps/, prisma/, etc - e.g. after uploading and
# unzipping trafo360-v2.zip on the server):
#
#   sudo ./install.sh
#
# What it does, in order:
#   1. Installs Node.js 20 LTS, PostgreSQL, PM2, jq, and every shared library
#      Puppeteer's bundled Chromium needs to actually launch (WhatsApp Web
#      won't work without these - a fresh Ubuntu server is missing all of
#      them by default)
#   2. Creates a dedicated non-root system user to run the app (never root)
#   3. Copies the app to /opt/trafo360-v2 (skipped if already running from there)
#   4. Creates a Postgres database + role with a generated password,
#      confirms password auth (scram-sha-256) is actually enforced - not
#      left on a permissive default
#   5. Generates .env with fresh secrets and a generated admin password
#   6. npm install, builds every workspace, runs migrations + seed
#   7. Does NOT touch Nginx/SSL/firewall ports 80/443 - that's aaPanel's job.
#      This script only opens SSH + aaPanel's own panel port so you can
#      reach aaPanel itself. Once aaPanel is installed (this script detects
#      whether it already is, and tells you how to install it if not), you
#      add a Website + Reverse Proxy pointing at this app through aaPanel's
#      own UI - the exact values to type in are printed at the end.
#   8. Starts api + worker under PM2, configured to survive a reboot
#      (systemd unit registered for the app user, not root)
#   9. Runs a smoke test (health check, build artifacts present, PM2 status)
#  10. Prints a final summary: aaPanel setup values (Run Directory, Reverse
#      Proxy target, Rewrite rule), and admin login - save that output, the
#      generated passwords are shown ONCE
#
# Safe to re-run - each step checks existing state before acting, so a
# failed run can just be retried with `sudo ./install.sh` again.
# ==============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
APP_DIR="/opt/trafo360-v2"
APP_USER="trafo360"
DATA_DIR="/var/lib/trafo360"
DB_NAME="trafo360"
DB_USER="trafo360"
API_PORT=4000
AAPANEL_DEFAULT_PORT=8888

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
log()  { echo "${GREEN}==>${RESET} $*"; }
warn() { echo "${YELLOW}==> WARNING:${RESET} $*"; }
fail() { echo "${RED}==> ERROR:${RESET} $*" >&2; exit 1; }

trap 'echo "${RED}Installation failed at line $LINENO. Fix the issue above and re-run: sudo ./install.sh${RESET}" >&2' ERR

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
if [[ $EUID -ne 0 ]]; then
  fail "Run this as root: sudo ./install.sh"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ ! -f "$SCRIPT_DIR/package.json" ]] || ! grep -q '"name": "trafo360-v2"' "$SCRIPT_DIR/package.json" 2>/dev/null; then
  fail "Run this from inside the extracted trafo360-v2 application directory (couldn't find its package.json here)."
fi

if [[ -z "${DOMAIN:-}" ]]; then
  read -rp "Domain this app will eventually be served from via aaPanel (e.g. trafo360.example.com): " DOMAIN
fi
[[ -n "$DOMAIN" ]] || fail "A domain is required."

log "Installing for domain: $BOLD$DOMAIN$RESET (web-facing setup happens in aaPanel afterward - see the final summary)"

# Generated secrets - shown once at the end, nowhere else.
#
# Reused from an existing .env on re-run, not regenerated - the seed script
# only ever sets the bootstrap admin's password when it first creates that
# user (never on a later upsert, so it doesn't clobber a password the admin
# has since changed from the UI). If this script generated a *new* random
# ADMIN_PASSWORD on every run, a second run would print a password that was
# never actually written to the database - which is exactly what happened
# on the first real re-run against a live server. Same reasoning applies to
# DB_PASSWORD (must keep matching the already-created Postgres role) and the
# JWT/encryption secrets (rotating them on every run would silently log out
# every session and break any data already encrypted with the old key).
EXISTING_ENV="$APP_DIR/.env"
env_value() {
  local key="$1"
  [[ -f "$EXISTING_ENV" ]] || return 0
  sed -nE "s/^${key}=\"?([^\"]*)\"?\$/\1/p" "$EXISTING_ENV" | head -1
}

DB_PASSWORD="$([[ -f "$EXISTING_ENV" ]] && sed -nE 's#^DATABASE_URL="postgresql://[^:]+:([^@]+)@.*#\1#p' "$EXISTING_ENV" | head -1 || true)"
[[ -n "$DB_PASSWORD" ]] || DB_PASSWORD="$(openssl rand -hex 24)"

ADMIN_PASSWORD="$(env_value BOOTSTRAP_ADMIN_PASSWORD)"
[[ -n "$ADMIN_PASSWORD" ]] || ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 20)"

JWT_ACCESS_SECRET="$(env_value JWT_ACCESS_SECRET)"
[[ -n "$JWT_ACCESS_SECRET" ]] || JWT_ACCESS_SECRET="$(openssl rand -hex 32)"

JWT_REFRESH_SECRET="$(env_value JWT_REFRESH_SECRET)"
[[ -n "$JWT_REFRESH_SECRET" ]] || JWT_REFRESH_SECRET="$(openssl rand -hex 32)"

SECRETS_ENCRYPTION_KEY="$(env_value SECRETS_ENCRYPTION_KEY)"
[[ -n "$SECRETS_ENCRYPTION_KEY" ]] || SECRETS_ENCRYPTION_KEY="$(openssl rand -hex 32)"

INTERNAL_WORKER_TOKEN="$(env_value INTERNAL_WORKER_TOKEN)"
[[ -n "$INTERNAL_WORKER_TOKEN" ]] || INTERNAL_WORKER_TOKEN="$(openssl rand -hex 32)"

# ---------------------------------------------------------------------------
# 1. System packages, Node.js, PM2, and Chromium's runtime dependencies
# ---------------------------------------------------------------------------
log "Updating package lists and installing base packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg lsb-release rsync ufw jq \
  postgresql postgresql-contrib \
  tesseract-ocr poppler-utils

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v20* ]]; then
  log "Installing Node.js 20 LTS (NodeSource)..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
NODE_VERSION="$(node -v)"
[[ "$NODE_VERSION" == v20* ]] || fail "Node.js 20.x did not install correctly (got $NODE_VERSION)."
log "Node.js $NODE_VERSION installed at $(command -v node) - on the default system PATH, no version-manager PATH juggling needed."

if ! command -v pm2 >/dev/null 2>&1; then
  log "Installing PM2 globally..."
  npm install -g pm2
fi

# whatsapp-web.js drives Puppeteer's bundled Chromium - a bare Ubuntu server
# has none of the shared libraries a real headless browser needs. Installed
# one at a time with a soft-fail per package: exact package names (and
# whether some are virtual/transitional aliases, e.g. Ubuntu 24.04's
# libasound2 -> libasound2t64 rename) drift between Ubuntu point releases,
# and one renamed font/codec package shouldn't abort the whole install -
# only whatsapp-web.js's ability to launch Chromium depends on this list,
# nothing else in the app does.
log "Installing Chromium's runtime dependencies (needed for WhatsApp Web)..."
CHROMIUM_DEPS=(
  fonts-liberation libasound2t64 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2
  libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc-s1 libglib2.0-0
  libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6
  libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6
  libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 xdg-utils
)
MISSING_DEPS=()
for pkg in "${CHROMIUM_DEPS[@]}"; do
  # Visible per-package progress (not silenced) and a 60s timeout per
  # package, so a single slow mirror or renamed package can't look
  # indistinguishable from the whole script being hung - it either
  # succeeds, fails fast, or gets killed and reported, never silent.
  printf '    %s... ' "$pkg"
  if timeout 60 apt-get install -y "$pkg" >/dev/null 2>&1; then
    echo "ok"
  else
    echo "skipped"
    MISSING_DEPS+=("$pkg")
  fi
done
if [[ ${#MISSING_DEPS[@]} -gt 0 ]]; then
  warn "Could not install: ${MISSING_DEPS[*]} (likely renamed in this Ubuntu point release, or timed out on a slow mirror). If WhatsApp Web's Connect button fails to launch Chromium later, check Administration -> WhatsApp Web's error and install the correctly-named equivalents by hand."
fi

# ---------------------------------------------------------------------------
# 2. Dedicated non-root app user
# ---------------------------------------------------------------------------
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  log "Creating system user '$APP_USER' (no login shell - the app never needs an interactive shell)..."
  useradd --system --create-home --home-dir "/home/$APP_USER" --shell /usr/sbin/nologin "$APP_USER"
fi

# ---------------------------------------------------------------------------
# 3. App source -> /opt/trafo360-v2
# ---------------------------------------------------------------------------
mkdir -p "$APP_DIR"
if [[ "$(realpath "$SCRIPT_DIR")" != "$(realpath "$APP_DIR")" ]]; then
  log "Copying application source to $APP_DIR..."
  rsync -a --delete \
    --exclude node_modules --exclude .git --exclude .devdb \
    --exclude 'storage/local' --exclude 'storage/nfs-mock' --exclude 'storage/whatsapp-session' \
    --exclude '.env' --exclude 'apps/*/dist' --exclude 'libs/*/dist' --exclude '*.tsbuildinfo' \
    "$SCRIPT_DIR"/ "$APP_DIR"/
else
  log "Already running from $APP_DIR."
fi

mkdir -p "$DATA_DIR/local-storage" "$DATA_DIR/whatsapp-session"

# ---------------------------------------------------------------------------
# 4. PostgreSQL - database, role, and *enforced* password auth
# ---------------------------------------------------------------------------
log "Configuring PostgreSQL..."
systemctl enable --now postgresql

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';" >/dev/null
else
  # Re-runs of this script (or a fresh DB_PASSWORD each run) need the role's
  # password to actually match what goes into .env this time.
  sudo -u postgres psql -c "ALTER USER $DB_USER WITH PASSWORD '$DB_PASSWORD';" >/dev/null
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" >/dev/null
fi

# Ubuntu's packaged Postgres already defaults local TCP connections to
# scram-sha-256, not the "trust" free-for-all a bundled/vendored Postgres
# install (e.g. aaPanel's own PostgreSQL plugin) can default to - but verify
# and correct explicitly rather than assuming, since a wrong assumption here
# means an unauthenticated database.
PG_VERSION="$(ls /etc/postgresql/ | sort -V | tail -1)"
PG_HBA="/etc/postgresql/$PG_VERSION/main/pg_hba.conf"
if [[ -f "$PG_HBA" ]] && ! grep -qE '^host\s+all\s+all\s+127\.0\.0\.1/32\s+scram-sha-256' "$PG_HBA"; then
  log "Tightening pg_hba.conf to require scram-sha-256 for local TCP connections..."
  sed -i -E 's/^(host\s+all\s+all\s+127\.0\.0\.1\/32\s+).*/\1scram-sha-256/' "$PG_HBA"
  systemctl reload postgresql
fi

# ---------------------------------------------------------------------------
# 5. .env
# ---------------------------------------------------------------------------
log "Generating .env..."
[[ -f "$APP_DIR/.env" ]] || cp "$APP_DIR/.env.example" "$APP_DIR/.env"

set_env() {
  local key="$1" val="$2" file="$APP_DIR/.env"
  if grep -q "^${key}=" "$file"; then
    sed -i "s#^${key}=.*#${key}=\"${val}\"#" "$file"
  else
    echo "${key}=\"${val}\"" >> "$file"
  fi
}

set_env DATABASE_URL "postgresql://$DB_USER:$DB_PASSWORD@127.0.0.1:5432/$DB_NAME?schema=public"
set_env NODE_ENV "production"
set_env APP_URL "http://$DOMAIN"
set_env API_PORT "$API_PORT"
set_env API_INTERNAL_URL "http://127.0.0.1:$API_PORT"
set_env JWT_ACCESS_SECRET "$JWT_ACCESS_SECRET"
set_env JWT_REFRESH_SECRET "$JWT_REFRESH_SECRET"
set_env SECRETS_ENCRYPTION_KEY "$SECRETS_ENCRYPTION_KEY"
set_env INTERNAL_WORKER_TOKEN "$INTERNAL_WORKER_TOKEN"
set_env BOOTSTRAP_ADMIN_USERNAME "admin"
set_env BOOTSTRAP_ADMIN_EMAIL "admin@$DOMAIN"
set_env BOOTSTRAP_ADMIN_PASSWORD "$ADMIN_PASSWORD"
set_env LOCAL_STORAGE_PATH "$DATA_DIR/local-storage"
set_env WHATSAPP_SESSION_PATH "$DATA_DIR/whatsapp-session"

# Fail loudly now, not three build steps later, if anything required is
# still missing - this exact class of bug (a silently-missing DATABASE_URL)
# is what motivated adding this check.
for key in DATABASE_URL API_PORT API_INTERNAL_URL JWT_ACCESS_SECRET JWT_REFRESH_SECRET \
           SECRETS_ENCRYPTION_KEY INTERNAL_WORKER_TOKEN BOOTSTRAP_ADMIN_USERNAME \
           BOOTSTRAP_ADMIN_PASSWORD LOCAL_STORAGE_PATH WHATSAPP_SESSION_PATH; do
  grep -q "^${key}=" "$APP_DIR/.env" || fail ".env is missing $key after generation - aborting before the build step."
done

chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$DATA_DIR"
chmod 600 "$APP_DIR/.env"

# ---------------------------------------------------------------------------
# 6. Install, build, migrate, seed - all as the app user, never root
# ---------------------------------------------------------------------------
log "Installing dependencies (this takes a few minutes)..."
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npm install"

log "Building all workspaces (libs/shared, api, worker, web)..."
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npm run build"

for artifact in apps/api/dist/main.js apps/worker/dist/main.js apps/web/dist/index.html libs/shared/dist/index.js; do
  [[ -f "$APP_DIR/$artifact" ]] || fail "Build did not produce $artifact - check the build output above."
done

log "Running database migrations..."
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npx prisma generate --schema=prisma/schema.prisma"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npx prisma migrate deploy --schema=prisma/schema.prisma"

log "Seeding default roles, permissions, and workflow template..."
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npx tsx prisma/seed.ts"

# ---------------------------------------------------------------------------
# 7. aaPanel detection (informational only - this script never installs or
#    configures aaPanel itself: its own installer changes version-numbered
#    URLs over time, and getting that wrong would silently break this
#    script months from now. Install it yourself from the official source
#    if it's not already here, then use the values in the final summary.)
# ---------------------------------------------------------------------------
AAPANEL_PRESENT=false
if [[ -d /www/server/panel ]] || command -v bt >/dev/null 2>&1; then
  AAPANEL_PRESENT=true
  log "aaPanel detected at /www/server/panel."
else
  warn "aaPanel not detected on this server. Install it from the official source (aapanel.com's own download page has the current one-line installer for Ubuntu) before doing the Website/Reverse Proxy step in the summary below."
fi

# ---------------------------------------------------------------------------
# 8. PM2 - api + worker, surviving a reboot, running as $APP_USER (never root)
# ---------------------------------------------------------------------------
log "Starting the application under PM2..."
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && pm2 delete trafo360-api trafo360-worker >/dev/null 2>&1 || true"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && pm2 start apps/api/dist/main.js --name trafo360-api"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && pm2 start apps/worker/dist/main.js --name trafo360-worker"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && pm2 save"

log "Configuring PM2 to auto-start on boot..."
# Bare `sudo -u user pm2 ...` (no shell wrapper) has been observed on some
# systems to not pick up the target user's $HOME correctly, spawning a PM2
# daemon under the *invoking* user's home instead - the bash -c wrapper
# used everywhere else in this script doesn't have that problem, so every
# pm2 call here goes through it too, not just the ones that need cd.
# `pm2 startup` run as a non-root user always exits non-zero - it can't
# install the systemd unit itself, so it just prints the root command to
# run and exits 1. That's expected, not a failure; `|| true` keeps
# set -euo pipefail from treating it as one.
STARTUP_CMD="$(sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && pm2 startup systemd -u '$APP_USER' --hp '/home/$APP_USER'" 2>&1 | tail -1 || true)"
[[ "$STARTUP_CMD" == sudo* ]] || fail "Could not determine the PM2 startup command (got: $STARTUP_CMD)"
eval "$STARTUP_CMD" >/dev/null
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && pm2 save"

# ---------------------------------------------------------------------------
# Firewall - SSH always; aaPanel's own port if aaPanel is (or will be)
# managing this box, so you're never locked out of it. Ports 80/443 are
# aaPanel's to open when you create the website - not this script's job.
# ---------------------------------------------------------------------------
log "Configuring firewall (allowing SSH + aaPanel's panel port)..."
ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow "$AAPANEL_DEFAULT_PORT"/tcp >/dev/null 2>&1 || true
ufw --force enable >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# 9. Smoke test
# ---------------------------------------------------------------------------
log "Running smoke tests..."
sleep 5
HEALTH="$(curl -sf "http://127.0.0.1:$API_PORT/api/health" || echo "")"
[[ "$HEALTH" == *'"status":"ok"'* ]] || fail "API health check failed - check: sudo -u $APP_USER bash -c 'cd $APP_DIR && pm2 logs trafo360-api'"
log "API health check: OK ($HEALTH)"

API_ONLINE="$(sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && pm2 jlist" | jq -r '.[] | select(.name=="trafo360-api") | .pm2_env.status')"
WORKER_ONLINE="$(sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && pm2 jlist" | jq -r '.[] | select(.name=="trafo360-worker") | .pm2_env.status')"
[[ "$API_ONLINE" == "online" ]] || fail "trafo360-api is not online (status: $API_ONLINE)"
[[ "$WORKER_ONLINE" == "online" ]] || fail "trafo360-worker is not online (status: $WORKER_ONLINE)"
log "PM2 processes: trafo360-api ($API_ONLINE), trafo360-worker ($WORKER_ONLINE)"

PUBLIC_IP="$(curl -s --max-time 3 https://icanhazip.com || echo "unknown")"

# ---------------------------------------------------------------------------
# 10. Summary
# ---------------------------------------------------------------------------
echo
echo "${BOLD}================================================================${RESET}"
echo "${BOLD} TRAFO 360 v2 - backend installation complete${RESET}"
echo "${BOLD}================================================================${RESET}"
echo " Server public IP:     ${PUBLIC_IP}"
echo " API (internal only):  127.0.0.1:$API_PORT  - not exposed externally, aaPanel's reverse proxy is the only way in"
echo " App directory:        $APP_DIR"
echo " Built SPA:            $APP_DIR/apps/web/dist"
if [[ "$AAPANEL_PRESENT" == true ]]; then
  echo " aaPanel:               already installed - https://${PUBLIC_IP}:${AAPANEL_DEFAULT_PORT}/  (your existing login)"
else
  echo " aaPanel:               ${YELLOW}not installed yet${RESET} - install it from aapanel.com's official download page, then"
  echo "                        continue with the steps below (this port is already open in the firewall: $AAPANEL_DEFAULT_PORT)"
fi
echo
echo "${BOLD}--- Add these in aaPanel: Website -> Add Site -> $DOMAIN -> Settings ---${RESET}"
echo
echo " 1. Run Directory (a.k.a. Site Directory / 运行目录):"
echo "      $APP_DIR/apps/web/dist"
echo "    This is the security-critical one - it scopes what Nginx serves as static"
echo "    files to just the built SPA, keeping .env/node_modules unreachable."
echo
echo " 2. Reverse Proxy tab -> Add Reverse Proxy:"
echo "      Target URL:       http://127.0.0.1:$API_PORT"
echo "      Proxy Directory:  /api"
echo "    Double-check the Target URL uses a COLON before the port (127.0.0.1:$API_PORT),"
echo "    not a slash - a typo here is a real, easy-to-make mistake that silently"
echo "    routes /api requests nowhere useful."
echo
echo " 3. Rewrite tab -> paste this (SPA client-side routing fallback):"
echo "      location / {"
echo "          try_files \$uri \$uri/ /index.html;"
echo "      }"
echo
echo " 4. SSL tab -> Let's Encrypt -> Apply, then toggle Force HTTPS."
echo "    Afterward, update APP_URL in $APP_DIR/.env to https://$DOMAIN and run:"
echo "      sudo -u $APP_USER bash -c 'cd $APP_DIR && pm2 restart trafo360-api'"
echo
echo " 5. Verify once the site is live:"
echo "      curl -I https://$DOMAIN/.env       # must be 404, not 200"
echo "      curl https://$DOMAIN/api/health    # must show status ok"
echo "${BOLD}================================================================${RESET}"
echo
echo " ${BOLD}App admin login${RESET} (once the site above is live)"
echo "   Username:  admin"
echo "   Password:  ${BOLD}${ADMIN_PASSWORD}${RESET}"
echo
echo " ${BOLD}Database${RESET} (for your own reference - the app reads this from .env, you shouldn't need it)"
echo "   postgresql://$DB_USER:${DB_PASSWORD}@127.0.0.1:5432/$DB_NAME"
echo
echo "${BOLD}================================================================${RESET}"
echo " Save this output now - the passwords above are shown only once."
echo " Change the admin password immediately after logging in"
echo " (top-right menu -> Change Password)."
echo "${BOLD}================================================================${RESET}"
