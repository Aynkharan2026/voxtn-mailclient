#!/usr/bin/env bash
# Integration test for POST /send + DELETE /send/cancel on voxmail-imap.
#
# Uses intentionally bogus SMTP credentials — we only exercise the BullMQ
# enqueue + cancel plumbing, not the actual SMTP transport. The 10s delay
# means the worker won't attempt SMTP within the test run, so an invalid
# host never surfaces.
#
# Usage:   bash scripts/test-send-cancel.sh
# Override base URL with: VOXMAIL_IMAP_URL=https://... bash scripts/test-send-cancel.sh

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
    echo "ERROR: INTERNAL_SERVICE_TOKEN not set in $ENV_FILE" >&2
    exit 2
fi

BASE="${VOXMAIL_IMAP_URL:-https://imap.nexamail.voxtn.com}"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

pass=0
fail=0

check_status() {
    local name="$1" expected="$2" actual="$3"
    echo "--- $name ---"
    echo "status: $actual"
    if [ "$actual" = "$expected" ]; then
        echo "PASS"
        pass=$((pass + 1))
    else
        echo "FAIL (expected $expected)"
        fail=$((fail + 1))
    fi
    echo
}

# 1. POST /send — enqueue with bogus SMTP
status=$(curl -sS -X POST "$BASE/send" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "to": "nobody@example.test",
        "subject": "test",
        "html": "<p>test</p>",
        "smtp": {"host":"localhost","port":1,"secure":false,"user":"x","pass":"y"}
    }' \
    -o "$TMP" -w "%{http_code}")
echo "body: $(cat "$TMP")"
check_status "POST /send enqueues delayed job" 200 "$status"

JOB_ID=$(sed -n 's/.*"jobId":"\([^"]*\)".*/\1/p' "$TMP")
MSG_ID=$(sed -n 's/.*"messageId":"\([^"]*\)".*/\1/p' "$TMP")

if [ -n "$JOB_ID" ] && [ -n "$MSG_ID" ]; then
    echo "--- response shape: jobId + messageId present ---"
    echo "jobId=$JOB_ID"
    echo "messageId=$MSG_ID"
    echo "PASS"
    pass=$((pass + 1))
else
    echo "--- response shape ---"
    echo "FAIL — missing jobId or messageId"
    fail=$((fail + 1))
    exit 1
fi
echo

# 2. DELETE /send/cancel — should remove the delayed job
status=$(curl -sS -X DELETE "$BASE/send/cancel?jobId=$JOB_ID" \
    -H "Authorization: Bearer $TOKEN" \
    -o "$TMP" -w "%{http_code}")
echo "body: $(cat "$TMP")"
check_status "DELETE /send/cancel?jobId=... returns 200" 200 "$status"

# 3. DELETE again — should 404 (job removed)
status=$(curl -sS -X DELETE "$BASE/send/cancel?jobId=$JOB_ID" \
    -H "Authorization: Bearer $TOKEN" \
    -o "$TMP" -w "%{http_code}")
echo "body: $(cat "$TMP")"
check_status "DELETE /send/cancel on removed job returns 404" 404 "$status"

# 4. DELETE without auth — should 401
status=$(curl -sS -X DELETE "$BASE/send/cancel?jobId=whatever" \
    -o "$TMP" -w "%{http_code}")
check_status "DELETE /send/cancel without auth returns 401" 401 "$status"

# 5. DELETE without jobId param — should 400
status=$(curl -sS -X DELETE "$BASE/send/cancel" \
    -H "Authorization: Bearer $TOKEN" \
    -o "$TMP" -w "%{http_code}")
check_status "DELETE /send/cancel missing jobId returns 400" 400 "$status"

echo "==============="
echo "passed: $pass"
echo "failed: $fail"
echo "==============="

[ "$fail" -eq 0 ] || exit 1
