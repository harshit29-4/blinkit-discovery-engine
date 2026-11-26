"use client";

/**
 * The demo shopper (persona). The choice lives in this browser only (localStorage); "New for you" tags read it
 * after load, so pages stay static.
 */
import { useMemo, useSyncExternalStore } from "react";
import { ITEM_BY_ID } from "@/lib/catalog.ts";
import type { CategoryId } from "@/lib/catalog.ts";
import { DEFAULT_SHOPPER, SHOPPERS, isNewFor, shopperById } from "@/lib/shoppers.ts";

const KEY = "demo-shopper";
const listeners = new Set<() => void>();

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? DEFAULT_SHOPPER;
  } catch {
    return DEFAULT_SHOPPER;
  }
}
export function setShopper(id: string) {
  try { localStorage.setItem(KEY, id); } catch { /* private mode: the choice just won't persist */ }
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  window.addEventListener("storage", l);
  return () => { listeners.delete(l); window.removeEventListener("storage", l); };
}

/**
 * The demo household, with categories from this browser's past demo orders added to its history: once you've
 * ordered from a category it stops being "New for you".
 */
const ordered = () => {
  try {
    const orders = JSON.parse(localStorage.getItem("demo-orders") ?? "[]") as { lines: { id: string }[] }[];
    return [...new Set(orders.flatMap((o) => o.lines.map((l) => ITEM_BY_ID.get(l.id)?.category).filter(Boolean)))].sort().join(",");
  } catch {
    return "";
  }
};
export function useShopper() {
  const base = shopperById(useSyncExternalStore(subscribe, read, () => DEFAULT_SHOPPER));
  const extra = useSyncExternalStore(subscribe, ordered, () => "");
  return useMemo(() => (extra ? { ...base, bought: [...base.bought, ...extra.split(",")] } : base), [base, extra]);
}

export function ShopperPicker() {
  const s = useShopper();
  return (
    <fieldset className="space-y-2">
      <legend className="font-extrabold">Shop as a demo household</legend>
      {SHOPPERS.map((x) => (
        <label key={x.id} className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${x.id === s.id ? "border-accent bg-accent-soft" : "border-border bg-surface"}`}>
          <input type="radio" name="shopper" value={x.id} checked={x.id === s.id} onChange={() => setShopper(x.id)} className="mt-1 h-6 w-6 shrink-0 accent-[var(--accent)]" />
          <span>
            <span className="block font-bold">{x.name}</span>
            <span className="block text-sm text-muted">{x.about}</span>
          </span>
        </label>
      ))}
      <p className="text-sm text-muted">Each has a made-up order history. Categories they&rsquo;ve never bought get a &ldquo;New for you&rdquo; tag.</p>
    </fieldset>
  );
}

export function NewBadge({ category, small = false, short = false }: { category: CategoryId; small?: boolean; short?: boolean }) {
  const s = useShopper();
  if (!isNewFor(s, category)) return null;
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-md bg-info font-bold text-surface ${small ? "px-1.5 text-sm" : "px-2 py-0.5 text-sm"}`}
      title={short ? "New for you: a category you haven't bought" : undefined}>
      {short ? "New" : "New for you"}
    </span>
  );
}

/** Renders its children only while this demo household is selected. */
export function ForShopper({ id, children }: { id: string; children: React.ReactNode }) {
  return useShopper().id === id ? <>{children}</> : null;
}

/** Renders its children only for categories this household has never bought. */
export function NewOnly({ category, children }: { category: CategoryId; children: React.ReactNode }) {
  const s = useShopper();
  return isNewFor(s, category) ? <>{children}</> : null;
}
