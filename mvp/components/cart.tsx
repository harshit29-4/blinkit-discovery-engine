"use client";

/**
 * The cart. Local to this browser until someone taps "Order together"; from then it is a shared cart saved on the
 * server under a short code, and everyone who opens the link sees and edits the same cart (P4's flat group).
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useSyncExternalStore } from "react";
import { ITEM_BY_ID, rupees } from "@/lib/catalog.ts";
import { shopperById } from "@/lib/shoppers.ts";
import { IconRight } from "./icons";
import { track } from "./track";

export type Line = { id: string; qty: number; by: string | null };
type State = { code: string | null; lines: Line[] };

const KEY = "demo-cart";
const EMPTY: State = { code: null, lines: [] };
const listeners = new Set<() => void>();
let cache: State | null = null;

function read(): State {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    cache = raw && Array.isArray(raw.lines) ? { code: raw.code ?? null, lines: raw.lines.filter((l: Line) => ITEM_BY_ID.has(l.id)) } : EMPTY;
  } catch {
    cache = EMPTY;
  }
  return cache;
}
function write(s: State) {
  cache = s;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: cart lasts for this page only */ }
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) { cache = null; l(); } };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(l); window.removeEventListener("storage", onStorage); };
}

export const useCart = () => useSyncExternalStore(subscribe, read, () => EMPTY);

const persona = () => { try { return localStorage.getItem("demo-shopper"); } catch { return null; } };

async function push(s: State) {
  if (!s.code) return;
  try {
    await fetch("/api/basket", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: s.code, lines: s.lines }) });
  } catch { /* the next change or refresh tries again */ }
}

export function changeQty(id: string, delta: number) {
  const s = read();
  const cur = s.lines.find((l) => l.id === id);
  const qty = Math.max(0, Math.min(20, (cur?.qty ?? 0) + delta));
  const by = cur?.by ?? shopperById(persona()).name;
  const lines = qty === 0 ? s.lines.filter((l) => l.id !== id)
    : cur ? s.lines.map((l) => (l.id === id ? { ...l, qty } : l)) : [...s.lines, { id, qty, by }];
  const next = { ...s, lines };
  write(next);
  void push(next);
  if (delta > 0 && !cur) track("cart_add", id, { shared: String(!!s.code) });
}

export function clearCart() {
  write(EMPTY);
}

/** Turns this cart into a shared one; returns the link to send. */
export async function startShared(): Promise<string | null> {
  const s = read();
  const res = await fetch("/api/basket", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines: s.lines }) });
  const body = await res.json().catch(() => ({}));
  if (!body.code) return null;
  write({ code: body.code, lines: body.lines });
  return `${location.origin}/b/${body.code}`;
}

/** Joins a shared cart from its link (replaces this browser's cart with the shared one). */
export async function joinShared(code: string): Promise<boolean> {
  const res = await fetch(`/api/basket?code=${code}`);
  const body = await res.json().catch(() => ({}));
  if (!Array.isArray(body.lines)) return false;
  write({ code, lines: body.lines });
  return true;
}

/** Refreshes a shared cart when the page comes back into view (someone else may have added things). */
export function useSharedRefresh() {
  useEffect(() => {
    const refresh = () => { const c = read().code; if (c && document.visibilityState === "visible") void joinShared(c); };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, []);
}

export const cartTotals = (lines: Line[]) => ({
  count: lines.reduce((n, l) => n + l.qty, 0),
  total: lines.reduce((t, l) => t + (ITEM_BY_ID.get(l.id)?.price ?? 0) * l.qty, 0),
});

/** Blinkit-style ADD button that turns into a − qty + stepper. */
export function AddButton({ id, size = "sm" }: { id: string; size?: "sm" | "lg" }) {
  const { lines } = useCart();
  const qty = lines.find((l) => l.id === id)?.qty ?? 0;
  const item = ITEM_BY_ID.get(id);
  const box = size === "lg" ? "h-12 min-w-36 text-base" : "h-8 min-w-[4.25rem] text-sm";
  if (qty === 0) {
    return (
      <button type="button" onClick={(e) => { e.preventDefault(); changeQty(id, 1); }}
        aria-label={`Add ${item?.name ?? "item"} to cart`}
        className={`${box} rounded-lg border border-accent px-3 font-extrabold shadow-sm ${size === "lg" ? "bg-accent text-accent-ink" : "bg-surface text-accent"}`}>
        {size === "lg" ? "Add to cart" : "ADD"}
      </button>
    );
  }
  return (
    <div className={`${box} flex items-center justify-between rounded-lg bg-accent font-extrabold text-accent-ink`}
      onClick={(e) => e.preventDefault()}>
      <button type="button" onClick={() => changeQty(id, -1)} aria-label={`Remove one ${item?.name ?? "item"}`} className="h-full px-2.5">−</button>
      <span aria-live="polite">{qty}</span>
      <button type="button" onClick={() => changeQty(id, 1)} aria-label={`Add one more ${item?.name ?? "item"}`} className="h-full px-2.5">+</button>
    </div>
  );
}

/** Floating green "View cart" bar above the bottom navigation (URL-aware part streams in; see shell.tsx). */
export const CartBar = () => <Suspense fallback={null}><CartBarInner /></Suspense>;

function CartBarInner() {
  const { lines, code } = useCart();
  const path = usePathname();
  useSharedRefresh();
  // Product pages have their own bottom bar (price + Add to cart), like Blinkit's.
  if (!lines.length || path === "/cart" || path.startsWith("/b/") || path.startsWith("/p/")) return null;
  const { count, total } = cartTotals(lines);
  return (
    <div className="sticky bottom-[4.25rem] z-20 px-3 pb-2">
      <Link href="/cart" className="flex items-center justify-between rounded-xl bg-accent px-4 py-3 text-accent-ink shadow-lg">
        <span className="leading-tight">
          <span className="block font-extrabold">{count} {count === 1 ? "item" : "items"} · {rupees(total)}</span>
          {code && <span className="block text-sm">Shared cart</span>}
        </span>
        <span className="flex items-center gap-1 font-extrabold">View cart <IconRight className="h-5 w-5" /></span>
      </Link>
    </div>
  );
}

/** Past demo orders (this browser only), for the Order Again tab. */
const ORDERS = "demo-orders";
export type PastOrder = { at: string; lines: Line[] };
export function saveOrder(lines: Line[]) {
  try {
    const prev = JSON.parse(localStorage.getItem(ORDERS) ?? "[]") as PastOrder[];
    localStorage.setItem(ORDERS, JSON.stringify([{ at: new Date().toISOString(), lines }, ...prev].slice(0, 10)));
    window.dispatchEvent(new StorageEvent("storage", { key: ORDERS })); // refresh "New for you" tags
  } catch { /* not persisted */ }
}
export function readOrders(): PastOrder[] {
  try { return JSON.parse(localStorage.getItem(ORDERS) ?? "[]"); } catch { return []; }
}

/** Header cart icon with a count, like Blinkit's. */
export function CartIcon() {
  const { count } = cartTotals(useCart().lines);
  return (
    <Link href="/cart" aria-label={`Cart, ${count} items`} className="relative rounded-full bg-surface p-1.5 shadow-sm">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-6 w-6">
        <circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /><path d="M2 3h3l2.5 12h12l2-8H6" />
      </svg>
      {count > 0 && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-accent px-1 text-center text-sm font-bold leading-5 text-accent-ink">{count}</span>}
    </Link>
  );
}
