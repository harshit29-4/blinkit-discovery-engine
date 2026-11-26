/** Client-side usage events (page views, searches, shares, replies). Server-side events are logged in their own routes. */
import { ITEM_BY_ID } from "@/lib/catalog.ts";
import { logEvent } from "@/lib/db.ts";
import { SHOPPERS } from "@/lib/shoppers.ts";

const KINDS = new Set(["view", "search", "share", "reply", "cart_add", "order"]);

export async function POST(req: Request) {
  let b: Record<string, unknown>;
  try {
    b = JSON.parse(await req.text());
  } catch {
    return new Response(null, { status: 400 });
  }
  const session = typeof b.session === "string" && /^[a-z0-9-]{8,40}$/.test(b.session) ? b.session : null;
  const kind = typeof b.kind === "string" && KINDS.has(b.kind) ? (b.kind as "view") : null;
  if (!session || !kind) return new Response(null, { status: 400 });
  const item = typeof b.item === "string" && ITEM_BY_ID.has(b.item) ? b.item : null;
  const shopper = SHOPPERS.some((s) => s.id === b.shopper) ? (b.shopper as string) : null;
  // Keep only short string fields in detail (e.g. the search text, the reply).
  const detail = Object.fromEntries(Object.entries((b.detail && typeof b.detail === "object" ? b.detail : {}) as Record<string, unknown>)
    .filter(([k, v]) => k.length <= 20 && (typeof v === "string" || typeof v === "boolean")).slice(0, 5)
    .map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 200) : v]));
  await logEvent({ session, shopper, kind, item, detail });
  return new Response(null, { status: 204 });
}
