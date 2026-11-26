/** The pre-generated, pre-checked default cards (data/cards.json, written by scripts/gen-cards.ts). */
import data from "../data/cards.json" with { type: "json" };
import { ATTR_LABEL, ITEMS, rupees, type Item } from "./catalog.ts";
import type { Card, Verdict } from "./card.ts";

const cards = (data as unknown as { cards: Record<string, Card> }).cards;

export const defaultCard = (id: string): Card | null => cards[id] ?? null;

const models = Object.values((data as { models?: Record<string, string> }).models ?? {});
export const CARDS_META = {
  generated_at: data.generated_at,
  version: data.version,
  models: [...new Set(models)].map((m) => `${m} (${models.filter((x) => x === m).length})`).join(", "),
};

export type Teaser = { verdict: Verdict; text: string };

const clip = (s: string, n = 56) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * One line for a product card in a list: the card's headline (an answer, led by what suits the shopper), so a
 * shopper who adds straight from search or a category grid still sees it. No extra model call.
 */
export function cardTeaser(item: Item): Teaser | null {
  const c = cards[item.id];
  return c?.headline ? { verdict: c.verdict, text: clip(c.headline) } : null;
}

/** What a shopper looking at the gap would want, per missing detail (used to label the better pick). */
const WANT: Record<string, string> = {
  exchange: "Want one you can exchange?", size_guide: "Want a clear size guide?", pickup: "Want an easy return pickup?",
  ripeness: "Want them ripe and ready?", ready_in: "Want them ripe and ready?", packed_on: "Want it packed fresh?",
  life_stage: "Want the right life stage?", flavour: "Want the exact flavour?", colour: "Want the colour you know?",
  opening: "Want one that's easy to clean?", inside: "Want one that's easy to clean?",
  fast_charge: "Want one that fast-charges?", works_with: "Want one that lists your phone?",
  marker_type: "Need a whiteboard marker?", size: "Need one that fits A4?", players: "Want one for your group?",
  learn_in: "Want one that's quick to learn?", warranty: "Want a warranty?", auto_off: "Want auto shut-off?",
};

export type BetterPick = { id: string; name: string; price: string; want: string; why: string };

/**
 * When this product's answer isn't a clear yes, a similar product (same category) whose own checked card is a yes
 * on the detail this one lacks, so the shopper still has a way to buy. Computed from the cards, no model call.
 */
export function betterPick(item: Item): BetterPick | null {
  const c = cards[item.id];
  if (!c || c.verdict === "yes") return null;
  for (const key of [...c.missing, ...c.cites]) {
    for (const x of ITEMS) {
      const xc = cards[x.id];
      if (x.id === item.id || x.category !== item.category || !xc || xc.verdict !== "yes") continue;
      if (!(xc.cites.includes(key) || (xc.good ?? []).some((g) => g.cite === key))) continue;
      return {
        id: x.id, name: x.name, price: rupees(x.price),
        want: WANT[key] ?? `Want one that lists the ${(ATTR_LABEL[key] ?? key).toLowerCase()}?`,
        why: clip(xc.headline ?? xc.answer, 64),
      };
    }
  }
  return null;
}
