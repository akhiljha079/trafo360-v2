#!/usr/bin/env bash
# Backs up the Postgres database and the local-fallback/WhatsApp-session
# storage directories to a single timestamped archive. Meant to be run from
# cron on the host (or inside the api container via `docker compose exec`) -
# not exposed through the app itself (spec's own file list treats backup as
# "scripts + doc, not an API surface": giving the web UI a button that can
# trigger a full DB dump is a bigger attack-surface/ops-risk tradeoff than
# it's worth for what's fundamentally a sysadmin task).
#
# Usage: ./scripts/backup.sh [backup_dir]
#   backup_dir defaults to ./backups
#
# Requires: pg_dump (matching the server's major version), DATABASE_URL (or
# the individual PG* vars) in the environment - `set -a; source .env; set +a`
# before running this if you keep them in .env.
set -euo pipefail

BACKUP_DIR="${1:-./backups}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set - source your .env first (set -a; source .env; set +a)" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

echo "==> Dumping database..."
pg_dump --format=custom --file="$WORK_DIR/database.dump" "$DATABASE_URL"

echo "==> Archiving local-fallback storage and WhatsApp session..."
# Both are optional - a fresh install or an all-NFS deployment may have
# nothing under storage/local, and WhatsApp may never have been paired.
tar -czf "$WORK_DIR/storage.tar.gz" -C "$(dirname "${LOCAL_STORAGE_PATH:-./storage/local}")" \
  "$(basename "${LOCAL_STORAGE_PATH:-./storage/local}")" 2>/dev/null || echo "    (no local storage to archive)"
tar -czf "$WORK_DIR/whatsapp-session.tar.gz" -C "$(dirname "${WHATSAPP_SESSION_PATH:-./storage/whatsapp-session}")" \
  "$(basename "${WHATSAPP_SESSION_PATH:-./storage/whatsapp-session}")" 2>/dev/null || echo "    (no WhatsApp session to archive)"

ARCHIVE="$BACKUP_DIR/trafo360-backup-$TIMESTAMP.tar.gz"
tar -czf "$ARCHIVE" -C "$WORK_DIR" .
echo "==> Backup written to $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
echo
echo "NOT backed up by this script (deliberately, see docs/backup-recovery.md):"
echo "  - NFS-stored documents/physical-file scans - back those up at the NFS layer, not here"
echo "  - SECRETS_ENCRYPTION_KEY / JWT secrets / INTERNAL_WORKER_TOKEN - keep these in your secrets"
echo "    manager, not in a backup archive that might end up somewhere less controlled"
