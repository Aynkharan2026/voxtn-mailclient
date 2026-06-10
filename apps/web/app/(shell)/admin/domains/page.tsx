import { listDomainsAction } from "./actions";
import { DomainsManager } from "@/components/admin/DomainsManager";

export const dynamic = "force-dynamic";

export default async function AdminDomainsPage() {
  const res = await listDomainsAction();
  const initial = res.ok ? res.domains : [];
  const loadError = res.ok ? null : res.error;

  return (
    <main className="min-h-screen max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-semibold text-brand-navy mb-2">
        Domain Onboarding
      </h1>
      <p className="text-sm text-gray-600 mb-6">
        Add a domain to the shared mail host (mail.voxtn.com) and generate its
        DKIM key. After onboarding, publish the 7 DNS records shown below in
        your DNS provider.
      </p>
      {loadError && (
        <div className="text-sm text-red-700 mb-4">
          Could not load domains: {loadError}
        </div>
      )}
      <DomainsManager initial={initial} />
    </main>
  );
}
