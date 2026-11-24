import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Card, PageHeader, SectionTitle, Skeleton } from "@/components/ui";
import { getAiUsage, getFunnel, getSourceCounts, SOURCE_LABEL, type AiUsage } from "@/lib/data";
import { fmtInt, pct } from "@/lib/format";

export const metadata: Metadata = { title: "How it works" };

export default function HowItWorksPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="How it works" subtitle="Everything the other pages leave out: what each part does, with live numbers." />
      <InShort />
      <nav aria-label="On this page" className="flex flex-wrap gap-2 text-sm">
        {[["collection", "Collection"], ["ai", "AI stages"], ["themes", "Themes"], ["ask", "Ask engine"],
          ["evidence", "Evidence search"], ["validation", "Validation"], ["glossary", "Glossary"]].map(([id, l]) => (
          <a key={id} href={`#${id}`} className="rounded-full border border-border bg-surface px-3 py-1 font-semibold hover:border-accent">{l}</a>
        ))}
      </nav>
      <Suspense fallback={<Skeleton h="h-[40rem]" />}>
        <Pipeline />
      </Suspense>
      <Explainers />
      <Suspense fallback={<Skeleton h="h-48" />}>
        <Usage />
      </Suspense>
    </div>
  );
}

/** The whole engine in four steps, before any detail. */
function InShort() {
  const steps = [
    ["Collect", "Reviews and comments about Blinkit from Google Play, the App Store, Reddit and YouTube, every day."],
    ["Filter", "Keywords, then an AI model, keep only feedback about what people buy and why."],
    ["Tag and group", "AI tags each entry (barriers, categories, needs…) and groups similar ones into themes."],
    ["Ask", "An AI agent answers questions from the tagged data, citing entries; every answer is checked."],
  ];
  return (
    <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {steps.map(([t, d], i) => (
        <li key={t} className={`rounded-2xl p-4 ${i % 2 ? "bg-tile" : "bg-brand-yellow-soft"}`}>
          <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-yellow font-extrabold text-brand-ink">{i + 1}</span>
          <p className="mt-2 font-extrabold">{t}</p>
          <p className="mt-1 text-sm">{d}</p>
        </li>
      ))}
    </ol>
  );
}

/** Explanations moved here from the other pages, so those pages stay short. */
function Explainers() {
  return (
    <div className="space-y-6">
      <section id="evidence" className="scroll-mt-32">
        <SectionTitle title="Searching the evidence" href="/evidence" link="Open Evidence →" />
        <Card>
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            <li>Search matches word forms: <em>refund</em> also finds refunds and refunded. Put a phrase in quotes
              (<em>&ldquo;fresh vegetables&rdquo;</em>), use <em>OR</em> for alternatives and <em>-word</em> to exclude.</li>
            <li>Filters marked (AI) use the tags the AI assigned, so they only cover the tagged sample.</li>
            <li>For common words the total is an estimate (shown as &ldquo;About …&rdquo;); counting 30,000+ matches
              exactly would take seconds. Browsing stops at page 200; add words or filters to narrow further.</li>
            <li>Translations of Hindi and Hinglish entries are shown only when a second AI model confirmed them.</li>
          </ul>
        </Card>
      </section>
      <section id="validation" className="scroll-mt-32">
        <SectionTitle title="How the checks work" href="/validation" link="See results →" />
        <Card>
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            <li><strong>Two models, one answer.</strong> A 10% sample is tagged again by a different model family. Agreement
              is reported as Cohen&rsquo;s kappa (κ), which removes agreement expected by chance: 0.41–0.60 is moderate,
              0.61–0.80 substantial.</li>
            <li><strong>Stars vs sentiment.</strong> The AI&rsquo;s sentiment is compared with the reviewer&rsquo;s own stars.</li>
            <li><strong>Grounding.</strong> Every tag must come with a quote found word for word in the original text.</li>
            <li><strong>Stability.</strong> A fixed panel is tagged again each week; answers should not drift.</li>
            <li><strong>Translations</strong> are scored by a second model; failed ones are never shown.</li>
            <li><strong>Ask answers</strong> are checked for valid citations, traceable numbers and support (see Ask engine above).</li>
          </ul>
        </Card>
      </section>
      <section id="glossary" className="scroll-mt-32">
        <SectionTitle title="Glossary" />
        <Card>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {[
              ["Tagged entry", "Feedback the AI has labelled with barriers, categories, sentiment, funnel stage and more."],
              ["Theme", "A group of tagged entries that describe the same problem or experience."],
              ["Barrier", "Something that stops a customer from trying or continuing a category (price, trust, expiry…)."],
              ["Funnel stage", "Awareness, consideration, trust, trial or repeat: where a customer is with a category."],
              ["Control sample", "5% of entries the keyword filter skipped, checked anyway to measure what it misses."],
              ["Margin of error", "How far a percentage from the tagged sample could be from the true figure (95% confidence)."],
            ].map(([t, d]) => (
              <div key={t}><dt className="font-bold">{t}</dt><dd className="text-muted">{d}</dd></div>
            ))}
          </dl>
        </Card>
      </section>
    </div>
  );
}

