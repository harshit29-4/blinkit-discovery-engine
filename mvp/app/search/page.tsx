import type { Metadata } from "next";
import { Suspense } from "react";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { ITEM_BY_ID } from "@/lib/catalog.ts";
import { llmJson } from "@/lib/llm.ts";
import { SEARCH_SYSTEM, checkSearch, keywordSearch, searchInput, tidyWhy, type Hit } from "@/lib/search.ts";
import { NEEDS, precomputedNeed } from "@/lib/needs.ts";
import { ProductCard } from "@/components/product-card";
import { SearchBar } from "@/components/shell";
import { IconSpark } from "@/components/icons";
import { Track } from "@/components/track";

export const metadata: Metadata = { title: "Search" };


/** Live model search, cached per query for a day. Throws on failure, so a failure is never cached. */
async function aiFind(q: string): Promise<{ hits: Hit[]; note: string | null }> {
  "use cache";
  cacheLife("days");
  const r = await llmJson(SEARCH_SYSTEM, searchInput(q), { maxTokens: 1200, geminiTimeoutMs: 6_000, groqTimeoutMs: 12_000 });
  const checked = checkSearch(r.data, q);
  if (checked.problems.length) console.warn("search dropped results", q, checked.problems);
  if (!checked.hits.length && !checked.note) throw new Error("no usable results");
  return checked;
}

/** Example needs are pre-generated (instant); typed needs get one live attempt, else keyword matches. */
async function findFor(q: string): Promise<{ hits: Hit[]; note: string | null; ai: boolean }> {
  const pre = precomputedNeed(q);
  if (pre) return { ...pre, ai: true };
  try {
    return { ...(await aiFind(q)), ai: true };
  } catch (e) {
    console.warn("search fell back to keywords", (e as Error).message);
    return { hits: keywordSearch(q), note: null, ai: false };
  }
}

async function Results({ params }: { params: PageProps<"/search">["searchParams"] }) {
  const sp = await params;
  const q = (typeof sp.q === "string" ? sp.q : "").trim().slice(0, 200);
  if (!q) {
    return (
      <div className="p-3">
        <h2 className="font-extrabold">Try saying what it&rsquo;s for</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {NEEDS.map((t) => (
            <Link key={t} href={`/search?q=${encodeURIComponent(t)}`} className="rounded-full border border-border bg-surface px-3 py-1.5 text-sm font-bold">{t}</Link>
          ))}
        </div>
      </div>
    );
  }
  const { hits, note, ai } = await findFor(q);
  return (
    <div className="p-3">
      <Track kind="search" detail={{ q, results: String(hits.length), ai }} />
      <h1 className="sr-only">Results for {q}</h1>
      {ai ? (
        <p className="flex items-center gap-1.5 font-extrabold"><IconSpark className="h-5 w-5 text-accent" /> Picks for your need</p>
      ) : (
        <p className="text-sm text-muted">The need-matcher is busy right now, so these are keyword matches. Try again in a minute.</p>
      )}
      {note && <p className="mt-1">{note}</p>}
      {hits.length ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {hits.map((h) => {
            const item = ITEM_BY_ID.get(h.id)!;
            return <ProductCard key={h.id} item={item} note={ai ? tidyWhy(h.why, item) ?? undefined : undefined} answer="always" wide />;
          })}
        </div>
      ) : !note && <p className="mt-2">Nothing in this demo catalogue fits that yet.</p>}
    </div>
  );
}

async function Bar({ params }: { params: PageProps<"/search">["searchParams"] }) {
  const sp = await params;
  return <SearchBar defaultValue={typeof sp.q === "string" ? sp.q : ""} autoFocus={!sp.q} />;
}

export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-border bg-surface p-3">
        <Suspense fallback={<SearchBar />}><Bar params={searchParams} /></Suspense>
      </header>
      <Suspense fallback={<p className="p-3 text-muted" aria-live="polite">Finding products for your need…</p>}>
        <Results params={searchParams} />
      </Suspense>
    </>
  );
}
