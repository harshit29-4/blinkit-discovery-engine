import Link from "next/link";
import { Suspense } from "react";
import { RatingBars, VolumeChart } from "@/components/charts";
import { Card, Skeleton, SourceBadge, Stat } from "@/components/ui";
import { getDailyVolume, getRatingMix, getRuns, getSourceCounts } from "@/lib/data";
import { fmtDate, fmtDateTime, fmtInt, pct } from "@/lib/format";

export default function OverviewPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">What&rsquo;s been collected</h1>
        <p className="mt-1 max-w-2xl text-muted">
          Public reviews and discussions about Blinkit from the last 12 months, gathered automatically every hour.
          Analysis pages (themes, research questions, Ask) arrive once tagging is built.
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
      <Stat label="Analysable items" value={fmtInt(items)} hint="reviews, posts and comments with real text" />
      <Stat label="Rating-only short reviews" value={fmtInt(shortRatings)} hint="“good”, “nice”… counted, not analysed" />
      <Stat label="Sources" value={counts.length} hint={`${fmtDate(oldest)} → ${fmtDate(newest)}`} />
      <Stat
        label="Last collection run"
        value={last ? fmtDateTime(last.started_at) : "—"}
        hint={last ? <Link className="underline underline-offset-2" href="/health">{last.status} · see Health</Link> : "no runs yet"}
      />
    </div>
  );
}

async function Sources() {
  const counts = await getSourceCounts();
  return (
    <Card title="By source" subtitle="Items with enough text to analyse (Play Store: 40+ characters).">
      <table className="w-full text-sm">
        <thead className="text-left text-muted">
          <tr><th className="pb-2 font-medium">Source</th><th className="pb-2 text-right font-medium">Items</th><th className="pb-2 text-right font-medium">From</th><th className="pb-2 text-right font-medium">To</th></tr>
        </thead>
        <tbody>
          {counts.sort((a, b) => b.items - a.items).map((c) => (
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
  const mix = await getRatingMix();
  const play = mix.filter((m) => m.source === "play_store");
  const fives = (rows: typeof play, kind: "short" | "long") => {
    const pick = (m: (typeof play)[number]) => (kind === "short" ? m.short_reviews ?? 0 : m.reviews - (m.short_reviews ?? 0));
    const total = rows.reduce((a, m) => a + pick(m), 0);
    return { five: pct(rows.filter((m) => m.rating === 5).reduce((a, m) => a + pick(m), 0), total), total };
  };
  const s = fives(play, "short");
  const l = fives(play, "long");
  return (
    <Card title="Star ratings" subtitle="All ratings, including short reviews. Reddit has no star ratings.">
      <RatingBars mix={mix} />
      {s.total > 0 && l.total > 0 && (
        <p className="mt-5 rounded-lg bg-warn-soft p-3 text-sm text-text">
          <strong>Bias to keep in mind:</strong> {s.five}% of short Play Store reviews are 5★, but only {l.five}% of the
          longer ones we analyse. Written reviews skew negative: complaints get written, contentment gets a star.
        </p>
      )}
    </Card>
  );
}

async function Volume() {
  const { rows, dayList } = await getDailyVolume(90);
  return (
    <Card title="Collected per day" subtitle="Analysable items by posting date.">
      <VolumeChart data={rows} dayList={dayList} />
    </Card>
  );
}
