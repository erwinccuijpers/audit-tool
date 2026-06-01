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
  title: "Pocket CMO — Your business diagnostic",
  description:
    "Built from real consulting experience: it walks you through the questions a sharp consultant would ask across your whole business, then shows you where you're leaving money on the table and the highest-upside moves to fix it. Do it in one go or pick it up whenever — your progress saves as you go.",
  applicationName: "Pocket CMO",
  openGraph: {
    title: "Pocket CMO — Your business diagnostic",
    description:
      "Built from real consulting experience — find where your business is leaving money on the table, and what to fix first. Do it in one go or pick up where you left off.",
    url: "https://pocketcmo.pro",
    siteName: "Pocket CMO",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Pocket CMO — Your business diagnostic",
    description:
      "Built from real consulting experience — find where your business is leaving money on the table, and what to fix first.",
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
