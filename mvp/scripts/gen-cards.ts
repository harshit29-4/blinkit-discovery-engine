/**
 * Generates the default decision card (no shopper details) for every catalogue item, checks each one,
 * and writes data/cards.json. A card that fails the checks gets one repair attempt with the problems listed;
 * if it still fails it is recorded as a failure and the app shows the plain listing instead.
 * Uses the app's model chain (Gemini, then Groq); the model that answered is recorded per card.
 * Resumable: keeps cards already made with this card version; "--fresh" or item ids redo them.
 * Run: npm run cards  (keys from the project's .env)
 */
import "./env.ts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ITEMS } from "../lib/catalog.ts";
import { CARD_SYSTEM, CARD_VERSION, cardInput, checkCard, type Card } from "../lib/card.ts";
import { llmJson, type LlmResult } from "../lib/llm.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const OUT = new URL("../data/cards.json", import.meta.url);
const args = process.argv.slice(2);
const fresh = args.includes("--fresh");
const only = args.filter((a) => !a.startsWith("--"));
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null;
const keep = prev && prev.version === CARD_VERSION && !fresh;
const cards: Record<string, Card> = keep ? prev.cards : {};
const models: Record<string, string> = keep ? prev.models ?? {} : {};
const failures: Record<string, string[]> = keep ? prev.failures : {};
let tokens = keep ? prev.tokens : 0;
let repaired = keep ? prev.repaired : 0;
const save = () => writeFileSync(OUT, JSON.stringify(
  { version: CARD_VERSION, generated_at: new Date().toISOString(), tokens, repaired, models, cards, failures }, null, 1) + "\n");
const opts = { geminiTries: 2, geminiTimeoutMs: 12_000, groqTries: 5, groqTimeoutMs: 40_000 };

for (const item of ITEMS.filter((x) => (only.length ? only.includes(x.id) : !cards[x.id]))) {
  const input = cardInput(item);
  let r: LlmResult;
  try {
    r = await llmJson(CARD_SYSTEM, input, opts);
  } catch (e) {
    console.log(`${item.id}: skipped (${(e as Error).message.slice(0, 80)}); run again to retry`);
    await sleep(15_000);
    continue;
  }
  tokens += r.tokens;
  let checked = checkCard(r.data, item);
  if (!checked.card) {
    const fix = `${input}\n\nYour previous card had these problems:\n- ${checked.problems.join("\n- ")}\nReturn a corrected card.`;
    try {
      r = await llmJson(CARD_SYSTEM, fix, opts);
      tokens += r.tokens;
      checked = checkCard(r.data, item);
      if (checked.card) repaired++;
    } catch { /* keep the failed check result */ }
  }
  if (checked.card) { cards[item.id] = checked.card; models[item.id] = r.model; delete failures[item.id]; }
  else failures[item.id] = checked.problems;
  save();
  console.log(`${item.id}: ${checked.card ? `${checked.card.verdict} (${r.model})` : "FAILED " + checked.problems.join("; ")}`);
  await sleep(3000);
}

save();
const byModel = Object.values(models).reduce<Record<string, number>>((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {});
console.log(`done: ${Object.keys(cards).length} cards (${JSON.stringify(byModel)}), ${repaired} repaired, ${Object.keys(failures).length} failed, ${tokens} tokens`);
