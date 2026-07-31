import type { Metadata } from "next";
import localFont from "next/font/local";
import { Providers } from "@/components/providers";
import "./globals.css";

// Rubik is self-hosted rather than loaded via next/font/google. Turbopack in
// Next 16.2.9 fails to resolve its own internal font module
// (@vercel/turbopack-next/internal/font/google/font), breaking `next build`
// while `--webpack` succeeds. Self-hosting sidesteps that path entirely and
// removes a build-time network dependency on Google — worth having regardless
// for an app whose primary script is Hebrew.
//
// Two declarations, not one: Google ships a separate variable woff2 per subset
// and there is no unicode-range support in next/font/local. Listing both
// families in --font-sans lets CSS fall through per glyph — Latin first, Hebrew
// picking up what Latin lacks — which preserves subset splitting so a Hebrew
// page never pays for glyphs it cannot render. 45 KB for the pair.
const rubikLatin = localFont({
  src: "./fonts/rubik-latin.woff2",
  weight: "400 700",
  style: "normal",
  variable: "--font-rubik-latin",
  display: "swap",
});

const rubikHebrew = localFont({
  src: "./fonts/rubik-hebrew.woff2",
  weight: "400 700",
  style: "normal",
  variable: "--font-rubik-hebrew",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SmartCase – מערכת ניהול תיקים",
  description: "מערכת CRM לניהול תיקי נכות ובטוח לאומי",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="he" dir="rtl" className={`${rubikLatin.variable} ${rubikHebrew.variable} h-full`}>
      <body className="h-full"><Providers>{children}</Providers></body>
    </html>
  );
}
