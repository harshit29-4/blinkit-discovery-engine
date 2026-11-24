import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { Card, Skeleton } from "@/components/ui";
import { getChatQuality, getValidation, type Metric } from "@/lib/data";
import { fmtDateTime, fmtInt } from "@/lib/format";
import { kappaBand } from "@/lib/research";
import { label } from "@/lib/taxonomy";

export const metadata: Metadata = { title: "Validation" };

export default function ValidationPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Validation</h1>
        <p className="mt-1 max-w-3xl text-muted">
          Every AI output is checked automatically, and the results are published here as they are computed. Where
          a check compares two raters, agreement is reported as Cohen&rsquo;s kappa (κ), which corrects for agreement
          expected by chance; 0.61 to 0.80 is conventionally read as substantial agreement.
        </p>
      </div>
      <Suspense fallback={<Skeleton h="h-[36rem]" />}>
        <Checks />
      </Suspense>
    </div>
  );
}

const pctStr = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`);

function Check({ id, title, what, children, m }: { id: string; title: string; what: string; children: ReactNode; m?: Metric }) {
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold tracking-tight"><span className="mr-2 text-muted">{id}</span>{title}</h2>
        {m && <span className="text-sm text-muted">Sample: {fmtInt(m.n)} · Updated {fmtDateTime(m.computed_at)} IST</span>}
      </div>
      <p className="mt-1 text-sm text-muted">{what}</p>
      <div className="mt-3 text-sm">{children}</div>
    </Card>
  );
}

function Big({ children }: { children: ReactNode }) {
  return <p className="text-2xl font-semibold tabular-nums">{children}</p>;
}

async function Checks() {
  const [rows, chat] = await Promise.all([getValidation(), getChatQuality()]);
  const m = Object.fromEntries(rows.map((r) => [r.metric, r])) as Record<string, Metric | undefined>;
  const pending = <p className="text-muted">Not computed yet. Results appear after the next scheduled analysis run.</p>;
  const v1 = [
    ["Sentiment", m.v1_sentiment], ["Category behaviour", m.v1_category_behavior], ["Funnel stage", m.v1_funnel_stage],
    ["Categories", m.v1_categories], ["Barriers", m.v1_barriers],
  ] as const;
  const conf = (m.v2_sentiment_vs_stars?.details?.confusion ?? {}) as Record<string, number>;
  return (
    <div className="space-y-5">
      <Check id="V1" title="Cross-model agreement" m={m.v1_sentiment}
             what="A 10% sample of tagged entries is re-tagged independently by a different model family (qwen3.8-27b, versus gpt-oss-120b for production tags). High agreement means the tags reflect the text rather than one model's quirks.">
        {m.v1_sentiment ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px]">
              <thead className="text-left text-muted">
                <tr><th className="pb-2 font-medium">Field</th><th className="pb-2 text-right font-medium">κ</th><th className="pb-2 pl-4 font-medium">Reading</th><th className="pb-2 text-right font-medium">Raw agreement</th></tr>
              </thead>
              <tbody>
                {v1.map(([name, r]) => (
                  <tr key={name} className="border-t border-border">
                    <td className="py-2">{name}</td>
                    <td className="py-2 text-right tabular-nums">{r?.value?.toFixed(2) ?? "—"}</td>
                    <td className="py-2 pl-4">
                      {kappaBand(r?.value)}
                      {r?.value !== null && r?.value !== undefined && r.value < 0.6 && <span className="ml-2 text-warn">(treated as lower reliability)</span>}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {pctStr((r?.details?.agreement ?? r?.details?.jaccard) as number | undefined)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-muted">For list fields (categories, barriers), κ is averaged across labels with enough examples; raw agreement is the mean overlap (Jaccard).</p>
          </div>
        ) : pending}
      </Check>

      <Check id="V2" title="Sentiment against the reviewer's own star rating" m={m.v2_sentiment_vs_stars}
             what="Star ratings are given by reviewers themselves, so they are an independent, non-AI reference. Clear cases are compared: 1–2 stars against AI-negative, 4–5 stars against AI-positive.">
        {m.v2_sentiment_vs_stars ? (
          <>
            <Big>{pctStr(m.v2_sentiment_vs_stars.value)} agreement</Big>
            <p className="mt-1 text-muted">
              Stars 1–2 read as negative: {fmtInt(conf["stars_negative|ai_negative"] ?? 0)} · read as positive: {fmtInt(conf["stars_negative|ai_positive"] ?? 0)}.
              Stars 4–5 read as positive: {fmtInt(conf["stars_positive|ai_positive"] ?? 0)} · read as negative: {fmtInt(conf["stars_positive|ai_negative"] ?? 0)}.
              Disagreements are often genuine: for example, a 5-star review that complains about one product.
            </p>
          </>
        ) : pending}
      </Check>

      <Check id="V3" title="Grounding of supporting quotes" m={m.v3_grounding}
             what="Every tagged entry must carry a supporting quote that appears word for word in the original text. Entries that fail are retried once; quotes that still fail are never displayed.">
        {m.v3_grounding ? <Big>{pctStr(m.v3_grounding.value)} verified verbatim</Big> : pending}
      </Check>

      <Check id="V4" title="Schema conformance" m={m.v4_schema}
             what="Every tag must come from the fixed taxonomy. Values outside it are discarded before storage.">
        {m.v4_schema ? <Big>{pctStr(m.v4_schema.value)} of entries needed no correction</Big> : pending}
      </Check>

      <Check id="V6" title="Coverage of the keyword pre-filter" m={m.v6_keyword_recall}
             what="A random 5% of the entries the keyword screen skipped are also reviewed by the AI. The share of them judged relevant estimates how much relevant feedback the screen misses.">
        {m.v6_keyword_recall ? (
          <>
            <Big>about {pctStr(m.v6_keyword_recall.value)} of relevant feedback captured</Big>
            <p className="mt-1 text-muted">
              {pctStr(m.v6_keyword_recall.details?.control_relevant_rate as number)} of skipped entries in the control sample were relevant,
              against {pctStr(m.v6_keyword_recall.details?.candidate_relevant_rate as number)} of keyword-matched entries.
            </p>
          </>
        ) : pending}
      </Check>

      <Check id="V7" title="Stability over time" m={m.v7_stability}
             what="Each week the production model re-tags a fixed panel of entries with the same instructions. Agreement with its earlier tags shows whether results are reproducible.">
        {m.v7_stability ? (
          <>
            <Big>{pctStr(m.v7_stability.value)} exact agreement</Big>
            <p className="mt-1 text-muted">
              Sentiment {pctStr((m.v7_stability.details?.exact_agreement as Record<string, number>)?.sentiment)} ·
              Funnel stage {pctStr((m.v7_stability.details?.exact_agreement as Record<string, number>)?.funnel_stage)} ·
              Barriers overlap {pctStr(m.v7_stability.details?.barriers_jaccard as number)}
            </p>
          </>
        ) : <p className="text-muted">Runs weekly; results appear after the first panel re-tag.</p>}
      </Check>

      <Check id="V8" title="Translation fidelity" m={m.v8_translation}
             what="Hindi and Hinglish entries are translated by the tagging model and checked by a different model family. Failed translations are kept for counts but never shown or quoted.">
        {m.v8_translation ? <Big>{pctStr(m.v8_translation.value)} passed</Big> : pending}
      </Check>

      <Check id="V10" title="Answer checks (Ask page)"
             what="Every answer from the insight engine is checked before it is shown: each citation must be an entry the agent retrieved, each number must appear in the data it retrieved (allowing for rounding), and a different model family (qwen3.8-27b) scores how far the cited evidence supports the claims. Answers that fail are rewritten once, and any remaining failure is shown with the answer.">
        {chat && chat.answers > 0 ? (
          <>
            <Big>{pctStr(chat.numbers_verified_rate)} of answers had every number traced to the data</Big>
            <p className="mt-2 text-muted">
              Citations valid in {pctStr(chat.citations_valid_rate)} of answers · mean support score{" "}
              {chat.mean_faithfulness === null ? "—" : pctStr(chat.mean_faithfulness)} · {fmtInt(chat.answers)} answers
              checked ({fmtInt(chat.cached_answers)} more served from the 24-hour cache).
            </p>
          </>
        ) : <p className="text-muted">Results appear once questions have been asked on the Ask page.</p>}
      </Check>

      <Check id="V9" title="Primary research"
             what="AI findings are a starting point. Interviews with users from the target segment will confirm or challenge each finding; results will be recorded here.">
        <p className="text-muted">Planned for Part 2 of the study.</p>
      </Check>

      <p className="text-sm text-muted">
        Field names map to the taxonomy used throughout the site, for example &ldquo;{label("barriers", "quality_trust")}&rdquo;
        or &ldquo;{label("funnel_stage", "trial")}&rdquo;.
      </p>
    </div>
  );
}
