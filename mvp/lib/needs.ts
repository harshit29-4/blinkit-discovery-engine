/**
 * The example needs shown as chips (home screen and empty search). Their results are generated and checked once
 * (scripts/gen-needs.ts -> data/needs.json), so tapping a chip is instant; typed searches go to the model live.
 */
import data from "../data/needs.json" with { type: "json" };
import type { Hit } from "./search.ts";

export const NEEDS = [
  "Envelope for paperwork tomorrow",
  "Game for a train with my 8-year-old",
  "Fast charger for a Samsung Galaxy A35",
  "Tomatoes for dinner tonight",
  "Food for my adult cat, chicken flavour",
  "Kettle that's easy to clean inside",
];

export const normNeed = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const pre = (data as { needs: Record<string, { hits: Hit[]; note: string | null }> }).needs;
export const precomputedNeed = (q: string) => pre[normNeed(q)] ?? null;
