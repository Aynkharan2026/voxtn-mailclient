#!/usr/bin/env bash
# Integration test for Phase 5 Step 2 — CASL compliance + audit log.
# Covers:
#   1. Unsubscribe flow end-to-end (POST, GET with signed token)
#   2. Blocked recipient is skipped from a campaign
#   3. audit_log is append-only (DELETE raises exception, TRUNCATE too)
#   4. audit_log populated after campaign send

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

TOKEN="$(grep -E '^INTERNAL_SERVICE_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
BASE="${VOXMAIL_IMAP_URL:-https://imap.nexamail.voxtn.com}"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

TAG="$(date +%s)"
UNSUB_EMAIL="unsub-${TAG}@example.test"
OTHER_EMAIL="other-${TAG}@example.test"
OWNER_EMAIL="itest-${TAG}@example.test"

pass=0
fail=0

check_status() {
    local name="$1" expected="$2" actual="$3"
    echo "--- $name ---"
    echo "status: $actual"
    if [ "$actual" = "$expected" ]; then
        echo "PASS"; pass=$((pass + 1))
    else
        echo "FAIL (expected $expected)"
        echo "body: $(head -c 300 "$TMP")"
        fail=$((fail + 1))
    fi
    echo
}

# ============================================================
# 1. POST /unsubscribe adds to table + audit_log (admin flow)
# ============================================================
status=$(curl -sS -X POST "$BASE/unsubscribe" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"email\":\"$UNSUB_EMAIL\",\"source\":\"itest\",\"owner_email\":\"$OWNER_EMAIL\"}" \
    -o "$TMP" -w '%{http_code}')
check_status "POST /unsubscribe admin flow → 201" 201 "$status"

# ============================================================
# 2. unsubscribes table row exists
# ============================================================
ROW_COUNT=$(ssh nexamail "sudo -u postgres psql -d nexamail -Atc \"SELECT COUNT(*) FROM unsubscribes WHERE email='$UNSUB_EMAIL'\"" 2>&1)
echo "--- unsubscribes row exists ---"
if [ "$ROW_COUNT" = "1" ]; then
    echo "PASS"; pass=$((pass + 1))
else
    echo "FAIL (got $ROW_COUNT)"; fail=$((fail + 1))
fi
echo

