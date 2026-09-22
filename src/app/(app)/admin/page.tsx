import { Suspense } from "react";
import type { Metadata } from "next";
import { AdminPanel } from "@/components/admin/AdminPanel";

export const metadata: Metadata = { title: "Admin" };

/**
 * The panel reads its tab from ?tab=, so it has to sit under a Suspense
 * boundary or the whole route drops out of prerendering.
 */
export default function AdminPage() {
  return (
    <Suspense fallback={<Loading />}>
      <AdminPanel />
    </Suspense>
  );
}

function Loading() {
  return (
    <div className="mx-auto max-w-[1040px] space-y-4">
      <div className="h-12 w-52 animate-pulse rounded-lg bg-sunk" />
      <div className="h-9 animate-pulse rounded-lg bg-sunk" />
      <div className="h-72 animate-pulse rounded-card bg-sunk" />
    </div>
  );
}
