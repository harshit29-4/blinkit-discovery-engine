-- 0002: rating-only rows for Play Store reviews under 40 characters (decision 2026-11-23).
-- ~80% of ~2,000 daily English reviews are one-liners ("good", "nice"). Their text isn't
-- analysed, but their star ratings keep rating statistics complete. The review ID is stored
-- as a 63-bit hash (bigint) instead of the 36-char UUID to keep the table small.

create table if not exists public.short_reviews (
  source      text     not null,
  id_hash     bigint   not null,
  posted_day  date     not null,
  rating      smallint check (rating between 1 and 5),
  lang_hint   text,
  primary key (source, id_hash)
);

create index if not exists short_reviews_day_idx on public.short_reviews (source, posted_day);

alter table public.short_reviews enable row level security;

-- Daily counts by rating for the Overview page: aggregates only, safe to expose.
create or replace view public.v_short_review_daily
with (security_invoker = false) as
select source, posted_day, rating, count(*) as reviews
from public.short_reviews
group by source, posted_day, rating;

grant select on public.v_short_review_daily to anon;
grant select, insert, update, delete on public.short_reviews to service_role;
