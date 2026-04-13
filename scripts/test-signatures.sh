#!/usr/bin/env bash
# End-to-end signatures CRUD test against voxmail-ai.
# Creates two signatures, toggles default, updates, deletes. Asserts statuses.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

TOKEN="$(grep -E '^INTERNAL_SERVICE_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
BASE="${VOXMAIL_AI_URL:-https://ai.nexamail.voxtn.com}"
EMAIL="sigtest+$(date +%s)@voxmail.test"
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
        echo "body: $(cat "$TMP")"
        fail=$((fail + 1))
    fi
    echo
}

urlenc() {
    # minimal: @ → %40, + → %2B
    echo -n "$1" | sed 's/@/%40/g; s/+/%2B/g'
}

E=$(urlenc "$EMAIL")

# 1. list empty
status=$(curl -sS -o "$TMP" -w '%{http_code}' \
    -H "Authorization: Bearer $TOKEN" \
    "$BASE/signatures?email=$E")
check_status "GET /signatures empty" 200 "$status"
[ "$(cat "$TMP")" = "[]" ] || { echo "expected empty list, got: $(cat "$TMP")"; fail=$((fail+1)); }
echo

# 2. create signature A (default)
status=$(curl -sS -o "$TMP" -w '%{http_code}' \
    -X POST "$BASE/signatures" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"owner_email\":\"$EMAIL\",\"name\":\"Work\",\"html_content\":\"<p>-- <br>Alice</p>\",\"is_default\":true}")
check_status "POST /signatures (default=true)" 201 "$status"
SIG_A=$(sed -n 's/.*"id":"\([^"]*\)".*/\1/p' "$TMP")
echo "sig A id: $SIG_A"
echo

# 3. create signature B (not default)
status=$(curl -sS -o "$TMP" -w '%{http_code}' \
    -X POST "$BASE/signatures" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"owner_email\":\"$EMAIL\",\"name\":\"Personal\",\"html_content\":\"<p>Cheers, Alice</p>\"}")
check_status "POST /signatures (default=false)" 201 "$status"
SIG_B=$(sed -n 's/.*"id":"\([^"]*\)".*/\1/p' "$TMP")
echo "sig B id: $SIG_B"
echo

# 4. list returns 2
status=$(curl -sS -o "$TMP" -w '%{http_code}' \
    -H "Authorization: Bearer $TOKEN" \
    "$BASE/signatures?email=$E")
check_status "GET /signatures returns 2" 200 "$status"
count=$(grep -o '"id":' "$TMP" | wc -l | tr -d ' ')
if [ "$count" = "2" ]; then echo "count=2 PASS"; pass=$((pass+1)); else echo "count=$count FAIL"; fail=$((fail+1)); fi
echo

# 5. set B as default (A should auto-undefault)
status=$(curl -sS -o "$TMP" -w '%{http_code}' \
    -X POST "$BASE/signatures/$SIG_B/set-default" \
    -H "Authorization: Bearer $TOKEN")
check_status "POST /signatures/{B}/set-default" 200 "$status"

# 6. verify only B is default
status=$(curl -sS -o "$TMP" -w '%{http_code}' \
    -H "Authorization: Bearer $TOKEN" \
    "$BASE/signatures?email=$E")
defaults=$(grep -o '"is_default":true' "$TMP" | wc -l | tr -d ' ')
echo "--- exactly one default after set-default ---"
if [ "$defaults" = "1" ]; then echo "PASS"; pass=$((pass+1)); else echo "FAIL (got $defaults)"; fail=$((fail+1)); fi
echo

# 7. update A's name
status=$(curl -sS -o "$TMP" -w '%{http_code}' \
    -X PUT "$BASE/signatures/$SIG_A" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"Work (renamed)"}')
check_status "PUT /signatures/{A} renames" 200 "$status"

# 8. delete A
status=$(curl -sS -o "$TMP" -w '%{http_code}' \
    -X DELETE "$BASE/signatures/$SIG_A" \
    -H "Authorization: Bearer $TOKEN")
check_status "DELETE /signatures/{A}" 204 "$status"

# 9. delete A again → 404
status=$(curl -sS -o "$TMP" -w '%{http_code}' \
    -X DELETE "$BASE/signatures/$SIG_A" \
    -H "Authorization: Bearer $TOKEN")
check_status "DELETE /signatures/{A} again" 404 "$status"

# 10. delete B (cleanup)
status=$(curl -sS -o "$TMP" -w '%{http_code}' \
    -X DELETE "$BASE/signatures/$SIG_B" \
    -H "Authorization: Bearer $TOKEN")
check_status "DELETE /signatures/{B} cleanup" 204 "$status"

echo "==============="
echo "passed: $pass"
echo "failed: $fail"
echo "==============="

[ "$fail" -eq 0 ] || exit 1
