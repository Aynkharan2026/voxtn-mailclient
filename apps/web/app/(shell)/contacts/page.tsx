import { cookies } from "next/headers";
import Link from "next/link";
import { listInboxAction } from "@/app/(shell)/inbox/actions";
import {
  contactTimelineAction,
  contactMessageAction,
} from "@/app/(shell)/contacts/actions";
import { ContactTimeline } from "@/components/contacts/ContactTimeline";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// E2: Contact timeline view. ?c=<email> shows the timeline; no ?c shows a picker.
export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const urlAccount = typeof params.account === "string" ? params.account : undefined;
  const cookieAccount = cookieStore.get("voxmail_account")?.value;
  const activeAccount =
    urlAccount ?? cookieAccount ?? process.env.NEXT_PUBLIC_DEFAULT_ACCOUNT ?? undefined;

  const contact = typeof params.c === "string" ? params.c.trim() : "";

  // No contact selected → render a picker (input + recent contacts).
  if (!contact) {
    // Derive recent contacts from recent inbox senders (no new backend) — same
    // approach as app/(shell)/compose/page.tsx contactSuggestions.
    let recent: { email: string; name: string }[] = [];
    try {
      const inboxRes = await listInboxAction(activeAccount);
      if (inboxRes.ok) {
        const seen = new Set<string>();
        for (const msg of inboxRes.messages) {
          if (msg.from.email && !seen.has(msg.from.email)) {
            seen.add(msg.from.email);
            recent.push({ email: msg.from.email, name: msg.from.name ?? "" });
          }
        }
      }
    } catch {
      // Recent contacts are best-effort; never block the picker.
    }

    return (
      <main className="flex-1 overflow-y-auto max-w-3xl mx-auto w-full p-6">
        <h1 className="text-2xl font-semibold text-brand-navy mb-6">Contacts</h1>

        <form method="GET" action="/contacts" className="flex items-center gap-2 mb-6">
          {activeAccount ? (
            <input type="hidden" name="account" value={activeAccount} />
          ) : null}
          <input
            type="email"
            name="c"
            required
            data-testid="contact-input"
            placeholder="Type a contact email…"
            className="flex-1 rounded border border-gray-300 px-3 py-2 outline-none focus:border-brand-amber"
          />
          <button
            type="submit"
            data-testid="contact-submit"
            className="px-5 py-2 rounded bg-brand-amber text-brand-navy font-medium hover:opacity-90 transition"
          >
            View timeline
          </button>
        </form>

        {recent.length > 0 && (
          <div>
            <h2 className="text-sm font-medium text-gray-500 mb-2">
              Recent contacts
            </h2>
            <ul className="flex flex-col gap-1">
              {recent.map((c) => {
                const qs = new URLSearchParams({ c: c.email });
                if (activeAccount) qs.set("account", activeAccount);
                return (
                  <li key={c.email}>
                    <Link
                      href={`/contacts?${qs.toString()}`}
                      prefetch={false}
                      className="flex items-center justify-between gap-3 rounded border border-gray-200 bg-white px-4 py-2 hover:bg-gray-50 transition"
                    >
                      <span className="text-sm font-medium text-brand-navy truncate">
                        {c.name && c.name !== c.email ? c.name : c.email}
                      </span>
                      {c.name && c.name !== c.email ? (
                        <span className="text-xs text-gray-400 truncate">
                          {c.email}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </main>
    );
  }

  // Contact selected → load + render the timeline.
  const res = await contactTimelineAction(contact, activeAccount);

  return (
    <main className="flex-1 overflow-y-auto max-w-3xl mx-auto w-full p-6">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-brand-navy">{contact}</h1>
          <p className="text-sm text-gray-500">Message timeline</p>
        </div>
        <Link
          href="/contacts"
          prefetch={false}
          className="text-sm text-brand-amber hover:underline flex-shrink-0"
        >
          ← All contacts
        </Link>
      </div>

      {res.ok ? (
        <ContactTimeline
          entries={res.entries}
          contact={contact}
          account={activeAccount}
          timelineAction={contactTimelineAction}
          messageAction={contactMessageAction}
        />
      ) : (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          Could not load timeline: {res.error}
        </p>
      )}
    </main>
  );
}
