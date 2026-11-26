"use client";

/** Blinkit-style bottom bar on a product page: price on the left, Add to cart on the right, cart link above. */
import Link from "next/link";
import { rupees } from "@/lib/catalog.ts";
import { AddButton, cartTotals, useCart } from "./cart";
import { IconRight } from "./icons";

export function ProductBar({ id, unit, price, mrp, off }: { id: string; unit: string; price: number; mrp: number | null; off: number | null }) {
  const { lines } = useCart();
  const { count, total } = cartTotals(lines);
  return (
    <div className="sticky bottom-[3.75rem] z-20 mt-2">
      {count > 0 && (
        <Link href="/cart" className="flex items-center justify-between bg-accent px-4 py-1.5 text-sm font-bold text-accent-ink">
          <span>{count} {count === 1 ? "item" : "items"} · {rupees(total)}</span>
          <span className="flex items-center gap-0.5">View cart <IconRight className="h-4 w-4" /></span>
        </Link>
      )}
      <div className="flex items-center justify-between gap-3 border-t border-border bg-surface px-4 py-2.5 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
        <div className="leading-tight">
          <p className="text-sm text-muted">{unit}</p>
          <p className="whitespace-nowrap">
            <span className="text-lg font-extrabold">{rupees(price)}</span>
            {mrp && <span className="ml-1.5 text-sm text-muted line-through">{rupees(mrp)}</span>}
            {off && <span className="ml-1.5 rounded bg-info-soft px-1 text-sm font-extrabold text-info">{off}% OFF</span>}
          </p>
          <p className="text-sm text-muted">Inclusive of all taxes</p>
        </div>
        <AddButton id={id} size="lg" />
      </div>
    </div>
  );
}
