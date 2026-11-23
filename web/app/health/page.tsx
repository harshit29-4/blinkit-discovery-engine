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
        <p className="mt-1 max-w-3xl text-muted">
          A record of every data collection run, including the volume collected and any issues encountered.
          Collection is fully automated; any gaps are logged and retried in the following run.
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
  reddit_post: "Reddit",
};
const TRIGGER_LABEL: Record<string, string> = { schedule: "Scheduled", manual: "Manual", button: "On demand" };
const MODE_LABEL: Record<string, string> = { backfill: "12-month backfill", incremental: "Incremental update" };
const KIND_LABEL: Record<string, string> = { collect: "Data collection" };

function notes(s: SourceStats): string[] {
  const out: string[] = [];
  if (s.error) out.push(`error: ${s.error}`);
  if (s.short_seen) out.push(`${fmtInt(s.short_seen)} rating-only`);
  if (s.failed_windows) out.push(`${s.failed_windows} search window(s) incomplete; will be retried`);
  if (s.failed_threads) out.push(`${s.failed_threads} thread(s) incomplete; will be retried`);
  if (s.reused_threads) out.push(`${s.reused_threads} previously collected thread(s) reused`);
  if (s.skipped_threads) out.push(`${s.skipped_threads} unrelated thread(s) excluded`);
  if (s.stopped_early) out.push("paused due to source rate limits; resumes in the next run");
  return out;
}

async function Runs() {
  const runs = await getRuns(25);
  if (!runs.length) return <Card title="Collection runs"><p className="text-muted">No runs have been recorded yet.</p></Card>;
  return (
    <Card
      title="Collection runs"
      subtitle="Most recent first. “New” counts entries not previously collected; repeated runs never create duplicates."
    >
      {/* A stacked list rather than a table, so it reads at any width without sideways scrolling. */}
      <ol className="text-sm">
        {runs.map((r) => {
          const sources = Object.entries(r.stats.sources ?? {});
          return (
            <li key={r.id} className="border-t border-border py-3 first:border-0 first:pt-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">Run {r.id} · {KIND_LABEL[r.kind] ?? r.kind}</span>
                <StatusPill status={r.status} />
                <span className="text-muted">
                  Started {fmtDateTime(r.started_at)} IST · {TRIGGER_LABEL[r.trigger] ?? r.trigger}
                  {r.stats.mode ? ` · ${MODE_LABEL[r.stats.mode] ?? r.stats.mode}` : ""}
                  {r.finished_at ? ` · Duration ${duration(r.started_at, r.finished_at)}` : ""}
                </span>
              </div>
              {sources.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {sources.map(([src, s]) => (
                    <li key={src} className="break-words">
                      <span className="font-medium">{SOURCE_LABEL[src] ?? src}</span>
                      {s.error ? null : (
                        <span className="tabular-nums"> · {fmtInt(s.seen)} collected, {fmtInt(s.new)} new</span>
                      )}
                      {notes(s).length > 0 && <span className="text-muted"> · {notes(s).join(" · ")}</span>}
                    </li>
                  ))}
                </ul>
              ) : r.status === "running" ? (
                <p className="mt-2 text-muted">Collection in progress. Results are recorded when the run completes.</p>
              ) : null}
              {r.error && <p className="mt-1 break-words text-bad">{r.error}</p>}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

async function Progress() {
  const cursors = await getCursors();
  const subs = cursors.filter((c) => c.key.startsWith("reddit_sub:"));
  const sources = cursors.filter((c) => !c.key.startsWith("reddit_sub:"));
  return (
    <div className={`grid gap-6 ${subs.length ? "lg:grid-cols-2" : ""}`}>
      <Card title="Collection progress" subtitle="Most recent entry collected from each source. Each hourly run continues from this point.">
        {sources.length === 0 ? <p className="text-muted">No source has completed a run yet.</p> : (
          <ul className="space-y-2 text-sm">
            {sources.map((c) => (
              <li key={c.key} className="flex justify-between gap-4 border-t border-border pt-2 first:border-0 first:pt-0">
                <span>{CURSOR_LABEL[c.key] ?? c.key}</span>
                <span className="text-muted">{fmtDateTime(c.newest_seen)} IST</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {/* Shown only once Reddit collection has begun. */}
      {subs.length > 0 && (
        <Card title="Reddit collection by community"
              subtitle="The Reddit archive limits request rates, so the 12-month history is collected across several runs.">
          <ul className="space-y-2 text-sm">
            {subs.map((c) => (
              <li key={c.key} className="flex justify-between gap-4 border-t border-border pt-2 first:border-0 first:pt-0">
                <span>r/{c.key.replace("reddit_sub:", "")}</span>
                <span className="text-muted">Complete up to {fmtDateTime(c.newest_seen)} IST</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
