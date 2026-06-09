import { getCurrentPlanAction } from "./actions";
import { BillingPanel } from "@/components/billing/BillingPanel";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const res = await getCurrentPlanAction();
  const plan = res.ok
    ? res.plan
    : {
        email: "",
        plan_tier: "free" as const,
        mailboxes_used: 0,
        ai_calls_this_month: 0,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        period_start: null,
        period_end: null,
      };
  const loadError = res.ok ? null : res.error;

  return (
    <main className="min-h-screen max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-semibold text-brand-navy mb-2">Billing</h1>
      {loadError && (
        <div className="text-sm text-red-700 mb-4">
          Couldn&apos;t load plan: {loadError}
        </div>
      )}
      <BillingPanel plan={plan} />
    </main>
  );
}
