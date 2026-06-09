import { CampaignForm } from "@/components/campaigns/CampaignForm";

export const dynamic = "force-dynamic";

export default function NewCampaignPage() {
  return (
    <main className="min-h-screen max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-semibold text-brand-navy mb-2">
        New campaign
      </h1>
      <p className="text-sm text-gray-600 mb-6">
        Each recipient gets an individual email (never BCC). Sends are rate
        limited to <strong>10/min</strong> to protect sender reputation.
      </p>
      <CampaignForm />
    </main>
  );
}
