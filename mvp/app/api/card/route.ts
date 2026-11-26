/**
 * Live decision card: re-answers the deciding question for what the shopper told us (their phone, their
 * foot size, when they need it). Same prompt and checks as the pre-generated cards; a card that fails the
 * checks gets one repair attempt, and if it still fails the shopper sees a plain "couldn't check" message.
 */
import { ITEM_BY_ID } from "@/lib/catalog.ts";
import { defaultCard } from "@/lib/cards.ts";
import { CARD_SYSTEM, cardInput, checkCard, type Card } from "@/lib/card.ts";
import { llmJson } from "@/lib/llm.ts";
import { logEvent } from "@/lib/db.ts";
import { SHOPPERS } from "@/lib/shoppers.ts";

const cache = new Map<string, Card>();
const hits = new Map<string, number[]>();
const LIMIT_PER_MIN = 12;

function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > LIMIT_PER_MIN;
}

export async function POST(req: Request) {
  let body: { id?: unknown; shopper?: unknown; session?: unknown; persona?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const item = typeof body.id === "string" ? ITEM_BY_ID.get(body.id) : undefined;
  const shopper = typeof body.shopper === "string" ? body.shopper.trim().slice(0, 160) : "";
  if (!item || !shopper) return Response.json({ error: "Tell us a little about what you need first." }, { status: 400 });
  if (limited(req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local")) {
    return Response.json({ error: "Too many checks in a minute. Try again shortly." }, { status: 429 });
  }

  // Usage log: the verdict only, never what the shopper typed.
  const session = typeof body.session === "string" && /^[a-z0-9-]{8,40}$/.test(body.session) ? body.session : null;
  const persona = SHOPPERS.some((s) => s.id === body.persona) ? (body.persona as string) : null;
  const log = (detail: object) => (session ? logEvent({ session, shopper: persona, kind: "card_check", item: item.id, detail }) : Promise.resolve());

  const key = `${item.id}|${shopper.toLowerCase()}`;
  const cached = cache.get(key);
  if (cached) {
    await log({ verdict: cached.verdict, cached: true });
    return Response.json({ card: cached, cached: true });
  }

  try {
    const input = cardInput(item, shopper);
    let r = await llmJson(CARD_SYSTEM, input, { geminiTimeoutMs: 7_000, groqTimeoutMs: 15_000, groqTries: 2 });
    let checked = checkCard(r.data, item, shopper);
    if (!checked.card) {
      const fix = `${input}\n\nYour previous card had these problems:\n- ${checked.problems.join("\n- ")}\nReturn a corrected card.`;
      r = await llmJson(CARD_SYSTEM, fix, { geminiTimeoutMs: 7_000, groqTimeoutMs: 15_000, groqTries: 2 });
      checked = checkCard(r.data, item, shopper);
    }
    if (!checked.card) {
      console.warn("card failed checks", item.id, checked.problems);
      await log({ verdict: null, failed: "checks" });
      // Fall back to this product's pre-checked card rather than an error: still grounded, just not personalised.
      const fallback = defaultCard(item.id);
      if (fallback) return Response.json({ card: fallback, note: "We couldn't check your exact situation, so this is the general answer for this product." });
      return Response.json({ error: "We couldn't check this reliably. The listing details below are what the seller states." }, { status: 502 });
    }
    if (cache.size > 500) cache.clear();
    cache.set(key, checked.card);
    await log({ verdict: checked.card.verdict, model: r.model });
    return Response.json({ card: checked.card });
  } catch (e) {
    console.warn("card model error", item.id, (e as Error).message);
    if (!process.env.GEMINI_API_KEY && !process.env.MVP_GROQ_API_KEY) {
      return Response.json({ error: "The checker isn't set up on this server (no AI key)." }, { status: 503 });
    }
    await log({ verdict: null, failed: "model" });
    return Response.json({ error: "The checker is busy right now. Try again in a minute." }, { status: 503 });
  }
}
