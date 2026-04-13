#!/usr/bin/env bash
# End-to-end test for GET /crm/context on the live nexamail-ai service.
#
# Usage:
#   bash scripts/test-crm-context.sh
#
# Requires:
#   .env at repo root with INTERNAL_SERVICE_TOKEN set.
#   curl available.
#
# Override base URL with:  NEXAMAIL_AI_URL=https://... bash scripts/test-crm-context.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: $ENV_FILE not found" >&2
    exit 2
fi

TOKEN="$(grep -E '^INTERNAL_SERVICE_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
if [ -z "$TOKEN" ]; then
    echo "ERROR: INTERNAL_SERVICE_TOKEN is empty in $ENV_FILE" >&2
    exit 2
fi

BASE="${NEXAMAIL_AI_URL:-https://ai.nexamail.voxtn.com}"
TMP_BODY="$(mktemp)"
trap 'rm -f "$TMP_BODY"' EXIT

pass=0
fail=0

urlencode() {
    python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$1"
}

run_case() {
    local name="$1" expected="$2"; shift 2
    echo "--- $name ---"
    echo "curl $*"
    local status
    status=$(curl -sS -o "$TMP_BODY" -w '%{http_code}' "$@" || echo "000")
    echo "status: $status"
    echo "body  : $(head -c 400 "$TMP_BODY")"
    if [ "$status" = "$expected" ]; then
        echo "PASS"
        pass=$((pass + 1))
    else
        echo "FAIL (expected $expected)"
        fail=$((fail + 1))
    fi
    echo
}

ALICE_URL="$BASE/crm/context?email=$(urlencode alice@example.com)"
NODEAL_URL="$BASE/crm/context?email=$(urlencode nodeal@example.com)"
UNKNOWN_URL="$BASE/crm/context?email=$(urlencode nobody@example.com)"

run_case "happy path: alice has deal + 3 activities" \
    200 -H "Authorization: Bearer $TOKEN" "$ALICE_URL"

run_case "contact exists, no deal/activities" \
    200 -H "Authorization: Bearer $TOKEN" "$NODEAL_URL"

run_case "unknown email returns 404" \
    404 -H "Authorization: Bearer $TOKEN" "$UNKNOWN_URL"

run_case "missing Authorization header returns 401" \
    401 "$ALICE_URL"

run_case "wrong bearer returns 401" \
    401 -H "Authorization: Bearer wrong-token-value" "$ALICE_URL"

echo "==============="
echo "passed: $pass"
echo "failed: $fail"
echo "==============="

[ "$fail" -eq 0 ] || exit 1
