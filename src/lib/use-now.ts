"use client";

import { useSyncExternalStore } from "react";

/**
 * A clock React is allowed to read.
 *
 * Calling Date.now() during render is impure and makes "synced 4 minutes ago"
 * lie after a re-render. This subscribes to the passing of minutes instead, so
 * the value is stable within a minute and re-renders exactly once when it ticks.
 */
function subscribe(onChange: () => void): () => void {
  const id = setInterval(onChange, 20_000);
  return () => clearInterval(id);
}

function snapshot(): number {
  return Math.floor(Date.now() / 60_000);
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, snapshot, () => 0) * 60_000;
}
