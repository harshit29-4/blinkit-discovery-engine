-- 0011: fast full-text search, and the discussion quota for the relevance gate.
--
-- search_feedback ranked every match (30,789 for "delivery") and took 3.3 s, above the 3 s limit for
-- the public key. It now ranks only the 400 most recent matches (read through the posted_at index),
-- with AI-tagged entries first. The statistics are refreshed so the planner sees the new fts column.
--
-- The relevance gate drew entries in random order from ~18,000 candidates, of which ~430 are Reddit,
-- so Reddit entries almost never reached tagging. Up to 40% of each batch now comes from discussion
-- sources, as for tagging (0010).

analyze public.raw_items;

drop function if exists public.ai_queue_relevance(int);
create or replace function public.ai_queue_relevance(n int, discussion_share real default 0.4,
                                                     discussion_sources text[] default array['reddit_post','reddit_comment'])
returns table (source text, source_id text, title text, text text, lang text, pool text, post_title text)
language sql stable as $$
  with disc as (
    select s.source, s.source_id, s.lang, s.pool from public.item_screen s
    where s.relevance is null and s.pool <> 'excluded' and s.attempts < 3 and s.source = any(discussion_sources)
    order by s.rand_key limit ceil(n * discussion_share)
  ), rest as (
    select s.source, s.source_id, s.lang, s.pool from public.item_screen s
    where s.relevance is null and s.pool <> 'excluded' and s.attempts < 3 and not (s.source = any(discussion_sources))
    order by s.rand_key limit n
  ), picked as (
    select * from disc
    union all
    (select * from rest limit greatest(n - (select count(*) from disc), 0))
  )
  select p.source, p.source_id, r.title, r.text, p.lang, p.pool, r.meta->>'post_title'
  from picked p join public.raw_items r using (source, source_id)
$$;
revoke all on function public.ai_queue_relevance(int, real, text[]) from public, anon, authenticated;
grant execute on function public.ai_queue_relevance(int, real, text[]) to service_role;

create or replace function public.search_feedback(q text default null, p_source text default null,
    p_barrier text default null, p_category text default null, p_theme int default null,
    p_rating int default null, p_tagged_only boolean default false, k int default 8)
returns table (source text, source_id text, text text, title text, rating smallint, posted_at timestamptz,
               url text, sentiment text, barriers text[], categories text[], evidence_span text,
               translation text, theme_id int, rank real)
language sql stable security definer set search_path = public as $$
  with snap as (
    select id from public.theme_snapshots where published order by id desc limit 1
  ), cand as (
    select r.source, r.source_id, r.text, r.title, r.rating, r.posted_at, r.url,
           t.sentiment, t.barriers, t.categories, t.evidence_grounded, t.evidence_span,
           t.translation_ok, t.translation, (t.source is not null) as tagged, ti.theme_id,
           case when coalesce(q, '') = '' then 0 else ts_rank(r.fts, websearch_to_tsquery('english', q)) end as rank
    from public.raw_items r
    left join public.item_tags t on t.source = r.source and t.source_id = r.source_id
    left join public.theme_items ti on ti.source = r.source and ti.source_id = r.source_id
      and ti.snapshot_id = (select id from snap)
    where (coalesce(q, '') = '' or r.fts @@ websearch_to_tsquery('english', q))
      and (p_source is null or r.source = p_source or (p_source = 'reddit' and r.source like 'reddit%'))
      and (p_barrier is null or t.barriers @> array[p_barrier])
      and (p_category is null or t.categories @> array[p_category])
      and (p_theme is null or ti.theme_id = p_theme)
      and (p_rating is null or r.rating = p_rating)
      and (not p_tagged_only or t.source is not null)
    order by r.posted_at desc
    limit 400
  )
  select source, source_id, left(text, 500), title, rating, posted_at, url, sentiment, barriers, categories,
         case when evidence_grounded then evidence_span end, case when translation_ok then translation end,
         theme_id, rank::real
  from cand
  order by tagged desc, rank desc, (evidence_grounded is true) desc, posted_at desc
  limit least(greatest(k, 1), 12)
$$;
grant execute on function public.search_feedback(text, text, text, text, int, int, boolean, int) to anon;

-- Second version (same migration, applied after the first measured 4 s): two paths, each planned with
-- the actual search words (EXECUTE), so the planner can pick the text index or the date index.
--   * any AI-tag filter: start from the tagged entries (a few hundred), rank all matches;
--   * otherwise: the 400 newest matches in raw_items, ranked, tagged ones first.
create or replace function public.search_feedback(q text default null, p_source text default null,
    p_barrier text default null, p_category text default null, p_theme int default null,
    p_rating int default null, p_tagged_only boolean default false, k int default 8)
returns table (source text, source_id text, text text, title text, rating smallint, posted_at timestamptz,
               url text, sentiment text, barriers text[], categories text[], evidence_span text,
               translation text, theme_id int, rank real)
language plpgsql stable security definer set search_path = public as $fn$
declare
  snap int := (select id from public.theme_snapshots where published order by id desc limit 1);
  tag_path boolean := p_tagged_only or p_barrier is not null or p_category is not null or p_theme is not null;
  has_q boolean := coalesce(q, '') <> '';
  lim int := least(greatest(coalesce(k, 8), 1), 12);
begin
  return query execute format($q$
    with cand as (
      select r.source, r.source_id, r.text, r.title, r.rating, r.posted_at, r.url, r.fts
      from %s
      where %s
        and ($2 is null or r.source = $2 or ($2 = 'reddit' and r.source like 'reddit%%'))
        and ($3 is null or t.barriers @> array[$3])
        and ($4 is null or t.categories @> array[$4])
        and ($5 is null or ti.theme_id = $5)
        and ($6 is null or r.rating = $6)
      order by r.posted_at desc
      limit 400
    )
    select c.source, c.source_id, left(c.text, 500), c.title, c.rating, c.posted_at, c.url,
           t.sentiment, t.barriers, t.categories,
           case when t.evidence_grounded then t.evidence_span end,
           case when t.translation_ok then t.translation end,
           ti.theme_id, %s::real
    from cand c
    left join public.item_tags t on t.source = c.source and t.source_id = c.source_id
    left join public.theme_items ti on ti.source = c.source and ti.source_id = c.source_id and ti.snapshot_id = $7
    order by (t.source is not null) desc, 14 desc, (t.evidence_grounded is true) desc, c.posted_at desc
    limit $8 $q$,
    case when tag_path then
      'public.item_tags t join public.raw_items r on r.source = t.source and r.source_id = t.source_id
       left join public.theme_items ti on ti.source = t.source and ti.source_id = t.source_id and ti.snapshot_id = $7'
    else
      'public.raw_items r cross join lateral (select null::text[] as barriers, null::text[] as categories) t
       cross join lateral (select null::int as theme_id) ti'
    end,
    case when has_q then $w$r.fts @@ websearch_to_tsquery('english', $1)$w$ else 'true' end,
    case when has_q then $w$ts_rank(c.fts, websearch_to_tsquery('english', $1))$w$ else '0' end)
  using q, p_source, p_barrier, p_category, p_theme, p_rating, snap, lim;
end $fn$;
