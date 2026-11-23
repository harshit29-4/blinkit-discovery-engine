import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, Skeleton, StatusPill } from "@/components/ui";
import { SOURCE_LABEL, getCursors, getRuns, type SourceStats } from "@/lib/data";
import { duration, fmtDateTime, fmtInt } from "@/lib/format";

export const metadata: Metadata = { title: "Health" };

export default function HealthPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pipeline health</h1>
        <p className="mt-1 max-w-2xl text-muted">
          Every collection run, what it found, and anything that went wrong. Runs are automatic and unattended,
          so gaps are recorded and retried on the next run, never silently skipped.
        </p>
      </div>
      <Suspense fallback={<Skeleton h="h-80" />}>
        <Runs />
      </Suspense>
      <Suspense fallback={<Skeleton h="h-48" />}>
        <Progress />
      </Suspense>
    </div>
  );
}

const CURSOR_LABEL: Record<string, string> = {
  play_store: "Play Store",
  app_store: "App Store",
  reddit_post: "Reddit (all subreddits)",
};

function notes(s: SourceStats): string[] {
  const out: string[] = [];
  if (s.error) out.push(`error: ${s.error}`);
  if (s.short_seen) out.push(`${fmtInt(s.short_seen)} short (rating only)`);
  if (s.failed_windows) out.push(`${s.failed_windows} search window(s) failed, will retry`);
  if (s.failed_threads) out.push(`${s.failed_threads} thread(s) failed, will retry`);
  if (s.reused_threads) out.push(`${s.reused_threads} known thread(s) reused`);
  if (s.skipped_threads) out.push(`${s.skipped_threads} passing-mention thread(s) skipped`);
  if (s.stopped_early) out.push("stopped early: source rate-limiting, resumes next run");
  return out;
}

async function Runs() {
  const runs = await getRuns(25);
  if (!runs.length) return <Card title="Recent runs"><p className="text-muted">No runs yet.</p></Card>;
  return (
    <Card title="Recent runs" subtitle="Newest first. “new” = items not seen before; re-runs never duplicate.">
      {/* A stacked list rather than a table, so it reads at any width without sideways scrolling. */}
      <ol className="text-sm">
        {runs.map((r) => (
          <li key={r.id} className="border-t border-border py-3 first:border-0 first:pt-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium">#{r.id} {r.kind}</span>
              <StatusPill status={r.status} />
              <span className="text-muted">
                {fmtDateTime(r.started_at)} IST · {r.trigger}
                {r.stats.mode ? ` · ${r.stats.mode}` : ""} · {duration(r.started_at, r.finished_at)}
              </span>
            </div>
            <ul className="mt-2 space-y-1">
              {Object.entries(r.stats.sources ?? {}).map(([src, s]) => (
                <li key={src} className="break-words">
                  <span className="font-medium">{SOURCE_LABEL[src] ?? src}</span>
                  {s.error ? null : <span className="tabular-nums"> · {fmtInt(s.seen)} seen, {fmtInt(s.new)} new</span>}
                  {notes(s).length > 0 && <span className="text-muted"> · {notes(s).join(" · ")}</span>}
                </li>
              ))}
            </ul>
            {r.error && <p className="mt-1 break-words text-bad">{r.error}</p>}
          </li>
        ))}
      </ol>
    </Card>
  );
}

async function Progress() {
  const cursors = await getCursors();
  const subs = cursors.filter((c) => c.key.startsWith("reddit_sub:"));
  const sources = cursors.filter((c) => !c.key.startsWith("reddit_sub:"));
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Collected up to" subtitle="Newest item each source has reached. Hourly runs continue from here.">
        {sources.length === 0 ? <p className="text-muted">No sources have completed a run yet.</p> : (
          <ul className="space-y-2 text-sm">
            {sources.map((c) => (
              <li key={c.key} className="flex justify-between border-t border-border pt-2 first:border-0 first:pt-0">
                <span>{CURSOR_LABEL[c.key] ?? c.key}</span>
                <span className="text-muted">{fmtDateTime(c.newest_seen)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Reddit backfill by subreddit"
            subtitle="Reddit's free archive rate-limits each IP, so the 12-month history fills in over several runs.">
        {subs.length === 0 ? <p className="text-muted">Not started on this database yet.</p> : (
          <ul className="space-y-2 text-sm">
            {subs.map((c) => (
              <li key={c.key} className="flex justify-between border-t border-border pt-2 first:border-0 first:pt-0">
                <span>r/{c.key.replace("reddit_sub:", "")}</span>
                <span className="text-muted">searched up to {fmtDateTime(c.newest_seen)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
