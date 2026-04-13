"use client";

import {
  EditorContent,
  useEditor,
  type Editor as TipTapEditor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect } from "react";

type EditorProps = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
};

export function Editor({ value, onChange, placeholder }: EditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { class: "text-brand-amber underline" },
      }),
      Placeholder.configure({
        placeholder: placeholder ?? "Write your message…",
      }),
    ],
    content: value,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class:
          "prose max-w-none min-h-[300px] outline-none py-3 focus:outline-none",
      },
    },
  });

  // Sync external value resets (e.g. Discard) into the editor.
  useEffect(() => {
    if (editor && editor.getHTML() !== value) {
      editor.commands.setContent(value, false);
    }
  }, [value, editor]);

  if (!editor) {
    return <div className="text-gray-400">Loading editor…</div>;
  }

  return (
    <div className="flex flex-col gap-2">
      <Toolbar editor={editor} />
      <div className="border rounded-md px-3">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function Toolbar({ editor }: { editor: TipTapEditor }) {
  const btn = (active: boolean) =>
    `px-2 py-1 text-sm rounded ${
      active
        ? "bg-brand-navy text-white"
        : "text-brand-navy hover:bg-gray-100"
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
