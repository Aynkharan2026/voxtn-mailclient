"use client";

import { useState, useTransition } from "react";
import {
  createTenantAction,
  listTenantsAction,
  updateTenantBrandingAction,
  type Tenant,
} from "@/app/admin/tenants/actions";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

type PlanTier = Tenant["plan_tier"];

export function TenantManager({ initial }: { initial: Tenant[] }) {
  const [tenants, setTenants] = useState<Tenant[]>(initial);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [planTier, setPlanTier] = useState<PlanTier>("free");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const refresh = async () => {
    const res = await listTenantsAction();
    if (res.ok) setTenants(res.tenants);
  };

  const handleCreate = () => {
    if (!SLUG_RE.test(slug)) {
      setError("slug must be lowercase letters/digits/dashes, max 63 chars");
      return;
    }
    if (!name.trim()) {
      setError("name required");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await createTenantAction({
        slug,
        name: name.trim(),
        plan_tier: planTier,
      });
      if (res.ok) {
        setSlug("");
        setName("");
        setPlanTier("free");
        await refresh();
      } else {
        setError(res.error);
      }
    });
  };

  const handleColor = (t: Tenant) => {
    const next = window.prompt(
      `Primary color for ${t.slug} (current: ${t.primary_color}). Use #RRGGBB hex.`,
      t.primary_color,
    );
    if (!next) return;
    if (!HEX_RE.test(next)) {
      setError(`invalid hex '${next}' — use #RRGGBB`);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await updateTenantBrandingAction(t.slug, {
        primary_color: next,
      });
      if (res.ok) await refresh();
      else setError(res.error);
    });
  };

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="text-lg font-semibold mb-3">All tenants</h2>
        {tenants.length === 0 ? (
          <p className="text-sm text-gray-500">No tenants yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {tenants.map((t) => (
              <li
                key={t.id}
                className="border rounded p-3 flex items-center gap-4"
              >
                <div
                  className="w-8 h-8 rounded border shrink-0"
                  style={{ backgroundColor: t.primary_color }}
                  aria-label={`swatch ${t.primary_color}`}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-brand-navy">
                    {t.name}{" "}
                    <span className="font-mono text-xs text-gray-500">
                      /{t.slug}
                    </span>
                  </div>
                  <div className="text-xs text-gray-600 flex gap-3 mt-1">
                    <span className="capitalize">
                      <strong>{t.plan_tier}</strong>
                    </span>
                    <span className="font-mono">{t.primary_color}</span>
                    {t.custom_domain && (
                      <span className="font-mono">{t.custom_domain}</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleColor(t)}
                  disabled={isPending}
                  className="text-sm text-brand-amber hover:underline disabled:opacity-50"
                >
                  Change color
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">New tenant</h2>
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-3 border-b pb-2">
            <span className="text-sm font-medium text-gray-600 w-24">Slug</span>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              placeholder="acme-realty"
              className="flex-1 outline-none bg-transparent font-mono"
              disabled={isPending}
            />
          </label>
          <label className="flex items-center gap-3 border-b pb-2">
            <span className="text-sm font-medium text-gray-600 w-24">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Realty"
              className="flex-1 outline-none bg-transparent"
              disabled={isPending}
            />
          </label>
          <label className="flex items-center gap-3 border-b pb-2">
            <span className="text-sm font-medium text-gray-600 w-24">
              Plan tier
            </span>
            <select
              value={planTier}
              onChange={(e) => setPlanTier(e.target.value as PlanTier)}
              className="flex-1 outline-none bg-transparent"
              disabled={isPending}
            >
              <option value="free">Free</option>
              <option value="starter">Starter</option>
              <option value="pro">Pro</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </label>
          {error && (
            <div className="text-sm text-red-700">Error: {error}</div>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleCreate}
              disabled={isPending || !slug.trim() || !name.trim()}
              className="px-5 py-2 rounded bg-brand-amber text-brand-navy font-medium hover:opacity-90 transition disabled:opacity-50"
            >
              Create tenant
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
