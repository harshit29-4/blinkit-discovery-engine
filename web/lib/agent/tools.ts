/**
 * The agent's tools. All are read-only and all numbers are computed in the database; the model
 * only chooses which tool to call and reports what comes back.
 *
 * Entries a tool returns are registered as evidence with short ids (E1, E2, …) that the model
 * cites. The citation check then confirms every cited id was really returned in this turn.
 */
import { rpc, select } from "../supabase";
import { TAXONOMY } from "../taxonomy";
import { KIND_LABEL, RESEARCH_QUESTIONS } from "../research";

const keys = (field: keyof typeof TAXONOMY) => Object.keys(TAXONOMY[field]);

export const GROUP_BY = {
  barrier: "barriers",
  category: "categories",
  info_need: "info_needs",
  discovery_channel: "discovery_channels",
  segment: "segment_signals",
  sentiment: "sentiment",
  funnel_stage: "funnel_stage",
  category_behavior: "category_behavior",
} as const;

const FILTERS = {
  source: { type: "string", enum: ["play_store", "app_store", "reddit"], description: "Only this source" },
  barrier: { type: "string", enum: keys("barriers"), description: "Only entries tagged with this barrier" },
  category: { type: "string", enum: keys("categories"), description: "Only entries about this category" },
  theme_id: { type: "integer", description: "Only entries in this theme (ids from get_themes)" },
} as const;

/** OpenAI-style tool definitions, as Groq expects them. */
export const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "search_feedback",
      description:
        "Find customer feedback entries (app reviews and Reddit). Keyword search over all collected entries; " +
        "AI-tagged entries are listed first. Returns entries with ids (E1, E2…) to cite. Use short keyword " +
        "queries (e.g. 'expired milk', 'pet food', 'refund'), not full sentences.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Keywords; supports \"quoted phrases\", OR, and -exclusions" },
          ...FILTERS,
          rating: { type: "integer", minimum: 1, maximum: 5, description: "Only reviews with this star rating" },
          tagged_only: { type: "boolean", description: "Only entries the AI has tagged" },
          limit: { type: "integer", minimum: 1, maximum: 8 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "count_feedback",
      description:
        "Count AI-tagged entries grouped by one field, with optional filters. Returns each value's count, its " +
        "share of the matching entries (base), and the base. Use this for every number you state.",
      parameters: {
        type: "object",
        properties: {
          group_by: {
            type: "string",
            enum: [...Object.keys(GROUP_BY), "habit", "source", "month", "rating", "theme"],
          },
          ...FILTERS,
          sentiment: { type: "string", enum: keys("sentiment") },
          query: { type: "string", description: "Optional keywords: only count entries matching them" },
        },
        required: ["group_by"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_themes",
      description:
        "The current themes (clusters of similar AI-tagged feedback), with size, share, average rating, " +
        "top barriers and one representative quote each (citable id).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_reliability",
      description:
        "How reliable each AI tag field is (agreement between two independent models, stability on re-runs, " +
        "grounding). Call this before relying on funnel stage or category behaviour.",
      parameters: { type: "object", properties: {} },
    },
  },
] as const;

export type Evidence = {
  id: string; source: string; source_id: string; url: string | null; rating: number | null;
  posted_at: string; text: string; translation: string | null;
};

/** Evidence ids for this turn, stable per entry. */
export class EvidenceRegistry {
  private byKey = new Map<string, Evidence>();
  constructor(start: Evidence[] = []) {
    for (const e of start) this.byKey.set(`${e.source}:${e.source_id}`, e);
  }
  add(e: Omit<Evidence, "id">): Evidence {
    const k = `${e.source}:${e.source_id}`;
    let ev = this.byKey.get(k);
    if (!ev) {
      ev = { ...e, id: `E${this.byKey.size + 1}` };
      this.byKey.set(k, ev);
    }
    return ev;
  }
  ids(): Set<string> {
    return new Set([...this.byKey.values()].map((e) => e.id));
  }
  get(id: string): Evidence | undefined {
    return [...this.byKey.values()].find((e) => e.id === id);
  }
}

type SearchRow = {
  source: string; source_id: string; text: string; title: string | null; rating: number | null;
  posted_at: string; url: string | null; sentiment: string | null; barriers: string[] | null;
  categories: string[] | null; evidence_span: string | null; translation: string | null; theme_id: number | null;
};
type CountRow = { value: string; entries: number; share: number; base: number };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null);
const int = (v: unknown) => (Number.isInteger(v) ? (v as number) : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null);
const oneOf = (v: unknown, allowed: string[]) => (typeof v === "string" && allowed.includes(v) ? v : null);

function labelFor(group: string, value: string): string {
  const field = GROUP_BY[group as keyof typeof GROUP_BY];
  if (field) return TAXONOMY[field][value] ?? value;
  if (group === "source") return { play_store: "Google Play", app_store: "App Store", reddit: "Reddit" }[value] ?? value;
  if (group === "rating") return `${value} star${value === "1" ? "" : "s"}`;
  return value;
}

export type ToolResult = { content: unknown; summary: string };

