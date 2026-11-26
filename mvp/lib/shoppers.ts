/**
 * Demo shoppers with a simulated order history, so the app can mark categories that are new for them.
 * Invented personas shaped like the interview segment (routine top-up shoppers), not real people.
 */
import type { CategoryId } from "./catalog.ts";

export type Shopper = { id: string; name: string; short: string; about: string; bought: string[] };

export const SHOPPERS: Shopper[] = [
  { id: "flat", name: "Flat of three", short: "Flatmates", about: "Students sharing a flat; one account orders for everyone",
    bought: ["snacks", "dairy", "household", "produce"] },
  { id: "cat", name: "Lives alone with a cat", short: "Solo + cat", about: "Works from home; quick top-ups between calls",
    bought: ["dairy", "snacks", "beverages", "produce", "phone"] },
  { id: "family", name: "Family with an 8-year-old", short: "Family", about: "Either parent orders; big shop done in person",
    bought: ["staples", "dairy", "snacks", "personal_care"] },
];

export const DEFAULT_SHOPPER = "flat";
export const shopperById = (id: string | null | undefined) => SHOPPERS.find((s) => s.id === id) ?? SHOPPERS[0];
export const isNewFor = (s: Shopper, c: CategoryId) => !s.bought.includes(c);
