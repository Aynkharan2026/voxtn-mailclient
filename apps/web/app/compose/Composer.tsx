"use client";

import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { useState } from "react";

type DraftMessage = {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  bodyHtml: string;
};

export function Composer() {
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          class: "text-[--color-brand-amber] underline",
        },
      }),
      Placeholder.configure({
        placeholder: "Write your message…",
      }),
    ],
    content: "",
    editorProps: {
      attributes: {
        class:
          "prose max-w-none min-h-[300px] outline-none py-3 focus:outline-none",
      },
    },
  });

  const handleSend = () => {
    const draft: DraftMessage = {
      to,
      cc,
      bcc,
      subject,
      bodyHtml: editor?.getHTML() ?? "",
    };
    // Wired in Phase 3.2 — POST to voxmail-imap /send via server action.
    // eslint-disable-next-line no-console
    console.log("draft", draft);
    window.alert("Send is not wired yet — see console for the draft payload.");
  };

  if (!editor) {
    return <div className="text-gray-400">Loading editor…</div>;
  }

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
              className="text-sm text-[--color-brand-amber]"
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

      <EditorToolbar editor={editor} />

      <div className="border rounded-md px-3">
        <EditorContent editor={editor} />
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="px-4 py-2 text-gray-600 hover:text-[--color-brand-navy]"
          onClick={() => editor.commands.clearContent()}
        >
          Discard
        </button>
        <button
          type="button"
          onClick={handleSend}
          className="px-5 py-2 rounded bg-[--color-brand-amber] text-[--color-brand-navy] font-medium hover:opacity-90 transition"
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

function EditorToolbar({ editor }: { editor: Editor }) {
  const btn = (active: boolean) =>
    `px-2 py-1 text-sm rounded ${
      active
        ? "bg-[--color-brand-navy] text-white"
        : "text-[--color-brand-navy] hover:bg-gray-100"
    }`;

  return (
    <div className="flex flex-wrap items-center gap-1 border-b pb-2">
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={btn(editor.isActive("bold"))}
      >
        Bold
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={btn(editor.isActive("italic"))}
      >
        Italic
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={btn(editor.isActive("strike"))}
      >
        Strike
      </button>
      <span className="mx-1 h-4 w-px bg-gray-200" />
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={btn(editor.isActive("bulletList"))}
      >
        • List
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={btn(editor.isActive("orderedList"))}
      >
        1. List
      </button>
      <span className="mx-1 h-4 w-px bg-gray-200" />
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={btn(editor.isActive("blockquote"))}
      >
        Quote
      </button>
      <button
        type="button"
        onClick={() => {
          const url = window.prompt("Link URL:");
          if (url) {
            editor
              .chain()
              .focus()
              .extendMarkRange("link")
              .setLink({ href: url })
              .run();
          }
        }}
        className={btn(editor.isActive("link"))}
      >
        Link
      </button>
      <span className="mx-1 h-4 w-px bg-gray-200" />
      <button
        type="button"
        onClick={() => editor.chain().focus().undo().run()}
        className={btn(false)}
      >
        Undo
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().redo().run()}
        className={btn(false)}
      >
        Redo
      </button>
    </div>
  );
}