function Stage({ n, title, method, children, status = "live", id }: {
  n: number; title: string; method: string; children: ReactNode; status?: "live" | "planned" | "on_request"; id?: string;
}) {
  return (
    <li id={id} className="relative scroll-mt-32 rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-extrabold tracking-tight">
          <span className="mr-2 inline-grid h-7 w-7 place-items-center rounded-full bg-brand-yellow text-sm text-brand-ink tabular-nums">{n}</span>{title}
        </h2>
        <span className={`rounded-full px-2 py-0.5 text-sm font-medium ${status === "planned" ? "bg-border text-text" : "bg-accent-soft text-accent"}`}>
          {status === "live" ? "Runs daily" : status === "on_request" ? "On request" : "In development"}
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
      <Stage n={1} id="collection" title="Collection" method="Python collectors run once a day on GitHub Actions (and from the Run button on the Pipeline page): Google Play and App Store reviews, Reddit posts and comments mentioning Blinkit, and comments on YouTube videos titled about Blinkit. Short Play Store reviews (under 40 characters) are kept for star ratings only.">
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
        <p className="mt-3 rounded-lg bg-bg p-3">
          <span className="font-medium">Learned screen.</span> Keywords alone reach only part of the relevant feedback, so a small
          classifier (trained on the AI gate&rsquo;s own past decisions, using gte-small embeddings; no AI tokens) also reads the
          skipped entries and sends the likely relevant ones to the gate.
          {f.scored ? <> So far {fmtInt(f.scored)} skipped entries scored, {fmtInt(f.promoted ?? 0)} sent on.</> : null}
        </p>
      </Stage>

      <Stage n={3} id="ai" title="AI relevance gate" method="Model: gpt-oss-20b (via Groq). Decides whether each entry concerns what or why people buy, categories, discovery, trust, habits or information needs, rather than only delivery, payments or support.">
        <div className="flex flex-wrap gap-6">
          <Metric label="Candidates reviewed" value={fmtInt(f.candidates_checked)} note={`of ${fmtInt(f.candidates)}`} />
          <Metric label="Judged relevant" value={`${candRate}%`} note={`${fmtInt(f.candidates_relevant)} entries`} />
          {f.promoted_checked ? (
            <Metric label="Sent on by the learned screen" value={fmtInt(f.promoted_checked)}
                    note={`${pct(f.promoted_relevant ?? 0, f.promoted_checked)}% relevant`} />
          ) : null}
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

      <Stage n={6} id="themes" title="Embeddings and theme discovery" method="Themes are found in the data, not defined in advance. Each tagged entry is turned into a vector with gte-small (run locally, no API); UMAP and HDBSCAN group similar entries, and entries that fit no group are left out rather than forced in. gpt-oss-120b names each group from its most representative verified quotes and merges groups that describe the same problem. Size, ratings, sentiment and trends are computed in code, not by the model.">
        <p><Link href="/themes" className="text-accent underline underline-offset-2">See the current themes</Link></p>
      </Stage>
      <Stage n={7} id="ask" title="Insight engine (Ask)" status="on_request" method="Model: Gemini 3.5 Flash-Lite (Google, free tier), with gpt-oss-20b and gpt-oss-120b on Groq as fallbacks, using tool calling. Instead of pre-written findings, the agent answers each question by calling read-only database tools: keyword search over all entries, counts and shares of tagged entries (computed in SQL), the current themes and the reliability results. It cites the entries it used.">
        <p>
          Each answer is checked before it is shown: citations must be entries the agent retrieved, every number must
          appear in the retrieved data, and qwen3.8-27b (a different model family) scores whether the cited evidence supports the claims. The
          eight research questions are offered as one-click questions.{" "}
          <Link href="/ask" className="text-accent underline underline-offset-2">Ask a question</Link>
        </p>
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
    <Card title="Model usage" subtitle="All AI calls run on free tiers (Groq; Gemini for Ask answers). Token counts only; no prompts or responses are stored.">
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
