import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VoxMail",
  description: "VoxMail — AI-powered white-label mail client. A VoxTN product.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
