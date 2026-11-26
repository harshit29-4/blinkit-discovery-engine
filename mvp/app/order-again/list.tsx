"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { ITEM_BY_ID } from "@/lib/catalog.ts";
import { readOrders } from "@/components/cart";
import { ProductCard } from "@/components/product-card";

const noop = () => () => {};

/** Items from this browser's past demo orders, most recent first, like Blinkit's Order Again. */
export function OrderAgainList() {
  const snapshot = useSyncExternalStore(noop, () => JSON.stringify(readOrders()), () => "[]");
  const orders = JSON.parse(snapshot) as ReturnType<typeof readOrders>;
  const ids = [...new Set(orders.flatMap((o) => o.lines.map((l) => l.id)))].filter((id) => ITEM_BY_ID.has(id));
  if (!ids.length) {
    return (
      <div className="p-6 text-center">
        <p aria-hidden className="text-6xl">🧾</p>
        <h2 className="mt-2 text-xl font-extrabold">No orders yet</h2>
        <p className="mt-1 text-muted">Things you order show up here, so reordering is one tap.</p>
        <Link href="/" className="mt-5 inline-block rounded-xl bg-accent px-5 py-3 font-extrabold text-accent-ink">Start shopping</Link>
      </div>
    );
  }
  return (
    <div className="p-3">
      <p className="text-sm text-muted">From your last {orders.length === 1 ? "order" : `${orders.length} orders`} (demo)</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {ids.map((id) => <ProductCard key={id} item={ITEM_BY_ID.get(id)!} wide showNew={false} />)}
      </div>
    </div>
  );
}
