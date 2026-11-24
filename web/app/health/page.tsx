import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, Skeleton, StatusPill } from "@/components/ui";
import { RunButton } from "@/components/run-button";
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
      <RunButton />
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
  youtube_comment: "YouTube",
};
const TRIGGER_LABEL: Record<string, string> = { schedule: "Scheduled", manual: "Manual", button: "On demand" };
const MODE_LABEL: Record<string, string> = { backfill: "12-month backfill", incremental: "Incremental update", analyse: "AI stages" };
const KIND_LABEL: Record<string, string> = { collect: "Data collection", analyse: "AI analysis" };
const STAGE_LABEL: Record<string, string> = { screen: "Pre-filter", relevance: "Relevance gate", tag: "Tagging", translation: "Translation check" };
const STAGE_STAT_LABEL: Record<string, string> = {
  screened: "screened", candidate: "candidates", control: "control sample", excluded: "excluded",
  candidate_relevant: "relevant", candidate_not_relevant: "not relevant", control_relevant: "control relevant",
  control_not_relevant: "control not relevant", tagged: "tagged", grounded: "quotes verified", translated: "translated",
  retried_grounded: "fixed on retry", passed: "passed", failed_check: "failed", failed_items: "failed (will retry)",
  unanswered: "unanswered (will retry)", schema_drops: "invalid tag values discarded",
  stopped_daily_limit: "stopped: daily model limit reached", paused_rate_limit: "paused: model rate limit",
};

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
          const stages = Object.entries(r.stats.stages ?? {});
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
              ) : stages.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {stages.map(([name, st]) => (
                    <li key={name} className="break-words">
                      <span className="font-medium">{STAGE_LABEL[name] ?? name}</span>
                      <span className="text-muted"> · {Object.entries(st)
                        .filter(([k]) => !k.startsWith("lang_"))
                        .map(([k, v]) => typeof v === "number" && !["stopped_daily_limit", "paused_rate_limit"].includes(k)
                          ? `${fmtInt(v)} ${STAGE_STAT_LABEL[k] ?? k}` : (STAGE_STAT_LABEL[k] ?? `${k}: ${v}`))
                        .join(" · ") || "no work pending"}</span>
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
  const queries = cursors.filter((c) => c.key.startsWith("youtube_q:"));
  const sources = cursors.filter((c) => !c.key.startsWith("reddit_sub:") && !c.key.startsWith("youtube_q:"));
  return (
    <div className={`grid gap-6 ${subs.length || queries.length ? "lg:grid-cols-2" : ""}`}>
      <Card title="Collection progress" subtitle="Most recent entry collected from each source. Each daily run continues from this point.">
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
      {/* Shown only once YouTube collection has begun. */}
      {queries.length > 0 && (
        <Card title="YouTube collection by search"
              subtitle="Videos found by each search; comments are read only on videos whose title names Blinkit. The free quota allows about 10,000 units a day (a search costs 100).">
          <ul className="space-y-2 text-sm">
            {queries.map((c) => (
              <li key={c.key} className="flex justify-between gap-4 border-t border-border pt-2 first:border-0 first:pt-0">
                <span>“{c.key.replace("youtube_q:", "")}”</span>
                <span className="text-muted">Newest video read: {fmtDateTime(c.newest_seen)} IST</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
