-- 0013: the Evidence page searches the full-text index instead of a regular expression.
-- The regex scan took 1.4 s for common words; the indexed search matches word forms too
-- ("refund" finds refunds/refunded) and ignores word order. The tsvector column is appended to the
-- view (CREATE OR REPLACE VIEW only allows new columns at the end); the site never selects it.
create or replace view public.v_evidence
with (security_invoker = false) as
select r.source, r.source_id, r.title, r.text, r.rating, r.url, r.posted_at, r.lang_hint,
       r.meta->>'subreddit' as subreddit, r.meta->>'post_title' as post_title,
       t.sentiment, t.categories, t.category_behavior, t.barriers, t.funnel_stage, t.discovery_channels,
       t.info_needs, t.unmet_need,
       case when t.evidence_grounded then t.evidence_span end as evidence_span,
       case when t.translation_ok then t.translation end as translation,
       (t.source is not null) as ai_tagged,
       ti.theme_id,
       r.fts
from public.raw_items r
left join public.item_tags t using (source, source_id)
left join public.theme_items ti on ti.source = r.source and ti.source_id = r.source_id
  and ti.snapshot_id = (select id from public.theme_snapshots where published order by id desc limit 1);
