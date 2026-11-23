import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Skeleton, SourceBadge, Stars } from "@/components/ui";
import { PAGE_SIZE, SOURCE_LABEL, SOURCES, searchEvidence, type EvidenceFilters } from "@/lib/data";
import { fmtDate, fmtInt } from "@/lib/format";

export const metadata: Metadata = { title: "Evidence" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default function EvidencePage(props: PageProps<"/evidence">) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Evidence</h1>
        <p className="mt-1 max-w-2xl text-muted">
          Every analysable review, post and comment, newest first. Search the text, filter by source or rating,
          and open the original.
        </p>
      </div>
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
  };
  const { rows, total, blocked } = await searchEvidence(filters);
  const pages = total ? Math.ceil(total / PAGE_SIZE) : 1;
  const page = filters.page ?? 1;

  const href = (p: number) => {
    const u = new URLSearchParams();
    if (filters.q) u.set("q", filters.q);
    if (filters.source) u.set("source", filters.source);
    if (filters.rating) u.set("rating", filters.rating);
    if (p > 1) u.set("page", String(p));
    const s = u.toString();
    return s ? `/evidence?${s}` : "/evidence";
  };

  return (
    <>
      <form action="/evidence" className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-4">
        <label className="flex min-w-60 flex-1 flex-col gap-1 text-sm">
          <span className="text-muted">Search text</span>
          <input name="q" defaultValue={filters.q} placeholder="e.g. pet food, expiry, refund" maxLength={100}
                 className="rounded-md border border-border bg-bg px-3 py-2 text-base" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Source</span>
          <select name="source" defaultValue={filters.source} className="rounded-md border border-border bg-bg px-3 py-2 text-base">
            <option value="">All sources</option>
            {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Rating</span>
          <select name="rating" defaultValue={filters.rating} className="rounded-md border border-border bg-bg px-3 py-2 text-base">
            <option value="">Any</option>
            {[1, 2, 3, 4, 5].map((r) => <option key={r} value={r}>{r}★</option>)}
          </select>
        </label>
        <button className="rounded-md bg-accent px-4 py-2 font-medium text-accent-ink">Apply</button>
        {(filters.q || filters.source || filters.rating) && (
          <Link href="/evidence" className="px-2 py-2 text-sm text-muted underline underline-offset-2">Clear</Link>
        )}
      </form>

      <p className="text-sm text-muted" aria-live="polite">
        {fmtInt(total ?? rows.length)} matching item{total === 1 ? "" : "s"}
        {pages > 1 && page <= pages && ` · page ${page} of ${fmtInt(pages)}`}
      </p>

      {blocked ? (
        <Card>
          <p className="text-muted">
            That search couldn&rsquo;t be run: it looks like code rather than words, so the database&rsquo;s
            firewall refused it. Try plain words such as <em>refund</em> or <em>expiry</em>.
          </p>
        </Card>
      ) : rows.length === 0 && total && page > pages ? (
        <Card>
          <p className="text-muted">
            There are only {fmtInt(pages)} pages of results.{" "}
            <Link className="text-accent underline underline-offset-2" href={href(pages)}>Go to the last page</Link>
          </p>
        </Card>
      ) : rows.length === 0 ? (
        <Card><p className="text-muted">Nothing matches. Try a broader search.</p></Card>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={`${r.source}:${r.source_id}`} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <SourceBadge source={r.source} />
                {r.subreddit && <span className="text-sm text-muted">r/{r.subreddit}</span>}
                <Stars rating={r.rating} />
                <span className="text-sm text-muted">{fmtDate(r.posted_at)}</span>
                {r.lang_hint === "hi" && <span className="text-sm text-muted">Hindi feed</span>}
                {r.url && (
                  <a href={r.url} target="_blank" rel="noopener noreferrer"
                     className="ml-auto text-sm text-accent underline underline-offset-2">
                    Original ↗
                  </a>
                )}
              </div>
              {r.source === "reddit_comment" && r.post_title && (
                <p className="mt-2 text-sm text-muted">In thread: “{r.post_title}”</p>
              )}
              {r.title && <p className="mt-2 font-medium">{r.title}</p>}
              {r.text && <p className="mt-1 whitespace-pre-line leading-relaxed">{r.text}</p>}
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between">
          {page > 1 ? <Link className="text-accent underline underline-offset-2" href={href(page - 1)}>← Newer</Link> : <span />}
          {page < pages ? <Link className="text-accent underline underline-offset-2" href={href(page + 1)}>Older →</Link> : <span />}
        </nav>
      )}
    </>
  );
}
