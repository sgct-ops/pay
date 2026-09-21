import type { Metadata } from "next";
import { Ledger } from "@/components/Ledger";

export const metadata: Metadata = { title: "Verify" };

export default function LedgerPage() {
  return <Ledger />;
}
