#!/usr/bin/env bash
# Integration test for Phase 6 Step 1 — Stripe billing + feature gates.
# Skips Stripe API-dependent flows (Checkout session creation) when
# STRIPE_SECRET_KEY isn't configured; exercises the webhook signature
# path, feature gate enforcement, and DB state transitions.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

TOKEN="$(grep -E '^INTERNAL_SERVICE_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
WEBHOOK_SECRET="$(grep -E '^STRIPE_WEBHOOK_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
AI_BASE="${VOXMAIL_AI_URL:-https://ai.nexamail.voxtn.com}"
IMAP_BASE="${VOXMAIL_IMAP_URL:-https://imap.nexamail.voxtn.com}"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

TAG="$(date +%s)"
FREE_EMAIL="free-${TAG}@example.test"
STARTER_EMAIL="starter-${TAG}@example.test"
PRO_EMAIL="pro-${TAG}@example.test"

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
# 1. GET /billing/plan for unknown email → 200 free
# ============================================================
status=$(curl -sS "$AI_BASE/billing/plan?email=$FREE_EMAIL" \
    -H "Authorization: Bearer $TOKEN" \
    -o "$TMP" -w '%{http_code}')
check_status "GET /billing/plan unknown email → 200" 200 "$status"
if grep -q '"plan_tier":"free"' "$TMP"; then
    echo "PASS (tier=free by default)"; pass=$((pass + 1))
else
    echo "FAIL (expected plan_tier=free)"; fail=$((fail + 1))
fi
echo

# ============================================================
# 2. Stripe webhook — no signature → 400
# ============================================================
status=$(curl -sS -X POST "$AI_BASE/stripe/webhook" \
    -H "Content-Type: application/json" \
    -d '{}' -o "$TMP" -w '%{http_code}')
check_status "POST /stripe/webhook no signature → 400" 400 "$status"

# ============================================================
# 3. Stripe webhook — bad signature → 400
# ============================================================
status=$(curl -sS -X POST "$AI_BASE/stripe/webhook" \
    -H "Content-Type: application/json" \
    -H "Stripe-Signature: t=1,v1=baaaaad" \
    -d '{}' -o "$TMP" -w '%{http_code}')
check_status "POST /stripe/webhook bad signature → 400" 400 "$status"

if [ -z "$WEBHOOK_SECRET" ]; then
    echo "SKIP — STRIPE_WEBHOOK_SECRET not set; cannot sign valid webhook events"
    echo