# ============================================================
# 3. Campaign with a blocked recipient skips it
# ============================================================
status=$(curl -sS -X POST "$BASE/campaigns" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{
        \"name\":\"compliance test campaign $TAG\",
        \"subject\":\"compliance test\",
        \"html\":\"<p>hi</p>\",
        \"recipients\":[\"$UNSUB_EMAIL\",\"$OTHER_EMAIL\"],
        \"smtp\":{\"host\":\"localhost\",\"port\":1,\"secure\":false,\"user\":\"$OWNER_EMAIL\",\"pass\":\"y\"}
    }" \
    -o "$TMP" -w '%{http_code}')
check_status "POST /campaigns with blocked recipient → 201" 201 "$status"

CAMPAIGN_ID=$(sed -n 's/.*"campaignId":"\([^"]*\)".*/\1/p' "$TMP")
QUEUED=$(sed -n 's/.*"queued":\([0-9]*\).*/\1/p' "$TMP")
echo "campaignId=$CAMPAIGN_ID queued=$QUEUED"

echo "--- unsubscribed recipient filtered out ---"
if [ "$QUEUED" = "1" ]; then
    echo "PASS (queued=1, unsubscribed recipient skipped)"; pass=$((pass + 1))
else
    echo "FAIL (expected queued=1, got $QUEUED)"; fail=$((fail + 1))
fi
echo

# ============================================================
# 4. audit_log is append-only — DELETE should raise
# ============================================================
echo "--- DELETE on audit_log must fail ---"
DEL_OUT=$(ssh nexamail "sudo -u postgres psql -d nexamail -c \"DELETE FROM audit_log WHERE owner_email='$OWNER_EMAIL'\"" 2>&1 || true)
if echo "$DEL_OUT" | grep -qi "audit_log is append-only"; then
    echo "PASS (exception raised: audit_log is append-only)"
    pass=$((pass + 1))
else
    echo "FAIL — DELETE did not raise expected exception"
    echo "  output: $DEL_OUT"
    fail=$((fail + 1))
fi
echo

# ============================================================
# 5. TRUNCATE on audit_log must also fail
# ============================================================
echo "--- TRUNCATE on audit_log must fail ---"
TRUNC_OUT=$(ssh nexamail "sudo -u postgres psql -d nexamail -c \"TRUNCATE audit_log\"" 2>&1 || true)
if echo "$TRUNC_OUT" | grep -qi "audit_log is append-only"; then
    echo "PASS (exception raised)"
    pass=$((pass + 1))
else
    echo "FAIL"
    echo "  output: $TRUNC_OUT"
    fail=$((fail + 1))
fi
echo

# ============================================================
# 6. audit_log has campaign_created + unsubscribe_admin entries
# ============================================================
echo "--- audit_log populated for this owner ---"
AUDIT_ACTIONS=$(ssh nexamail "sudo -u postgres psql -d nexamail -Atc \"SELECT string_agg(DISTINCT action, ',' ORDER BY action) FROM audit_log WHERE owner_email='$OWNER_EMAIL'\"" 2>&1)
echo "distinct actions: $AUDIT_ACTIONS"
expected_present=true
for expected_action in campaign_created unsubscribe_admin; do
    if ! echo ",$AUDIT_ACTIONS," | grep -q ",$expected_action,"; then
        echo "  MISSING: $expected_action"
        expected_present=false
    fi
done
if $expected_present; then
    echo "PASS"; pass=$((pass + 1))
else
    echo "FAIL"; fail=$((fail + 1))
fi
echo

# ============================================================
# 7. GET /audit-log returns events for owner
# ============================================================
status=$(curl -sS "$BASE/audit-log?owner_email=$OWNER_EMAIL" \
    -H "Authorization: Bearer $TOKEN" \
    -o "$TMP" -w '%{http_code}')
check_status "GET /audit-log → 200" 200 "$status"
COUNT_IN_RESPONSE=$(sed -n 's/.*"count":\([0-9]*\).*/\1/p' "$TMP")
echo "events in response: $COUNT_IN_RESPONSE"
if [ -n "$COUNT_IN_RESPONSE" ] && [ "$COUNT_IN_RESPONSE" -ge 2 ]; then
    echo "PASS (>=2 events)"
    pass=$((pass + 1))
else
    echo "FAIL (expected >=2)"
    fail=$((fail + 1))
fi
echo

# ============================================================
# 8. GET /unsubscribe with a signed token (simulate email click)
# ============================================================
# Build a token locally using the shared secret so we exercise the real
# verify path. Node present on CI host.
UNSUB_SECRET=$(grep -E '^UNSUBSCRIBE_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2-)
SECOND_EMAIL="click-${TAG}@example.test"
GEN_TOKEN=$(node -e "
const crypto = require('crypto');
const secret = process.argv[1];
const payload = JSON.stringify({ r: process.argv[2], s: process.argv[3] });
const b64 = Buffer.from(payload, 'utf-8').toString('base64url');
const sig = crypto.createHmac('sha256', secret).update(b64).digest('base64url');
console.log(b64 + '.' + sig);
" "$UNSUB_SECRET" "$SECOND_EMAIL" "$OWNER_EMAIL")

status=$(curl -sS "$BASE/unsubscribe?token=$GEN_TOKEN" -o "$TMP" -w '%{http_code}')
check_status "GET /unsubscribe with valid signed token → 200" 200 "$status"

BODY_SAMPLE=$(head -c 400 "$TMP")
echo "body sample: $(echo "$BODY_SAMPLE" | tr -d '\n' | head -c 200)..."
if echo "$BODY_SAMPLE" | grep -qi "unsubscribed"; then
    echo "PASS (html confirms unsubscribe)"; pass=$((pass + 1))
else
    echo "FAIL (html did not confirm)"; fail=$((fail + 1))
fi
echo

# ============================================================
# 9. GET /unsubscribe with tampered token → 400
# ============================================================
TAMPERED="${GEN_TOKEN}xxx"
status=$(curl -sS "$BASE/unsubscribe?token=$TAMPERED" -o "$TMP" -w '%{http_code}')
check_status "GET /unsubscribe with tampered token → 400" 400 "$status"

# ============================================================
# 10. Second email is now in unsubscribes
# ============================================================
ROW_COUNT=$(ssh nexamail "sudo -u postgres psql -d nexamail -Atc \"SELECT COUNT(*) FROM unsubscribes WHERE email='$SECOND_EMAIL'\"" 2>&1)
echo "--- one-click unsubscribe persisted ---"
if [ "$ROW_COUNT" = "1" ]; then
    echo "PASS"; pass=$((pass + 1))
else
    echo "FAIL"; fail=$((fail + 1))
fi
echo

# ============================================================
# cleanup — remove this run's artifacts so tests are isolated
# note: audit_log rows CANNOT be deleted (that's the point). Those rows
# will remain. Campaign + unsubscribes can be cleaned up.
# ============================================================
ssh nexamail "sudo -u postgres psql -d nexamail -c \"
DELETE FROM campaigns WHERE id = '$CAMPAIGN_ID';
DELETE FROM unsubscribes WHERE email IN ('$UNSUB_EMAIL', '$SECOND_EMAIL');
\" >/dev/null 2>&1" || true

echo "==============="
echo "passed: $pass"
echo "failed: $fail"
echo "==============="
[ "$fail" -eq 0 ] || exit 1
