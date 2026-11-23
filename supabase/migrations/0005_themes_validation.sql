-- 0005: AI phase B — embeddings, theme discovery snapshots, cross-model checks, validation metrics.

create extension if not exists vector with schema extensions;

-- S4: one embedding per tagged entry (gte-small, 384 dimensions, English text).
create table if not exists public.item_embeddings (
  source      text not null,
  source_id   text not null,
  model       text not null,
  embedded_at timestamptz not null default now(),
  embedding   extensions.vector(384) not null,
  primary key (source, source_id),
  foreign key (source, source_id) references public.raw_items (source, source_id) on delete cascade
);
create index if not exists item_embeddings_hnsw on public.item_embeddings
  using hnsw (embedding extensions.vector_cosine_ops);

-- S5: each theme run is a versioned snapshot; the site shows the latest published one.
create table if not exists public.theme_snapshots (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  items       int not null,
  noise       int not null,
  params      jsonb not null default '{}'::jsonb,
  model       text not null,
  published   boolean not null default false
);

create table if not exists public.themes (
  snapshot_id    bigint not null references public.theme_snapshots (id) on delete cascade,
  theme_id       int not null,
  name           text not null,
  description    text not null,
  kind           text not null,          -- exploration_barrier | habit | discovery | information_need | general_friction | positive_experience
  questions      int[] not null default '{}', -- research questions (1–8) the theme informs
  size           int not null,
  share          real not null,          -- of clustered entries
  avg_rating     real,
  pct_negative   real,
  top_barriers   jsonb not null default '[]'::jsonb,
  top_categories jsonb not null default '[]'::jsonb,
  sources        jsonb not null default '{}'::jsonb,
  monthly        jsonb not null default '{}'::jsonb,
  rep_keys       jsonb not null default '[]'::jsonb,  -- representative entries [[source, source_id], ...]
  primary key (snapshot_id, theme_id)
);

create table if not exists public.theme_items (
  snapshot_id bigint not null,
  theme_id    int not null,
  source      text not null,
  source_id   text not null,
  similarity  real,
  primary key (snapshot_id, source, source_id),
  foreign key (snapshot_id, theme_id) references public.themes (snapshot_id, theme_id) on delete cascade
);
create index if not exists theme_items_theme_idx on public.theme_items (snapshot_id, theme_id);

-- V1: independent re-tag of a 10% sample by a different model family.
create table if not exists public.item_crosscheck (
  source            text not null,
  source_id         text not null,
  model             text not null,
  prompt_version    text not null,
  tagged_at         timestamptz not null default now(),
  sentiment         text,
  categories        text[] not null default '{}',
  category_behavior text,
  barriers          text[] not null default '{}',
  funnel_stage      text,
  primary key (source, source_id),
  foreign key (source, source_id) references public.raw_items (source, source_id) on delete cascade
);

-- V7: weekly re-tag of a fixed panel by the production tagger.
create table if not exists public.item_stability (
  source            text not null,
  source_id         text not null,
  run_week          date not null,
  sentiment         text,
  categories        text[] not null default '{}',
  barriers          text[] not null default '{}',
  funnel_stage      text,
  primary key (source, source_id, run_week),
  foreign key (source, source_id) references public.raw_items (source, source_id) on delete cascade
);

-- All validation results, appended each time they are computed (history kept).
create table if not exists public.validation_metrics (
  id          bigint generated always as identity primary key,
  computed_at timestamptz not null default now(),
  metric      text not null,      -- e.g. v1_agreement_barriers, v2_sentiment_vs_stars
  value       real,
  n           int,
  details     jsonb not null default '{}'::jsonb
);
create index if not exists validation_metrics_metric_idx on public.validation_metrics (metric, computed_at desc);

alter table public.item_embeddings   enable row level security;
alter table public.theme_snapshots   enable row level security;
alter table public.themes            enable row level security;
alter table public.theme_items       enable row level security;
alter table public.item_crosscheck   enable row level security;
alter table public.item_stability    enable row level security;
alter table public.validation_metrics enable row level security;
grant select, insert, update, delete on public.item_embeddings, public.theme_snapshots, public.themes,
  public.theme_items, public.item_crosscheck, public.item_stability, public.validation_metrics to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ---------- queues ----------

create or replace function public.ai_queue_embedding(n int)
returns table (source text, source_id text, title text, text text, translation text, translation_ok boolean)
language sql stable as $$
  select t.source, t.source_id, r.title, r.text, t.translation, t.translation_ok
  from public.item_tags t join public.raw_items r using (source, source_id)
  where not exists (select 1 from public.item_embeddings e where e.source = t.source and e.source_id = t.source_id)
  order by t.tagged_at limit n
