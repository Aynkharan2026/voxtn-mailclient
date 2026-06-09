"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { Account } from "@/app/shell/actions";

const COOKIE_NAME = "voxmail_account";

function readCookieAccount(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)voxmail_account=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookieAccount(email: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(email)}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`;
}

export function AccountSwitcher({
  initialAccounts,
}: {
  initialAccounts: Account[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  // Determine the active account from URL param > cookie > first account
  const urlAccount = searchParams.get("account");
  const [activeEmail, setActiveEmail] = useState<string>(() => {
    if (urlAccount) return urlAccount;
    if (typeof document !== "undefined") {
      const c = readCookieAccount();
      if (c) return c;
    }
    return initialAccounts[0]?.email_address ?? "";
  });

  // On mount, reconcile cookie with URL
  useEffect(() => {
    const cookieAccount = readCookieAccount();
    const resolved = urlAccount ?? cookieAccount ?? initialAccounts[0]?.email_address ?? "";
    setActiveEmail(resolved);
    // Ensure cookie is set
    if (resolved) writeCookieAccount(resolved);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync active when URL changes
  useEffect(() => {
    if (urlAccount && urlAccount !== activeEmail) {
      setActiveEmail(urlAccount);
      writeCookieAccount(urlAccount);
    }
  }, [urlAccount]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleChange(email: string) {
    setActiveEmail(email);
    writeCookieAccount(email);
    // Navigate to current path with ?account= set (preserves folder route)
    const params = new URLSearchParams(searchParams.toString());
    params.set("account", email);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  if (initialAccounts.length === 0) return null;

  const active = initialAccounts.find((a) => a.email_address === activeEmail) ?? initialAccounts[0];

  return (
    <div className="px-2 pb-3" data-testid="account-switcher">
      <select
        value={active.email_address}
        onChange={(e) => handleChange(e.target.value)}
        className="w-full text-xs bg-white/10 text-white border border-white/20 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-amber cursor-pointer appearance-none"
        aria-label="Switch account"
      >
        {initialAccounts.map((acct) => (
          <option
            key={acct.email_address}
            value={acct.email_address}
            data-testid="account-option"
            className="bg-brand-navy text-white"
          >
            {acct.display_name !== acct.email_address
              ? `${acct.display_name} <${acct.email_address}>`
              : acct.email_address}
          </option>
        ))}
      </select>
    </div>
  );
}
