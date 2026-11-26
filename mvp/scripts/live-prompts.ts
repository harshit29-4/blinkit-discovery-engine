/**
 * Sends eval/live-prompts.json to a deployed app's /api/card, exactly as the "Check it for your situation" box
 * does (no session id, so nothing is logged), and writes eval/live-prompts-results.json for review.
 * Run: node scripts/live-prompts.ts [base url]   (default https://will-it-suit-me.vercel.app)
 * Paced at one request every 6 s to stay under the route's 12-per-minute limit.
 */
import { readFileSync, writeFileSync } from "node:fs";

type P = { group: string; id: string; shopper: string; expect: string };
const base = process.argv[2] ?? "https://will-it-suit-me.vercel.app";
const { prompts } = JSON.parse(readFileSync(new URL("../eval/live-prompts.json", import.meta.url), "utf8")) as { prompts: P[] };
const out = [];

for (const p of prompts) {
  const t0 = Date.now();
  let status = 0;
  let body: Record<string, unknown> = {};
  try {
    const res = await fetch(`${base}/api/card`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: p.id, shopper: p.shopper }),
      signal: AbortSignal.timeout(60_000),
    });
    status = res.status;
    body = await res.json();
  } catch (e) {
    body = { error: (e as Error).message };
  }
  const ms = Date.now() - t0;
  const c = body.card as Record<string, unknown> | undefined;
  const row = {
    ...p, status, ms,
    verdict: c?.verdict ?? null, headline: c?.headline ?? null,
    good: ((c?.good as { text: string }[]) ?? []).map((g) => g.text), tip: c?.tip ?? null, answer: c?.answer ?? null,
    error: body.error ?? null,
  };
  out.push(row);
  console.log(`${String(status).padEnd(4)}${String(ms).padStart(6)}ms  ${p.id} [${p.shopper}] -> ${row.verdict ?? row.error} | ${row.headline ?? ""}`);
  writeFileSync(new URL("../eval/live-prompts-results.json", import.meta.url), JSON.stringify({ base, run_at: new Date().toISOString(), rows: out }, null, 1) + "\n");
  await new Promise((r) => setTimeout(r, 6000));
}
