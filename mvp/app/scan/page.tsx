import type { Metadata } from "next";
import { ScanForm } from "./scan-form";
import { PageHeader } from "@/components/shell";

export const metadata: Metadata = { title: "Scan the packet" };

export default function ScanPage() {
  return (
    <>
    <PageHeader title="Scan a pack" />
    <div className="p-3">
      <h2 className="text-xl font-extrabold">Find the exact one you use</h2>
      <p className="mt-1 text-muted">
        Take a photo of the pack you have at home. We&rsquo;ll find the same brand and variant, or tell you it isn&rsquo;t
        stocked and what&rsquo;s closest. The photo is checked once and not stored.
      </p>
      <div className="mt-4"><ScanForm /></div>
    </div>
    </>
  );
}
