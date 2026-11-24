/**
 * All data the pages read, in one place. Each function is cached for a few minutes
 * ('use cache' + cacheLife('minutes')): the pipeline only writes hourly, so this keeps
 * pages fast without showing stale data for long.
 */
import { cacheLife } from "next/cache";
import { select, UpstreamError } from "./supabase";
import { isKey } from "./taxonomy";

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
  stats: { mode?: string; sources?: Record<string, SourceStats>; stages?: Record<string, Record<string, number | string>> };
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
  // AI tags (null until the entry has been tagged)
  sentiment: string | null;
  categories: string[] | null;
  category_behavior: string | null;
  barriers: string[] | null;
  funnel_stage: string | null;
  discovery_channels: string[] | null;
  info_needs: string[] | null;
  unmet_need: string | null;
  evidence_span: string | null; // only when verified verbatim (V3)
  translation: string | null;   // only when the second model passed it (V8)
  ai_tagged: boolean;
  theme_id: number | null;      // theme in the current published snapshot
};

export type Funnel = {
  collected: number; screened: number; candidates: number; control_sample: number; excluded: number;
  candidates_checked: number; candidates_relevant: number; control_checked: number; control_relevant: number;
  tagged: number; grounded: number; translated: number; translation_checked: number; translation_passed: number;
  non_english: number;
};
export type AiUsage = { day: string; stage: string; model: string; calls: number; items: number;
  tokens_in: number; tokens_out: number; failed_calls: number };

export type Theme = {
  theme_id: number; name: string; description: string; kind: string; questions: number[];
  size: number; share: number; avg_rating: number | null; pct_negative: number | null;
  top_barriers: [string, number][]; top_categories: [string, number][];
  sources: Record<string, number>; monthly: Record<string, number>;
};
export type ThemeQuote = {
  theme_id: number; ord: number; source: string; source_id: string; url: string | null;
  rating: number | null; posted_at: string; quote: string; translation: string | null;
};
export type ThemeSnapshot = { id: number; created_at: string; items: number; noise: number; model: string };
export type Metric = { metric: string; value: number | null; n: number; details: Record<string, unknown>; computed_at: string };

export async function getThemes() {
  "use cache";
  cacheLife("minutes");
  const [themes, quotes, snap] = await Promise.all([
    select<Theme>("v_themes", { select: "*", order: "size.desc" }),
    select<ThemeQuote>("v_theme_quotes", { select: "*", order: "theme_id.asc,ord.asc" }),
    select<ThemeSnapshot>("v_theme_snapshot", { select: "*" }),
  ]);
  return { themes: themes.rows, quotes: quotes.rows, snapshot: snap.rows[0] ?? null };
}

export async function getValidation() {
  "use cache";
  cacheLife("minutes");
  return (await select<Metric>("v_validation", { select: "*" })).rows;
}

export type ChatQuality = {
  answers: number; citations_valid_rate: number | null; numbers_verified_rate: number | null;
  mean_faithfulness: number | null; cached_answers: number;
};

/** Results of the automatic checks on Ask-page answers (no question or answer text is stored). */
export async function getChatQuality() {
  "use cache";
  cacheLife("minutes");
  return (await select<ChatQuality>("v_chat_quality", { select: "*" })).rows[0] ?? null;
}

export async function getFunnel() {
  "use cache";
  cacheLife("minutes");
  return (await select<Funnel>("v_ai_funnel", { select: "*" })).rows[0];
}

export async function getAiUsage() {
  "use cache";
  cacheLife("minutes");
  return (await select<AiUsage>("v_ai_usage", { select: "*", order: "day.desc", limit: 200 })).rows;
}

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

export type EvidenceFilters = {
  q?: string; source?: string; rating?: string; page?: number;
  barrier?: string; category?: string; stage?: string; tagged?: string; theme?: string;
};
export const PAGE_SIZE = 25;

export async function searchEvidence(f: EvidenceFilters) {
  "use cache";
  cacheLife("minutes");
  const page = Math.min(Math.max(1, Math.floor(f.page ?? 1)), 10_000);
  // Full-text search on the indexed fts column: English word forms ("refund" finds refunds/refunded),
  // whole words only ("pet" does not match "petty"), "quoted phrases", OR and -exclusions.
  // Commas/parens would break PostgREST's filter syntax; capped at 100 characters.
  const q = (f.q ?? "").slice(0, 100).replace(/[,()]/g, " ").replace(/\s+/g, " ").trim();
  try {
    return { ...(await runSearch(q, f, page)), blocked: false };
  } catch (e) {
    // A search the upstream firewall refuses (e.g. SQL-injection-looking text) gets a calm
    // "couldn't run that search" instead of the whole page failing.
    if (e instanceof UpstreamError && e.status === 403) {
      return { rows: [] as Evidence[], total: 0, approximate: false, blocked: true };
    }
    throw e;
  }
}

// Every v_evidence column except the search vector, which is only used for filtering.
const EVIDENCE_COLUMNS =
  "source,source_id,title,text,rating,url,posted_at,lang_hint,subreddit,post_title,sentiment,categories," +
  "category_behavior,barriers,funnel_stage,discovery_channels,info_needs,unmet_need,evidence_span,translation," +
  "ai_tagged,theme_id";

async function runSearch(q: string, f: EvidenceFilters, page: number) {
  // With any AI-tag filter, search v_evidence_tagged, which starts from the few hundred tagged entries
  // (in v_evidence the planner would walk every match looking for tagged ones).
  const taggedOnly = f.tagged === "1" || isKey("barriers", f.barrier) || isKey("categories", f.category) ||
    isKey("funnel_stage", f.stage) || (!!f.theme && /^\d{1,4}$/.test(f.theme));
  const res = await select<Evidence>(
    taggedOnly ? "v_evidence_tagged" : "v_evidence",
    {
      select: EVIDENCE_COLUMNS,
      order: "posted_at.desc",
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      fts: q ? `wfts(english).${q}` : undefined,
      source: f.source && SOURCES.includes(f.source as Source) ? `eq.${f.source}` : undefined,
      rating: f.rating && /^[1-5]$/.test(f.rating) ? `eq.${f.rating}` : undefined,
      // AI tag filters: only values from the shared taxonomy are ever sent to the database.
      barriers: isKey("barriers", f.barrier) ? `cs.{${f.barrier}}` : undefined,
      categories: isKey("categories", f.category) ? `cs.{${f.category}}` : undefined,
      funnel_stage: isKey("funnel_stage", f.stage) ? `eq.${f.stage}` : undefined,
      theme_id: f.theme && /^\d{1,4}$/.test(f.theme) ? `eq.${f.theme}` : undefined,
    },
    // An exact count of a common word (30,000+ matches) takes seconds, so text-search totals are
    // estimated by the planner when large (PostgREST counts exactly when the result is small).
    { count: q ? "estimated" : true },
  );
  return { ...res, approximate: !!q && (res.total ?? 0) >= 1000 };
}
