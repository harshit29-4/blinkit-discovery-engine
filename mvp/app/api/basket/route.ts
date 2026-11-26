/**
 * Shared cart ("Order together"): one short code per cart; anyone in the household with the link sees and edits
 * the same cart. Demo only: nothing is bought, and the cart holds catalogue ids, not personal details.
 * Last write wins, which is fine for a household demo.
 */
import { ITEM_BY_ID } from "@/lib/catalog.ts";
import { cartGet, cartSet, dbReady, type CartLine } from "@/lib/db.ts";

const CODE = /^[a-z0-9]{8}$/;

function newCode(): string {
  const abc = "abcdefghijkmnpqrstuvwxyz23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (n) => abc[n % abc.length]).join("");
}

function cleanLines(v: unknown): CartLine[] | null {
  if (!Array.isArray(v) || v.length > 40) return null;
  const out: CartLine[] = [];
  for (const l of v) {
    const o = (l && typeof l === "object" ? l : {}) as Record<string, unknown>;
    const qty = Number(o.qty);
    if (typeof o.id !== "string" || !ITEM_BY_ID.has(o.id) || !Number.isInteger(qty) || qty < 1 || qty > 20) return null;
    out.push({ id: o.id, qty, by: typeof o.by === "string" ? o.by.slice(0, 40) : null });
  }
  return out;
}

export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code") ?? "";
  if (!CODE.test(code)) return Response.json({ error: "Bad code" }, { status: 400 });
  const lines = await cartGet(code);
  return lines ? Response.json({ code, lines }) : Response.json({ error: "Couldn't load the shared cart" }, { status: 503 });
}

export async function POST(req: Request) {
  if (!dbReady()) return Response.json({ error: "Shared carts aren't set up here." }, { status: 503 });
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const lines = cleanLines(b.lines);
  if (!lines) return Response.json({ error: "Bad cart" }, { status: 400 });
  const code = typeof b.code === "string" && CODE.test(b.code) ? b.code : newCode();
  const saved = await cartSet(code, lines);
  return saved ? Response.json({ code, lines: saved }) : Response.json({ error: "Couldn't save the shared cart. Try again." }, { status: 503 });
}
