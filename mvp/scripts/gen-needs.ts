/**
 * Generates and checks search results for the example needs (lib/needs.ts) -> data/needs.json.
 * Same prompt and checks as live search. Run: node scripts/gen-needs.ts
 */
import "./env.ts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { llmJson } from "../lib/llm.ts";
import { SEARCH_SYSTEM, checkSearch, searchInput, type Hit } from "../lib/search.ts";

const OUT = new URL("../data/needs.json", import.meta.url);
// lib/needs.ts imports needs.json, so read the list without importing it.
const NEEDS = [...readFileSync(new URL("../lib/needs.ts", import.meta.url), "utf8").matchAll(/^\s+"([^"]+)",$/gm)].map((m) => m[1]);
const norm = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { needs: {} };
const needs: Record<string, { q: string; hits: Hit[]; note: string | null; model?: string }> = prev.needs ?? {};

for (const q of NEEDS) {
  if (needs[norm(q)] && !process.argv.includes("--fresh")) continue;
  try {
    const r = await llmJson(SEARCH_SYSTEM, searchInput(q), { maxTokens: 1200, geminiTries: 2, geminiTimeoutMs: 12_000, groqTries: 4 });
    const c = checkSearch(r.data, q);
    console.log(`${q}: ${c.hits.length} results${c.problems.length ? `, dropped: ${c.problems.join("; ")}` : ""}`);
    if (c.hits.length) needs[norm(q)] = { q, hits: c.hits, note: c.note, model: r.model };
  } catch (e) {
    console.log(`${q}: skipped (${(e as Error).message.slice(0, 60)})`);
  }
  writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), needs }, null, 1) + "\n");
  await new Promise((r) => setTimeout(r, 4500));
}
console.log(`done: ${Object.keys(needs).length} of ${NEEDS.length}`);
