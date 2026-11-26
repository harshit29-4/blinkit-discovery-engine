/**
 * Scan the packet: a photo of the pack at home -> the exact catalogue item, or "not stocked" with the closest
 * options. Code checks the matched id exists, and an "exact" match must agree with the brand and flavour/variant
 * the model says it read, so a misread can't silently become the wrong product.
 */
import { ATTR_LABEL, ITEMS, ITEM_BY_ID, type Item } from "./catalog.ts";

export const SCAN_SYSTEM = `You match a photo of a product pack (taken at the shopper's home) to a quick-commerce
catalogue, so they can reorder exactly the same thing.

1. Read the pack: brand, product, variant (flavour, life stage, type, colour) and size. Only write what is legible.
2. Compare with the catalogue lines in the input. "exact": same brand, product and variant. "similar": same kind of
   product but brand or variant differs. "none": nothing comparable.
3. If not exact, list up to 3 closest catalogue ids in "alternatives" and say in "note" what differs
   (e.g. "Same brand, but tuna in jelly, not chicken in gravy").

Return ONLY JSON: {"read": {"brand": str|null, "product": str|null, "variant": str|null, "size": str|null},
"match": "exact"|"similar"|"none", "id": str|null, "alternatives": [str], "note": str|null}`;

const line = (x: Item) => `${x.id} | ${x.name} | ${x.brand} | ${x.unit} | ` +
  Object.entries(x.attrs).map(([k, v]) => `${ATTR_LABEL[k] ?? k}: ${v}`).join("; ");

export const scanCatalogue = () => ITEMS.map(line).join("\n");

export type ScanResult = {
  read: { brand: string | null; product: string | null; variant: string | null; size: string | null };
  match: "exact" | "similar" | "none";
  id: string | null;
  alternatives: string[];
  note: string | null;
};

const s = (v: unknown, max = 120) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

export function checkScan(raw: unknown): { result: ScanResult | null; problems: string[] } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const r = (o.read && typeof o.read === "object" ? o.read : {}) as Record<string, unknown>;
  const problems: string[] = [];
  const read = { brand: s(r.brand), product: s(r.product), variant: s(r.variant), size: s(r.size) };
  let match = (["exact", "similar", "none"] as const).find((m) => m === o.match) ?? null;
  if (!match) problems.push(`bad match ${String(o.match)}`);
  let id = s(o.id);
  if (id && !ITEM_BY_ID.has(id)) { problems.push(`unknown id ${id}`); id = null; }
  const alternatives = (Array.isArray(o.alternatives) ? o.alternatives : [])
    .filter((x): x is string => typeof x === "string" && ITEM_BY_ID.has(x) && x !== id).slice(0, 3);
  let note = s(o.note, 240);

  // An exact match must agree with what was read: brand, and the variant if one was read.
  if (match === "exact") {
    const item = id ? ITEM_BY_ID.get(id)! : null;
    const text = item ? norm(`${item.name} ${item.brand} ${Object.values(item.attrs).join(" ")}`) : "";
    const brandOk = !!item && !!read.brand && text.includes(norm(read.brand));
    const variantOk = !!item && (!read.variant || norm(read.variant).split(" ").filter((w) => w.length > 3).every((w) => text.includes(w)));
    if (!brandOk || !variantOk) {
      match = "similar";
      if (id) alternatives.unshift(id);
      id = null;
      note = note ?? "Couldn't confirm an exact match from the photo. Check these against your pack.";
    }
  }
  if (!match) return { result: null, problems };
  return { result: { read, match, id: match === "exact" ? id : null, alternatives: [...new Set(alternatives)].slice(0, 3), note }, problems };
}
