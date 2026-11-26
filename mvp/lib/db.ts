/**
 * Server-only access to the MVP's two Supabase tables (shared carts, usage events) with the service key.
 * Logging never breaks a page: failures are swallowed with a warning.
 */
import "server-only";

const base = () => {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "").replace(/\/rest\/v1$|\/rest$/, "");
  const key = process.env.SUPABASE_SECRET_KEY;
  return url && key ? { url: `${url}/rest/v1`, key } : null;
};

async function call(path: string, init: RequestInit): Promise<Response | null> {
  const b = base();
  if (!b) return null;
  return fetch(`${b.url}${path}`, {
    ...init,
    headers: { apikey: b.key, Authorization: `Bearer ${b.key}`, "Content-Type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
}

export const dbReady = () => base() !== null;

export type EventKind = "view" | "card_check" | "search" | "scan" | "share" | "reply" | "cart_add" | "order";

export async function logEvent(e: { session: string; shopper?: string | null; kind: EventKind; item?: string | null; detail?: object }) {
  try {
    const r = await call("/mvp_events", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ session: e.session, shopper: e.shopper ?? null, kind: e.kind, item: e.item ?? null, detail: e.detail ?? {} }),
    });
    if (r && !r.ok) console.warn("event not logged", r.status);
  } catch (err) {
    console.warn("event not logged", (err as Error).message);
  }
}

/** A shared cart line: catalogue id, quantity, and which demo persona added it. */
export type CartLine = { id: string; qty: number; by: string | null };

export async function cartSet(code: string, lines: CartLine[]): Promise<CartLine[] | null> {
  const r = await call("/rpc/mvp_basket_set", { method: "POST", body: JSON.stringify({ p_code: code, p_items: lines }) });
  return r?.ok ? ((await r.json()) as CartLine[]) : null;
}

export async function cartGet(code: string): Promise<CartLine[] | null> {
  const r = await call(`/mvp_baskets?select=items&code=eq.${encodeURIComponent(code)}`, { method: "GET" });
  if (!r?.ok) return null;
  const rows = (await r.json()) as { items: CartLine[] }[];
  return rows[0]?.items ?? [];
}
