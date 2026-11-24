import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, PageHeader, Skeleton, SourceBadge, Stars } from "@/components/ui";
import { getThemes, type Theme, type ThemeQuote } from "@/lib/data";
import { fmtDate, fmtInt } from "@/lib/format";
import { KIND_LABEL, RESEARCH_QUESTIONS } from "@/lib/research";
import { label } from "@/lib/taxonomy";

export const metadata: Metadata = { title: "Themes" };

export default function ThemesPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Themes" subtitle="Recurring problems and experiences the AI found in the feedback, biggest first."
        learn="themes" />
      <Suspense fallback={<Skeleton h="h-[40rem]" />}>
        <ThemeList />
      </Suspense>
    </div>
  );
}

async function ThemeList() {
  const { themes, quotes, snapshot } = await getThemes();
  if (!snapshot || themes.length === 0) {
    return (
      <Card>
        <p className="text-muted">
          Themes will be published once enough feedback has been tagged (at least 200 entries). Progress is shown on{" "}
          <Link href="/how-it-works" className="text-accent underline underline-offset-2">How it works</Link>.
        </p>
      </Card>
    );
  }
  const byTheme = new Map<number, ThemeQuote[]>();
  for (const q of quotes) byTheme.set(q.theme_id, [...(byTheme.get(q.theme_id) ?? []), q]);
  const clustered = snapshot.items - snapshot.noise;
  return (
    <>
      <ul className="flex flex-wrap gap-2 text-sm">
        <li className="rounded-full bg-surface px-3 py-1 font-semibold">{fmtInt(themes.length)} themes</li>
        <li className="rounded-full bg-surface px-3 py-1">{fmtInt(clustered)} of {fmtInt(snapshot.items)} tagged entries grouped</li>
        <li className="rounded-full bg-surface px-3 py-1 text-muted">Updated {fmtDate(snapshot.created_at)}</li>
      </ul>
      <ol className="space-y-5">
        {themes.map((t) => <ThemeCard key={t.theme_id} t={t} quotes={byTheme.get(t.theme_id) ?? []} />)}
      </ol>
    </>
  );
}

function ThemeCard({ t, quotes }: { t: Theme; quotes: ThemeQuote[] }) {
  const months = Object.entries(t.monthly).sort(([a], [b]) => a.localeCompare(b)).slice(-6);
  const peak = Math.max(1, ...months.map(([, v]) => v));
  return (
    <li className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-extrabold tracking-tight">{t.name}</h2>
        <span className={`rounded-full px-2.5 py-0.5 text-sm font-bold ${
          t.kind === "positive_experience" ? "bg-accent-soft text-accent" : "bg-brand-yellow-soft text-text"}`}>
          {KIND_LABEL[t.kind] ?? t.kind}
        </span>
      </div>
      <p className="mt-1 max-w-3xl">{t.description}</p>

      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3 rounded-xl bg-bg p-4 text-sm">
        <div><dt className="text-muted">Entries</dt><dd className="text-lg font-semibold tabular-nums">{fmtInt(t.size)} <span className="text-sm font-normal text-muted">({Math.round(t.share * 100)}% of themed entries)</span></dd></div>
        {t.avg_rating !== null && <div><dt className="text-muted">Average rating</dt><dd className="text-lg font-semibold tabular-nums">{t.avg_rating.toFixed(1)} / 5</dd></div>}
        {t.pct_negative !== null && <div><dt className="text-muted">Negative sentiment</dt><dd className="text-lg font-semibold tabular-nums">{Math.round(t.pct_negative)}%</dd></div>}
        {months.length > 1 && (
          <div>
            <dt className="text-muted">Recent months</dt>
            <dd className="mt-1 flex items-end gap-1" aria-label={months.map(([m, v]) => `${m}: ${v}`).join(", ")}>
              {months.map(([m, v]) => (
                <span key={m} title={`${m}: ${v}`} className="w-3 rounded-sm bg-accent" style={{ height: `${Math.max(3, (v / peak) * 28)}px` }} />
              ))}
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        {t.top_barriers.length > 0 && (
          <p><span className="text-muted">Most common barriers: </span>
            {t.top_barriers.map(([k, n]) => `${label("barriers", k)} (${fmtInt(n)})`).join(" · ")}</p>
        )}
        {t.top_categories.length > 0 && (
          <p><span className="text-muted">Categories mentioned: </span>
            {t.top_categories.map(([k, n]) => `${label("categories", k)} (${fmtInt(n)})`).join(" · ")}</p>
        )}
      </div>

      {t.questions.length > 0 && (
        <div className="mt-3 text-sm">
          <span className="text-muted">Informs research questions: </span>
          {t.questions.map((q) => <span key={q} title={RESEARCH_QUESTIONS[q]} className="mr-2 inline-block rounded border border-border px-1.5">Q{q}</span>)}
        </div>
      )}

      {quotes.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-bold">What customers said</p>
          <ul className="mt-2 space-y-2">
            {quotes.slice(0, 2).map((q) => (
              <li key={`${q.source}:${q.source_id}`} className="rounded-xl border-l-4 border-brand-yellow bg-bg p-3 text-sm">
                <p>&ldquo;{q.quote}&rdquo;</p>
                {q.translation && <p className="mt-1 text-muted">English: {q.translation}</p>}
                <div className="mt-1 flex flex-wrap items-center gap-x-3 text-muted">
                  <SourceBadge source={q.source} />
                  <Stars rating={q.rating} />
                  <span>{fmtDate(q.posted_at)}</span>
                  {q.url && <a href={q.url} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">View original ↗</a>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        <Link href={`/evidence?theme=${t.theme_id}`}
          className="rounded-lg border border-accent px-3 py-1.5 font-bold text-accent hover:bg-accent-soft">
          All {fmtInt(t.size)} entries
        </Link>
        <Link href={`/ask?q=${encodeURIComponent(`What is behind the theme "${t.name}"?`)}`}
          className="rounded-lg bg-accent px-3 py-1.5 font-bold text-accent-ink hover:brightness-110">
          Ask about this theme
        </Link>
      </div>
    </li>
  );
}
