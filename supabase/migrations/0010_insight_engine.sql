-- 0010: phase C, the insight engine.
--   * tagging quota for discussion sources
--   * 24-hour model usage (for the pipeline's daily caps)
--   * full-text search (replaces the slow regex search; used by the agent)
--   * read-only agent tools callable with the public key
--   * chat guard (rate limits), answer cache and usage log

-- ---------- C0: discussion-source quota in the tagging queue ----------
-- Up to `discussion_share` of each batch comes from discussion sources (Reddit now; YouTube and forums
-- later), the rest from app-store reviews. Within each group: outdated tags first, then random order.
drop function if exists public.ai_queue_tagging(int, text);
create or replace function public.ai_queue_tagging(n int, version text, discussion_share real default 0.4,
                                                   discussion_sources text[] default array['reddit_post','reddit_comment'])
returns table (source text, source_id text, title text, text text, lang text, post_title text)
language sql stable as $$
  with pending as (
    select s.source, s.source_id, s.lang, s.rand_key, (t.source is null) as untagged,
           (s.source = any(discussion_sources)) as discussion
    from public.item_screen s
    left join public.item_tags t on t.source = s.source and t.source_id = s.source_id
    where s.relevance = 'relevant' and s.attempts < 3 and (t.source is null or t.prompt_version <> version)
  ), disc as (
    select * from pending where discussion order by untagged, rand_key limit ceil(n * discussion_share)
  ), rest as (
    select * from pending where not discussion order by untagged, rand_key limit n
  ), picked as (
    select * from disc
    union all
    (select * from rest limit greatest(n - (select count(*) from disc), 0))
  )
  select p.source, p.source_id, r.title, r.text, p.lang, r.meta->>'post_title'
  from picked p join public.raw_items r using (source, source_id)
$$;
revoke all on function public.ai_queue_tagging(int, text, real, text[]) from public, anon, authenticated;
grant execute on function public.ai_queue_tagging(int, text, real, text[]) to service_role;

-- ---------- C0b: last-24-hour token use per model ----------
create or replace function public.ai_usage_24h()
returns table (model text, tokens bigint, calls bigint)
language sql stable security definer set search_path = public as $$
  select model, coalesce(sum(tokens_in + tokens_out), 0)::bigint, count(*)::bigint
  from public.ai_calls where at > now() - interval '24 hours' group by model
$$;
grant execute on function public.ai_usage_24h() to service_role, anon;

-- ---------- C1: full-text search ----------
-- English text, or the verified translation for Hindi/Hinglish entries, is indexed via item_tags;
-- raw text is indexed for everything (simple config also matches romanised Hindi words).
alter table public.raw_items add column if not exists fts tsvector
  generated always as (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(text, ''))) stored;
create index if not exists raw_items_fts_idx on public.raw_items using gin (fts);

-- ---------- C2: agent tools (read-only, public key) ----------
-- search_feedback: full-text search over all collected entries with optional filters on AI tags.
create or replace function public.search_feedback(q text default null, p_source text default null,
    p_barrier text default null, p_category text default null, p_theme int default null,
    p_rating int default null, p_tagged_only boolean default false, k int default 8)
returns table (source text, source_id text, text text, title text, rating smallint, posted_at timestamptz,
               url text, sentiment text, barriers text[], categories text[], evidence_span text,
               translation text, theme_id int, rank real)
language sql stable security definer set search_path = public as $$
  select r.source, r.source_id, left(r.text, 500), r.title, r.rating, r.posted_at, r.url,
         t.sentiment, t.barriers, t.categories,
         case when t.evidence_grounded then t.evidence_span end,
         case when t.translation_ok then t.translation end,
         ti.theme_id,
         case when q is null or q = '' then 0 else ts_rank(r.fts, websearch_to_tsquery('english', q)) end
  from public.raw_items r
  left join public.item_tags t on t.source = r.source and t.source_id = r.source_id
  left join public.theme_items ti on ti.source = r.source and ti.source_id = r.source_id
    and ti.snapshot_id = (select id from public.theme_snapshots where published order by id desc limit 1)
  where (q is null or q = '' or r.fts @@ websearch_to_tsquery('english', q))
    and (p_source is null or r.source = p_source or (p_source = 'reddit' and r.source like 'reddit%'))
    and (p_barrier is null or t.barriers @> array[p_barrier])
    and (p_category is null or t.categories @> array[p_category])
    and (p_theme is null or ti.theme_id = p_theme)
    and (p_rating is null or r.rating = p_rating)
    and (not p_tagged_only or t.source is not null)
  order by 14 desc, (t.evidence_grounded is true) desc, r.posted_at desc
  limit least(greatest(k, 1), 12)
