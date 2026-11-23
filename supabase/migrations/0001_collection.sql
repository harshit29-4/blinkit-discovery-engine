-- 0001: collection layer — raw items, per-source cursors, pipeline run log.
-- Later migrations add cleaning, enrichment, embeddings, themes, insights.

create table if not exists public.raw_items (
  source       text        not null,
  source_id    text        not null,
  text         text        not null,
  title        text,
  url          text,
  rating       smallint    check (rating between 1 and 5),
  author_hash  text,
  lang_hint    text,
  posted_at    timestamptz not null,
  fetched_at   timestamptz not null default now(),
  meta         jsonb       not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  primary key (source, source_id)
);

create index if not exists raw_items_posted_at_idx on public.raw_items (posted_at desc);
create index if not exists raw_items_source_posted_idx on public.raw_items (source, posted_at desc);

-- Where each collector left off (newest posted_at seen), for incremental runs.
create table if not exists public.source_cursors (
  source      text primary key,
  newest_seen timestamptz not null,
  updated_at  timestamptz not null default now()
);

-- One row per pipeline run, shown on the Health page.
create table if not exists public.pipeline_runs (
  id          bigint generated always as identity primary key,
  kind        text        not null,           -- collect | process | synthesize | validate
  trigger     text        not null default 'schedule', -- schedule | manual | button
  status      text        not null default 'running' check (status in ('running','ok','partial','failed')),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  stats       jsonb       not null default '{}'::jsonb,
  error       text
);

create index if not exists pipeline_runs_started_idx on public.pipeline_runs (started_at desc);

-- Row Level Security: the public site (anon key) may read run history and aggregate
-- counts, but never raw rows (they're exposed later only through curated views).
alter table public.raw_items      enable row level security;
alter table public.source_cursors enable row level security;
alter table public.pipeline_runs  enable row level security;

drop policy if exists "public read runs" on public.pipeline_runs;
create policy "public read runs" on public.pipeline_runs for select to anon using (true);

-- Aggregate view for the Overview/Health pages (no text, no authors).
create or replace view public.v_source_counts
with (security_invoker = false) as
select source,
       count(*)                as items,
       min(posted_at)          as oldest,
       max(posted_at)          as newest,
       max(fetched_at)         as last_fetched
from public.raw_items
group by source;

grant select on public.v_source_counts to anon;

-- Explicit grants: newer Supabase projects may not auto-expose new tables to the Data API.
-- The pipeline writes as service_role (bypasses RLS); the public site reads as anon.
grant select, insert, update, delete on public.raw_items, public.source_cursors, public.pipeline_runs to service_role;
grant usage, select on all sequences in schema public to service_role;
grant select on public.pipeline_runs to anon;
