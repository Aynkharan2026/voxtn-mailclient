import { listTenantsAction } from "./actions";
import { TenantManager } from "@/components/admin/TenantManager";

export const dynamic = "force-dynamic";

export default async function AdminTenantsPage() {
  const res = await listTenantsAction();
  const initial = res.ok ? res.tenants : [];
  const loadError = res.ok ? null : res.error;

  return (
    <main className="min-h-screen max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-semibold text-brand-navy mb-2">Tenants</h1>
      <p className="text-sm text-gray-600 mb-6">
        Whitelabel customers. Each tenant gets its own slug, branding, and
        plan tier. The deployed apps/web instance picks its tenant via the
        <code className="mx-1 font-mono">NEXT_PUBLIC_TENANT_SLUG</code>
        env var.
      </p>
      {loadError && (
        <div className="text-sm text-red-700 mb-4">
          Couldn&apos;t load tenants: {loadError}
        </div>
      )}
      <TenantManager initial={initial} />
    </main>
  );
}
