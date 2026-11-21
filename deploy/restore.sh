#!/usr/bin/env bash
# Restore a backup made by deploy/backup.sh into a STOPPED-traffic staging stack.
# Usage: deploy/restore.sh deploy/backups/<stamp>   (asks for confirmation; destructive)
set -euo pipefail
DIR=${1:?usage: deploy/restore.sh <backup-dir>}
COMPOSE=(docker compose -f deploy/compose.staging.yaml --env-file "${ENV_FILE:-deploy/staging.env}")
( cd "$DIR" && sha256sum -c SHA256SUMS )
read -r -p "This REPLACES the staging database and private documents. Type 'restore' to continue: " answer
[ "$answer" = "restore" ] || { echo "Aborted."; exit 1; }
"${COMPOSE[@]}" stop api web
"${COMPOSE[@]}" exec -T postgres pg_restore -U shango -d shango --clean --if-exists --no-owner < "$DIR/shango.dump"
"${COMPOSE[@]}" run --rm --no-deps --entrypoint sh api -c \
  'rm -rf /data/private-documents/* && tar -C /data -xzf -' < "$DIR/private-documents.tgz"
"${COMPOSE[@]}" up -d api web
echo "Restored from $DIR. Check /api/v1/health/ready and run the smoke checklist."
