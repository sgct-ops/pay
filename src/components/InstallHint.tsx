"use client";

import { useEffect, useState } from "react";

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "ct.install.dismissed";

/**
 * Everything this component needs to know about where it is running. Read once,
 * in a state initialiser rather than an effect — the component only ever mounts
 * on the client, below the auth gate.
 */
function readEnvironment() {
  if (typeof window === "undefined") {
    return { standalone: true, isIOS: false, dismissed: true };
  }
  let dismissed = false;
  try {
    dismissed = window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    dismissed = false;
  }
  return {
    standalone:
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true,
    isIOS: /iPad|iPhone|iPod/.test(window.navigator.userAgent),
    dismissed,
  };
}

/**
 * Offers to install the app to the home screen.
 *
 * This matters more than it looks: a UPI QR on a laptop screen can't be scanned
 * by the same laptop, so paying actually happens on a phone. Installed, the app
 * opens full-screen and hands the payment straight to GPay or PhonePe.
 */
export function InstallHint({ compact = false }: { compact?: boolean }) {
  const [env] = useState(readEnvironment);
  const [deferred, setDeferred] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(env.standalone);
  const [dismissed, setDismissed] = useState(env.dismissed);
  const isIOS = env.isIOS;

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as InstallEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || dismissed) return null;
  if (!deferred && !isIOS) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className={`rounded-card border border-line bg-card px-4 py-3.5 ${compact ? "" : "mt-5"}`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-[15px] leading-none text-spruce" aria-hidden>
          ⌂
        </span>
        <div className="flex-1">
          <p className="text-[13px] font-semibold text-ink">Install on your phone</p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-2">
            {isIOS
              ? "Tap Share, then Add to Home Screen. Paying from the phone means the UPI link opens your payment app directly — no scanning your own screen."
              : "Keeps the ledger on your phone and opens payments straight in GPay or PhonePe, instead of scanning a QR off your laptop."}
          </p>
          <div className="mt-2.5 flex items-center gap-3">
            {deferred && (
              <button
                onClick={async () => {
                  await deferred.prompt();
                  const choice = await deferred.userChoice;
                  if (choice.outcome === "accepted") setInstalled(true);
                  setDeferred(null);
                }}
                className="rounded-lg bg-spruce px-3 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-spruce-deep"
              >
                Install
              </button>
            )}
            <button onClick={dismiss} className="text-[12.5px] text-ink-3 hover:text-ink">
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
