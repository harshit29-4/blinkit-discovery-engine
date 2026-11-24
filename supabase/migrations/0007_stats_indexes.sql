-- 0007: covering indexes for the dashboard summaries.
-- With ~109k reviews and ~368k rating-only rows, v_source_counts took 3.4 s (it read every full review
-- row, text included), over the 3-second limit for public queries, and failed the Vercel build.
-- These indexes let the summaries read slim index entries instead: 3.4 s → 72 ms, 1.2 s → 270 ms,
-- 0.7 s → 77 ms (measured 2026-11-24).
create index if not exists raw_items_stats_idx on public.raw_items (source, posted_at, fetched_at, rating);
create index if not exists short_reviews_stats_idx on public.short_reviews (source, rating);
