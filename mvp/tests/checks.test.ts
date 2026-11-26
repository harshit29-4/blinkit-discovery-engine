/** Offline tests for the checks that sit between the model and the shopper (no network). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ITEM_BY_ID, ITEMS, UNSTATED } from "../lib/catalog.ts";
import { checkCard, numbersIn } from "../lib/card.ts";
import { checkSearch, keywordSearch } from "../lib/search.ts";
import { checkScan } from "../lib/scan.ts";

const kettle = ITEM_BY_ID.get("kettle-1-5l")!;
const charger = ITEM_BY_ID.get("charger-33w")!;

test("catalogue: ids unique, unstated details really absent", () => {
  assert.equal(new Set(ITEMS.map((x) => x.id)).size, ITEMS.length);
  for (const [id, keys] of Object.entries(UNSTATED)) {
    const item = ITEM_BY_ID.get(id);
    assert.ok(item, id);
    for (const k of keys) assert.ok(!(k in item.attrs), `${id}.${k}`);
  }
});

test("numbersIn normalises commas and keeps decimals", () => {
  assert.deepEqual(numbersIn("1,350 W and 1.5 litres, UK 8"), ["1350", "1.5", "8"]);
  assert.deepEqual(numbersIn("fits A4 and C4, like my M14"), []);
});

test("answer-first: headline must be a statement, good points must cite the listing, gaps need a tip", () => {
  const base = { question: "Easy to clean?", verdict: "not_stated", answer: "The seller hasn't said.", cites: [], missing: ["opening"], also: [] };
  assert.ok(checkCard({ ...base, headline: "Stainless steel inside, 1.5 litres", good: [{ text: "Stainless steel", cite: "inside" }], tip: "Ask for a photo of the inside." }, kettle).card);
  assert.match(checkCard({ ...base, headline: "Can you clean it?", good: [], tip: "x" }, kettle).problems.join(), /question/);
  assert.match(checkCard({ ...base, headline: "Easy to clean", good: [{ text: "Wide mouth", cite: "opening" }], tip: "x" }, kettle).problems.join(), /good point cites opening/);
  assert.match(checkCard({ ...base, headline: "Stainless steel inside", good: [], tip: null }, kettle).problems.join(), /without a tip/);
  assert.match(checkCard({ ...base, headline: "Holds 3 litres", good: [], tip: "x" }, kettle).problems.join(), /headline: number 3/);
});

test("house rules: never send the shopper elsewhere; never call the price or brand missing", () => {
  const base = { headline: "Fast-charges Galaxy phones", good: [], question: "Fast?", verdict: "not_stated", answer: "Not stated.", cites: [], also: [] };
  assert.match(checkCard({ ...base, missing: ["waterproof"], tip: "Check the Amazon listing." }, charger).problems.join(), /amazon/i);
  assert.match(checkCard({ ...base, missing: ["waterproof"], tip: "Buy one elsewhere." }, charger).problems.join(), /elsewhere/i);
  assert.match(checkCard({ ...base, missing: ["price"], tip: "Check the label." }, charger).problems.join(), /page always shows it/);
  assert.ok(checkCard({ ...base, missing: ["waterproof"], tip: "Check your phone's charging standard." }, charger).card);
});

test("house rules: no connector the listing and shopper never mentioned", () => {
  const ear = ITEM_BY_ID.get("earphones-typec")!;
  const base = { headline: "USB-C earphones", good: [], question: "Fit?", verdict: "ask", answer: "Works with USB-C phones.", cites: ["connector"], missing: [], ask: "Does your phone have USB-C?", also: [] };
  assert.match(checkCard({ ...base, tip: "iPhone 11 uses Lightning, so get Lightning earphones." }, ear, "I have an iPhone 11").problems.join(), /lightning/);
  assert.ok(checkCard({ ...base, tip: "Check your phone has a USB-C port." }, ear, "I have an iPhone 11").card);
  assert.ok(checkCard({ ...base, tip: "Lightning won't fit, as you said." }, ear, "my phone has a Lightning port").card);
});

test("a grounded card passes", () => {
  const r = checkCard({ headline: "Fast-charges your phone", good: [], tip: "Check your model.", question: "Will it fast-charge your phone?", verdict: "yes", answer: "Yes: 33 W with USB PD 3.0.",
    cites: ["wattage", "fast_charge"], missing: [], ask: null, also: [] }, charger);
  assert.deepEqual(r.problems, []);
  assert.equal(r.card?.verdict, "yes");
});

test("citing a detail the listing doesn't state fails", () => {
  const r = checkCard({ headline: "Fast-charges your phone", good: [], tip: "Check your model.", question: "Easy to clean?", verdict: "yes", answer: "Yes, wide opening.", cites: ["opening"], missing: [], also: [] }, kettle);
  assert.equal(r.card, null);
  assert.match(r.problems.join(), /opening/);
});

test("an invented number fails", () => {
  const r = checkCard({ headline: "Fast-charges your phone", good: [], tip: "Check your model.", question: "Big enough?", verdict: "yes", answer: "Holds 2 litres.", cites: ["capacity"], missing: [], also: [] }, kettle);
  assert.equal(r.card, null);
  assert.match(r.problems.join(), /number 2/);
});

test("numbers from the shopper's own words are allowed", () => {
  const r = checkCard({ headline: "Fast-charges your phone", good: [], tip: "Check your model.", question: "Will it fit?", verdict: "ask", answer: "Sizes are listed in UK sizes; you said 8.", cites: ["sizes"],
    missing: [], ask: "Your foot length?", also: [] }, ITEM_BY_ID.get("slippers-cloud")!, "I wear UK 8");
  assert.deepEqual(r.problems, []);
});

test("not stated must name what is missing, and may name something never listed", () => {
  assert.equal(checkCard({ headline: "Fast-charges your phone", good: [], tip: "Check your model.", question: "Hand fits inside?", verdict: "not_stated", answer: "The seller hasn't said.", cites: [], missing: [], also: [] }, kettle).card, null);
  assert.ok(checkCard({ headline: "Fast-charges your phone", good: [], tip: "Check your model.", question: "Waterproof?", verdict: "not_stated", answer: "The seller hasn't said.", cites: [], missing: ["waterproof"], also: [] }, kettle).card);
  assert.ok(checkCard({ headline: "Fast-charges your phone", good: [], tip: "Check your model.", question: "Hand fits inside?", verdict: "not_stated", answer: "Not stated.", cites: [], missing: ["opening (Mouth opening)"], also: [] }, kettle).card);
});

test("saying a stated detail is missing fails", () => {
  const r = checkCard({ headline: "Fast-charges your phone", good: [], tip: "Check your model.", question: "Auto off?", verdict: "not_stated", answer: "Not stated.", cites: [], missing: ["auto_off"], also: [] }, kettle);
  assert.equal(r.card, null);
});

test("a yes without any citation fails; ask needs a question", () => {
  assert.equal(checkCard({ headline: "Fast-charges your phone", good: [], tip: "Check your model.", question: "Good?", verdict: "yes", answer: "Yes.", cites: [], missing: [], also: [] }, kettle).card, null);
  assert.equal(checkCard({ headline: "Fast-charges your phone", good: [], tip: "Check your model.", question: "Fits your phone?", verdict: "ask", answer: "Works with USB-C phones.", cites: ["works_with"], missing: [], ask: null, also: [] }, charger).card, null);
});

test("a bad 'also' check fails the whole card", () => {
  const r = checkCard({ headline: "Fast-charges your phone", good: [], tip: "Check your model.", question: "Will it fast-charge?", verdict: "yes", answer: "Yes, USB PD 3.0.", cites: ["fast_charge"], missing: [],
    also: [{ question: "Waterproof?", verdict: "yes", answer: "Yes.", cites: ["waterproof"], missing: [] }] }, charger);
  assert.equal(r.card, null);
});

test("search drops unknown ids and invented numbers, keeps the rest", () => {
  const r = checkSearch({ results: [
    { id: "envelope-a4", why: "Fits A4 unfolded (32.4 × 22.9 cm)" },
    { id: "nope", why: "x" },
    { id: "envelope-dl", why: "Holds 50 sheets" },
  ], note: null }, "envelope for A4 papers");
  assert.deepEqual(r.hits.map((h) => h.id), ["envelope-a4"]);
  assert.equal(r.problems.length, 2);
});

test("keyword fallback finds envelopes", () => {
  assert.ok(keywordSearch("A4 envelope").some((h) => h.id === "envelope-a4"));
});

test("scan: exact match must agree with the brand and variant read", () => {
  const ok = checkScan({ read: { brand: "Purrfect Bowl", product: "cat food", variant: "chicken in gravy", size: "85 g" }, match: "exact", id: "cat-chicken-gravy", alternatives: [] });
  assert.equal(ok.result?.match, "exact");
  const wrongVariant = checkScan({ read: { brand: "Purrfect Bowl", product: "cat food", variant: "tuna in jelly", size: "85 g" }, match: "exact", id: "cat-chicken-gravy", alternatives: [] });
  assert.equal(wrongVariant.result?.match, "similar");
  assert.equal(wrongVariant.result?.id, null);
  const noBrand = checkScan({ read: { brand: null, product: "cat food", variant: null, size: null }, match: "exact", id: "cat-chicken-gravy", alternatives: [] });
  assert.equal(noBrand.result?.match, "similar");
});

test("house rules: connector terms with dots and dashes are matched", () => {
  const charger = ITEM_BY_ID.get("charger-basic")!;
  const base = { headline: "12 W USB-A charger", good: [], question: "Fast?", verdict: "not_stated", answer: "Not stated.", cites: [], missing: ["fast_charge"], also: [] };
  assert.match(checkCard({ ...base, tip: "Old phones use Micro-USB cables." }, charger).problems.join(), /micro-usb/);
  assert.match(checkCard({ ...base, tip: "Or use a 3.5 mm adapter." }, charger).problems.join(), /3\.5 mm/);
});
