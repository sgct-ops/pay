import type { Metadata } from "next";
import { Uploader } from "@/components/Uploader";

export const metadata: Metadata = { title: "Upload" };

export default function UploadPage() {
  return <Uploader />;
}
