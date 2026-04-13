import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 gap-6">
      <h1 className="text-4xl font-semibold text-[--color-brand-navy]">VoxMail</h1>
      <p className="text-gray-600">AI-powered white-label mail client.</p>
      <Link
        href="/compose"
        className="px-5 py-2 rounded bg-[--color-brand-amber] text-[--color-brand-navy] font-medium hover:opacity-90 transition"
      >
        Compose
      </Link>
    </main>
  );
}
