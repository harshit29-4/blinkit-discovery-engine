/**
 * Ask engine eval (docs/ask-test-plan.md, group A). Calls the agent directly, so it skips the site's
 * rate guard and answer cache but uses the real models, tools and data. Costs AI quota: ~4 model calls
 * per case on Gemini's free allowance, plus one judge call on Groq.
 *
 *   npm run eval:ask                 all cases
 *   npm run eval:ask -- A4 A7        only these cases
 *
 * Prints one line per case and writes the full answers to scripts/ask-eval/results/ (git-ignored).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { CASES, THIN, type Case } from "./cases"; // resolved to cases.ts by hooks.mjs

const web = new URL("../../", import.meta.url);
const { answerQuestion } = await import(new URL("lib/agent/run.ts", web).href);
const { select } = await import(new URL("lib/supabase.ts", web).href);
const { checkFraming } = await import(new URL("lib/agent/checks.ts", web).href);

// The same data overview the API route gives the agent.
async function overview(): Promise<string> {
  const { rpc } = await import(new URL("lib/supabase.ts", web).href);
  const name: Record<string, string> = { play_store: "Google Play reviews", app_store: "App Store reviews",
    reddit_post: "Reddit posts", reddit_comment: "Reddit comments", reddit: "Reddit", youtube_comment: "YouTube comments" };
  const [counts, tagged] = await Promise.all([
    select("v_source_counts", { select: "*" }).then((r: { rows: { source: string; items: number }[] }) => r.rows),
    rpc("count_feedback", { group_by: "source" }) as Promise<{ value: string; entries: number }[]>,
  ]);
  return `collected entries: ${counts.map((c: { source: string; items: number }) => `${c.items} ${name[c.source] ?? c.source}`).join(", ")}. Of these, a random ` +
    `sample of relevant entries has been tagged by AI (barriers, categories, sentiment, funnel stage, etc.): ` +
    `${tagged.map((t) => `${t.entries} ${name[t.value] ?? t.value}`).join(", ")}. Keyword search covers all collected ` +
    `entries; counts cover the tagged sample only.`;
}

const DECLINE = /can only|only (?:answer|provide|help)|outside|unrelated|not (?:able|something)|can.?t (?:help|answer|write|provide)|cannot|won.?t|research (?:question|project)|ask (?:about|me)|can answer questions|you can ask|you can use|does not contain|doesn.?t contain/i;
const MARKUP = /\[(?:research_topic|search_feedback|count_feedback|get_themes|get_reliability)\]|<\/?tool_call>|"tool_calls"/;

type Result = { id: string; ok: boolean; fails: string[]; secs: number; model?: string; fallback?: string | null; answer?: string;
  checks?: unknown; steps?: string[]; error?: string };

async function runCase(c: Case, ov: string): Promise<Result> {
  const t = Date.now();
  try {
    const a = await answerQuestion(c.question, c.history ?? [], ov);
    const secs = (Date.now() - t) / 1000;
    const fails: string[] = [];
    const text: string = a.answer;
    const e = c.expect;
    if (!text.trim() || /could not finish this answer/.test(text)) fails.push("empty or unfinished answer");
    if (secs > 45) fails.push(`slow (${secs}s)`);
    if (!a.checks.citations.ok) fails.push(`citation check: ${a.checks.citations.missing ? "none cited" : a.checks.citations.unknown.join(",")}`);
    if (!a.checks.numbers.ok) fails.push(`unverified numbers: ${a.checks.numbers.unverified.join(", ")}`);
    const f = a.checks.faithfulness;
    if (!e.decline && !e.skipJudge && f.score !== null && f.score < 0.7) fails.push(`judge ${f.score}: ${f.unsupported.join(" | ")}`);
    if (MARKUP.test(text)) fails.push("tool markup in text");
    if (e.cites && !a.citations.length) fails.push("no citations");
    if (e.thin && !THIN.test(text)) fails.push("does not say the evidence is thin");
    if (e.decline && (!DECLINE.test(text) || a.citations.length > 0)) fails.push("did not decline cleanly");
    const framing = e.noAvoidClaim ? checkFraming(text) : null; // the same check the engine runs
    if (framing) fails.push(`avoid-claim: "${framing}"`);
    for (const re of e.match ?? []) if (!re.test(text)) fails.push(`missing ${re}`);
    for (const re of e.noMatch ?? []) if (re.test(text)) fails.push(`must not match ${re}`);
    return { id: c.id, ok: fails.length === 0, fails, secs, model: a.model, fallback: a.fallback, answer: text,
      checks: a.checks, steps: a.steps.map((s: { tool: string; args: unknown; summary: string }) => `${s.tool} ${JSON.stringify(s.args)} -> ${s.summary}`) };
  } catch (err) {
    return { id: c.id, ok: false, fails: ["crashed"], secs: (Date.now() - t) / 1000, error: String((err as Error).message ?? err).slice(0, 300) };
  }
}

const only = process.argv.slice(2).filter((a) => /^A\d+$/.test(a));
const cases = only.length ? CASES.filter((c) => only.includes(c.id)) : CASES;
const ov = await overview();
const results: Result[] = [];
for (const c of cases) {
  const r = await runCase(c, ov);
  results.push(r);
  console.log(`${r.ok ? "PASS" : "FAIL"} ${c.id.padEnd(4)} ${c.kind.padEnd(20)} ${String(r.secs).padStart(5)}s ${(r.model ?? "-").padEnd(22)} ${r.fails.join("; ")}${r.error ? ` ${r.error}` : ""}`);
  await new Promise((res) => setTimeout(res, 8000)); // stay under Gemini's free per-minute limit (3 s was too short)
}
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
const dir = new URL("results/", import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL(`eval-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, dir), JSON.stringify(results, null, 1));
process.exitCode = passed === results.length ? 0 : 1;
