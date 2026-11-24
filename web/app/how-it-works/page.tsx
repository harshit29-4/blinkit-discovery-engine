import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Card, Skeleton } from "@/components/ui";
import { getAiUsage, getFunnel, getSourceCounts, SOURCE_LABEL, type AiUsage } from "@/lib/data";
import { fmtInt, pct } from "@/lib/format";

export const metadata: Metadata = { title: "How it works" };

export default function HowItWorksPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">How the discovery engine works</h1>
        <p className="mt-1 max-w-3xl text-muted">
          Public feedback is collected every hour and passed through a sequence of deterministic and AI stages.
          Each stage below shows live counts from the database, so the path from raw feedback to structured
          evidence can be followed and checked end to end.
        </p>
      </div>
      <Suspense fallback={<Skeleton h="h-[40rem]" />}>
        <Pipeline />
      </Suspense>
      <Suspense fallback={<Skeleton h="h-48" />}>
        <Usage />
      </Suspense>
    </div>
  );
}

function Stage({ n, title, method, children, status = "live" }: {
  n: number; title: string; method: string; children: ReactNode; status?: "live" | "planned";
}) {
  return (
    <li className="relative rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold tracking-tight">
          <span className="mr-2 text-muted tabular-nums">{n}.</span>{title}
        </h2>
        <span className={`rounded-full px-2 py-0.5 text-sm font-medium ${status === "live" ? "bg-accent-soft text-accent" : "bg-border text-text"}`}>
          {status === "live" ? "Running hourly" : "In development"}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">{method}</p>
      <div className="mt-3 text-sm">{children}</div>
    </li>
  );
}

function Metric({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="min-w-36">
      <p className="text-muted">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      {note && <p className="text-muted">{note}</p>}
    </div>
  );
}

