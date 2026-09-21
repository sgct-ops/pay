"use client";

import { useEffect } from "react";

/**
 * Registers the service worker that makes the app installable and usable with
 * no signal. Kept out of the way: it never blocks a render and a failure here
 * costs nothing but offline support.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch(() => {});
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
