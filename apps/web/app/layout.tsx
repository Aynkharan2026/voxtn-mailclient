import type { Metadata } from "next";
import { DEFAULT_PRIMARY_COLOR, getCurrentTenant } from "@/lib/tenant";
import "./globals.css";

export const metadata: Metadata = {
  title: "VoxMail",
  description: "VoxMail — AI-powered white-label mail client. A VoxTN product.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const tenant = await getCurrentTenant();
  const primary = tenant?.primary_color ?? DEFAULT_PRIMARY_COLOR;
  const brandStyle = `:root{--brand-primary:${primary};}`;

  return (
    <html lang="en">
      <head>
        <style
          data-brand-primary={primary}
          dangerouslySetInnerHTML={{ __html: brandStyle }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
