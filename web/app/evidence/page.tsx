import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Card, PageHeader, Skeleton, SourceBadge, Stars } from "@/components/ui";
import { IconSearch } from "@/components/icons";
import { MAX_PAGES, PAGE_SIZE, SOURCE_LABEL, getSourceCounts, getThemes, searchEvidence, type Evidence, type EvidenceFilters } from "@/lib/data";
import { fmtDate, fmtInt } from "@/lib/format";
import { TAXONOMY, label } from "@/lib/taxonomy";

export const metadata: Metadata = { title: "Evidence" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default function EvidencePage(props: PageProps<"/evidence">) {
  return (
    <div className="space-y-6">
      <PageHeader title="Evidence" subtitle="Every review and comment collected, newest first, with links to the originals."
        learn="evidence" />
      <Suspense fallback={<Skeleton h="h-96" />}>
        <Results searchParams={props.searchParams as Promise<SP>} />
      </Suspense>
    </div>
  );
}

async function Results({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const filters: EvidenceFilters = {
    q: one(sp.q),
    source: one(sp.source),
    rating: one(sp.rating),
    page: Number(one(sp.page)) || 1,
    barrier: one(sp.barrier),
    category: one(sp.category),
    stage: one(sp.stage),
    tagged: one(sp.tagged),
    theme: one(sp.theme),
  };
  // Only sources that actually hold data are offered as filters.
  const [{ rows, total, approximate, blocked }, counts, { themes }] = await Promise.all([
    searchEvidence(filters), getSourceCounts(), getThemes(),
  ]);
  const themeName = new Map(themes.map((t) => [t.theme_id, t.name]));
  const available = counts.filter((c) => c.items > 0).sort((a, b) => b.items - a.items);
  const allPages = total ? Math.ceil(total / PAGE_SIZE) : 1;
  const pages = Math.min(allPages, MAX_PAGES); // browsable pages
  const page = filters.page ?? 1;

  const href = (p: number) => {
    const u = new URLSearchParams();
    if (filters.q) u.set("q", filters.q);
    if (filters.source) u.set("source", filters.source);
    if (filters.rating) u.set("rating", filters.rating);
    for (const k of ["barrier", "category", "stage", "tagged", "theme"] as const) if (filters[k]) u.set(k, filters[k]!);
    if (p > 1) u.set("page", String(p));
    const s = u.toString();
    return s ? `/evidence?${s}` : "/evidence";
  };

  return (
    <>
      <form action="/evidence" className="space-y-3 rounded-2xl border border-border bg-surface p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-bg px-3 focus-within:border-accent">
            <IconSearch className="h-5 w-5 shrink-0 text-muted" />
            <span className="sr-only">Keyword</span>
            <input name="q" defaultValue={filters.q} placeholder={"Search feedback, e.g. pet food, expiry, \u201cfresh vegetables\u201d"}
                   maxLength={100} className="w-full bg-transparent py-2.5 text-base focus:outline-none" />
          </label>
          <button className="rounded-xl bg-accent px-5 py-2.5 font-bold text-accent-ink hover:brightness-110">Search</button>
        </div>
        <details className="group" open={!!(filters.source || filters.rating || filters.barrier || filters.category || filters.stage || filters.tagged || filters.theme)}>
          <summary className="cursor-pointer list-none text-sm font-semibold text-accent">
            <span className="group-open:hidden">+ More filters</span><span className="hidden group-open:inline">− Fewer filters</span>
          </summary>
          <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Source</span>
          <select name="source" defaultValue={filters.source} className="rounded-md border border-border bg-bg px-3 py-2 text-base">
            <option value="">All sources</option>
            {available.map((c) => (
              <option key={c.source} value={c.source}>{SOURCE_LABEL[c.source] ?? c.source}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Rating</span>
          <select name="rating" defaultValue={filters.rating} className="rounded-md border border-border bg-bg px-3 py-2 text-base">
            <option value="">All ratings</option>
            {[5, 4, 3, 2, 1].map((r) => <option key={r} value={r}>{r} star{r > 1 ? "s" : ""}</option>)}
          </select>
        </label>
        {themes.length > 0 && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Theme (AI)</span>
            <select name="theme" defaultValue={filters.theme} className="max-w-64 rounded-md border border-border bg-bg px-3 py-2 text-base">
              <option value="">Any</option>
              {themes.map((t) => <option key={t.theme_id} value={t.theme_id}>{t.name}</option>)}
            </select>
          </label>
        )}
        <TagSelect name="barrier" label="Barrier (AI)" field="barriers" value={filters.barrier} />
        <TagSelect name="category" label="Category (AI)" field="categories" value={filters.category} />
        <TagSelect name="stage" label="Funnel stage (AI)" field="funnel_stage" value={filters.stage} />
        <label className="flex items-center gap-2 self-center pt-5 text-sm">
          <input type="checkbox" name="tagged" value="1" defaultChecked={filters.tagged === "1"} className="h-4 w-4" />
          AI-tagged only
        </label>
          </div>
        </details>
        {(filters.q || filters.source || filters.rating || filters.barrier || filters.category || filters.stage || filters.tagged || filters.theme) && (
          <Link href="/evidence" className="inline-block text-sm text-muted underline underline-offset-2">Clear search and filters</Link>
        )}
      </form>

      <p className="text-sm text-muted" aria-live="polite">
        {approximate ? "About " : ""}{fmtInt(total ?? rows.length)} {total === 1 ? "result" : "results"}
        {pages > 1 && page <= pages && ` · Page ${fmtInt(page)} of ${allPages > MAX_PAGES ? fmtInt(pages) : `${approximate ? "about " : ""}${fmtInt(pages)}`}`}
        {allPages > MAX_PAGES && ` (the newest ${fmtInt(MAX_PAGES * PAGE_SIZE)} can be browsed; add a keyword or filter to narrow the rest)`}

      </p>

      {blocked ? (
        <Card>
          <p className="text-muted">
            This search could not be processed because it contains characters that resemble code. Please search
            using plain keywords, for example <em>refund</em> or <em>expiry</em>.
          </p>
        </Card>
      ) : rows.length === 0 && total && page > pages ? (
        <Card>
          <p className="text-muted">
            {allPages > MAX_PAGES ? `Browsing stops at page ${fmtInt(pages)}.` : `The results contain ${fmtInt(pages)} pages.`}{" "}
            <Link className="text-accent underline underline-offset-2" href={href(pages)}>Go to the last page</Link>
          </p>
        </Card>
      ) : rows.length === 0 ? (
        <Card><p className="text-muted">No feedback matches these criteria. Try a broader keyword or remove a filter.</p></Card>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={`${r.source}:${r.source_id}`} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <SourceBadge source={r.source} />
                {r.subreddit && <span className="text-sm text-muted">r/{r.subreddit}</span>}
                <Stars rating={r.rating} />
                <span className="text-sm text-muted">{fmtDate(r.posted_at)}</span>
                {r.lang_hint === "hi" && <span className="text-sm text-muted">Hindi</span>}
                {r.url && (
                  <a href={r.url} target="_blank" rel="noopener noreferrer"
                     className="ml-auto text-sm text-accent underline underline-offset-2">
                    View original ↗
                  </a>
                )}
              </div>
              {(r.source === "reddit_comment" || r.source === "youtube_comment") && r.post_title && (
                <p className="mt-2 text-sm text-muted">
                  {r.source === "youtube_comment" ? "Comment on the video" : "Comment on"}: “{r.post_title}”
                </p>
              )}
              {r.title && <p className="mt-2 font-medium">{r.title}</p>}
              {r.text && <p className="mt-1 whitespace-pre-line leading-relaxed">{r.text}</p>}
              {r.translation && (
                <p className="mt-2 text-sm text-muted"><span className="font-medium">English (AI translation, verified):</span> {r.translation}</p>
              )}
              {r.ai_tagged && <AiTags r={r} theme={r.theme_id !== null ? themeName.get(r.theme_id) : undefined} />}
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && page <= pages && (
        <nav aria-label="Pagination" className="flex items-center justify-between">
          {page > 1 ? <Link className="text-accent underline underline-offset-2" href={href(page - 1)}>← Previous</Link> : <span />}
          {page < pages ? <Link className="text-accent underline underline-offset-2" href={href(page + 1)}>Next →</Link> : <span />}
        </nav>
      )}
    </>
  );
}

function TagSelect({ name, label: text, field, value }: {
  name: string; label: string; field: "barriers" | "categories" | "funnel_stage"; value?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted">{text}</span>
      <select name={name} defaultValue={value} className="rounded-md border border-border bg-bg px-3 py-2 text-base">
        <option value="">Any</option>
        {Object.entries(TAXONOMY[field]).filter(([k]) => k !== "none").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
    </label>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return <span className="rounded-full border border-border px-2 py-0.5 text-sm">{children}</span>;
}

/** The AI's reading of an entry. Only tags from the shared taxonomy are stored, so labels always resolve. */
function AiTags({ r, theme }: { r: Evidence; theme?: string }) {
  const groups: [string, string[]][] = [
    ["Barriers", (r.barriers ?? []).map((k) => label("barriers", k))],
    ["Categories", (r.categories ?? []).map((k) => label("categories", k))],
    ["Information needed", (r.info_needs ?? []).map((k) => label("info_needs", k))],
    ["Discovered via", (r.discovery_channels ?? []).map((k) => label("discovery_channels", k))],
  ];
  const stage = r.funnel_stage && r.funnel_stage !== "none" ? label("funnel_stage", r.funnel_stage) : null;
  const behaviour = r.category_behavior && r.category_behavior !== "none" ? label("category_behavior", r.category_behavior) : null;
  return (
    <div className="mt-3 rounded-lg bg-bg p-3 text-sm">
      <p className="font-medium">AI analysis</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
        {r.sentiment && <span><span className="text-muted">Sentiment:</span> {label("sentiment", r.sentiment)}</span>}
        {stage && <span><span className="text-muted">Funnel stage:</span> {stage}</span>}
        {behaviour && <span><span className="text-muted">Behaviour:</span> {behaviour}</span>}
        {theme && <span><span className="text-muted">Theme:</span> {theme}</span>}
      </div>
      {groups.filter(([, v]) => v.length).map(([name, vals]) => (
        <div key={name} className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-muted">{name}:</span>
          {vals.map((v) => <Chip key={v}>{v}</Chip>)}
        </div>
      ))}
      {r.unmet_need && <p className="mt-2"><span className="text-muted">Unmet need:</span> {r.unmet_need}</p>}
      {r.evidence_span && (
        <p className="mt-2"><span className="text-muted">Supporting quote (verified verbatim):</span> &ldquo;{r.evidence_span}&rdquo;</p>
      )}
    </div>
  );
}