$$;

-- count_feedback: counts and shares of AI-tagged entries grouped by one field, with filters.
-- All arithmetic happens here; the agent only reports it.
create or replace function public.count_feedback(group_by text, p_source text default null,
    p_barrier text default null, p_category text default null, p_theme int default null,
    p_sentiment text default null, q text default null)
returns table (value text, entries bigint, share real, base bigint)
language plpgsql stable security definer set search_path = public as $$
declare col text;
begin
  col := case group_by
    when 'barrier' then 'unnest(t.barriers)'
    when 'category' then 'unnest(t.categories)'
    when 'info_need' then 'unnest(t.info_needs)'
    when 'discovery_channel' then 'unnest(t.discovery_channels)'
    when 'segment' then 'unnest(t.segment_signals)'
    when 'sentiment' then 't.sentiment'
    when 'funnel_stage' then 't.funnel_stage'
    when 'category_behavior' then 't.category_behavior'
    when 'habit' then 'case when t.habit_signal then ''habit'' else ''no habit stated'' end'
    when 'source' then 'case when r.source like ''reddit%'' then ''reddit'' else r.source end'
    when 'month' then 'to_char(r.posted_at, ''YYYY-MM'')'
    when 'rating' then 'r.rating::text'
    when 'theme' then 'ti.theme_id::text'
    else null end;
  if col is null then
    raise exception 'unsupported group_by %', group_by;
  end if;
  return query execute format($f$
    with base as (
      select t.*, r.source as r_source, r.rating, r.posted_at, ti.theme_id
      from public.item_tags t
      join public.raw_items r on r.source = t.source and r.source_id = t.source_id
      left join public.theme_items ti on ti.source = t.source and ti.source_id = t.source_id
        and ti.snapshot_id = (select id from public.theme_snapshots where published order by id desc limit 1)
      where ($1 is null or r.source = $1 or ($1 = 'reddit' and r.source like 'reddit%%'))
        and ($2 is null or t.barriers @> array[$2])
        and ($3 is null or t.categories @> array[$3])
        and ($4 is null or ti.theme_id = $4)
        and ($5 is null or t.sentiment = $5)
        and ($6 is null or $6 = '' or r.fts @@ websearch_to_tsquery('english', $6))
    ), n as (select count(*) as base from base)
    select v::text, count(*)::bigint, round(count(*)::numeric / nullif((select base from n), 0), 4)::real,
           (select base from n)
    from (select %s as v from base t join public.raw_items r on r.source = t.source and r.source_id = t.source_id
          left join public.theme_items ti on ti.source = t.source and ti.source_id = t.source_id
            and ti.snapshot_id = (select id from public.theme_snapshots where published order by id desc limit 1)) x
    where v is not null
    group by v order by 2 desc limit 25 $f$, col)
  using p_source, p_barrier, p_category, p_theme, p_sentiment, q;
end $$;

grant execute on function public.search_feedback(text, text, text, text, int, int, boolean, int) to anon;
grant execute on function public.count_feedback(text, text, text, text, int, text, text) to anon;

-- ---------- C3: chat guard, cache and log ----------
create table if not exists public.chat_requests (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  visitor     text not null              -- salted hash of the visitor's IP, never the IP itself
);
create index if not exists chat_requests_at_idx on public.chat_requests (at desc);

