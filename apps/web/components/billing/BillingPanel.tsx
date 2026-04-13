"use client";

import { useState, useTransition } from "react";
import {
  startCheckoutAction,
  type Plan,
  type PlanTier,
} from "@/app/settings/billing/actions";

const PLAN_CATALOG: ReadonlyArray<{
  tier: PlanTier;
  label: string;
  price: string;
  features: string[];
  checkoutable: boolean;
}> = [
  {
    tier: "free",
    label: "Free",
    price: "$0 / month",
    features: ["1 mailbox", "Send + reply", "No AI features"],
    checkoutable: false,
  },
  {
    tier: "starter",
    label: "Starter",
    price: "$29 / month",
    features: [
      "3 mailboxes",
      "Thread summaries",
      "CRM context sidebar",
      "Click-to-log activities",
    ],
    checkoutable: true,
  },
  {
    tier: "pro",
    label: "Pro",
    price: "$79 / month",
    features: [
      "10 mailboxes",
      "Everything in Starter",
      "Voice-to-email",
      "Mass-send campaigns",
    ],
    checkoutable: true,
  },
  {
    tier: "enterprise",
    label: "Enterprise",
    price: "Contact sales",
    features: ["Unlimited mailboxes", "SSO, audit, SLA", "Custom onboarding"],
    checkoutable: false,
  },
];

export function BillingPanel({ plan }: { plan: Plan }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleUpgrade = (tier: "starter" | "pro") => {
    setError(null);
    startTransition(async () => {
      const res = await startCheckoutAction(tier);
      if (res.ok) {
        window.location.href = res.url;
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="border rounded-lg p-4 bg-gray-50">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-600">Current plan</div>
            <div className="text-xl font-semibold text-brand-navy capitalize">
              {plan.plan_tier}
            </div>
          </div>
          <div className="text-right text-sm">
            <div>
              <span className="text-gray-600">Mailboxes:</span>{" "}
              <span className="font-semibold">{plan.mailboxes_used}</span>
            </div>
            <div>
              <span className="text-gray-600">AI calls this month:</span>{" "}
              <span className="font-semibold">{plan.ai_calls_this_month}</span>
            </div>
          </div>
        </div>
        {plan.period_end && (
          <div className="text-xs text-gray-500 mt-2">
            Current period ends:{" "}
            {new Date(plan.period_end).toLocaleDateString()}
          </div>
        )}
      </section>

      {error && (
        <div className="text-sm text-red-700">Error: {error}</div>
      )}

      <section>
        <h2 className="text-lg font-semibold mb-3">All plans</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {PLAN_CATALOG.map((p) => {
            const isCurrent = p.tier === plan.plan_tier;
            return (
              <div
                key={p.tier}
                className={`border rounded-lg p-4 flex flex-col gap-3 ${
                  isCurrent ? "border-brand-amber" : "border-gray-200"
                }`}
              >
                <div className="flex items-baseline justify-between">
                  <div className="text-lg font-semibold text-brand-navy">
                    {p.label}
                  </div>
                  <div className="text-sm text-gray-600">{p.price}</div>
                </div>
                <ul className="text-sm text-gray-700 list-disc pl-5 space-y-1">
                  {p.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                <div className="mt-auto">
                  {isCurrent ? (
                    <div className="inline-block px-3 py-1 rounded bg-brand-amber text-brand-navy text-xs font-semibold">
                      Your plan
                    </div>
                  ) : p.checkoutable ? (
                    <button
                      type="button"
                      onClick={() => handleUpgrade(p.tier as "starter" | "pro")}
                      disabled={isPending}
                      className="px-4 py-2 rounded bg-brand-amber text-brand-navy text-sm font-semibold hover:opacity-90 transition disabled:opacity-50"
                    >
                      {isPending ? "Redirecting…" : `Upgrade to ${p.label}`}
                    </button>
                  ) : p.tier === "enterprise" ? (
                    <a
                      href="mailto:sales@voxtn.com?subject=VoxMail%20Enterprise%20inquiry"
                      className="inline-block px-4 py-2 rounded border border-brand-navy text-brand-navy text-sm font-semibold hover:bg-gray-50"
                    >
                      Contact sales
                    </a>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
