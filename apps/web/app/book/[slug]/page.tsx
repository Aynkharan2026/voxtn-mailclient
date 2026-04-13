import Link from "next/link";
import { BookingView } from "@/components/booking/BookingView";

type Params = { slug: string };

export default async function BookingPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const calOrigin = process.env.CALCOM_BASE_URL ?? "https://cal.voxtn.com";
  const displayName = slug
    .split("-")
    .map((s) => (s ? s[0]!.toUpperCase() + s.slice(1) : ""))
    .join(" ");

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="bg-brand-navy text-white">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-semibold hover:opacity-90">
            VoxMail Booking
          </Link>
          <span className="text-sm text-brand-amber font-medium">
            Book with {displayName}
          </span>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto p-6">
        <h1 className="text-2xl font-semibold text-brand-navy mb-2">
          Schedule a meeting with {displayName}
        </h1>
        <p className="text-sm text-gray-600 mb-6">
          Choose a time that works for you below. You&apos;ll get a calendar
          invite once confirmed.
        </p>

        <div className="border rounded-lg overflow-hidden">
          <BookingView slug={slug} calOrigin={calOrigin} />
        </div>

        <footer className="mt-8 text-xs text-gray-400">
          Powered by{" "}
          <span className="text-brand-amber font-medium">VoxMail</span> — a
          VoxTN product.
        </footer>
      </main>
    </div>
  );
}
