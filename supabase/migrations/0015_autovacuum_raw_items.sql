-- 0015: vacuum raw_items after small batches of inserts.
-- The stats views (v_source_counts, v_rating_mix, v_daily_volume) rely on index-only scans, which
-- need the table's visibility map to be current. Postgres's default runs the insert-triggered
-- autovacuum only after inserts of 20% of the table (~22,000 rows here); the first YouTube collection
-- inserted 23,000 rows, the views timed out and the site build failed. 2% (~2,200 rows) keeps the
-- visibility map current after every daily run.
alter table public.raw_items set (
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_vacuum_insert_threshold = 1000,
  autovacuum_analyze_scale_factor = 0.02
);
