import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell";
import { ShopperPicker } from "@/components/shopper";
import { IconInfo, IconRight } from "@/components/icons";

export const metadata: Metadata = { title: "Account" };

export default function Account() {
  return (
    <>
      <PageHeader title="Account" search={false} />
      <div className="space-y-4 p-3">
        <section className="rounded-2xl bg-surface p-3"><ShopperPicker /></section>
        <Link href="/how-it-works" className="flex items-center gap-3 rounded-2xl bg-surface p-3 font-bold hover:underline">
          <IconInfo className="h-5 w-5 text-accent" /> <span className="flex-1">About this prototype and how it&rsquo;s checked</span><IconRight className="h-5 w-5" />
        </Link>
        <p className="px-1 text-sm text-muted">
          Unofficial concept prototype of a feature for Blinkit, built for a product case study. Not affiliated with
          Blinkit. Products, brands, prices and addresses are invented; nothing can be bought. No sign-in, and no personal
          details are collected.
        </p>
      </div>
    </>
  );
}
