#!/usr/bin/env bash
# Integration test for Phase 5 Step 4 — ownership transfer + audit_log
# full immutability (UPDATE now blocked).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

TOKEN="$(grep -E '^INTERNAL_SERVICE_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
BASE="${VOXMAIL_IMAP_URL:-https://imap.nexamail.voxtn.com}"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

TAG="$(date +%s)"
TENANT="tenant-ot-${TAG}@example.test"
INBOX_EMAIL="support-ot-${TAG}@example.test"
REP1="rep1-ot-${TAG}@example.test"
REP2="rep2-ot-${TAG}@example.test"
SUPER="super-ot-${TAG}@example.test"
OUTSIDER="outsider-ot-${TAG}@example.test"

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

# ========================================================
# Setup: create inbox, supervisor, rep1
# ========================================================
curl -sS -X POST "$BASE/shared-inboxes" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"tenant_email\":\"$TENANT\",\"name\":\"ot itest\",\"email_address\":\"$INBOX_EMAIL\"}" \
    -o "$TMP" >/dev/null

INBOX_ID=$(sed -n 's/.*"id":"\([0-9a-f-]\{36\}\)".*/\1/p' "$TMP" | head -1)
echo "inbox: $INBOX_ID"

curl -sS -X POST "$BASE/shared-inboxes/$INBOX_ID/supervise" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"email\":\"$SUPER\"}" -o /dev/null

curl -sS -X POST "$BASE/shared-inboxes/$INBOX_ID/assign" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"email\":\"$REP1\"}" -o /dev/null

# ========================================================
# Create an OPEN campaign owned by REP1 (bogus SMTP so jobs fail;
# they stay in 'failed' terminal state but the campaign row stays
# owned by rep1). To ensure the campaign is "open" when transfer runs,
# we need it in 'sending' state briefly. Simpler: seed directly via
# psql so we don't race the worker.
# ========================================================
CAMP1=$(ssh nexamail "sudo -u postgres psql -d nexamail -Atc \"
INSERT INTO campaigns (owner_email, name, subject, html_body, status)
VALUES ('$REP1', 'ot itest draft', 'x', '<p>x</p>', 'draft')
RETURNING id\"" 2>&1)
CAMP2=$(ssh nexamail "sudo -u postgres psql -d nexamail -Atc \"
INSERT INTO campaigns (owner_email, name, subject, html_body, status)
VALUES ('$REP1', 'ot itest complete', 'x', '<p>x</p>', 'complete')
RETURNING id\"" 2>&1)
echo "seeded campaigns: open=$CAMP1 complete=$CAMP2"
echo

# ========================================================
# 1. Transfer by non-supervisor → 403
# ========================================================
status=$(curl -sS -X POST "$BASE/shared-inboxes/$INBOX_ID/transfer-ownership" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"from_email\":\"$REP1\",\"to_email\":\"$REP2\",\"requester_email\":\"$OUTSIDER\"}" \
    -o "$TMP" -w '%{http_code}')
check_status "transfer by non-supervisor → 403" 403 "$status"

# ========================================================
# 2. Transfer with identical from/to → 400
# ========================================================
status=$(curl -sS -X POST "$BASE/shared-inboxes/$INBOX_ID/transfer-ownership" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"from_email\":\"$REP1\",\"to_email\":\"$REP1\",\"requester_email\":\"$SUPER\"}" \
    -o "$TMP" -w '%{http_code}')
check_status "transfer identical from/to → 400" 400 "$status"

# ========================================================
# 3. Transfer by supervisor → 200 + correct body shape
# ========================================================
status=$(curl -sS -X POST "$BASE/shared-inboxes/$INBOX_ID/transfer-ownership" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"from_email\":\"$REP1\",\"to_email\":\"$REP2\",\"requester_email\":\"$SUPER\"}" \
    -o "$TMP" -w '%{http_code}')
check_status "transfer by supervisor → 200" 200 "$status"

TRANSFERRED=$(sed -n 's/.*"transferredCampaigns":\([0-9]*\).*/\1/p' "$TMP")
echo "--- transferredCampaigns count ---"
if [ "$TRANSFERRED" = "1" ]; then
    echo "PASS (1 open campaign transferred; complete one untouched)"; pass=$((pass + 1))
else
    echo "FAIL (expected 1, got $TRANSFERRED)"; fail=$((fail + 1))
