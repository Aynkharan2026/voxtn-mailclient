#!/usr/bin/env bash
# Integration test for Phase 5 Step 3 — shared inboxes + supervisor audit.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

TOKEN="$(grep -E '^INTERNAL_SERVICE_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
BASE="${VOXMAIL_IMAP_URL:-https://imap.nexamail.voxtn.com}"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

TAG="$(date +%s)"
TENANT="tenant-${TAG}@example.test"
INBOX_EMAIL="support-${TAG}@example.test"
REP="rep-${TAG}@example.test"
SUPER="super-${TAG}@example.test"
NONE="nobody-${TAG}@example.test"

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

# 1. POST /shared-inboxes → 201
status=$(curl -sS -X POST "$BASE/shared-inboxes" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"tenant_email\":\"$TENANT\",\"name\":\"itest support\",\"email_address\":\"$INBOX_EMAIL\"}" \
    -o "$TMP" -w '%{http_code}')
check_status "POST /shared-inboxes → 201" 201 "$status"

INBOX_ID=$(sed -n 's/.*"id":"\([0-9a-f-]\{36\}\)".*/\1/p' "$TMP" | head -1)
echo "inbox id: $INBOX_ID"
echo

# 2. duplicate email_address → 409
status=$(curl -sS -X POST "$BASE/shared-inboxes" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"tenant_email\":\"$TENANT\",\"name\":\"dup\",\"email_address\":\"$INBOX_EMAIL\"}" \
    -o "$TMP" -w '%{http_code}')
check_status "POST duplicate email_address → 409" 409 "$status"

# 3. GET list → contains the new inbox
status=$(curl -sS "$BASE/shared-inboxes?tenant_email=$TENANT" \
    -H "Authorization: Bearer $TOKEN" \
    -o "$TMP" -w '%{http_code}')
check_status "GET /shared-inboxes?tenant_email= → 200" 200 "$status"
if grep -q "\"id\":\"$INBOX_ID\"" "$TMP"; then
    echo "PASS (list contains created inbox)"; pass=$((pass + 1))
else
    echo "FAIL (list did not contain $INBOX_ID)"; fail=$((fail + 1))
fi
echo

# 4. assign rep twice (dedupe)
status=$(curl -sS -X POST "$BASE/shared-inboxes/$INBOX_ID/assign" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"email\":\"$REP\"}" -o "$TMP" -w '%{http_code}')
check_status "POST /assign (first) → 200" 200 "$status"

status=$(curl -sS -X POST "$BASE/shared-inboxes/$INBOX_ID/assign" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"email\":\"$REP\"}" -o "$TMP" -w '%{http_code}')
check_status "POST /assign (duplicate) → 200" 200 "$status"

echo "--- assigned_rep_emails deduped ---"
REP_COUNT=$(ssh nexamail "sudo -u postgres psql -d nexamail -Atc \"SELECT array_length(assigned_rep_emails,1) FROM shared_inboxes WHERE id='$INBOX_ID'\"")
if [ "$REP_COUNT" = "1" ]; then
    echo "PASS (count=1 after duplicate assign)"; pass=$((pass + 1))
else
    echo "FAIL (got $REP_COUNT)"; fail=$((fail + 1))
fi
echo

# 5. supervisor
status=$(curl -sS -X POST "$BASE/shared-inboxes/$INBOX_ID/supervise" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"email\":\"$SUPER\"}" -o "$TMP" -w '%{http_code}')
check_status "POST /supervise → 200" 200 "$status"

# 6. messages fetch with bogus IMAP → 502 (caller is authorized rep)
status=$(curl -sS -X POST "$BASE/shared-inboxes/$INBOX_ID/messages" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -H "X-Voxmail-User: $REP" \
    -d "{\"imap\":{\"host\":\"localhost\",\"port\":1,\"secure\":false,\"user\":\"$REP\",\"pass\":\"y\"}}" \
    -o "$TMP" -w '%{http_code}')
check_status "POST /messages bogus imap → 502" 502 "$status"

# 7. messages fetch by unauthorized caller → 403
status=$(curl -sS -X POST "$BASE/shared-inboxes/$INBOX_ID/messages" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -H "X-Voxmail-User: $NONE" \
    -d "{\"imap\":{\"host\":\"localhost\",\"port\":1,\"secure\":false,\"user\":\"$NONE\",\"pass\":\"y\"}}" \
    -o "$TMP" -w '%{http_code}')
check_status "POST /messages by unauthorized user → 403" 403 "$status"

# 8. seed a fake audit row so the supervisor endpoint has data to return
ssh nexamail "sudo -u postgres psql -d nexamail -c \"
INSERT INTO audit_log (owner_email, action, payload)
VALUES ('$REP', 'shared_inbox_accessed',
  jsonb_build_object('sharedInboxId', '$INBOX_ID', 'accessedBy', '$REP', 'messageCount', 5))
\" >/dev/null 2>&1"

# 9. GET /audit without header → 401
status=$(curl -sS "$BASE/shared-inboxes/$INBOX_ID/audit" \
    -H "Authorization: Bearer $TOKEN" -o "$TMP" -w '%{http_code}')
check_status "GET /audit without X-Voxmail-User → 401" 401 "$status"

# 10. GET /audit as non-supervisor → 403
status=$(curl -sS "$BASE/shared-inboxes/$INBOX_ID/audit" \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-Voxmail-User: $REP" \
    -o "$TMP" -w '%{http_code}')
check_status "GET /audit as non-supervisor → 403" 403 "$status"

# 11. GET /audit as supervisor → 200 with events
status=$(curl -sS "$BASE/shared-inboxes/$INBOX_ID/audit" \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-Voxmail-User: $SUPER" \
    -o "$TMP" -w '%{http_code}')
check_status "GET /audit as supervisor → 200" 200 "$status"
COUNT=$(sed -n 's/.*"count":\([0-9]*\).*/\1/p' "$TMP")
if [ -n "$COUNT" ] && [ "$COUNT" -ge 1 ]; then
    echo "PASS (events=$COUNT)"; pass=$((pass + 1))
else
    echo "FAIL (expected >=1 event)"; fail=$((fail + 1))
fi
echo

# 12. unknown inbox → 404
FAKE_UUID="00000000-0000-0000-0000-000000000000"
status=$(curl -sS -X POST "$BASE/shared-inboxes/$FAKE_UUID/assign" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"email\":\"$REP\"}" -o "$TMP" -w '%{http_code}')
check_status "POST /assign on unknown id → 404" 404 "$status"

# cleanup (audit_log rows persist by design)
ssh nexamail "sudo -u postgres psql -d nexamail -c \"
DELETE FROM shared_inboxes WHERE id = '$INBOX_ID';
\" >/dev/null 2>&1" || true

echo "==============="
echo "passed: $pass"
echo "failed: $fail"
echo "==============="
[ "$fail" -eq 0 ] || exit 1
