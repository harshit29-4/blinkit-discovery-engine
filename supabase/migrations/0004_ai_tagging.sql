-- 0004: AI phase A — screening, relevance gate, tagging + translation, call log.
-- Stage tables are keyed like raw_items; deleting a raw item removes its AI rows.

-- S1 pre-filter + S2 relevance gate, one row per raw item.
create table if not exists public.item_screen (
  source           text not null,
  source_id        text not null,
  screened_at      timestamptz not null default now(),
  lang             text not null,                 -- en | hi | hinglish
  keyword_hits     text[] not null default '{}',  -- which keyword groups matched
  pool             text not null check (pool in ('candidate', 'control', 'excluded')),
  relevance        text check (relevance in ('relevant', 'not_relevant')),
  relevance_reason text,
  relevance_model  text,
  relevance_at     timestamptz,
  attempts         smallint not null default 0,
  last_error       text,
  primary key (source, source_id),
  foreign key (source, source_id) references public.raw_items (source, source_id) on delete cascade
);
create index if not exists item_screen_queue_idx on public.item_screen (pool, relevance);

-- S3 tagging (+ translation and its check), one row per relevant item.
create table if not exists public.item_tags (
  source              text not null,
  source_id           text not null,
  model               text not null,
  prompt_version      text not null,
  tagged_at           timestamptz not null default now(),
  sentiment           text,
  categories          text[] not null default '{}',
  category_behavior   text,
  barriers            text[] not null default '{}',
  funnel_stage        text,
  discovery_channels  text[] not null default '{}',
  habit_signal        boolean,
  info_needs          text[] not null default '{}',
  segment_signals     text[] not null default '{}',
  unmet_need          text,
  evidence_span       text,
  evidence_grounded   boolean not null default false,  -- V3: verbatim substring of the source text
  translation         text,                            -- English, for Hindi/Hinglish items
  translation_score   real,                            -- V8: second-model meaning check, 0–1
  translation_ok      boolean,
  confidence          real,
  raw                 jsonb not null default '{}'::jsonb,
  primary key (source, source_id),
  foreign key (source, source_id) references public.raw_items (source, source_id) on delete cascade
);
create index if not exists item_tags_barriers_idx on public.item_tags using gin (barriers);
create index if not exists item_tags_categories_idx on public.item_tags using gin (categories);

-- Every model call, for the budget/health view (no prompt or response text stored).
create table if not exists public.ai_calls (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  stage       text not null,
  model       text not null,
  items       int not null default 0,
  tokens_in   int not null default 0,
  tokens_out  int not null default 0,
  ok          boolean not null,
  error       text
);
create index if not exists ai_calls_at_idx on public.ai_calls (at desc);

alter table public.item_screen enable row level security;
alter table public.item_tags   enable row level security;
alter table public.ai_calls    enable row level security;
grant select, insert, update, delete on public.item_screen, public.item_tags, public.ai_calls to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ---------- work queues (called by the pipeline via PostgREST RPC) ----------
-- md5 ordering spreads work across months/sources, so a partial run is still representative.

create or replace function public.ai_queue_screen(n int)
returns setof public.raw_items language sql stable as $$
  select r.* from public.raw_items r
  where not exists (select 1 from public.item_screen s where s.source = r.source and s.source_id = r.source_id)
  order by r.posted_at desc limit n
$$;

create or replace function public.ai_queue_relevance(n int)
returns table (source text, source_id text, title text, text text, lang text, pool text, post_title text)
language sql stable as $$
  select s.source, s.source_id, r.title, r.text, s.lang, s.pool, r.meta->>'post_title'
  from public.item_screen s join public.raw_items r using (source, source_id)
  where s.pool in ('candidate', 'control') and s.relevance is null and s.attempts < 3
  order by (s.pool = 'control'), md5(s.source || s.source_id) limit n
$$;

create or replace function public.ai_queue_tagging(n int)
returns table (source text, source_id text, title text, text text, lang text, post_title text)
language sql stable as $$
  select s.source, s.source_id, r.title, r.text, s.lang, r.meta->>'post_title'
  from public.item_screen s join public.raw_items r using (source, source_id)
  where s.relevance = 'relevant' and s.attempts < 3
    and not exists (select 1 from public.item_tags t where t.source = s.source and t.source_id = s.source_id)
  order by md5(s.source || s.source_id) limit n