fi
echo

# ========================================================
# 4. DB check — the draft campaign now owned by REP2
# ========================================================
NEW_OWNER=$(ssh nexamail "sudo -u postgres psql -d nexamail -Atc \"SELECT owner_email FROM campaigns WHERE id='$CAMP1'\"")
echo "--- open campaign ownership flipped ---"
if [ "$NEW_OWNER" = "$REP2" ]; then
    echo "PASS"; pass=$((pass + 1))
else
    echo "FAIL (got '$NEW_OWNER')"; fail=$((fail + 1))
fi
echo

# ========================================================
# 5. DB check — the complete campaign still owned by REP1 (not touched)
# ========================================================
OLD_OWNER=$(ssh nexamail "sudo -u postgres psql -d nexamail -Atc \"SELECT owner_email FROM campaigns WHERE id='$CAMP2'\"")
echo "--- closed campaign ownership preserved ---"
if [ "$OLD_OWNER" = "$REP1" ]; then
    echo "PASS"; pass=$((pass + 1))
else
    echo "FAIL (got '$OLD_OWNER')"; fail=$((fail + 1))
fi
echo

# ========================================================
# 6. DB check — assigned_rep_emails swapped
# ========================================================
REPS=$(ssh nexamail "sudo -u postgres psql -d nexamail -Atc \"SELECT assigned_rep_emails FROM shared_inboxes WHERE id='$INBOX_ID'\"")
echo "--- rep array swap ---"
echo "assigned_rep_emails: $REPS"
if ! echo "$REPS" | grep -q "$REP1" && echo "$REPS" | grep -q "$REP2"; then
    echo "PASS (rep1 removed, rep2 added)"; pass=$((pass + 1))
else
    echo "FAIL"; fail=$((fail + 1))
fi
echo

# ========================================================
# 7. audit_log has ownership_transferred
# ========================================================
AUDIT_PAYLOAD=$(ssh nexamail "sudo -u postgres psql -d nexamail -Atc \"
SELECT payload::text FROM audit_log
 WHERE action='ownership_transferred'
   AND payload->>'sharedInboxId'='$INBOX_ID'
 ORDER BY created_at DESC LIMIT 1
\"")
echo "--- audit_log entry written ---"
echo "payload: $AUDIT_PAYLOAD"
if echo "$AUDIT_PAYLOAD" | grep -q "\"from\": \"$REP1\"" && \
   echo "$AUDIT_PAYLOAD" | grep -q "\"to\": \"$REP2\"" && \
   echo "$AUDIT_PAYLOAD" | grep -q "\"requester\": \"$SUPER\""; then
    echo "PASS"; pass=$((pass + 1))
else
    echo "FAIL"; fail=$((fail + 1))
fi
echo

# ========================================================
# 8. audit_log is now fully immutable — UPDATE must fail
# ========================================================
echo "--- UPDATE on audit_log must fail ---"
UPD_OUT=$(ssh nexamail "sudo -u postgres psql -d nexamail -c \"UPDATE audit_log SET action='tampered' WHERE payload->>'sharedInboxId'='$INBOX_ID'\"" 2>&1 || true)
if echo "$UPD_OUT" | grep -qi "audit_log is append-only"; then
    echo "PASS (UPDATE raises append-only exception)"; pass=$((pass + 1))
else
    echo "FAIL"
    echo "output: $UPD_OUT"
    fail=$((fail + 1))
fi
echo

# ========================================================
# 9. Unknown inbox → 404
# ========================================================
status=$(curl -sS -X POST "$BASE/shared-inboxes/00000000-0000-0000-0000-000000000000/transfer-ownership" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"from_email\":\"$REP1\",\"to_email\":\"$REP2\",\"requester_email\":\"$SUPER\"}" \
    -o "$TMP" -w '%{http_code}')
check_status "transfer on unknown inbox → 404" 404 "$status"

# ========================================================
# cleanup
# ========================================================
ssh nexamail "sudo -u postgres psql -d nexamail -c \"
DELETE FROM campaigns WHERE id IN ('$CAMP1', '$CAMP2');
DELETE FROM shared_inboxes WHERE id = '$INBOX_ID';
\" >/dev/null 2>&1" || true

echo "==============="
echo "passed: $pass"
echo "failed: $fail"
echo "==============="
[ "$fail" -eq 0 ] || exit 1
