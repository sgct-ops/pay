import type { Metadata } from "next";
import { PayDesk } from "@/components/PayDesk";

export const metadata: Metadata = { title: "Pay" };

export default function PayPage() {
  return <PayDesk />;
}
