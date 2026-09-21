import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CarbonTree Payout Desk",
    short_name: "Payout Desk",
    description:
      "Turn a Return Prime export into paid-out UPI refunds — upload, filter, scan, tick off.",
    // Straight into the ledger; the root only redirects, which is a poor
    // launch target for an installed app.
    start_url: "/ledger",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#faf7f0",
    theme_color: "#2f6b4f",
    categories: ["business", "finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Pay desk", url: "/pay" },
      { name: "Upload an export", url: "/upload" },
    ],
  };
}
