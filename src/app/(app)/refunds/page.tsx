import type { Metadata } from "next";
import { Refunds } from "@/components/Refunds";

export const metadata: Metadata = { title: "Refunds" };

export default function RefundsPage() {
  return <Refunds />;
}
