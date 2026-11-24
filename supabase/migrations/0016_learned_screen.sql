-- 0016: the learned screen.
-- The keyword pre-filter reaches only ~28% of relevant feedback (V6, measured on the control sample).
-- A classifier on gte-small embeddings, trained on the AI relevance gate's own decisions, scores the
-- entries the keywords skipped; high scorers move to the new pool 'promoted', which the relevance
-- queue already reads (it takes every pool except 'excluded'). The control sample is never scored or
-- moved, so recall stays measurable.

alter table public.item_screen add column if not exists screen_score real;
alter table public.item_screen add column if not exists screen_model text;

alter table public.item_screen drop constraint if exists item_screen_pool_check;
alter table public.item_screen add constraint item_screen_pool_check
  check (pool in ('candidate', 'control', 'excluded', 'promoted'));

-- Unscored skipped entries, in the stored random order.
create index if not exists item_screen_rescreen_idx on public.item_screen (rand_key)
  where pool = 'excluded' and screen_score is null;

create or replace function public.ai_queue_rescreen(n int)
returns table (source text, source_id text, title text, text text, post_title text)
language sql stable as $$
  select s.source, s.source_id, r.title, r.text, r.meta->>'post_title'
  from public.item_screen s join public.raw_items r using (source, source_id)
  where s.pool = 'excluded' and s.screen_score is null
  order by s.rand_key limit n
$$;

-- Training data: entries the relevance gate has judged, a random sample.
create or replace function public.ai_screen_training(n int)
returns table (pool text, relevant boolean, title text, text text, post_title text)
language sql stable as $$
  select s.pool, s.relevance = 'relevant', r.title, r.text, r.meta->>'post_title'
  from public.item_screen s join public.raw_items r using (source, source_id)
  where s.relevance is not null and s.pool in ('candidate', 'control', 'promoted')
  order by s.rand_key limit n
$$;

-- Writes scores; only 'excluded' rows are touched (never the control sample).
create or replace function public.ai_set_screen_scores(rows jsonb)
returns int language sql as $$
  with x as (
    select * from jsonb_to_recordset(rows) as x(source text, source_id text, score real, model text, promote boolean)
  ), u as (
    update public.item_screen s
    set screen_score = x.score, screen_model = x.model,
        pool = case when x.promote then 'promoted' else s.pool end
    from x
    where s.source = x.source and s.source_id = x.source_id and s.pool = 'excluded'
    returning 1
  )
  select count(*)::int from u
$$;

revoke all on function public.ai_queue_rescreen(int), public.ai_screen_training(int), public.ai_set_screen_scores(jsonb)
  from public, anon, authenticated;
grant execute on function public.ai_queue_rescreen(int), public.ai_screen_training(int), public.ai_set_screen_scores(jsonb)
  to service_role;

-- Funnel: promoted entries and scoring progress (new columns appended at the end).
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
         count(*) filter (where lang <> 'en')                                  as non_english,
         count(*) filter (where pool = 'promoted')                             as promoted,
         count(*) filter (where pool = 'promoted' and relevance is not null)   as promoted_checked,
         count(*) filter (where pool = 'promoted' and relevance = 'relevant')  as promoted_relevant,
         count(*) filter (where screen_score is not null)                      as scored
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
       t.translation_passed, s.non_english, s.promoted, s.promoted_checked, s.promoted_relevant, s.scored
from s, t;
