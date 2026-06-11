import { Suspense } from "react";
import Link from "next/link";
import { listAccountsAction } from "@/app/shell/actions";
import { AccountSwitcher } from "@/components/shell/AccountSwitcher";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { ShellKeyboardShortcuts } from "@/components/shell/ShellKeyboardShortcuts";

const NAV_FOLDERS = [
  { href: "/inbox", label: "Inbox" },
  { href: "/contacts", label: "Contacts" },
  { href: "/briefing", label: "Briefing" },
  { href: "/sent", label: "Sent" },
  { href: "/drafts", label: "Drafts" },
  { href: "/spam", label: "Spam" },
  { href: "/trash", label: "Trash" },
  { href: "/archive", label: "Archive" },
];

export default async function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const accountsResult = await listAccountsAction();
  const accounts = accountsResult.accounts;

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Shell-wide keyboard shortcuts (client, renders nothing) */}
      <ShellKeyboardShortcuts />
      {/* Global command palette — opened by Cmd/Ctrl+K */}
      <Suspense fallback={null}>
        <CommandPalette accounts={accounts} />
      </Suspense>
      {/* Persistent navy sidebar */}
      <aside className="w-52 flex-shrink-0 bg-brand-navy text-white flex flex-col pt-5 pb-4 gap-0">
        {/* Brand wordmark */}
        <div className="px-4 pb-3 text-lg font-semibold text-brand-amber tracking-tight">
          <Link href="/inbox" prefetch={false} className="hover:opacity-80 transition">
            VoxMail
          </Link>
        </div>

        {/* Account switcher — Suspense required because AccountSwitcher uses useSearchParams */}
        <Suspense fallback={null}>
          <AccountSwitcher initialAccounts={accounts} />
        </Suspense>

        {/* Compose CTA */}
        <div className="px-3 pb-3">
          <Link
            href="/compose"
            prefetch={false}
            className="flex items-center justify-center gap-1.5 w-full px-3 py-1.5 text-sm rounded bg-brand-amber text-brand-navy font-semibold hover:opacity-90 transition"
          >
            <span aria-hidden="true">+</span>
            Compose
          </Link>
        </div>

        {/* Folder nav */}
        <nav className="flex flex-col gap-0.5 flex-1" aria-label="Folders">
          {NAV_FOLDERS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              prefetch={false}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-md mx-2 text-left text-white/80 hover:bg-white/10 transition"
            >
              {label}
            </Link>
          ))}
        </nav>

        {/* Bottom links */}
        <div className="flex flex-col gap-0.5 mt-auto px-2 pt-2 border-t border-white/10">
          <Link
            href="/settings/signatures"
            prefetch={false}
            className="flex items-center gap-2 px-3 py-2 text-xs rounded-md text-white/60 hover:bg-white/10 hover:text-white/90 transition"
          >
            Settings
          </Link>
          <Link
            href="/campaigns/new"
            prefetch={false}
            className="flex items-center gap-2 px-3 py-2 text-xs rounded-md text-white/60 hover:bg-white/10 hover:text-white/90 transition"
          >
            Campaigns
          </Link>
          <Link
            href="/admin/domains"
            prefetch={false}
            className="flex items-center gap-2 px-3 py-2 text-xs rounded-md text-white/60 hover:bg-white/10 hover:text-white/90 transition"
          >
            Domains
          </Link>
        </div>
      </aside>

      {/* Main content area — overflow-y-auto lets settings/compose scroll; InboxView uses h-full internally */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
