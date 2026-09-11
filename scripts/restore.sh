#!/usr/bin/env bash
# Restores a backup produced by scripts/backup.sh. DESTRUCTIVE: drops and
# recreates the target database's schema before restoring - only run this
# against a database you intend to overwrite.
#
# Usage: ./scripts/restore.sh <backup_archive.tar.gz>
set -euo pipefail

ARCHIVE="${1:?Usage: $0 <backup_archive.tar.gz>}"
if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set - source your .env first (set -a; source .env; set +a)" >&2
  exit 1
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "==> Extracting $ARCHIVE..."
tar -xzf "$ARCHIVE" -C "$WORK_DIR"

read -r -p "This will DROP and recreate the public schema on the database in DATABASE_URL. Type 'yes' to continue: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 1
fi

echo "==> Restoring database..."
psql "$DATABASE_URL" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
pg_restore --format=custom --dbname="$DATABASE_URL" "$WORK_DIR/database.dump"

if [ -f "$WORK_DIR/storage.tar.gz" ]; then
  echo "==> Restoring local-fallback storage to ${LOCAL_STORAGE_PATH:-./storage/local}..."
  mkdir -p "$(dirname "${LOCAL_STORAGE_PATH:-./storage/local}")"
  tar -xzf "$WORK_DIR/storage.tar.gz" -C "$(dirname "${LOCAL_STORAGE_PATH:-./storage/local}")"
fi
if [ -f "$WORK_DIR/whatsapp-session.tar.gz" ]; then
  echo "==> Restoring WhatsApp session to ${WHATSAPP_SESSION_PATH:-./storage/whatsapp-session}..."
  mkdir -p "$(dirname "${WHATSAPP_SESSION_PATH:-./storage/whatsapp-session}")"
  tar -xzf "$WORK_DIR/whatsapp-session.tar.gz" -C "$(dirname "${WHATSAPP_SESSION_PATH:-./storage/whatsapp-session}")"
fi

echo "==> Running migrations to catch the schema up to the current codebase, in case the backup predates it..."
npx prisma migrate deploy --schema=prisma/schema.prisma

echo "==> Restore complete. Remember to also restore NFS-stored documents separately (see docs/backup-recovery.md)."
