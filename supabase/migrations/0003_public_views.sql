-- 0003: read-only views for the public website (publishable key = anon role).
-- Review text is public on the source sites already; these views expose it with a link
-- to the original, but never the (hashed) author or internal metadata.

create or replace view public.v_evidence
with (security_invoker = false) as
select source,
       source_id,
       title,
       text,
       rating,
       url,
       posted_at,
       lang_hint,
       meta->>'subreddit'   as subreddit,
       meta->>'post_title'  as post_title
from public.raw_items;

-- Daily item counts per source, for volume charts (aggregates only).
create or replace view public.v_daily_volume
with (security_invoker = false) as
select source, (posted_at at time zone 'Asia/Kolkata')::date as day, count(*) as items
from public.raw_items
group by 1, 2;

-- Rating mix per source including the rating-only short reviews.
create or replace view public.v_rating_mix
with (security_invoker = false) as
select source, rating, sum(n)::bigint as reviews, sum(n) filter (where kind = 'short')::bigint as short_reviews
from (
  select source, rating, count(*) as n, 'long' as kind from public.raw_items where rating is not null group by 1, 2
  union all
  select source, rating, count(*) as n, 'short' as kind from public.short_reviews where rating is not null group by 1, 2
) t
group by 1, 2;

-- Collection cursors (how far each source / subreddit has got), for the Health page.
create or replace view public.v_cursors
with (security_invoker = false) as
select source as key, newest_seen, updated_at from public.source_cursors;

grant select on public.v_evidence, public.v_daily_volume, public.v_rating_mix, public.v_cursors to anon;

-- Fast keyword search for the evidence browser.
create extension if not exists pg_trgm;
create index if not exists raw_items_text_trgm_idx on public.raw_items using gin (text gin_trgm_ops);
