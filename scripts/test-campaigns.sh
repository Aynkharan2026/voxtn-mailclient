#!/usr/bin/env bash
# Integration test for POST /campaigns + GET /campaigns/:id/status on
# voxmail-imap. Uses bogus SMTP — exercises DB writes + queue enqueue.
# The rate-limited worker will later fail each job; we only verify the
# synchronous path and initial DB state here.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

TOKEN="$(grep -E '^INTERNAL_SERVICE_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
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
        echo "PASS"; pass=$((pass + 1))
    else
        echo "FAIL (expected $expected)"; echo "body: $(cat "$TMP")"; fail=$((fail + 1))
    fi
    echo
}

# 1. unauthenticated
status=$(curl -sS -X POST "$BASE/campaigns" -o "$TMP" -w '%{http_code}')
check_status "POST /campaigns without auth" 401 "$status"

# 2. invalid payload (missing name)
status=$(curl -sS -X POST "$BASE/campaigns" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"subject":"x","html":"<p>y</p>","recipients":["a@b.test"],"smtp":{"host":"x","port":1,"secure":false,"user":"x","pass":"y"}}' \
    -o "$TMP" -w '%{http_code}')
check_status "POST /campaigns missing name → 400" 400 "$status"

# 3. happy path — 3 inputs with a case-variant duplicate → 2 queued
status=$(curl -sS -X POST "$BASE/campaigns" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{
        "name":"VoxMail integration-test campaign",
        "subject":"Integration test",
        "html":"<p>this is a test</p>",
        "recipients":["alice+itest@example.test","ALICE+ITEST@EXAMPLE.TEST","bob+itest@example.test"],
        "smtp":{"host":"localhost","port":1,"secure":false,"user":"itest@example.test","pass":"y"}
    }' \
    -o "$TMP" -w '%{http_code}')
check_status "POST /campaigns valid payload → 201" 201 "$status"

CAMPAIGN_ID=$(sed -n 's/.*"campaignId":"\([^"]*\)".*/\1/p' "$TMP")
QUEUED=$(sed -n 's/.*"queued":\([0-9]*\).*/\1/p' "$TMP")
echo "campaignId=$CAMPAIGN_ID queued=$QUEUED"

echo "--- case-insensitive dedupe ---"
if [ "$QUEUED" = "2" ]; then
    echo "PASS (queued=2)"; pass=$((pass + 1))
else
    echo "FAIL (expected 2, got $QUEUED)"; fail=$((fail + 1))
fi
echo

# 4. DB row sanity
echo "--- DB row counts (campaigns|recipients|name_stored) ---"
COUNTS=$(ssh nexamail "sudo -u postgres psql -d nexamail -Atc \"
SELECT
    (SELECT COUNT(*) FROM campaigns WHERE id = '$CAMPAIGN_ID'),
    (SELECT COUNT(*) FROM campaign_recipients WHERE campaign_id = '$CAMPAIGN_ID'),
    (SELECT name = 'VoxMail integration-test campaign' FROM campaigns WHERE id = '$CAMPAIGN_ID')
\" 2>/dev/null" 2>&1)
echo "result: $COUNTS"
if echo "$COUNTS" | grep -q "^1|2|t"; then
    echo "PASS"; pass=$((pass + 1))
else
    echo "FAIL"; fail=$((fail + 1))
fi
echo

# 5. GET /campaigns/:id/status
status=$(curl -sS "$BASE/campaigns/$CAMPAIGN_ID/status" \
    -H "Authorization: Bearer $TOKEN" \
    -o "$TMP" -w '%{http_code}')
check_status "GET /campaigns/{id}/status → 200" 200 "$status"
echo "body: $(cat "$TMP")"

# Assert the shape
for field in total sent failed open_count click_count status; do
    if ! grep -q "\"$field\"" "$TMP"; then
        echo "FAIL: response missing \"$field\""
        fail=$((fail + 1))
    fi
done
TOTAL=$(sed -n 's/.*"total":\([0-9]*\).*/\1/p' "$TMP")
if [ "$TOTAL" = "2" ]; then
    echo "PASS (total=2 matches queued)"; pass=$((pass + 1))
else
    echo "FAIL (expected total=2, got $TOTAL)"; fail=$((fail + 1))
fi
echo

# 6. unknown campaign id → 404
status=$(curl -sS "$BASE/campaigns/00000000-0000-0000-0000-000000000000/status" \
    -H "Authorization: Bearer $TOKEN" -o "$TMP" -w '%{http_code}')
check_status "GET /campaigns/{unknown-uuid}/status → 404" 404 "$status"

# 7. invalid uuid → 400
status=$(curl -sS "$BASE/campaigns/not-a-uuid/status" \
    -H "Authorization: Bearer $TOKEN" -o "$TMP" -w '%{http_code}')
check_status "GET /campaigns/{bad-id}/status → 400" 400 "$status"

# 8. Cleanup — drop test campaign so workers stop retrying
ssh nexamail "sudo -u postgres psql -d nexamail -c \"DELETE FROM campaigns WHERE id = '$CAMPAIGN_ID'\" >/dev/null 2>&1" || true

echo "==============="
echo "passed: $pass"
echo "failed: $fail"
echo "==============="
[ "$fail" -eq 0 ] || exit 1
