/**
 * Need-led search: "something to play on a train with my 8-year-old" -> products, across categories, each
 * with a one-line reason taken from its listing. Code checks every id exists and every number in a reason
 * appears in that product's listing or the shopper's words. Falls back to keyword search if the model fails.
 */
import { ATTR_LABEL, ITEMS, ITEM_BY_ID, rupees, type Item } from "./catalog.ts";
import { numbersIn } from "./card.ts";

export const SEARCH_SYSTEM = `You help a shopper on a quick-commerce app find products for a need, including in
categories they may never have bought. You get the shopper's need and the full catalogue (one product per line).

Pick up to 6 products that fit the need, best first. For each, "why": one short plain-English phrase (max 110
characters, not a list of fields) taken ONLY from that product's listed details, ideally the detail that decides
it for this need, e.g. "Two or more can play, and it takes about 5 minutes to learn" or "Fits A4 papers unfolded".
Write it as a sentence fragment, never as a list like "Age: 7+; Players: 2-8". Never invent details or use outside
knowledge.
If something important for the need isn't listed for a product, you may still include it and say so in "why"
("ripeness not stated"). If nothing in the catalogue fits, return no results and say so in "note".

Return ONLY JSON: {"results": [{"id": str, "why": str}], "note": str|null}`;

const line = (x: Item) =>
  `${x.id} | ${x.name} | ${x.brand} | ${x.unit} | ${rupees(x.price)} | ` +
  Object.entries(x.attrs).map(([k, v]) => `${ATTR_LABEL[k] ?? k}: ${v}`).join("; ");

export const searchInput = (q: string) => `Need: ${q}\n\nCatalogue:\n${ITEMS.map(line).join("\n")}`;

export type Hit = { id: string; why: string };

export function checkSearch(raw: unknown, q: string): { hits: Hit[]; note: string | null; problems: string[] } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const problems: string[] = [];
  const hits: Hit[] = [];
  for (const r of Array.isArray(o.results) ? o.results.slice(0, 6) : []) {
    const id = (r as Record<string, unknown>)?.id;
    const why = (r as Record<string, unknown>)?.why;
    const item = typeof id === "string" ? ITEM_BY_ID.get(id) : undefined;
    if (!item) { problems.push(`unknown id ${String(id)}`); continue; }
    if (typeof why !== "string" || !why.trim() || why.length > 160) { problems.push(`${item.id}: bad reason`); continue; }
    const known = new Set(numbersIn([item.name, item.unit, String(item.price), ...Object.values(item.attrs), q].join(" ")));
    const bad = numbersIn(why).filter((n) => !known.has(n));
    if (bad.length) { problems.push(`${item.id}: number ${bad.join(", ")} not in listing`); continue; }
    if (!hits.some((h) => h.id === item.id)) hits.push({ id: item.id, why: why.trim() });
  }
  const note = typeof o.note === "string" && o.note.trim() ? o.note.trim().slice(0, 200) : null;
  return { hits, note, problems };
}

/** Plain keyword fallback: score items by query words found in their text. */
export function keywordSearch(q: string): Hit[] {
  const words = q.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  return ITEMS.map((x) => {
    const text = `${x.name} ${x.brand} ${Object.values(x.attrs).join(" ")}`.toLowerCase();
    return { x, score: words.filter((w) => text.includes(w)).length };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 6)
    .map((r) => ({ id: r.x.id, why: "Matches the words you typed" }));
}

/**
 * Display tidy-up for a reason: drops one that only repeats the product name, and turns "A: x; B: y" lists into
 * "A: x · B: y". Text is unchanged otherwise, so the grounding check above still applies to every word shown.
 */
export function tidyWhy(why: string, item: Item): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!norm(why) || norm(item.name).includes(norm(why))) return null;
  const t = why.replace(/\s*;\s*/g, " · ").replace(/\.$/, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}
