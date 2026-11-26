"use client";

import Link from "next/link";
import { useState } from "react";
import { CATEGORIES, ITEM_BY_ID, mrpOf, rupees, type CategoryId } from "@/lib/catalog.ts";
import { isNewFor } from "@/lib/shoppers.ts";
import { AddButton, cartTotals, clearCart, saveOrder, startShared, useCart } from "@/components/cart";
import { IconClock, IconUsers } from "@/components/icons";
import { NewBadge, useShopper } from "@/components/shopper";
import { track } from "@/components/track";

async function shareLink(url: string): Promise<string> {
  try {
    if (navigator.share) { await navigator.share({ text: "Add anything you need to our order:", url }); return "Sent."; }
    await navigator.clipboard.writeText(url);
    return "Link copied. Paste it in your group chat.";
  } catch {
    return `Share this link: ${url}`;
  }
}

export function CartView() {
  const { lines, code } = useCart();
  const shopper = useShopper();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [placed, setPlaced] = useState<{ items: number; fresh: string[] } | null>(null);
  const { count, total } = cartTotals(lines);
  const mrpTotal = lines.reduce((t, l) => {
    const x = ITEM_BY_ID.get(l.id);
    return t + (x ? (mrpOf(x)?.mrp ?? x.price) * l.qty : 0);
  }, 0);
  const saved = mrpTotal - total;

  if (placed) {
    return (
      <div className="p-4 text-center">
        <p aria-hidden className="text-6xl">✅</p>
        <h2 className="mt-2 text-xl font-extrabold">Order placed (demo)</h2>
        <p className="mt-1 text-muted">Nothing is bought or delivered in this prototype.</p>
        {placed.fresh.length > 0 && (
          <p className="mx-auto mt-4 max-w-xs rounded-xl bg-info-soft p-3 font-bold text-info">
            First order from {placed.fresh.length === 1 ? "a new category" : `${placed.fresh.length} new categories`}: {placed.fresh.join(", ")}
          </p>
        )}
        <Link href="/" className="mt-6 inline-block rounded-xl bg-accent px-5 py-3 font-extrabold text-accent-ink">Back to home</Link>
      </div>
    );
  }

  if (!lines.length) {
    return (
      <div className="p-6 text-center">
        <p aria-hidden className="text-6xl">🛒</p>
        <h2 className="mt-2 text-xl font-extrabold">Your cart is empty</h2>
        <p className="mt-1 text-muted">{code ? "This shared cart has nothing in it yet." : "Add something to get started."}</p>
        <Link href="/" className="mt-5 inline-block rounded-xl bg-accent px-5 py-3 font-extrabold text-accent-ink">Browse products</Link>
      </div>
    );
  }

  async function orderTogether() {
    setBusy(true);
    const url = code ? `${location.origin}/b/${code}` : await startShared();
    setMsg(url ? await shareLink(url) : "Couldn't start a shared cart. Try again.");
    if (url) track("share", null, { cart: true });
    setBusy(false);
  }

  function place() {
    const cats = [...new Set(lines.map((l) => ITEM_BY_ID.get(l.id)?.category).filter(Boolean))] as CategoryId[];
    const fresh = cats.filter((c) => isNewFor(shopper, c)).map((c) => CATEGORIES[c].name);
    track("order", null, { items: String(count), new_categories: String(fresh.length), shared: String(!!code) });
    saveOrder(lines);
    clearCart();
    setPlaced({ items: count, fresh });
  }

  return (
    <div className="space-y-3 p-3">
      <section className="rounded-2xl bg-surface p-3">
        <p className="flex items-center gap-2 text-lg font-extrabold"><IconClock className="h-5 w-5" /> Delivery in 12 minutes</p>
        <p className="text-sm text-muted">Shipment of {count} {count === 1 ? "item" : "items"}</p>
        <ul className="mt-2 divide-y divide-border">
          {lines.map((l) => {
            const x = ITEM_BY_ID.get(l.id)!;
            return (
              <li key={l.id} className="flex items-center gap-3 py-2">
                <Link href={`/p/${x.id}`} aria-hidden tabIndex={-1} className={`grid h-14 w-14 shrink-0 place-items-center rounded-lg text-3xl ${CATEGORIES[x.category].tile === "tile" ? "bg-tile" : "bg-tile-2"}`}>{x.emoji}</Link>
                <div className="min-w-0 flex-1">
                  <Link href={`/p/${x.id}`} className="line-clamp-2 min-h-6 py-0.5 font-bold leading-snug hover:underline">{x.name}</Link>
                  <p className="text-sm text-muted">{x.unit}{code && l.by ? ` · added by ${l.by}` : ""}</p>
                  <div className="mt-0.5 flex items-center gap-2"><span className="font-extrabold">{rupees(x.price * l.qty)}</span><NewBadge category={x.category} small /></div>
                </div>
                <AddButton id={x.id} />
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-2xl border-2 border-dashed border-accent bg-surface p-3">
        <p className="flex items-center gap-2 font-extrabold"><IconUsers className="h-5 w-5 text-accent" /> {code ? "Shared cart" : "Ordering for your flat or family?"}</p>
        <p className="mt-1 text-sm text-muted">
          {code ? "Everyone with the link sees this cart and can add to it." : "Share this cart so everyone adds what they need to one order."}
        </p>
        <button type="button" onClick={orderTogether} disabled={busy}
          className="mt-2 w-full rounded-xl border-2 border-accent px-4 py-2 font-extrabold text-accent disabled:opacity-50">
          {busy ? "Starting…" : code ? "Share the cart link again" : "Order together"}
        </button>
        {msg && <p role="status" className="mt-1 break-all text-sm text-muted">{msg}</p>}
      </section>

      <section className="rounded-2xl bg-surface p-3">
        <h2 className="font-extrabold">Bill details</h2>
        <dl className="mt-2 space-y-1.5">
          <div className="flex justify-between">
            <dt>Items total</dt>
            <dd>
              {saved > 0 && <span className="mr-1.5 text-sm text-muted line-through">{rupees(mrpTotal)}</span>}
              {rupees(total)}
              {saved > 0 && <span className="ml-1.5 rounded bg-info-soft px-1 text-sm font-bold text-info">Saved {rupees(saved)}</span>}
            </dd>
          </div>
          <div className="flex justify-between"><dt>Delivery charge</dt><dd className="font-bold text-accent">FREE</dd></div>
          <div className="flex justify-between"><dt>Handling charge</dt><dd className="font-bold text-accent">FREE</dd></div>
          <div className="flex justify-between border-t border-border pt-2 font-extrabold"><dt>Grand total</dt><dd>{rupees(total)}</dd></div>
        </dl>
        {saved > 0 && (
          <p className="mt-3 flex justify-between rounded-xl bg-info-soft px-3 py-2 font-bold text-info">
            <span>Your total savings</span><span>{rupees(saved)}</span>
          </p>
        )}
      </section>

      <section className="rounded-2xl bg-surface p-3">
        <h2 className="font-extrabold">Cancellation policy</h2>
        <p className="mt-1 text-sm text-muted">This is a demo order: nothing is packed, charged or delivered, so there is nothing to cancel.</p>
      </section>

      <div className="sticky bottom-[3.75rem] z-20 -mx-3 border-t border-border bg-surface px-3 py-2.5">
        <button type="button" onClick={place}
          className="flex w-full items-center justify-between rounded-xl bg-accent px-4 py-3 font-extrabold text-accent-ink">
          <span className="text-left leading-tight">{rupees(total)}<span className="block text-sm font-semibold">TOTAL</span></span>
          <span>Place order (demo) ›</span>
        </button>
      </div>
    </div>
  );
}