$$;

-- 10% deterministic sample of tagged entries not yet cross-checked.
create or replace function public.ai_queue_crosscheck(n int)
returns table (source text, source_id text, title text, text text, post_title text)
language sql stable as $$
  select t.source, t.source_id, r.title, r.text, r.meta->>'post_title'
  from public.item_tags t join public.raw_items r using (source, source_id)
  where ('x' || substr(md5(t.source || ':' || t.source_id), 1, 8))::bit(32)::bigint % 10 = 0
    and not exists (select 1 from public.item_crosscheck c where c.source = t.source and c.source_id = t.source_id)
  limit n
$$;

-- Fixed stability panel: the first 100 tagged entries by hash; re-tagged once per ISO week.
create or replace function public.ai_queue_stability(n int, week date)
returns table (source text, source_id text, title text, text text, post_title text)
language sql stable as $$
  with panel as (
    select t.source, t.source_id from public.item_tags t
    order by md5('panel:' || t.source || ':' || t.source_id) limit 100
  )
  select p.source, p.source_id, r.title, r.text, r.meta->>'post_title'
  from panel p join public.raw_items r using (source, source_id)
  where not exists (select 1 from public.item_stability s
                    where s.source = p.source and s.source_id = p.source_id and s.run_week = week)
  limit n
$$;

-- Page through embeddings of tagged entries for clustering.
create or replace function public.ai_embeddings_page(after_key text, n int)
returns table (k text, source text, source_id text, embedding text)
language sql stable as $$
  select e.source || ':' || e.source_id as k, e.source, e.source_id, e.embedding::text
  from public.item_embeddings e
  where e.source || ':' || e.source_id > coalesce(after_key, '')
  order by 1 limit n
$$;

revoke all on function public.ai_queue_embedding(int), public.ai_queue_crosscheck(int),
  public.ai_queue_stability(int, date), public.ai_embeddings_page(text, int) from public, anon, authenticated;
grant execute on function public.ai_queue_embedding(int), public.ai_queue_crosscheck(int),
  public.ai_queue_stability(int, date), public.ai_embeddings_page(text, int) to service_role;

-- ---------- public views ----------

create or replace view public.v_theme_snapshot
with (security_invoker = false) as
select id, created_at, items, noise, model from public.theme_snapshots
where published order by id desc limit 1;

create or replace view public.v_themes
with (security_invoker = false) as
select t.* from public.themes t
where t.snapshot_id = (select id from public.theme_snapshots where published order by id desc limit 1);

-- Representative quotes for each current theme: only verified (grounded) quotes are exposed.
create or replace view public.v_theme_quotes
with (security_invoker = false) as
select th.theme_id, k.ord, r.source, r.source_id, r.url, r.rating, r.posted_at,
       tg.evidence_span as quote, (case when tg.translation_ok then tg.translation end) as translation
from public.v_themes th
cross join lateral jsonb_array_elements(th.rep_keys) with ordinality as k(key, ord)
join public.raw_items r on r.source = k.key->>0 and r.source_id = k.key->>1
join public.item_tags tg on tg.source = r.source and tg.source_id = r.source_id
where tg.evidence_grounded;

create or replace view public.v_validation
with (security_invoker = false) as
select distinct on (metric) metric, value, n, details, computed_at
from public.validation_metrics order by metric, computed_at desc;

-- Evidence gains the current theme of each entry (appended column).
create or replace view public.v_evidence
with (security_invoker = false) as
select r.source, r.source_id, r.title, r.text, r.rating, r.url, r.posted_at, r.lang_hint,
       r.meta->>'subreddit' as subreddit, r.meta->>'post_title' as post_title,
       t.sentiment, t.categories, t.category_behavior, t.barriers, t.funnel_stage, t.discovery_channels,
       t.info_needs, t.unmet_need,
       case when t.evidence_grounded then t.evidence_span end as evidence_span,
       case when t.translation_ok then t.translation end as translation,
       (t.source is not null) as ai_tagged,
       ti.theme_id
from public.raw_items r
left join public.item_tags t using (source, source_id)
left join public.theme_items ti on ti.source = r.source and ti.source_id = r.source_id
  and ti.snapshot_id = (select id from public.theme_snapshots where published order by id desc limit 1);

grant select on public.v_theme_snapshot, public.v_themes, public.v_theme_quotes, public.v_validation, public.v_evidence to anon;
