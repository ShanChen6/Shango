#!/usr/bin/env bash
# Consistent-enough staging backup: PostgreSQL custom dump + private driver documents.
# DB and files are captured back to back; documents referenced by the dump are kept because
# superseded files are never deleted (see docs/driver-documents.md). Run from the repo root.
set -euo pipefail
umask 077
COMPOSE=(docker compose -f deploy/compose.staging.yaml --env-file "${ENV_FILE:-deploy/staging.env}")
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT=${BACKUP_DIR:-deploy/backups}/$STAMP
mkdir -p "$OUT"
chmod 700 "$OUT"
"${COMPOSE[@]}" exec -T postgres pg_dump -U shango -d shango -Fc > "$OUT/shango.dump"
"${COMPOSE[@]}" exec -T api tar -C /data -czf - private-documents > "$OUT/private-documents.tgz"
( cd "$OUT" && sha256sum shango.dump private-documents.tgz > SHA256SUMS )
echo "Backup written to $OUT (contains personal data: store encrypted, restrict access)."
