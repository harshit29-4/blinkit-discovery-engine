-- 0008: work queues as index lookups.
-- With ~109k reviews the queue functions took 1.3–4.6 s idle and exceeded the 8 s API limit under
-- load (HTTP 500s on 2026-11-24 03:03, during a collection run), so the hourly AI run did no work.

-- Small key/value store for pipeline bookmarks (e.g. how far the pre-filter has read).
create table if not exists public.ai_state (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.ai_state enable row level security;
grant select, insert, update, delete on public.ai_state to service_role;

-- Pre-filter reads new rows in insertion order, from a bookmark (first_seen_at, source, source_id).
-- Upserts give a whole batch the same first_seen_at, so the bookmark includes the key to stay exact.
create index if not exists raw_items_first_seen_idx on public.raw_items (first_seen_at, source, source_id);

drop function if exists public.ai_queue_screen(int);
create or replace function public.ai_queue_screen(after_ts timestamptz, after_source text, after_id text, n int)
returns setof public.raw_items language sql stable as $$
  select r.* from public.raw_items r
  where (r.first_seen_at, r.source, r.source_id) > (after_ts, after_source, after_id)
  order by r.first_seen_at, r.source, r.source_id limit n
$$;

-- Stable pseudo-random order, stored once: queues walk an index instead of sorting the backlog.
alter table public.item_screen
  add column if not exists rand_key int
  generated always as ((('x' || substr(md5(source || ':' || source_id), 1, 7))::bit(28))::int) stored;
create index if not exists item_screen_relevance_queue_idx on public.item_screen (rand_key)
  where relevance is null and pool <> 'excluded';
create index if not exists item_screen_tagging_queue_idx on public.item_screen (rand_key)
  where relevance = 'relevant';

-- Candidates and the control sample are now interleaved (random order across both), so the
-- keyword-coverage check (V6) fills in alongside the main work instead of only at the end.
create or replace function public.ai_queue_relevance(n int)
returns table (source text, source_id text, title text, text text, lang text, pool text, post_title text)
language sql stable as $$
  select s.source, s.source_id, r.title, r.text, s.lang, s.pool, r.meta->>'post_title'
  from public.item_screen s join public.raw_items r using (source, source_id)
  where s.relevance is null and s.pool <> 'excluded' and s.attempts < 3
  order by s.rand_key limit n
$$;

create or replace function public.ai_queue_tagging(n int)
returns table (source text, source_id text, title text, text text, lang text, post_title text)
language sql stable as $$
  select s.source, s.source_id, r.title, r.text, s.lang, r.meta->>'post_title'
  from public.item_screen s join public.raw_items r using (source, source_id)
  where s.relevance = 'relevant' and s.attempts < 3
    and not exists (select 1 from public.item_tags t where t.source = s.source and t.source_id = s.source_id)
  order by s.rand_key limit n
$$;

revoke all on function public.ai_queue_screen(timestamptz, text, text, int) from public, anon, authenticated;
grant execute on function public.ai_queue_screen(timestamptz, text, text, int) to service_role;