else
    # ============================================================
    # 4. Valid signed webhook — checkout.session.completed → upgrades to starter
    # ============================================================
    TS=$(date +%s)
    EVENT_JSON=$(cat <<EOF
{"id":"evt_test_${TAG}","type":"checkout.session.completed","data":{"object":{"customer":"cus_test_${TAG}","subscription":"sub_test_${TAG}","customer_email":"${STARTER_EMAIL}","metadata":{"plan_tier":"starter","owner_email":"${STARTER_EMAIL}"}}}}
EOF
)
    SIG=$(node -e "
const crypto = require('crypto');
const secret = process.argv[1];
const ts = process.argv[2];
const payload = process.argv[3];
const signedPayload = ts + '.' + payload;
const sig = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
console.log('t=' + ts + ',v1=' + sig);
" "$WEBHOOK_SECRET" "$TS" "$EVENT_JSON")

    status=$(curl -sS -X POST "$AI_BASE/stripe/webhook" \
        -H "Content-Type: application/json" \
        -H "Stripe-Signature: $SIG" \
        -d "$EVENT_JSON" -o "$TMP" -w '%{http_code}')
    check_status "POST /stripe/webhook valid signed checkout.session.completed → 200" 200 "$status"

    # ============================================================
    # 5. GET /billing/plan for the upgraded user → starter
    # ============================================================
    status=$(curl -sS "$AI_BASE/billing/plan?email=$STARTER_EMAIL" \
        -H "Authorization: Bearer $TOKEN" \
        -o "$TMP" -w '%{http_code}')
    check_status "GET /billing/plan upgraded user → 200" 200 "$status"
    if grep -q '"plan_tier":"starter"' "$TMP"; then
        echo "PASS (plan_tier=starter after checkout)"; pass=$((pass + 1))
    else
        echo "FAIL"; echo "body: $(cat "$TMP")"; fail=$((fail + 1))
    fi
    echo

    # ============================================================
    # 6. Seed a 'pro' tier user via direct INSERT (simulates a second
    #    successful webhook) for the gate tests below.
    # ============================================================
    ssh nexamail "sudo -u postgres psql -d nexamail -c \"
        INSERT INTO billing_usage (owner_email, plan_tier, stripe_customer_id, stripe_subscription_id)
        VALUES ('$PRO_EMAIL', 'pro', 'cus_prosim_${TAG}', 'sub_prosim_${TAG}')
    \" >/dev/null 2>&1"

    # ============================================================
    # 7. Feature gate: free user → /crm/context 402
    # ============================================================
    status=$(curl -sS "$AI_BASE/crm/context?email=alice%40example.com" \
        -H "Authorization: Bearer $TOKEN" \
        -H "X-Voxmail-User: $FREE_EMAIL" \
        -o "$TMP" -w '%{http_code}')
    check_status "CRM gate: free tier → 402" 402 "$status"

    # ============================================================
    # 8. Feature gate: starter user → /crm/context 200 (starter allows CRM)
    # ============================================================
    status=$(curl -sS "$AI_BASE/crm/context?email=alice%40example.com" \
        -H "Authorization: Bearer $TOKEN" \
        -H "X-Voxmail-User: $STARTER_EMAIL" \
        -o "$TMP" -w '%{http_code}')
    check_status "CRM gate: starter tier → 200" 200 "$status"

    # ============================================================
    # 9. Feature gate: campaigns blocked for starter (needs pro)
    # ============================================================
    status=$(curl -sS -X POST "$IMAP_BASE/campaigns" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -H "X-Voxmail-User: $STARTER_EMAIL" \
        -d "{\"name\":\"billing gate test\",\"subject\":\"x\",\"html\":\"<p>x</p>\",\"recipients\":[\"r@x.test\"],\"smtp\":{\"host\":\"localhost\",\"port\":1,\"secure\":false,\"user\":\"$STARTER_EMAIL\",\"pass\":\"y\"}}" \
        -o "$TMP" -w '%{http_code}')
    check_status "Campaigns gate: starter → 402" 402 "$status"

    # ============================================================
    # 10. Feature gate: pro user CAN hit /campaigns (201 with bogus SMTP)
    # ============================================================
    status=$(curl -sS -X POST "$IMAP_BASE/campaigns" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -H "X-Voxmail-User: $PRO_EMAIL" \
        -d "{\"name\":\"billing gate pro test\",\"subject\":\"x\",\"html\":\"<p>x</p>\",\"recipients\":[\"r@x.test\"],\"smtp\":{\"host\":\"localhost\",\"port\":1,\"secure\":false,\"user\":\"$PRO_EMAIL\",\"pass\":\"y\"}}" \
        -o "$TMP" -w '%{http_code}')
    check_status "Campaigns gate: pro → 201" 201 "$status"
    CAMP_ID=$(sed -n 's/.*"campaignId":"\([^"]*\)".*/\1/p' "$TMP")

    # ============================================================
    # 11. subscription.deleted webhook → downgrades to free
    # ============================================================
    TS=$(date +%s)
    EVENT_JSON=$(cat <<EOF
{"id":"evt_test_del_${TAG}","type":"customer.subscription.deleted","data":{"object":{"id":"sub_test_${TAG}","customer":"cus_test_${TAG}"}}}
EOF
)
    SIG=$(node -e "
const crypto = require('crypto');
const signedPayload = process.argv[2] + '.' + process.argv[3];
console.log('t=' + process.argv[2] + ',v1=' + crypto.createHmac('sha256', process.argv[1]).update(signedPayload).digest('hex'));
" "$WEBHOOK_SECRET" "$TS" "$EVENT_JSON")

    status=$(curl -sS -X POST "$AI_BASE/stripe/webhook" \
        -H "Content-Type: application/json" \
        -H "Stripe-Signature: $SIG" \
        -d "$EVENT_JSON" -o "$TMP" -w '%{http_code}')
    check_status "POST /stripe/webhook subscription.deleted → 200" 200 "$status"

    # ============================================================
    # 12. Plan after deletion → free
    # ============================================================
    status=$(curl -sS "$AI_BASE/billing/plan?email=$STARTER_EMAIL" \
        -H "Authorization: Bearer $TOKEN" \
        -o "$TMP" -w '%{http_code}')
    if grep -q '"plan_tier":"free"' "$TMP"; then
        echo "--- subscription.deleted downgraded to free ---"
        echo "PASS"; pass=$((pass + 1))
    else
        echo "--- subscription.deleted downgraded to free ---"
        echo "FAIL"; echo "body: $(cat "$TMP")"; fail=$((fail + 1))
    fi
    echo

    # cleanup
    ssh nexamail "sudo -u postgres psql -d nexamail -c \"
        DELETE FROM billing_usage WHERE owner_email IN ('$STARTER_EMAIL', '$PRO_EMAIL');
        ${CAMP_ID:+DELETE FROM campaigns WHERE id = '$CAMP_ID';}
    \" >/dev/null 2>&1" || true
fi

echo "==============="
echo "passed: $pass"
echo "failed: $fail"
echo "==============="
[ "$fail" -eq 0 ] || exit 1
