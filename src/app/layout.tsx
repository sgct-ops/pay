import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "@/components/Providers";

/*
 * Fonts are vendored into the repo rather than fetched from Google. A tool
 * that has to work on a warehouse phone with no signal should not need a CDN
 * to render its own numbers, and self-hosting also keeps customer data out of
 * a third-party request log.
 */
const archivo = localFont({
  src: "../fonts/archivo-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-archivo",
  display: "swap",
});

const publicSans = localFont({
  src: "../fonts/public-sans-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-public-sans",
  display: "swap",
});

const plexMono = localFont({
  src: [
    { path: "../fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "CarbonTree Payout Desk",
    template: "%s · CarbonTree Payout Desk",
  },
  description:
    "Turn a Return Prime export into paid-out UPI refunds — upload, filter, scan, tick off.",
  applicationName: "Payout Desk",
  appleWebApp: {
    capable: true,
    title: "Payout Desk",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#2f6b4f",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${publicSans.variable} ${plexMono.variable}`}
    >
      <body className="min-h-dvh bg-paper text-ink antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
