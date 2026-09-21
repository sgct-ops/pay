import type { Metadata } from "next";
import Link from "next/link";
import { Mark } from "@/components/Mark";

export const metadata: Metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <div className="max-w-[380px] text-center">
        <div className="mb-4 flex justify-center">
          <Mark size={40} />
        </div>
        <h1 className="display text-[18px] font-semibold text-ink">No connection</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">
          This screen has not been opened on this device yet, so there is nothing cached to show.
          The ledger and the pay desk both work offline once you have opened them — anything you
          mark paid while offline is queued and syncs when you are back.
        </p>
        <Link
          href="/ledger"
          className="mt-5 inline-block rounded-lg bg-spruce px-4 py-2.5 text-[13px] font-semibold text-white"
        >
          Back to the ledger
        </Link>
      </div>
    </div>
  );
}
