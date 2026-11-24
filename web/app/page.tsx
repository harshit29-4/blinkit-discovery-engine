import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { RatingBars, VolumeChart } from "@/components/charts";
import { IconArrow, IconCheck, IconSearch, IconThemes } from "@/components/icons";
import { Card, SectionTitle, Skeleton, SourceBadge, Stat } from "@/components/ui";
import { getDailyVolume, getRatingMix, getRuns, getSourceCounts, getThemes } from "@/lib/data";
import { fmtDate, fmtDateTime, fmtInt, pct } from "@/lib/format";
import { RESEARCH_QUESTIONS } from "@/lib/research";

const STATUS_LABEL: Record<string, string> = {
  ok: "Completed",
  partial: "Partially completed",
  failed: "Failed",
  running: "In progress",
};

export default function HomePage() {
  return (
    <div className="space-y-10">
      <Hero />
      <section aria-labelledby="questions">
        <SectionTitle title="Start with a research question" href="/ask" link="Ask your own" />
        <ul id="questions" className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Object.entries(RESEARCH_QUESTIONS).map(([n, q]) => (
            <li key={n}>
              <Link href={`/ask?q=${encodeURIComponent(q)}`}
                className="flex h-full flex-col justify-between gap-3 rounded-xl bg-tile p-4 transition hover:-translate-y-0.5 hover:shadow-md">
                <span className="text-sm font-extrabold text-accent">Q{n}</span>
                <span className="font-semibold leading-snug">{q}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <Suspense fallback={<div className="grid gap-4 md:grid-cols-3"><Skeleton h="h-36" /><Skeleton h="h-36" /><Skeleton h="h-36" /></div>}>
        <Banners />
      </Suspense>

      <section aria-labelledby="glance" className="space-y-6">
        <SectionTitle title="Data at a glance" href="/how-it-works#collection" link="How we collect →" />
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
      </section>
    </div>
  );
}

/** Yellow hero with the question box: the one thing to do first. */
function Hero() {
  return (
    <section className="overflow-hidden rounded-2xl bg-brand-yellow p-6 text-brand-ink sm:p-10">
      <p className="text-sm font-bold uppercase tracking-wide text-brand-ink-muted">Category discovery research · Blinkit</p>
      <h1 className="mt-2 max-w-3xl text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
        Why do shoppers keep buying from the same few categories?
      </h1>
      <p className="mt-3 max-w-2xl text-base font-medium text-brand-ink-muted sm:text-lg">
        Ask in plain language. The AI reads real customer feedback and every answer cites it.
      </p>
      <form action="/ask" className="mt-6 flex max-w-2xl flex-col gap-2 sm:flex-row">
        <label htmlFor="hero-q" className="sr-only">Your question</label>
        <input id="hero-q" name="q" maxLength={500} required minLength={3}
          placeholder="e.g. What stops people from buying fresh produce online?"
          className="w-full rounded-xl border-2 border-transparent bg-white px-4 py-3 text-base text-[#1f1f1f] placeholder:text-[#666] focus:border-brand-ink focus:outline-none" />
        <button className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 font-bold text-white hover:brightness-110">
          Ask <IconArrow className="h-4 w-4" />
        </button>
      </form>
    </section>
  );
}

function Banner({ href, tone, Icon, title, body, cta }: {
  href: string; tone: string; Icon: (p: { className?: string }) => ReactNode; title: string; body: ReactNode; cta: string;
}) {
  return (
    <Link href={href} className={`group flex flex-col justify-between gap-4 rounded-2xl p-5 transition hover:shadow-md ${tone}`}>
      <div>
        <Icon className="h-7 w-7" />
        <p className="mt-3 text-lg font-extrabold tracking-tight">{title}</p>
        <p className="mt-1">{body}</p>
      </div>
      <span className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-surface px-3 py-1.5 text-sm font-bold text-accent">
        {cta} <IconArrow className="h-4 w-4 transition group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

/** Three Blinkit-style banners: the main places to go next, with live numbers. */
async function Banners() {
  const [{ themes, snapshot }, counts] = await Promise.all([getThemes(), getSourceCounts()]);
  const entries = counts.reduce((a, c) => a + c.items, 0);
  return (
    <section aria-label="Explore" className="grid gap-4 md:grid-cols-3">
      <Banner href="/themes" tone="bg-tile-2 text-text" Icon={IconThemes} title="Themes"
        body={snapshot ? <>{themes.length} recurring problems the AI found in {fmtInt(snapshot.items)} tagged entries.</> : <>Recurring problems found by the AI.</>}
        cta="See themes" />
      <Banner href="/evidence" tone="bg-brand-yellow-soft text-text" Icon={IconSearch} title="Evidence"
        body={<>Search {fmtInt(entries)} reviews and comments, with AI tags and links to the originals.</>}
        cta="Search feedback" />
      <Banner href="/validation" tone="bg-tile text-text" Icon={IconCheck} title="Can we trust it?"
        body={<>How often two different AI models agree, and every other automatic check.</>}
        cta="See checks" />
    </section>
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
      <Stat label="Feedback entries" value={fmtInt(items)} hint="With enough text to analyse" />
      <Stat label="Rating-only reviews" value={fmtInt(shortRatings)} hint="Counted in ratings only" />
      <Stat label="Sources" value={counts.length} hint={`${fmtDate(oldest)} to ${fmtDate(newest)}`} />
      <Stat
        label="Last collection"
        value={last ? fmtDateTime(last.started_at) : "—"}
        hint={last ? (
          <Link className="underline underline-offset-2" href="/health">{STATUS_LABEL[last.status] ?? last.status}</Link>
        ) : "No runs recorded yet"}
      />
    </div>
  );
}

async function Sources() {
  const counts = [...(await getSourceCounts())].sort((a, b) => b.items - a.items);
  return (
    <Card title="Feedback by source">
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
  const has = (prefix: string) => counts.some((c) => c.source.startsWith(prefix) && c.items > 0);
  const unrated = [has("reddit") && "Reddit", has("youtube") && "YouTube"].filter(Boolean).join(" and ");
  const play = mix.filter((m) => m.source === "play_store");
  const fives = (rows: typeof play, kind: "short" | "long") => {
    const pick = (m: (typeof play)[number]) => (kind === "short" ? m.short_reviews ?? 0 : m.reviews - (m.short_reviews ?? 0));
    const total = rows.reduce((a, m) => a + pick(m), 0);
    return { five: pct(rows.filter((m) => m.rating === 5).reduce((a, m) => a + pick(m), 0), total), total };
  };
  const s = fives(play, "short");
  const l = fives(play, "long");
  return (
    <Card title="Star ratings" subtitle={unrated ? `${unrated} have no star ratings.` : undefined}>
      <RatingBars mix={mix} />
      {s.total > 0 && l.total > 0 && (
        <p className="mt-5 rounded-lg bg-warn-soft p-3 text-sm text-text">
          <strong>Keep in mind:</strong> {s.five}% of short Play Store reviews are 5-star, but only {l.five}% of the
          longer ones the AI reads. Written feedback leans negative.
        </p>
      )}
    </Card>
  );
}

async function Volume() {
  const { rows, dayList } = await getDailyVolume(90);
  return (
    <Card title="Entries per day (last 90 days)">
      <VolumeChart data={rows} dayList={dayList} />
    </Card>
  );
}
