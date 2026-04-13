import { Composer } from "./Composer";

export default function ComposePage() {
  return (
    <main className="min-h-screen max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-semibold text-[--color-brand-navy] mb-6">
        Compose
      </h1>
      <Composer />
    </main>
  );
}