create table if not exists public.chat_cache (
  question_key text primary key,         -- normalised single-turn question
  answer       jsonb not null,
  created_at   timestamptz not null default now()
);

create table if not exists public.chat_log (
  id                 bigint generated always as identity primary key,
  at                 timestamptz not null default now(),
  model              text not null,
  tool_calls         int not null,
  tokens             int not null,
  citations_valid    boolean,
  numbers_verified   boolean,
  faithfulness       real,
  cached             boolean not null default false
);

alter table public.chat_requests enable row level security;
alter table public.chat_cache    enable row level security;
alter table public.chat_log      enable row level security;
grant select, insert, update, delete on public.chat_requests, public.chat_cache, public.chat_log to service_role;

-- Allows a question if the visitor has asked < per_visitor in the last hour and the site < per_day today.
create or replace function public.chat_guard(p_visitor text, per_visitor int default 8, per_day int default 60)
returns table (allowed boolean, reason text, used_today bigint, limit_today int)
language plpgsql security definer set search_path = public as $$
declare v_hour bigint; v_day bigint;
begin
  select count(*) into v_hour from public.chat_requests where visitor = p_visitor and at > now() - interval '1 hour';
  select count(*) into v_day from public.chat_requests where at > now() - interval '24 hours';
  if v_hour >= per_visitor then
    return query select false, 'visitor_limit', v_day, per_day; return;
  end if;
  if v_day >= per_day then
    return query select false, 'daily_limit', v_day, per_day; return;
  end if;
  insert into public.chat_requests (visitor) values (left(p_visitor, 64));
  return query select true, null::text, v_day + 1, per_day;
end $$;

create or replace function public.chat_cache_get(p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select answer from public.chat_cache where question_key = p_key and created_at > now() - interval '24 hours'
$$;

create or replace function public.chat_cache_put(p_key text, p_answer jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.chat_cache (question_key, answer) values (left(p_key, 300), p_answer)
  on conflict (question_key) do update set answer = excluded.answer, created_at = now()
$$;

-- Logs one answer: per-call token use goes to ai_calls (so the pipeline's daily caps see it) and the
-- answer's check results to chat_log (shown on the Validation page). No question or answer text is stored.
create or replace function public.chat_record(p_model text, p_tool_calls int, p_tokens_in int, p_tokens_out int,
    p_citations_valid boolean, p_numbers_verified boolean, p_faithfulness real, p_cached boolean,
    p_judge_model text default null, p_judge_tokens int default 0)
returns void language sql security definer set search_path = public as $$
  insert into public.ai_calls (stage, model, items, tokens_in, tokens_out, ok)
    select 'chat', p_model, 1, greatest(p_tokens_in, 0), greatest(p_tokens_out, 0), true where not p_cached;
  insert into public.ai_calls (stage, model, items, tokens_in, tokens_out, ok)
    select 'chat_judge', p_judge_model, 1, greatest(p_judge_tokens, 0), 0, true where p_judge_model is not null and not p_cached;
  insert into public.chat_log (model, tool_calls, tokens, citations_valid, numbers_verified, faithfulness, cached)
    values (p_model, p_tool_calls, greatest(p_tokens_in + p_tokens_out, 0), p_citations_valid, p_numbers_verified,
            p_faithfulness, p_cached);
$$;

create or replace view public.v_chat_quality
with (security_invoker = false) as
select count(*) filter (where not cached)                                       as answers,
       avg(case when citations_valid then 1.0 else 0 end) filter (where not cached)  as citations_valid_rate,
       avg(case when numbers_verified then 1.0 else 0 end) filter (where not cached) as numbers_verified_rate,
       avg(faithfulness) filter (where not cached and faithfulness is not null)     as mean_faithfulness,
       count(*) filter (where cached)                                            as cached_answers
from public.chat_log;

grant execute on function public.chat_guard(text, int, int), public.chat_cache_get(text),
  public.chat_cache_put(text, jsonb),
  public.chat_record(text, int, int, int, boolean, boolean, real, boolean, text, int) to anon;
grant select on public.v_chat_quality to anon, service_role;
