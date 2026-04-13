#!/usr/bin/env bash
# Integration test for POST /campaigns on voxmail-imap.
# Uses bogus SMTP — exercises DB writes + queue enqueue. The rate-limited
# worker will later fail each job (can't connect to bogus host); the DB row
# status will flip from 'queued' to 'failed' within a few minutes. We only
# verify the synchronous path here.

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

# 2. invalid payload (missing recipients)
status=$(curl -sS -X POST "$BASE/campaigns" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"subject":"x","html":"<p>y</p>","smtp":{"host":"x","port":1,"secure":false,"user":"x","pass":"y"}}' \
    -o "$TMP" -w '%{http_code}')
check_status "POST /campaigns missing recipients → 400" 400 "$status"

# 3. happy path with 2 distinct recipients + 1 case-variant duplicate of the
#    first; we expect the server to dedupe to 2 queued emails.
status=$(curl -sS -X POST "$BASE/campaigns" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{
        "subject":"VoxMail campaign integration test",
        "html":"<p>this is a test</p>",
        "recipients":["alice+itest@example.test","ALICE+ITEST@EXAMPLE.TEST","bob+itest@example.test"],
        "smtp":{"host":"localhost","port":1,"secure":false,"user":"itest@example.test","pass":"y"}
    }' \
    -o "$TMP" -w '%{http_code}')
check_status "POST /campaigns 3 input → 2 queued (case-insensitive dedupe) → 201" 201 "$status"

CAMPAIGN_ID=$(sed -n 's/.*"campaignId":"\([^"]*\)".*/\1/p' "$TMP")
QUEUED=$(sed -n 's/.*"queued":\([0-9]*\).*/\1/p' "$TMP")
echo "campaignId=$CAMPAIGN_ID queued=$QUEUED"

echo "--- case-insensitive dedupe ---"
if [ "$QUEUED" = "2" ]; then
    echo "PASS (queued=2, alice and ALICE collapsed)"
    pass=$((pass + 1))
else
    echo "FAIL (expected 2, got $QUEUED)"
    fail=$((fail + 1))
fi
echo

# 5. verify DB rows via psql-on-server (counts only — no PII in output)
echo "--- DB verification via ssh ---"
COUNTS=$(ssh nexamail "sudo -u postgres psql -d nexamail -Atc \"
SELECT
    (SELECT COUNT(*) FROM campaigns WHERE id = '$CAMPAIGN_ID'),
    (SELECT COUNT(*) FROM campaign_recipients WHERE campaign_id = '$CAMPAIGN_ID')
\" 2>/dev/null" 2>&1)
echo "row counts (campaigns|recipients): $COUNTS"
if echo "$COUNTS" | grep -q "^1|"; then
    echo "PASS (campaign row exists)"
    pass=$((pass + 1))
else
    echo "FAIL"
    fail=$((fail + 1))
fi

# 6. cleanup — drop the test campaign so the jobs stop retrying
ssh nexamail "sudo -u postgres psql -d nexamail -c \"DELETE FROM campaigns WHERE id = '$CAMPAIGN_ID'\" >/dev/null 2>&1" || true
echo

echo "==============="
echo "passed: $pass"
echo "failed: $fail"
echo "==============="
[ "$fail" -eq 0 ] || exit 1