$$;

create or replace function public.ai_queue_translation_check(n int)
returns table (source text, source_id text, text text, translation text)
language sql stable as $$
  select t.source, t.source_id, r.text, t.translation
  from public.item_tags t join public.raw_items r using (source, source_id)
  where t.translation is not null and t.translation_score is null
  limit n
$$;

-- Bump attempts for items whose call failed, so a poison item can't block the queue forever.
create or replace function public.ai_mark_failed(keys jsonb, err text)
returns void language sql as $$
  update public.item_screen s set attempts = s.attempts + 1, last_error = left(err, 300)
  from jsonb_to_recordset(keys) as k(source text, source_id text)
  where s.source = k.source and s.source_id = k.source_id
$$;

revoke all on function public.ai_queue_screen(int), public.ai_queue_relevance(int), public.ai_queue_tagging(int),
  public.ai_queue_translation_check(int), public.ai_mark_failed(jsonb, text) from public, anon, authenticated;
grant execute on function public.ai_queue_screen(int), public.ai_queue_relevance(int), public.ai_queue_tagging(int),
  public.ai_queue_translation_check(int), public.ai_mark_failed(jsonb, text) to service_role;

-- ---------- public views (anon) ----------

-- Evidence now carries AI tags (null until an item is tagged). Columns are appended at the end,
-- as CREATE OR REPLACE VIEW requires.
create or replace view public.v_evidence
with (security_invoker = false) as
select r.source, r.source_id, r.title, r.text, r.rating, r.url, r.posted_at, r.lang_hint,
       r.meta->>'subreddit' as subreddit, r.meta->>'post_title' as post_title,
       t.sentiment, t.categories, t.category_behavior, t.barriers, t.funnel_stage, t.discovery_channels,
       t.info_needs, t.unmet_need,
       case when t.evidence_grounded then t.evidence_span end as evidence_span,
       case when t.translation_ok then t.translation end as translation,
       (t.source is not null) as ai_tagged
from public.raw_items r
left join public.item_tags t using (source, source_id);

-- One-row funnel for the How-it-works page.
create or replace view public.v_ai_funnel
with (security_invoker = false) as
select
  (select count(*) from public.raw_items)                                              as collected,
  (select count(*) from public.item_screen)                                            as screened,
  (select count(*) from public.item_screen where pool = 'candidate')                   as candidates,
  (select count(*) from public.item_screen where pool = 'control')                     as control_sample,
  (select count(*) from public.item_screen where pool = 'excluded')                    as excluded,
  (select count(*) from public.item_screen where pool = 'candidate' and relevance is not null) as candidates_checked,
  (select count(*) from public.item_screen where pool = 'candidate' and relevance = 'relevant') as candidates_relevant,
  (select count(*) from public.item_screen where pool = 'control' and relevance is not null)   as control_checked,
  (select count(*) from public.item_screen where pool = 'control' and relevance = 'relevant')  as control_relevant,
  (select count(*) from public.item_tags)                                              as tagged,
  (select count(*) from public.item_tags where evidence_grounded)                      as grounded,
  (select count(*) from public.item_tags where translation is not null)                as translated,
  (select count(*) from public.item_tags where translation_score is not null)          as translation_checked,
  (select count(*) from public.item_tags where translation_ok)                         as translation_passed,
  (select count(*) from public.item_screen where lang <> 'en')                         as non_english;

-- Model usage per day and stage (counts only).
create or replace view public.v_ai_usage
with (security_invoker = false) as
select (at at time zone 'Asia/Kolkata')::date as day, stage, model,
       count(*) as calls, sum(items) as items, sum(tokens_in) as tokens_in, sum(tokens_out) as tokens_out,
       count(*) filter (where not ok) as failed_calls
from public.ai_calls group by 1, 2, 3;

grant select on public.v_evidence, public.v_ai_funnel, public.v_ai_usage to anon;
