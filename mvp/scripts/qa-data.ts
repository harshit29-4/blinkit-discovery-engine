/**
 * Data and design QA (no network): card format, better picks, colour contrast of every text token pair, and no
 * real brand names in the demo catalogue. Tests A2, A6, A7, D3, G3 in TESTING.md.
 * Run: node scripts/qa-data.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { ITEMS, ITEM_BY_ID } from "../lib/catalog.ts";
import { betterPick, defaultCard } from "../lib/cards.ts";

type R = { id: string; test: string; pass: boolean; detail: string };
const results: R[] = [];
const check = (id: string, test: string, pass: boolean, detail = "") => {
  results.push({ id, test, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${id} ${test}${detail ? ` (${detail})` : ""}`);
};

// A2: every item has a card
const missing = ITEMS.filter((x) => !defaultCard(x.id)).map((x) => x.id);
check("A2", `every item has a checked card (${ITEMS.length - missing.length}/${ITEMS.length})`, missing.length === 0, missing.join(", "));

// A7: answer-first format
const fmt: string[] = [];
for (const x of ITEMS) {
  const c = defaultCard(x.id);
  if (!c) continue;
  if (c.headline.includes("?")) fmt.push(`${x.id}: headline is a question`);
  if (c.verdict !== "yes" && !c.tip) fmt.push(`${x.id}: ${c.verdict} without tip`);
  for (const g of c.good) if (!(g.cite in x.attrs)) fmt.push(`${x.id}: good point cites ${g.cite}`);
}
check("A7", "answer-first format holds on every card", fmt.length === 0, fmt.join("; "));

// A6: better picks
const picks: string[] = [];
let pickCount = 0;
for (const x of ITEMS) {
  const p = betterPick(x);
  if (!p) continue;
  pickCount++;
  const y = ITEM_BY_ID.get(p.id);
  if (!y) picks.push(`${x.id}: unknown pick ${p.id}`);
  else {
    if (y.category !== x.category) picks.push(`${x.id} → ${p.id}: other category`);
    if (defaultCard(y.id)?.verdict !== "yes") picks.push(`${x.id} → ${p.id}: pick isn't a yes`);
    if (y.id === x.id) picks.push(`${x.id}: picks itself`);
  }
}
check("A6", `better picks are same-category yes cards (${pickCount} picks)`, picks.length === 0, picks.join("; "));

// D3: contrast of the text/background token pairs the UI uses
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const tok = Object.fromEntries([...css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// [text, background, minimum]: 4.5 for body text, 3 for bold labels ≥ 14 px bold / large
const pairs: [string, string, number][] = [
  ["text", "surface", 4.5], ["text", "bg", 4.5], ["muted", "surface", 4.5], ["muted", "bg", 4.5],
  ["accent", "surface", 4.5], ["accent-ink", "accent", 4.5], ["accent", "accent-soft", 3],
  ["brand-ink", "brand-yellow", 4.5], ["brand-ink-muted", "brand-yellow", 4.5], ["brand-ink", "brand-yellow-soft", 4.5],
  ["brand-ink-muted", "brand-yellow-soft", 4.5], ["info", "surface", 4.5], ["surface", "info", 4.5], ["info", "info-soft", 4.5],
  ["warn", "warn-soft", 4.5], ["warn", "surface", 4.5], ["bad", "bad-soft", 4.5], ["bad", "surface", 4.5],
  ["text", "tile", 4.5], ["text", "tile-2", 4.5], ["surface", "brand-ink", 4.5], ["text", "brand-yellow-soft", 4.5],
];
const low = pairs.map(([f, b, min]) => [f, b, min, ratio(tok[f], tok[b])] as const).filter(([, , min, r]) => r < min)
  .map(([f, b, min, r]) => `${f} on ${b} ${r.toFixed(2)} < ${min}`);
check("D3", `text contrast meets WCAG AA on ${pairs.length} token pairs`, low.length === 0, low.join("; "));

// G3: no real brands in the demo catalogue
const REAL = ["amul", "aashirvaad", "tata", "pedigree", "whiskas", "drools", "boat", "samsung charger", "anker", "mi ", "philips",
  "prestige", "bajaj", "havells", "classmate", "camlin", "faber", "parker", "funskool", "hasbro", "mattel", "bata", "sparx", "crocs"];
const hits = ITEMS.filter((x) => REAL.some((b) => `${x.brand} ${x.name}`.toLowerCase().includes(b))).map((x) => `${x.id} (${x.brand})`);
check("G3", "no real brand names in the catalogue", hits.length === 0, hits.join(", "));

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} passed`);
writeFileSync(new URL("../eval/qa-data-results.json", import.meta.url),
  JSON.stringify({ run_at: new Date().toISOString(), passed, total: results.length, results }, null, 1) + "\n");
process.exitCode = passed === results.length ? 0 : 1;