async function Pipeline() {
  const [f, counts] = await Promise.all([getFunnel(), getSourceCounts()]);
  if (!f) return <Card><p className="text-muted">Pipeline figures are not available yet.</p></Card>;
  const candRate = pct(f.candidates_relevant, f.candidates_checked);
  const ctrlRate = f.control_checked ? f.control_relevant / f.control_checked : 0;
  const nonCandidates = f.excluded + f.control_sample;
  const estMissed = Math.round(ctrlRate * nonCandidates);
  const estFound = f.candidates_checked ? Math.round((f.candidates_relevant / f.candidates_checked) * f.candidates) : 0;
  const recall = estFound + estMissed ? pct(estFound, estFound + estMissed) : 0;
  // Entries are processed in a fixed random order, so the tagged set is a random sample at any point.
  const estRelevant = estFound + estMissed;
  const moe = f.tagged ? 1.96 * Math.sqrt(0.25 / f.tagged) * 100 : null; // worst-case 95% margin for a proportion
  return (
    <ol className="space-y-4">
      <Stage n={1} title="Collection" method="Python collectors on a GitHub Actions schedule; idempotent upserts into Supabase (Postgres).">
        <div className="flex flex-wrap gap-6">
          <Metric label="Entries with analysable text" value={fmtInt(f.collected)} />
          <Metric label="Sources" value={counts.map((c) => SOURCE_LABEL[c.source] ?? c.source).join(", ")} />
        </div>
      </Stage>

      <Stage n={2} title="Pre-filter (deterministic, no AI)"
             method="Language detection (English / Hindi / Hinglish) and a keyword screen for categories, discovery, trust, habit and information needs. A reproducible 5% random sample of the remaining entries is kept as a control group.">
        <div className="flex flex-wrap gap-6">
          <Metric label="Screened" value={fmtInt(f.screened)} />
          <Metric label="Candidates for AI review" value={fmtInt(f.candidates)} note={`${pct(f.candidates, f.screened)}% of screened`} />
          <Metric label="Control sample" value={fmtInt(f.control_sample)} note="5% of non-candidates" />
          <Metric label="Hindi or Hinglish" value={fmtInt(f.non_english)} />
        </div>
      </Stage>

      <Stage n={3} title="AI relevance gate" method="Model: gpt-oss-20b (via Groq). Decides whether each entry concerns what or why people buy, categories, discovery, trust, habits or information needs, rather than only delivery, payments or support.">
        <div className="flex flex-wrap gap-6">
          <Metric label="Candidates reviewed" value={fmtInt(f.candidates_checked)} note={`of ${fmtInt(f.candidates)}`} />
          <Metric label="Judged relevant" value={`${candRate}%`} note={`${fmtInt(f.candidates_relevant)} entries`} />
          <Metric label="Control entries reviewed" value={fmtInt(f.control_checked)}
                  note={f.control_checked ? `${pct(f.control_relevant, f.control_checked)}% relevant` : "pending"} />
        </div>
      </Stage>

      <Stage n={4} title="AI tagging and translation" method="Model: gpt-oss-120b (via Groq). Assigns structured tags from a fixed taxonomy (categories, barriers, funnel stage, discovery channel, information needs, segment signals, unmet need), copies a supporting quote, and translates Hindi and Hinglish into English.">
        <div className="flex flex-wrap gap-6">
          <Metric label="Entries tagged" value={fmtInt(f.tagged)} note={`of ${fmtInt(f.candidates_relevant + f.control_relevant)} relevant so far`} />
          <Metric label="Quotes verified verbatim" value={`${pct(f.grounded, f.tagged)}%`} note={`${fmtInt(f.grounded)} of ${fmtInt(f.tagged)}`} />
          <Metric label="Translated" value={fmtInt(f.translated)} />
        </div>
        <p className="mt-3 rounded-lg bg-bg p-3">
          <span className="font-medium">Sampling.</span> Entries are reviewed and tagged in a fixed random order across
          months and sources, so the tagged set is a random sample at every point.{" "}
          {estRelevant > 0 && <>About {fmtInt(estRelevant)} relevant entries are estimated in total; {fmtInt(f.tagged)} ({pct(f.tagged, estRelevant)}%) are tagged so far. </>}
          {moe !== null && <>With {fmtInt(f.tagged)} tagged entries, percentages computed from them carry a margin of error of at most ±{moe.toFixed(1)} points (95% confidence); the margin narrows as tagging continues, within the free daily model allowance.</>}
        </p>
        <p className="mt-3">
          <Link href="/evidence?tagged=1" className="text-accent underline underline-offset-2">Browse tagged entries in Evidence</Link>
        </p>
      </Stage>

      <Stage n={5} title="Translation check" method="Model: qwen3.8-27b (via Groq), a different model family from the translator. Scores whether each English translation keeps the original meaning; failed translations are never shown or quoted.">
        <div className="flex flex-wrap gap-6">
          <Metric label="Translations checked" value={fmtInt(f.translation_checked)} note={`of ${fmtInt(f.translated)}`} />
          <Metric label="Passed" value={`${pct(f.translation_passed, f.translation_checked)}%`} />
        </div>
      </Stage>

      <Stage n={6} title="Embeddings and theme discovery" method="Each tagged entry is embedded with gte-small (run locally, no API). UMAP and HDBSCAN group similar entries; gpt-oss-120b names each group from its most representative verified quotes. Size, ratings, sentiment and trends are computed in code.">
        <p><Link href="/themes" className="text-accent underline underline-offset-2">See the current themes</Link></p>
      </Stage>
      <Stage n={7} title="Insights for the eight research questions" status="planned" method="Statistics are computed in code; a model writes each finding with at least three cited entries. Findings are published only if grounding and faithfulness checks pass.">
        <p className="text-muted">Builds on stages 4 and 6.</p>
      </Stage>
      <Stage n={8} title="Research agent" status="planned" method="A tool-using agent that searches and counts the tagged evidence to answer new questions, citing the entries it relied on.">
        <p className="text-muted">Builds on stages 4 to 7.</p>
      </Stage>

      <li>
        <Card title="Quality checks"
              subtitle={<>Automated checks run alongside the pipeline. Full results, including cross-model agreement, rating consistency and stability, are on the <Link href="/validation" className="text-accent underline underline-offset-2">Validation</Link> page.</>}>
          <ul className="space-y-2 text-sm">
            <li><span className="font-medium">Grounding:</span> {pct(f.grounded, f.tagged)}% of tagged entries carry a supporting quote found verbatim in the original text. Entries that fail are retried once; quotes that still fail are never displayed.</li>
            <li><span className="font-medium">Schema conformance:</span> every tag is validated against the fixed taxonomy; values outside it are discarded and counted in the run log.</li>
            <li><span className="font-medium">Translation fidelity:</span> {pct(f.translation_passed, f.translation_checked)}% of checked translations passed a second-model review.</li>
            <li>
              <span className="font-medium">Keyword screen coverage:</span>{" "}
              {f.control_checked >= 50 ? (
                <>
                  in the random control sample, {Math.round(ctrlRate * 100)}% of entries the keyword screen skipped were still
                  judged relevant. This suggests the screen captures about {recall}% of all relevant feedback; the estimate is
                  reported rather than hidden.
                </>
              ) : (
                <>measured on the control sample once at least 50 of its entries have been reviewed ({fmtInt(f.control_checked)} so far).</>
              )}
            </li>
          </ul>
        </Card>
      </li>
    </ol>
  );
}

async function Usage() {
  const rows = await getAiUsage();
  if (!rows.length) return null;
  const byModel = new Map<string, { calls: number; items: number; tin: number; tout: number; failed: number }>();
  for (const r of rows as AiUsage[]) {
    const m = byModel.get(r.model) ?? { calls: 0, items: 0, tin: 0, tout: 0, failed: 0 };
    m.calls += r.calls; m.items += r.items; m.tin += r.tokens_in; m.tout += r.tokens_out; m.failed += r.failed_calls;
    byModel.set(r.model, m);
  }
  return (
    <Card title="Model usage" subtitle="All AI calls run on Groq's free tier. Token counts only; no prompts or responses are stored.">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="text-left text-muted">
            <tr>
              <th className="pb-2 font-medium">Model</th>
              <th className="pb-2 text-right font-medium">Calls</th>
              <th className="pb-2 text-right font-medium">Entries processed</th>
              <th className="pb-2 text-right font-medium">Tokens in / out</th>
              <th className="pb-2 text-right font-medium">Failed calls</th>
            </tr>
          </thead>
          <tbody>
            {[...byModel.entries()].map(([model, m]) => (
              <tr key={model} className="border-t border-border">
                <td className="py-2">{model}</td>
                <td className="py-2 text-right tabular-nums">{fmtInt(m.calls)}</td>
                <td className="py-2 text-right tabular-nums">{fmtInt(m.items)}</td>
                <td className="py-2 text-right tabular-nums">{fmtInt(m.tin)} / {fmtInt(m.tout)}</td>
                <td className="py-2 text-right tabular-nums">{fmtInt(m.failed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
