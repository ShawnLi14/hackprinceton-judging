import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { GeistPixelSquare } from "geist/font/pixel";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "HackPrinceton Judging",
    template: "%s | HackPrinceton Judging",
  },
  description: "Simple judging tools for HackPrinceton judges and organizers.",
  applicationName: "HackPrinceton Judging",
  referrer: "origin-when-cross-origin",
  themeColor: "#f8fafc",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} ${GeistPixelSquare.variable}`}
    >
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
