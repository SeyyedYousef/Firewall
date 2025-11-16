#!/usr/bin/env bash

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL environment variable is required." >&2
  exit 1
fi

STAMP="$(date -u +"%Y%m%d-%H%M%S")"
TARGET_DIR="${1:-backups}"
mkdir -p "$TARGET_DIR"

OUTPUT_PATH="${TARGET_DIR}/tgfirewall-${STAMP}.sql"

echo "Creating database backup at ${OUTPUT_PATH}"
pg_dump --no-owner --file="$OUTPUT_PATH" "$DATABASE_URL"
echo "Backup complete."
