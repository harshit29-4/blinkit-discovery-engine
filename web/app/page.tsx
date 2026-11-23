import Link from "next/link";
import { Suspense } from "react";
import { RatingBars, VolumeChart } from "@/components/charts";
import { Card, Skeleton, SourceBadge, Stat } from "@/components/ui";
import { getDailyVolume, getRatingMix, getRuns, getSourceCounts } from "@/lib/data";
import { fmtDate, fmtDateTime, fmtInt, pct } from "@/lib/format";

const STATUS_LABEL: Record<string, string> = {
  ok: "Completed",
  partial: "Partially completed",
  failed: "Failed",
  running: "In progress",
};

export default function OverviewPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Data collection overview</h1>
        <p className="mt-1 max-w-3xl text-muted">
          This dashboard summarises publicly available customer feedback on Blinkit from the past 12 months. Data
          is refreshed automatically every hour, and AI models screen, tag and translate the relevant feedback
          (see <Link href="/how-it-works" className="underline underline-offset-2">How it works</Link>). Themes,
          research findings and the research agent will follow as the next stages are completed.
        </p>
      </div>
      <Suspense fallback={<div className="grid gap-3 sm:grid-cols-4"><Skeleton h="h-24" /><Skeleton h="h-24" /><Skeleton h="h-24" /><Skeleton h="h-24" /></div>}>
        <Headline />
      </Suspense>
      <div className="grid gap-6 lg:grid-cols-2">
        <Suspense fallback={<Skeleton h="h-64" />}>
          <Sources />
        </Suspense>
        <Suspense fallback={<Skeleton h="h-64" />}>
          <Ratings />
        </Suspense>
      </div>
      <Suspense fallback={<Skeleton h="h-72" />}>
        <Volume />
      </Suspense>
    </div>
  );
}

async function Headline() {
  const [counts, mix, runs] = await Promise.all([getSourceCounts(), getRatingMix(), getRuns(1)]);
  const items = counts.reduce((a, c) => a + c.items, 0);
  const shortRatings = mix.reduce((a, m) => a + (m.short_reviews ?? 0), 0);
  const oldest = counts.map((c) => c.oldest).sort()[0];
  const newest = counts.map((c) => c.newest).sort().at(-1);
  const last = runs[0];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="Feedback entries" value={fmtInt(items)} hint="Entries with enough text for analysis" />
      <Stat label="Rating-only reviews" value={fmtInt(shortRatings)} hint="Under 40 characters; counted in ratings only" />
      <Stat label="Data sources" value={counts.length} hint={`${fmtDate(oldest)} to ${fmtDate(newest)}`} />
      <Stat
        label="Latest collection run"
        value={last ? fmtDateTime(last.started_at) : "—"}
        hint={last ? (
          <Link className="underline underline-offset-2" href="/health">
            {STATUS_LABEL[last.status] ?? last.status} · View pipeline health
          </Link>
        ) : "No runs recorded yet"}
      />
    </div>
  );
}

async function Sources() {
  const counts = [...(await getSourceCounts())].sort((a, b) => b.items - a.items);
  return (
    <Card title="Feedback by source" subtitle="Entries with enough text for analysis (Play Store reviews: 40 characters or more).">
      <table className="w-full text-sm">
        <thead className="text-left text-muted">
          <tr>
            <th className="pb-2 font-medium">Source</th>
            <th className="pb-2 text-right font-medium">Entries</th>
            <th className="pb-2 text-right font-medium">From</th>
            <th className="pb-2 text-right font-medium">To</th>
          </tr>
        </thead>
        <tbody>
          {counts.map((c) => (
            <tr key={c.source} className="border-t border-border">
              <td className="py-2"><SourceBadge source={c.source} /></td>
              <td className="py-2 text-right tabular-nums">{fmtInt(c.items)}</td>
              <td className="py-2 text-right text-muted">{fmtDate(c.oldest)}</td>
              <td className="py-2 text-right text-muted">{fmtDate(c.newest)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

async function Ratings() {
  const [mix, counts] = await Promise.all([getRatingMix(), getSourceCounts()]);
  const hasReddit = counts.some((c) => c.source.startsWith("reddit") && c.items > 0);
  const play = mix.filter((m) => m.source === "play_store");
  const fives = (rows: typeof play, kind: "short" | "long") => {
    const pick = (m: (typeof play)[number]) => (kind === "short" ? m.short_reviews ?? 0 : m.reviews - (m.short_reviews ?? 0));
    const total = rows.reduce((a, m) => a + pick(m), 0);
    return { five: pct(rows.filter((m) => m.rating === 5).reduce((a, m) => a + pick(m), 0), total), total };
  };
  const s = fives(play, "short");
  const l = fives(play, "long");
  return (
    <Card
      title="Rating distribution"
      subtitle={`All star ratings, including rating-only reviews.${hasReddit ? " Reddit content carries no star ratings." : ""}`}
    >
      <RatingBars mix={mix} />
      {s.total > 0 && l.total > 0 && (
        <p className="mt-5 rounded-lg bg-warn-soft p-3 text-sm text-text">
          <strong>Note on sampling bias:</strong> {s.five}% of short Play Store reviews are 5-star, compared with{" "}
          {l.five}% of the longer reviews used for analysis. Written feedback over-represents dissatisfied
          customers, and findings are interpreted with this in mind.
        </p>
      )}
    </Card>
  );
}

async function Volume() {
  const { rows, dayList } = await getDailyVolume(90);
  return (
    <Card title="Daily collection volume" subtitle="Entries with enough text for analysis, by posting date.">
      <VolumeChart data={rows} dayList={dayList} />
    </Card>
  );
}
