/**
 * Which UPI app the phone should open.
 *
 * Every Indian UPI app understands the same `pay?pa=…&am=…` query; only the
 * scheme in front of it differs. So the link is built once and the prefix is
 * swapped — no separate deep-link format per app.
 *
 * `upi://pay` is the honest default: Android shows its own chooser and every
 * installed app appears. The named ones are for skipping that chooser when you
 * are paying twenty refunds in a row and always use the same app.
 *
 * If an app is not installed, its scheme simply does nothing — the phone has no
 * way to tell us, so the picker keeps "Any UPI app" one tap away.
 */

export interface UpiApp {
  id: string;
  name: string;
  /** Scheme and path that replaces `upi://pay`. */
  prefix: string;
  /** Initial shown in the picker. */
  letter: string;
  tint: string;
}

export const UPI_APPS: UpiApp[] = [
  { id: "any", name: "Any UPI app", prefix: "upi://pay", letter: "₹", tint: "#2f6b4f" },
  { id: "gpay", name: "Google Pay", prefix: "tez://upi/pay", letter: "G", tint: "#1a73e8" },
  { id: "phonepe", name: "PhonePe", prefix: "phonepe://pay", letter: "P", tint: "#5f259f" },
  { id: "paytm", name: "Paytm", prefix: "paytmmp://pay", letter: "P", tint: "#00b9f1" },
  { id: "bhim", name: "BHIM", prefix: "bhim://pay", letter: "B", tint: "#e07a2f" },
];

const STORE_KEY = "ct.upiapp";

export function appById(id: string | null): UpiApp {
  return UPI_APPS.find((a) => a.id === id) ?? UPI_APPS[0];
}

export function readPreferredApp(): UpiApp {
  if (typeof window === "undefined") return UPI_APPS[0];
  try {
    return appById(window.localStorage.getItem(STORE_KEY));
  } catch {
    return UPI_APPS[0];
  }
}

export function writePreferredApp(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORE_KEY, id);
  } catch {
    /* private mode — the choice just won't be remembered */
  }
}

/** Re-point a `upi://pay?…` link at a specific app. */
export function linkForApp(link: string, app: UpiApp): string {
  if (!link) return link;
  return link.replace(/^upi:\/\/pay/, app.prefix);
}
