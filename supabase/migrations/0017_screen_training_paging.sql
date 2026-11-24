-- 0017: the training sample for the learned screen is read in pages. The database API returns at
-- most 1,000 rows per call, so the first run trained on 1,000 decisions instead of the intended 4,000.
drop function if exists public.ai_screen_training(int);
create or replace function public.ai_screen_training(n int, skip int default 0)
returns table (pool text, relevant boolean, title text, text text, post_title text)
language sql stable as $$
  select s.pool, s.relevance = 'relevant', r.title, r.text, r.meta->>'post_title'
  from public.item_screen s join public.raw_items r using (source, source_id)
  where s.relevance is not null and s.pool in ('candidate', 'control', 'promoted')
  order by s.rand_key, s.source, s.source_id limit n offset skip
$$;
revoke all on function public.ai_screen_training(int, int) from public, anon, authenticated;
grant execute on function public.ai_screen_training(int, int) to service_role;
