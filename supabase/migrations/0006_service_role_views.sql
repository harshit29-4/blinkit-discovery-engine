-- 0006: the pipeline (service role) also reads the public views (e.g. v_ai_funnel for validation
-- metrics). Earlier migrations granted the views to anon only, so those reads failed with 403.
grant select on public.v_source_counts, public.v_short_review_daily, public.v_evidence, public.v_daily_volume,
  public.v_rating_mix, public.v_cursors, public.v_ai_funnel, public.v_ai_usage, public.v_theme_snapshot,
  public.v_themes, public.v_theme_quotes, public.v_validation to service_role;
