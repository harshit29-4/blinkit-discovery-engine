/**
 * Need-led search QA (test A4): 12 needs, each with the category that must come back, sent to a running app's
 * search page. Reads the results from the server-rendered HTML (product links), so it tests the real path.
 * Run: node scripts/qa-search.ts [base url]
 */
import { writeFileSync } from "node:fs";
import { ITEM_BY_ID } from "../lib/catalog.ts";

const base = process.argv[2] ?? "https://will-it-suit-me.vercel.app";
const NEEDS: [string, string][] = [
  ["something to keep my cat's tray clean", "pet"],
  ["charger for my Pixel phone", "phone"],
  ["fruit that's ready to eat today", "produce"],
  ["slippers I can wear at home", "footwear"],
  ["need to post a certificate flat", "stationery"],
  ["game for four people after dinner", "games"],
  ["boil water quickly for tea", "appliances"],
  ["earphones for a phone without a headphone jack", "phone"],
  ["kitten food", "pet"],
  ["write on a whiteboard in class", "stationery"],
  ["iron my shirts before work", "appliances"],
  ["salad tonight", "produce"],
];
const rows = [];
for (const [q, want] of NEEDS) {
  const t0 = Date.now();
  const html = await (await fetch(`${base}/search?q=${encodeURIComponent(q)}`)).text();
  const ms = Date.now() - t0;
  const ids = [...new Set([...html.matchAll(/href="\/p\/([a-z0-9-]+)"/g)].map((m) => m[1]))].filter((id) => ITEM_BY_ID.has(id));
  const cats = ids.map((id) => ITEM_BY_ID.get(id)!.category);
  const ai = html.includes("Picks for your need");
  const pass = cats.includes(want as never);
  rows.push({ q, want, pass, ai, ms, results: ids });
  console.log(`${pass ? "PASS" : "FAIL"} A4 "${q}" → ${want}: ${ids.length} results (${ai ? "model" : "keywords"}, ${ms} ms) ${ids.slice(0, 3).join(", ")}`);
  await new Promise((r) => setTimeout(r, 4000));
}
const passed = rows.filter((r) => r.pass).length;
console.log(`\n${passed}/${rows.length} passed`);
writeFileSync(new URL("../eval/qa-search-results.json", import.meta.url),
  JSON.stringify({ base, run_at: new Date().toISOString(), passed, total: rows.length, rows }, null, 1) + "\n");