/** Runs one tool call. Bad arguments are dropped, not trusted: the model gets an error to correct. */
export async function runTool(name: string, rawArgs: string, reg: EvidenceRegistry): Promise<ToolResult> {
  let a: Record<string, unknown> = {};
  try {
    a = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return { content: { error: "arguments were not valid JSON" }, summary: "invalid arguments" };
  }
  const filters = {
    p_source: oneOf(a.source, ["play_store", "app_store", "reddit"]),
    p_barrier: oneOf(a.barrier, keys("barriers")),
    p_category: oneOf(a.category, keys("categories")),
    p_theme: int(a.theme_id),
  };

  if (name === "search_feedback") {
    const rows = await rpc<SearchRow[]>("search_feedback", {
      q: str(a.query), ...filters, p_rating: int(a.rating), p_tagged_only: a.tagged_only === true,
      k: Math.min(int(a.limit) ?? 6, 8),
    });
    const entries = rows.map((r) => {
      const ev = reg.add({
        source: r.source, source_id: r.source_id, url: r.url, rating: r.rating, posted_at: r.posted_at,
        text: r.text, translation: r.translation,
      });
      return {
        id: ev.id, source: r.source, rating: r.rating, date: r.posted_at.slice(0, 10),
        text: r.text.slice(0, 260), ...(r.translation ? { translation: r.translation.slice(0, 260) } : {}),
        ...(r.sentiment ? { ai_tags: { sentiment: r.sentiment, barriers: r.barriers, categories: r.categories } } : {}),
        ...(r.theme_id !== null ? { theme_id: r.theme_id } : {}),
      };
    });
    return {
      content: entries.length ? { entries } : { entries: [], note: "No entries match. Try fewer or different keywords." },
      summary: `${entries.length} entr${entries.length === 1 ? "y" : "ies"}`,
    };
  }

  if (name === "count_feedback") {
    const group = oneOf(a.group_by, [...Object.keys(GROUP_BY), "habit", "source", "month", "rating", "theme"]);
    if (!group) return { content: { error: "group_by is required and must be one of the listed values" }, summary: "invalid arguments" };
    const rows = await rpc<CountRow[]>("count_feedback", {
      group_by: group, ...filters, p_sentiment: oneOf(a.sentiment, keys("sentiment")), q: str(a.query),
    });
    const base = rows[0]?.base ?? 0;
    return {
      content: {
        base, note: "base = AI-tagged entries matching the filters; an entry can have several values",
        rows: rows.map((r) => ({ value: r.value, label: labelFor(group, r.value), entries: r.entries,
          percent: Math.round(r.share * 1000) / 10 })),
      },
      summary: `${rows.length} groups, base ${base}`,
    };
  }

  if (name === "get_themes") {
    type T = { theme_id: number; name: string; description: string; kind: string; questions: number[];
      size: number; share: number; avg_rating: number | null; pct_negative: number | null; top_barriers: [string, number][] };
    type Q = { theme_id: number; ord: number; source: string; source_id: string; url: string | null; rating: number | null;
      posted_at: string; quote: string; translation: string | null };
    const [themes, quotes] = await Promise.all([
      select<T>("v_themes", { select: "*", order: "size.desc" }),
      select<Q>("v_theme_quotes", { select: "*", order: "theme_id.asc,ord.asc" }),
    ]);
    const content = themes.rows.map((t) => ({
      theme_id: t.theme_id, name: t.name, description: t.description, kind: KIND_LABEL[t.kind] ?? t.kind,
      entries: t.size, percent_of_tagged: Math.round(t.share * 1000) / 10,
      avg_rating: t.avg_rating === null ? null : Math.round(t.avg_rating * 10) / 10,
      percent_negative: t.pct_negative === null ? null : Math.round(t.pct_negative * 1000) / 10,
      top_barriers: (t.top_barriers ?? []).slice(0, 3).map(([b, n]) => ({ barrier: TAXONOMY.barriers[b] ?? b, entries: n })),
      research_questions: (t.questions ?? []).map((q) => RESEARCH_QUESTIONS[q]).filter(Boolean),
      quotes: quotes.rows.filter((q) => q.theme_id === t.theme_id).slice(0, 1).map((q) => {
        const ev = reg.add({ source: q.source, source_id: q.source_id, url: q.url, rating: q.rating,
          posted_at: q.posted_at, text: q.quote, translation: q.translation });
        return { id: ev.id, text: q.quote.slice(0, 200) };
      }),
    }));
    return { content: { themes: content }, summary: `${content.length} themes` };
  }

  if (name === "get_reliability") {
    type M = { metric: string; value: number | null; n: number; details: Record<string, unknown> };
    const { rows } = await select<M>("v_validation", { select: "metric,value,n,details" });
    const meaning: Record<string, string> = {
      v1_sentiment: "sentiment: agreement between two models (Cohen's kappa)",
      v1_barriers: "barriers: agreement between two models (kappa)",
      v1_categories: "categories: agreement between two models (kappa)",
      v1_funnel_stage: "funnel stage: agreement between two models (kappa)",
      v1_category_behavior: "category behaviour: agreement between two models (kappa)",
      v2_sentiment_vs_stars: "sentiment agrees with the star rating (share)",
      v3_grounding: "tags backed by a verbatim quote (share)",
      v7_stability: "same answer when re-run a week later (share)",
      v8_translation: "translations confirmed by a second model (share)",
    };
    const content = rows.filter((r) => meaning[r.metric]).map((r) => ({
      measure: meaning[r.metric], value: r.value === null ? null : Math.round(r.value * 100) / 100, sample: r.n,
    }));
    return {
      content: { measures: content, guide: "kappa: below 0.4 weak, 0.4–0.6 moderate, above 0.6 substantial" },
      summary: `${content.length} measures`,
    };
  }

  return { content: { error: `unknown tool ${name}` }, summary: "unknown tool" };
}
