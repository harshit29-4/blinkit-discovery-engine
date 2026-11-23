/**
 * All data the pages read, in one place. Each function is cached for a few minutes
 * ('use cache' + cacheLife('minutes')): the pipeline only writes hourly, so this keeps
 * pages fast without showing stale data for long.
 */
import { cacheLife } from "next/cache";
import { select, UpstreamError } from "./supabase";

export const SOURCES = ["play_store", "app_store", "reddit_post", "reddit_comment"] as const;
export type Source = (typeof SOURCES)[number];

export const SOURCE_LABEL: Record<string, string> = {
  play_store: "Play Store",
  app_store: "App Store",
  reddit_post: "Reddit posts",
  reddit_comment: "Reddit comments",
};

export type SourceCount = { source: string; items: number; oldest: string; newest: string; last_fetched: string };
export type RatingMix = { source: string; rating: number; reviews: number; short_reviews: number | null };
export type DailyVolume = { source: string; day: string; items: number };
export type Run = {
  id: number;
  kind: string;
  trigger: string;
  status: "running" | "ok" | "partial" | "failed";
  started_at: string;
  finished_at: string | null;
  stats: { mode?: string; sources?: Record<string, SourceStats> };
  error: string | null;
};
export type SourceStats = {
  seen?: number;
  new?: number;
  short_seen?: number;
  error?: string;
  failed_windows?: number;
  failed_threads?: number;
  skipped_threads?: number;
  reused_threads?: number;
  stopped_early?: boolean;
};
export type Cursor = { key: string; newest_seen: string; updated_at: string };
export type Evidence = {
  source: string;
  source_id: string;
  title: string | null;
  text: string;
  rating: number | null;
  url: string | null;
  posted_at: string;
  lang_hint: string | null;
  subreddit: string | null;
  post_title: string | null;
};

export async function getSourceCounts() {
  "use cache";
  cacheLife("minutes");
  return (await select<SourceCount>("v_source_counts", { select: "*" })).rows;
}

export async function getRatingMix() {
  "use cache";
  cacheLife("minutes");
  return (await select<RatingMix>("v_rating_mix", { select: "*" })).rows;
}

/** Rows for the last `days` days plus the full list of days (so empty days still show). The
 *  current date is read here, inside the cached scope, as Cache Components requires. */
export async function getDailyVolume(days = 90) {
  "use cache";
  cacheLife("minutes");
  const now = Date.now();
  const dayList = Array.from({ length: days }, (_, i) =>
    new Date(now - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  );
  const rows = (await select<DailyVolume>("v_daily_volume", { select: "*", day: `gte.${dayList[0]}`, order: "day.asc" })).rows;
  return { rows, dayList };
}

export async function getRuns(limit = 25) {
  "use cache";
  cacheLife("minutes");
  return (await select<Run>("pipeline_runs", { select: "*", order: "id.desc", limit })).rows;
}

export async function getCursors() {
  "use cache";
  cacheLife("minutes");
  return (await select<Cursor>("v_cursors", { select: "*", order: "key.asc" })).rows;
}

export type EvidenceFilters = { q?: string; source?: string; rating?: string; page?: number };
export const PAGE_SIZE = 25;

export async function searchEvidence(f: EvidenceFilters) {
  "use cache";
  cacheLife("minutes");
  const page = Math.min(Math.max(1, Math.floor(f.page ?? 1)), 10_000);
  // Whole-word match (Postgres regex \m…\M) allowing a plural: "pet" finds pet/pets, not "petty".
  // Regex metacharacters are escaped; commas/parens would break PostgREST's filter syntax.
  // Capped at 100 chars: bounds the regex work any single request can ask the database to do.
  const q = (f.q ?? "").slice(0, 100).replace(/[,()]/g, " ").trim().replace(/[.*+?^${}|[\]\\]/g, "\\$&");
  try {
    return { ...(await runSearch(q, f, page)), blocked: false };
  } catch (e) {
    // A search the upstream firewall refuses (e.g. SQL-injection-looking text) gets a calm
    // "couldn't run that search" instead of the whole page failing.
    if (e instanceof UpstreamError && e.status === 403) return { rows: [] as Evidence[], total: 0, blocked: true };
    throw e;
  }
}

function runSearch(q: string, f: EvidenceFilters, page: number) {
  return select<Evidence>(
    "v_evidence",
    {
      select: "*",
      order: "posted_at.desc",
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      text: q ? `imatch.\\m${q}(s|es)?\\M` : undefined,
      source: f.source && SOURCES.includes(f.source as Source) ? `eq.${f.source}` : undefined,
      rating: f.rating && /^[1-5]$/.test(f.rating) ? `eq.${f.rating}` : undefined,
    },
    { count: true },
  );
}
