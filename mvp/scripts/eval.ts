/**
 * Runs the fixed test set (eval/cases.json) through the same path the app uses (prompt -> checks -> one repair),
 * scores each case, and writes eval/results.json. Publish gate: every card passes the grounding checks and no
 * "not stated" case gets an invented yes/no/partly.
 * Run: npm run eval  (uses GEMINI_API_KEY from the project's .env)
 */
import "./env.ts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ITEM_BY_ID } from "../lib/catalog.ts";
import { CARD_SYSTEM, CARD_VERSION, cardInput, checkCard, type Card } from "../lib/card.ts";
import { llmJson } from "../lib/llm.ts";

type Case = { id: string; shopper: string | null; kind: "not_stated" | "answer" | "ask"; accept: string[]; cite?: string; missing?: string; forbid?: string[] };
const { cases } = JSON.parse(readFileSync(new URL("../eval/cases.json", import.meta.url), "utf8")) as { cases: Case[] };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Resumable: finished cases are kept in eval/progress.json (same card version), so a free-tier outage
// only costs the case it hit. "--fresh" starts over. results.json is written only when every case is done.
const PROGRESS = new URL("../eval/progress.json", import.meta.url);
const fresh = process.argv.includes("--fresh");
const prev = !fresh && existsSync(PROGRESS) ? JSON.parse(readFileSync(PROGRESS, "utf8")) : null;
const done: Record<string, unknown> = prev?.version === CARD_VERSION ? prev.rows : {};
const keyOf = (c: Case) => `${c.id}|${c.shopper ?? ""}`;
const anyOf = (want: string | undefined, got: string[]) => !want || want.split("|").some((k) => got.includes(k));

const OPTS = { geminiTries: 2, geminiTimeoutMs: 12_000, groqTries: 5, groqTimeoutMs: 40_000 };
async function card(c: Case): Promise<{ card: Card | null; problems: string[]; repaired: boolean; model: string }> {
  const item = ITEM_BY_ID.get(c.id)!;
  const shopper = c.shopper ?? undefined;
  const input = cardInput(item, shopper);
  let r = await llmJson(CARD_SYSTEM, input, OPTS);
  let checked = checkCard(r.data, item, shopper);
  if (checked.card) return { ...checked, repaired: false, model: r.model };
  await sleep(4500);
  const fix = `${input}\n\nYour previous card had these problems:\n- ${checked.problems.join("\n- ")}\nReturn a corrected card.`;
  r = await llmJson(CARD_SYSTEM, fix, OPTS);
  checked = checkCard(r.data, item, shopper);
  return { ...checked, repaired: !!checked.card, model: r.model };
}

type Row = ReturnType<typeof makeRow>;
function makeRow(c: Case, r: Awaited<ReturnType<typeof card>>) {
  const v = r.card?.verdict ?? null;
  const row = {
    ...c,
    model: r.model,
    verdict: v,
    answer: r.card?.answer ?? null,
    cites: r.card?.cites ?? [],
    missing: r.card?.missing ?? [],
    checks_pass: !!r.card,
    repaired: r.repaired,
    problems: r.card ? [] : r.problems,
    verdict_ok: !!v && c.accept.includes(v),
    cite_ok: !!r.card && anyOf(c.cite, r.card.cites),
    missing_ok: !!r.card && anyOf(c.missing, r.card.missing),
    invented: c.kind === "not_stated" && !!v && ["yes", "no", "partly"].includes(v),
    forbidden: (c.forbid ?? []).filter((f) => `${r.card?.headline ?? ""} ${r.card?.tip ?? ""} ${r.card?.answer ?? ""}`.toLowerCase().includes(f)),
    pass: false,
  };
  row.pass = row.checks_pass && row.verdict_ok && row.cite_ok && row.missing_ok && row.forbidden.length === 0;
  return row;
}

for (const c of cases) {
  if (done[keyOf(c)]) continue;
  let r;
  try {
    r = await card(c);
  } catch (e) {
    console.log(`SKIP ${c.id} [${c.shopper ?? "-"}]: ${(e as Error).message.slice(0, 50)} (run again to retry)`);
    await sleep(60_000);
    continue;
  }
  const row = makeRow(c, r);
  done[keyOf(c)] = row;
  writeFileSync(PROGRESS, JSON.stringify({ version: CARD_VERSION, rows: done }, null, 1) + "\n");
  console.log(`${row.pass ? "PASS" : "FAIL"} ${c.id} [${c.shopper ?? "-"}] -> ${row.verdict} ${row.pass ? "" : JSON.stringify({ cites: row.cites, missing: row.missing, problems: row.problems })}`);
  await sleep(4500);
}

const missingCases = cases.filter((c) => !done[keyOf(c)]);
if (missingCases.length) {
  console.log(`${missingCases.length} cases still to run; run again to finish. results.json not updated.`);
  process.exit(2);
}
const rows = cases.map((c) => done[keyOf(c)] as Row);
const ns = rows.filter((r) => r.kind === "not_stated");
const ans = rows.filter((r) => r.kind === "answer");
const summary = {
  version: CARD_VERSION,
  models: rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r.model]: (m[r.model] ?? 0) + 1 }), {}),
  run_at: new Date().toISOString(),
  cases: rows.length,
  passed: rows.filter((r) => r.pass).length,
  checks_pass: rows.filter((r) => r.checks_pass).length,
  repaired: rows.filter((r) => r.repaired).length,
  not_stated_cases: ns.length,
  not_stated_correct: ns.filter((r) => r.verdict === "not_stated").length,
  invented_answers: ns.filter((r) => r.invented).length,
  answer_cases: ans.length,
  answer_correct: ans.filter((r) => r.pass).length,
};
const gate = summary.checks_pass === summary.cases && summary.invented_answers === 0;
writeFileSync(new URL("../eval/results.json", import.meta.url), JSON.stringify({ summary: { ...summary, gate_passed: gate }, rows }, null, 1) + "\n");
console.log(JSON.stringify(summary, null, 1));
console.log(gate ? "GATE PASSED" : "GATE FAILED");
process.exitCode = gate ? 0 : 1;
