import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "HackPrinceton Judging",
    template: "%s | HackPrinceton Judging",
  },
  description: "Simple judging tools for HackPrinceton judges and organizers.",
  applicationName: "HackPrinceton Judging",
  referrer: "origin-when-cross-origin",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#f8fafc",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="antialiased">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
