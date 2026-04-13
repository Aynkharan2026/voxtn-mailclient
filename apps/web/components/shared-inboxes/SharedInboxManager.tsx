"use client";

import { useState, useTransition } from "react";
import {
  addSupervisorAction,
  assignRepAction,
  createSharedInboxAction,
  listSharedInboxesAction,
  type SharedInbox,
} from "@/app/settings/shared-inboxes/actions";

export function SharedInboxManager({ initial }: { initial: SharedInbox[] }) {
  const [inboxes, setInboxes] = useState<SharedInbox[]>(initial);
  const [name, setName] = useState("");
  const [emailAddress, setEmailAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const refresh = async () => {
    const res = await listSharedInboxesAction();
    if (res.ok) setInboxes(res.inboxes);
  };

  const handleCreate = () => {
    if (!name.trim() || !emailAddress.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await createSharedInboxAction({
        name: name.trim(),
        email_address: emailAddress.trim().toLowerCase(),
      });
      if (res.ok) {
        setName("");
        setEmailAddress("");
        await refresh();
      } else {
        setError(res.error);
      }
    });
  };

  const handleAssignRep = (id: string) => {
    const email = window.prompt("Rep email to assign:")?.trim().toLowerCase();
    if (!email) return;
    setError(null);
    startTransition(async () => {
      const res = await assignRepAction(id, email);
      if (res.ok) await refresh();
      else setError(res.error);
    });
  };

  const handleAddSupervisor = (id: string) => {
    const email = window
      .prompt("Supervisor email to add:")
      ?.trim()
      .toLowerCase();
    if (!email) return;
    setError(null);
    startTransition(async () => {
      const res = await addSupervisorAction(id, email);
      if (res.ok) await refresh();
      else setError(res.error);
    });
  };

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="text-lg font-semibold mb-2">Your shared inboxes</h2>
        {inboxes.length === 0 ? (
          <p className="text-sm text-gray-500">
            No shared inboxes yet. Create one below.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {inboxes.map((i) => (
              <li key={i.id} className="border rounded p-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-brand-navy">
                      {i.name}
                    </div>
                    <div className="text-sm text-gray-600 font-mono">
                      {i.email_address}
                    </div>
                    <div className="text-xs text-gray-500 mt-2 space-x-3">
                      <span>
                        <strong>{i.assigned_rep_emails.length}</strong> rep
                        {i.assigned_rep_emails.length === 1 ? "" : "s"}
                      </span>
                      <span>
                        <strong>{i.supervisor_emails.length}</strong>{" "}
                        supervisor
                        {i.supervisor_emails.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    {(i.assigned_rep_emails.length > 0 ||
                      i.supervisor_emails.length > 0) && (
                      <div className="mt-2 text-xs text-gray-600 space-y-1">
                        {i.assigned_rep_emails.length > 0 && (
                          <div>
                            Reps:{" "}
                            <span className="font-mono">
                              {i.assigned_rep_emails.join(", ")}
                            </span>
                          </div>
                        )}
                        {i.supervisor_emails.length > 0 && (
                          <div>
                            Supervisors:{" "}
                            <span className="font-mono">
                              {i.supervisor_emails.join(", ")}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 shrink-0 text-sm">
                    <button
                      type="button"
                      onClick={() => handleAssignRep(i.id)}
                      disabled={isPending}
                      className="text-brand-amber hover:underline disabled:opacity-50"
                    >
                      Assign rep
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAddSupervisor(i.id)}
                      disabled={isPending}
                      className="text-brand-navy hover:underline disabled:opacity-50"
                    >
                      Add supervisor
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">New shared inbox</h2>
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-3 border-b pb-2">
            <span className="text-sm font-medium text-gray-600 w-24">
              Name
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Support"
              className="flex-1 outline-none bg-transparent"
              disabled={isPending}
            />
          </label>
          <label className="flex items-center gap-3 border-b pb-2">
            <span className="text-sm font-medium text-gray-600 w-24">
              Email address
            </span>
            <input
              type="email"
              value={emailAddress}
              onChange={(e) => setEmailAddress(e.target.value)}
              placeholder="support@acme.com"
              className="flex-1 outline-none bg-transparent font-mono"
              disabled={isPending}
            />
          </label>
          {error && (
            <div className="text-sm text-red-700">Error: {error}</div>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleCreate}
              disabled={
                isPending || !name.trim() || !emailAddress.trim()
              }
              className="px-5 py-2 rounded bg-brand-amber text-brand-navy font-medium hover:opacity-90 transition disabled:opacity-50"
            >
              Create shared inbox
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
