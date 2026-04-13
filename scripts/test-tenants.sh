#!/usr/bin/env bash
# Integration test for Phase 6 Step 2 — tenant provisioning + whitelabel API.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

TOKEN="$(grep -E '^INTERNAL_SERVICE_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
BASE="${VOXMAIL_AI_URL:-https://ai.nexamail.voxtn.com}"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

TAG="$(date +%s)"
SLUG="ttest-${TAG}"
NAME="Tenant Test ${TAG}"

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
# 1. Seeded tenants exist
# ============================================================
status=$(curl -sS "$BASE/tenants" -H "Authorization: Bearer $TOKEN" \
    -o "$TMP" -w '%{http_code}')
check_status "GET /tenants → 200" 200 "$status"

for s in voxtn carvia realtorsuba; do
    if grep -q "\"slug\":\"$s\"" "$TMP"; then
        echo "  PASS ($s seeded)"; pass=$((pass + 1))
    else
        echo "  FAIL ($s missing)"; fail=$((fail + 1))
    fi
done
echo

# ============================================================
# 2. Seeded tenant plan tiers
# ============================================================
status=$(curl -sS "$BASE/tenants/voxtn" -H "Authorization: Bearer $TOKEN" \
    -o "$TMP" -w '%{http_code}')
check_status "GET /tenants/voxtn → 200" 200 "$status"
if grep -q '"plan_tier":"enterprise"' "$TMP"; then
    echo "PASS (voxtn is enterprise)"; pass=$((pass + 1))
else
    echo "FAIL (voxtn should be enterprise)"; fail=$((fail + 1))
fi
echo

status=$(curl -sS "$BASE/tenants/carvia" -H "Authorization: Bearer $TOKEN" \
    -o "$TMP" -w '%{http_code}')
if grep -q '"plan_tier":"pro"' "$TMP"; then
    echo "--- carvia plan_tier ---"
    echo "PASS (carvia is pro)"; pass=$((pass + 1))
else
    echo "FAIL"; fail=$((fail + 1))
fi
echo

# ============================================================
# 3. Create tenant → 201
# ============================================================
status=$(curl -sS -X POST "$BASE/tenants" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"slug\":\"$SLUG\",\"name\":\"$NAME\",\"plan_tier\":\"starter\"}" \
    -o "$TMP" -w '%{http_code}')
check_status "POST /tenants → 201" 201 "$status"

# ============================================================
# 4. Duplicate slug → 409
# ============================================================
status=$(curl -sS -X POST "$BASE/tenants" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"slug\":\"$SLUG\",\"name\":\"dup\"}" \
    -o "$TMP" -w '%{http_code}')
check_status "POST /tenants duplicate slug → 409" 409 "$status"

# ============================================================
# 5. Invalid slug → 400
# ============================================================
status=$(curl -sS -X POST "$BASE/tenants" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"slug\":\"Bad Slug!\",\"name\":\"x\"}" \
    -o "$TMP" -w '%{http_code}')
check_status "POST /tenants bad slug → 400" 400 "$status"

# ============================================================
# 6. PUT /tenants/:slug update primary_color
# ============================================================
status=$(curl -sS -X PUT "$BASE/tenants/$SLUG" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"primary_color":"#1e40af"}' \
    -o "$TMP" -w '%{http_code}')
check_status "PUT /tenants/... primary_color → 200" 200 "$status"
if grep -q '"primary_color":"#1e40af"' "$TMP"; then
    echo "PASS (color updated in response)"; pass=$((pass + 1))
else
    echo "FAIL"; fail=$((fail + 1))
fi
echo

# ============================================================
# 7. GET /tenants/:slug reflects update
# ============================================================
status=$(curl -sS "$BASE/tenants/$SLUG" -H "Authorization: Bearer $TOKEN" \
    -o "$TMP" -w '%{http_code}')
if grep -q '"primary_color":"#1e40af"' "$TMP"; then
    echo "--- color persisted ---"
    echo "PASS"; pass=$((pass + 1))
else
    echo "FAIL"; fail=$((fail + 1))
fi
echo

# ============================================================
# 8. PUT invalid hex → 400
# ============================================================
status=$(curl -sS -X PUT "$BASE/tenants/$SLUG" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"primary_color":"not-a-color"}' \
    -o "$TMP" -w '%{http_code}')
check_status "PUT invalid hex → 400" 400 "$status"

# ============================================================
# 9. PUT empty body → 400
# ============================================================
status=$(curl -sS -X PUT "$BASE/tenants/$SLUG" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{}' \
    -o "$TMP" -w '%{http_code}')
check_status "PUT empty body → 400" 400 "$status"

# ============================================================
# 10. GET unknown slug → 404
# ============================================================
status=$(curl -sS "$BASE/tenants/does-not-exist-$TAG" \
    -H "Authorization: Bearer $TOKEN" \
    -o "$TMP" -w '%{http_code}')
check_status "GET unknown tenant → 404" 404 "$status"

# ============================================================
# 11. GET /tenants without auth → 401
# ============================================================
status=$(curl -sS "$BASE/tenants" -o "$TMP" -w '%{http_code}')
check_status "GET /tenants without auth → 401" 401 "$status"

# ============================================================
# cleanup
# ============================================================
ssh nexamail "sudo -u postgres psql -d nexamail -c \"
DELETE FROM tenants WHERE slug = '$SLUG';
\" >/dev/null 2>&1" || true

echo "==============="
echo "passed: $pass"
echo "failed: $fail"
echo "==============="
[ "$fail" -eq 0 ] || exit 1
