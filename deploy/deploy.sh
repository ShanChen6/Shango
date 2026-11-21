#!/usr/bin/env bash
# Staging deploy per docs/release-checklist.md section B. Never targets production.
#
#   deploy/deploy.sh <git-sha>            # build images for that commit, back up, start, smoke
#   SKIP_BACKUP=1 deploy/deploy.sh <sha>  # first deploy only (nothing to back up yet)
#   ROLLBACK=1 deploy/deploy.sh <old-sha> # reuse existing images of an earlier tag, no build
set -euo pipefail
SHA=${1:?usage: deploy/deploy.sh <git-sha>}
ENV_FILE=${ENV_FILE:-deploy/staging.env}
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE (copy deploy/staging.env.example)"; exit 1; }
REGISTRY=$(grep -E '^REGISTRY=' "$ENV_FILE" | cut -d= -f2-)
REGISTRY=${REGISTRY:-shango}
COMPOSE=(docker compose -f deploy/compose.staging.yaml --env-file "$ENV_FILE")
export IMAGE_TAG=$SHA

if [ "${ROLLBACK:-0}" != 1 ]; then
  [ -z "$(git status --porcelain)" ] || { echo "Working tree not clean; commit or stash first."; exit 1; }
  git rev-parse --verify "$SHA^{commit}" >/dev/null
  [ "$(git rev-parse HEAD)" = "$(git rev-parse "$SHA^{commit}")" ] || { echo "Check out $SHA before deploying it."; exit 1; }
  # Extra flags, e.g. behind a TLS-inspecting proxy: DOCKER_BUILD_FLAGS="--secret id=npm_ca,src=ca.crt"
  # shellcheck disable=SC2086
  docker build ${DOCKER_BUILD_FLAGS:-} -f deploy/api.Dockerfile -t "$REGISTRY/api:$SHA" .
  # shellcheck disable=SC2086
  docker build ${DOCKER_BUILD_FLAGS:-} -f deploy/web.Dockerfile -t "$REGISTRY/web:$SHA" .
else
  docker image inspect "$REGISTRY/api:$SHA" "$REGISTRY/web:$SHA" >/dev/null || { echo "Images for $SHA not found."; exit 1; }
fi

# Validate configuration before touching the running stack.
"${COMPOSE[@]}" config --quiet

if [ "${SKIP_BACKUP:-0}" != 1 ]; then
  ENV_FILE=$ENV_FILE deploy/backup.sh || {
    echo "Backup failed: deploy aborted, running stack untouched. Fix it, or use SKIP_BACKUP=1 only for a first deploy."
    exit 1
  }
fi

"${COMPOSE[@]}" up -d --wait --wait-timeout 180
echo "Stack is up with IMAGE_TAG=$SHA. Running smoke checks…"
ENV_FILE=$ENV_FILE deploy/smoke.sh
echo "Record in the release log: date, $SHA, operator. Rollback: ROLLBACK=1 deploy/deploy.sh <previous-sha>"
