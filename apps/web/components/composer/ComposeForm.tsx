"use client";

import { useState } from "react";
import { Editor } from "./Editor";

type Draft = {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  bodyHtml: string;
};

export function ComposeForm() {
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);

  const handleSend = () => {
    const draft: Draft = { to, cc, bcc, subject, bodyHtml };
    // Wired in Phase 3.2 — POST to voxmail-imap /send via server action.
    // eslint-disable-next-line no-console
    console.log("draft", draft);
    window.alert("Send is not wired yet — see console for the draft payload.");
  };

  const handleDiscard = () => {
    setTo("");
    setCc("");
    setBcc("");
    setSubject("");
    setBodyHtml("");
  };

  return (
    <div className="flex flex-col gap-4">
      <RecipientRow
        label="To"
        value={to}
        onChange={setTo}
        placeholder="recipient@example.com"
        trailing={
          !showCcBcc && (
            <button
              type="button"
              onClick={() => setShowCcBcc(true)}
              className="text-sm text-brand-amber"
            >
              Cc / Bcc
            </button>
          )
        }
      />

      {showCcBcc && (
        <>
          <RecipientRow
            label="Cc"
            value={cc}
            onChange={setCc}
            placeholder="cc@example.com"
          />
          <RecipientRow
            label="Bcc"
            value={bcc}
            onChange={setBcc}
            placeholder="bcc@example.com"
          />
        </>
      )}

      <label className="flex items-center gap-3 border-b pb-2">
        <span className="text-sm font-medium text-gray-600 w-16">Subject</span>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="(no subject)"
          className="flex-1 outline-none bg-transparent"
        />
      </label>

      <Editor value={bodyHtml} onChange={setBodyHtml} />

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={handleDiscard}
          className="px-4 py-2 text-gray-600 hover:text-brand-navy"
        >
          Discard
        </button>
        <button
          type="button"
          onClick={handleSend}
          className="px-5 py-2 rounded bg-brand-amber text-brand-navy font-medium hover:opacity-90 transition"
        >
          Send
        </button>
      </div>
    </div>
  );
}

function RecipientRow({
  label,
  value,
  onChange,
  placeholder,
  trailing,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  trailing?: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-3 border-b pb-2">
      <span className="text-sm font-medium text-gray-600 w-16">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 outline-none bg-transparent"
      />
      {trailing}
    </label>
  );
}
