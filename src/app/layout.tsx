import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://pocketcmo.pro"),
  title: "Pocket CMO — Your AI business diagnostic",
  description:
    "A sharp, AI-led diagnostic interview that pinpoints where your business is leaving money on the table — and the highest-upside moves to fix it.",
  applicationName: "Pocket CMO",
  openGraph: {
    title: "Pocket CMO — Your AI business diagnostic",
    description:
      "Find where your business is leaving money on the table — and what to do about it.",
    url: "https://pocketcmo.pro",
    siteName: "Pocket CMO",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Pocket CMO — Your AI business diagnostic",
    description:
      "Find where your business is leaving money on the table — and what to do about it.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
