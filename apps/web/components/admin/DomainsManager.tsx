"use client";

import { useState, useTransition } from "react";
import {
  listDomainsAction,
  getDomainRecordsAction,
  onboardDomainAction,
} from "@/app/(shell)/admin/domains/actions";
import { computeDnsRecords } from "@/lib/dns-records";
import type { DkimInfo, DnsRecord } from "@/lib/dns-records";

// ---- helpers ---------------------------------------------------------------

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {
    /* ignore — best-effort */
  });
}

// ---- sub-components --------------------------------------------------------

function RecordRow({ rec }: { rec: DnsRecord }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    copyToClipboard(rec.value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <tr className="border-b border-gray-100 last:border-0">
      <td className="py-2 pr-3 font-mono text-xs text-brand-navy whitespace-nowrap">
        {rec.type}
      </td>
      <td className="py-2 pr-3 font-mono text-xs text-gray-700 break-all max-w-xs">
        {rec.name}
      </td>
      <td className="py-2 pr-3 font-mono text-xs text-gray-700 break-all max-w-sm">
        {rec.value.split("\n").map((line, i) => (
          <span key={i} className="block">
            {line}
          </span>
        ))}
      </td>
      <td className="py-2 pr-3 text-xs text-gray-500 whitespace-nowrap">
        {rec.ttl}
      </td>
      <td className="py-2 pr-3 text-xs whitespace-nowrap">
        {rec.proxy === "grey-cloud" ? (
          <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
            ☁ DNS-only
          </span>
        ) : (
          <span className="text-gray-400">n/a</span>
        )}
      </td>
      <td className="py-2">
        <button
          type="button"
          onClick={handleCopy}
          className="text-xs text-brand-navy underline hover:opacity-70 transition"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </td>
    </tr>
  );
}

interface DnsDisclosureProps {
  domain: string;
  initialDkim?: DkimInfo | null;
}

function DnsDisclosure({ domain, initialDkim }: DnsDisclosureProps) {
  const [open, setOpen] = useState(false);
  const [dkim, setDkim] = useState<DkimInfo | null>(initialDkim ?? null);
  const [loading, setLoading] = useState(false);
  const [fetchErr, setFetchErr] = useState<string | null>(null);

  const handleOpen = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (!dkim) {
      setLoading(true);
      setFetchErr(null);
      const res = await getDomainRecordsAction(domain);
      setLoading(false);
      if (res.ok) {
        setDkim(res.dkim);
      } else {
        setFetchErr(res.error);
      }
    }
  };

  const records: DnsRecord[] = dkim ? computeDnsRecords(domain, dkim) : [];

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={handleOpen}
        className="text-sm text-brand-navy underline hover:opacity-70 transition"
        aria-expanded={open}
      >
        {open ? "Hide" : "Show"} DNS records
      </button>

      {open && (
        <div className="mt-3">
          {/* Grey-cloud warning */}
          <div
            data-testid="greycloud-warning"
            className="mb-3 flex items-start gap-2 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <span aria-hidden="true" className="mt-0.5 shrink-0 text-base">
              ⚠️
            </span>
            <span>
              In Cloudflare set the mail records (A{" "}
              <code className="font-mono">mail.{domain}</code>, MX target,
              autodiscover/autoconfig CNAMEs) to{" "}
              <strong>DNS-only (grey cloud)</strong> — proxying breaks
              SMTP/IMAP. SPF/DKIM/DMARC TXT are unaffected. PTR is set at the
              VPS (shared host = mail.voxtn.com).
            </span>
          </div>

          {loading && (
            <p className="text-xs text-gray-500">Loading DKIM record…</p>
          )}
          {fetchErr && (
            <p className="text-xs text-red-600">
              Could not load DKIM: {fetchErr}
            </p>
          )}

          {records.length > 0 && (
            <div className="overflow-x-auto rounded border border-gray-200">
              <table
                data-testid="dns-records"
                className="min-w-full text-left"
              >
                <thead className="bg-gray-50">
                  <tr>
                    {["Type", "Name", "Value", "TTL", "Proxy", ""].map(
                      (h) => (
                        <th
                          key={h}
                          className="px-2 py-1.5 text-xs font-medium text-gray-500 uppercase tracking-wide"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {records.map((rec, i) => (
                    <RecordRow key={i} rec={rec} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- main component --------------------------------------------------------

interface DomainsManagerProps {
  initial: string[];
}

export function DomainsManager({ initial }: DomainsManagerProps) {
  const [domains, setDomains] = useState<string[]>(initial);
  const [newDomain, setNewDomain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const refresh = async () => {
    const res = await listDomainsAction();
    if (res.ok) setDomains(res.domains);
  };

  const handleOnboard = () => {
    const domain = newDomain.trim().toLowerCase();
    if (!domain) {
      setError("Enter a domain name.");
      return;
    }
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      const res = await onboardDomainAction(domain);
      if (res.ok) {
        setSuccess(`${domain} onboarded. DKIM key generated.`);
        setNewDomain("");
        await refresh();
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Onboard form */}
      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="new-domain"
            className="text-xs font-medium text-gray-700"
          >
            Domain
          </label>
          <input
            id="new-domain"
            type="text"
            placeholder="example.com"
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleOnboard();
            }}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-navy focus:outline-none"
          />
        </div>
        <button
          type="button"
          data-testid="onboard-domain-btn"
          onClick={handleOnboard}
          disabled={isPending}
          className="rounded bg-brand-navy px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 transition disabled:opacity-50"
        >
          {isPending ? "Onboarding…" : "Onboard domain"}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}
      {success && (
        <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
          {success}
        </p>
      )}

      {/* Domain list */}
      {domains.length === 0 ? (
        <p className="text-sm text-gray-500">No domains onboarded yet.</p>
      ) : (
        <ul className="space-y-4">
          {domains.map((domain) => (
            <li
              key={domain}
              className="rounded border border-gray-200 bg-white px-4 py-3 shadow-sm"
            >
              <p className="font-mono text-sm font-semibold text-brand-navy">
                {domain}
              </p>
              <DnsDisclosure domain={domain} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
