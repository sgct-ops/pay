"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth-context";
import { ServiceWorker } from "@/components/ServiceWorker";

/**
 * Only auth lives up here. The ledger and the pay queue are mounted below the
 * sign-in gate (see AppShell), so signing out unmounts them and the cached
 * orders leave memory without anyone having to remember to clear them.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      {children}
      <ServiceWorker />
    </AuthProvider>
  );
}
