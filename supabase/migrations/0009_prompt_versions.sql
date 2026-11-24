-- 0009: keep every AI output on the current prompt version, so validation compares like with like.
-- The first cross-model agreement scores (κ ≈ 0.2 for funnel stage and behaviour) compared tags made
-- with prompt tag-v2 against cross-checks made with differently worded instructions; part of the
-- disagreement was the instructions, not the models.

-- Tagging: entries with no tag, or a tag from an older prompt version (those first, so the current
-- sample is brought up to date before new entries are added).
drop function if exists public.ai_queue_tagging(int);
create or replace function public.ai_queue_tagging(n int, version text)
returns table (source text, source_id text, title text, text text, lang text, post_title text)
language sql stable as $$
  select s.source, s.source_id, r.title, r.text, s.lang, r.meta->>'post_title'
  from public.item_screen s
  join public.raw_items r using (source, source_id)
  left join public.item_tags t on t.source = s.source and t.source_id = s.source_id
  where s.relevance = 'relevant' and s.attempts < 3
    and (t.source is null or t.prompt_version <> version)
  order by (t.source is null), s.rand_key limit n
$$;

-- Cross-check: the 10% sample, restricted to tags on the current version, re-checked when the
-- cross-check itself is from an older version.
drop function if exists public.ai_queue_crosscheck(int);
create or replace function public.ai_queue_crosscheck(n int, tag_version text, cross_version text)
returns table (source text, source_id text, title text, text text, post_title text)
language sql stable as $$
  select t.source, t.source_id, r.title, r.text, r.meta->>'post_title'
  from public.item_tags t
  join public.raw_items r using (source, source_id)
  left join public.item_crosscheck c on c.source = t.source and c.source_id = t.source_id
  where t.prompt_version = tag_version
    and ('x' || substr(md5(t.source || ':' || t.source_id), 1, 8))::bit(32)::bigint % 10 = 0
    and (c.source is null or c.prompt_version <> cross_version)
  limit n
$$;

-- Stability rows record the prompt version they were produced with.
alter table public.item_stability add column if not exists prompt_version text;

revoke all on function public.ai_queue_tagging(int, text), public.ai_queue_crosscheck(int, text, text)
  from public, anon, authenticated;
grant execute on function public.ai_queue_tagging(int, text), public.ai_queue_crosscheck(int, text, text)
  to service_role;
