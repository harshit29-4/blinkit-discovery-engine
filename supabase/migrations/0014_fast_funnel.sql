-- 0014: v_ai_funnel read item_screen six times and item_tags five times (7 s, over the 3 s limit for
-- the public key; it broke the site build). Same columns, one pass per table with FILTER.
create or replace view public.v_ai_funnel
with (security_invoker = false) as
with s as (
  select count(*)                                                              as screened,
         count(*) filter (where pool = 'candidate')                            as candidates,
         count(*) filter (where pool = 'control')                              as control_sample,
         count(*) filter (where pool = 'excluded')                             as excluded,
         count(*) filter (where pool = 'candidate' and relevance is not null)  as candidates_checked,
         count(*) filter (where pool = 'candidate' and relevance = 'relevant') as candidates_relevant,
         count(*) filter (where pool = 'control' and relevance is not null)    as control_checked,
         count(*) filter (where pool = 'control' and relevance = 'relevant')   as control_relevant,
         count(*) filter (where lang <> 'en')                                  as non_english
  from public.item_screen
), t as (
  select count(*)                                          as tagged,
         count(*) filter (where evidence_grounded)         as grounded,
         count(*) filter (where translation is not null)   as translated,
         count(*) filter (where translation_score is not null) as translation_checked,
         count(*) filter (where translation_ok)            as translation_passed
  from public.item_tags
)
select (select count(*) from public.raw_items) as collected,
       s.screened, s.candidates, s.control_sample, s.excluded, s.candidates_checked, s.candidates_relevant,
       s.control_checked, s.control_relevant, t.tagged, t.grounded, t.translated, t.translation_checked,
       t.translation_passed, s.non_english
from s, t;

-- Evidence filtered to AI-tagged entries: v_evidence's ai_tagged is computed from a left join, so the
-- planner walked the whole date index looking for the few tagged rows (a timeout for "refund" + tagged
-- only). This view starts from item_tags (an inner join); the site uses it whenever a tag filter is set.
create or replace view public.v_evidence_tagged
with (security_invoker = false) as
select r.source, r.source_id, r.title, r.text, r.rating, r.url, r.posted_at, r.lang_hint,
       r.meta->>'subreddit' as subreddit, r.meta->>'post_title' as post_title,
       t.sentiment, t.categories, t.category_behavior, t.barriers, t.funnel_stage, t.discovery_channels,
       t.info_needs, t.unmet_need,
       case when t.evidence_grounded then t.evidence_span end as evidence_span,
       case when t.translation_ok then t.translation end as translation,
       true as ai_tagged,
       ti.theme_id,
       r.fts
from public.item_tags t
join public.raw_items r on r.source = t.source and r.source_id = t.source_id
left join public.theme_items ti on ti.source = t.source and ti.source_id = t.source_id
  and ti.snapshot_id = (select id from public.theme_snapshots where published order by id desc limit 1);
grant select on public.v_evidence_tagged to anon, service_role;
