/** Try one card: node scripts/try-card.ts <item-id> [shopper words...] [--groq]  (--groq skips Gemini) */
import "./env.ts";
import { ITEM_BY_ID } from "../lib/catalog.ts";
import { CARD_SYSTEM, cardInput, checkCard } from "../lib/card.ts";
import { llmJson } from "../lib/llm.ts";

const args = process.argv.slice(2);
const groq = args.includes("--groq");
const [id, ...rest] = args.filter((a) => a !== "--groq");
const item = ITEM_BY_ID.get(id)!;
const shopper = rest.join(" ") || undefined;
const input = cardInput(item, shopper);
let r = await llmJson(CARD_SYSTEM, input, { only: groq ? "groq" : undefined, groqTimeoutMs: 40_000 });
let c = checkCard(r.data, item, shopper);
let repaired = false;
if (!c.card) {
  const fix = `${input}\n\nYour previous card had these problems:\n- ${c.problems.join("\n- ")}\nReturn a corrected card.`;
  r = await llmJson(CARD_SYSTEM, fix, { only: groq ? "groq" : undefined, groqTimeoutMs: 40_000 });
  c = checkCard(r.data, item, shopper);
  repaired = true;
}
console.log(JSON.stringify({ model: r.model, repaired, problems: c.problems, verdict: c.card?.verdict, headline: c.card?.headline, tip: c.card?.tip, answer: c.card?.answer }));
