import type { Metadata } from "next";
import { People } from "@/components/People";

export const metadata: Metadata = { title: "People" };

export default function PeoplePage() {
  return <People />;
}
