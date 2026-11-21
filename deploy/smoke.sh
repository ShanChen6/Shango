#!/usr/bin/env bash
# Automatable part of docs/release-checklist.md section C. Run from a network allowed by
# STAGING_ALLOWED_CIDRS after `deploy/deploy.sh`. Manual checks (OTP logins, a full order between
# two phones, DevTools CSP console) remain in the checklist.
#
#   ENV_FILE=deploy/staging.env deploy/smoke.sh
#   (set INSECURE=1 only for a local stack using Caddy local_certs)
set -euo pipefail
ENV_FILE=${ENV_FILE:-deploy/staging.env}
# Compose env files are not shell syntax (unquoted values with spaces), so read keys explicitly.
envget() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2-; }
CUSTOMER_HOST=$(envget CUSTOMER_HOST)
DRIVER_HOST=$(envget DRIVER_HOST)
ADMIN_HOST=$(envget ADMIN_HOST)
PORT_SUFFIX=$(envget ORIGIN_PORT_SUFFIX)
CURL=(curl -sS --max-time 15)
[ "${INSECURE:-0}" = 1 ] && CURL+=(-k)
COMPOSE=(docker compose -f deploy/compose.staging.yaml --env-file "$ENV_FILE")
failures=0
check() {
  local name=$1 expected=$2 actual=$3
  if [ "$actual" = "$expected" ]; then echo "PASS  $name"; else echo "FAIL  $name (expected $expected, got $actual)"; failures=$((failures + 1)); fi
}
contains() {
  local name=$1 needle=$2 haystack=$3
  if grep -qiF -- "$needle" <<<"$haystack"; then echo "PASS  $name"; else echo "FAIL  $name (missing: $needle)"; failures=$((failures + 1)); fi
}
status() { "${CURL[@]}" -o /dev/null -w '%{http_code}' "$@" || echo 000; }

for host in "$CUSTOMER_HOST" "$DRIVER_HOST" "$ADMIN_HOST"; do
  base="https://${host}${PORT_SUFFIX}"
  check "$host /api/v1/health/ready" 200 "$(status "$base/api/v1/health/ready")"
  check "$host metrics blocked at edge" 404 "$(status "$base/api/v1/health/metrics")"
  check "$host SPA deep link" 200 "$(status "$base/some/deep/link")"
  headers=$("${CURL[@]}" -D - -o /dev/null "$base/" || true)
  contains "$host HSTS" "strict-transport-security: max-age=31536000" "$headers"
  contains "$host CSP script-src self" "script-src 'self'" "$headers"
  contains "$host frame-ancestors none" "frame-ancestors 'none'" "$headers"
  contains "$host nosniff" "x-content-type-options: nosniff" "$headers"
  contains "$host HTML not cached" "cache-control: no-cache" "$headers"
done
driver_headers=$("${CURL[@]}" -D - -o /dev/null "https://${DRIVER_HOST}${PORT_SUFFIX}/" || true)
contains "driver may use geolocation" "geolocation=(self)" "$driver_headers"
customer_headers=$("${CURL[@]}" -D - -o /dev/null "https://${CUSTOMER_HOST}${PORT_SUFFIX}/" || true)
contains "customer has no geolocation" "geolocation=()" "$customer_headers"

# Web auth is on: an unauthenticated refresh must be rejected, and a foreign Origin refused.
check "refresh without cookie rejected" 401 "$(status -X POST -H "Origin: https://${CUSTOMER_HOST}${PORT_SUFFIX}" "https://${CUSTOMER_HOST}${PORT_SUFFIX}/api/v1/auth/web/refresh")"
check "foreign Origin refused" 403 "$(status -X POST -H 'Origin: https://evil.example' -H 'Content-Type: application/json' -d '{}' "https://${CUSTOMER_HOST}${PORT_SUFFIX}/api/v1/auth/web/otp/request")"

# Metrics are reachable inside the private network with the token.
internal=$("${COMPOSE[@]}" exec -T api node -e "fetch('http://127.0.0.1:3000/api/v1/health/metrics',{headers:{Authorization:'Bearer '+process.env.METRICS_TOKEN}}).then(r=>console.log(r.status),()=>console.log(0))")
check "internal metrics with token" 200 "$internal"

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed. Do not hand over; see docs/release-checklist.md section D."
  exit 1
fi
echo "All automated smoke checks passed. Continue with the manual items in section C."
