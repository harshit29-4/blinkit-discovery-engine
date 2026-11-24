-- 0012: the chat's guard, cache and log functions are called only by the site's server (/api/ask),
-- with the secret key. With the public key, anyone could otherwise fill the answer cache with
-- made-up answers or spend the daily question allowance. The agent's read-only tools stay public.
revoke execute on function public.chat_guard(text, int, int), public.chat_cache_get(text),
  public.chat_cache_put(text, jsonb),
  public.chat_record(text, int, int, int, boolean, boolean, real, boolean, text, int)
  from public, anon, authenticated;
grant execute on function public.chat_guard(text, int, int), public.chat_cache_get(text),
  public.chat_cache_put(text, jsonb),
  public.chat_record(text, int, int, int, boolean, boolean, real, boolean, text, int)
  to service_role;
revoke execute on function public.ai_usage_24h() from public, anon, authenticated;
grant execute on function public.ai_usage_24h() to service_role;
