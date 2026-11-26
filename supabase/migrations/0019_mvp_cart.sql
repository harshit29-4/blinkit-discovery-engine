-- MVP redesign (Blinkit-style app): the shared basket becomes a shared cart with quantities, saved whole,
-- and the usage log gains cart and order events. Still server-only (service role).

drop function if exists public.mvp_basket_add(text, jsonb);

-- items is now the cart: [{"id": item id, "qty": 1-20, "by": demo persona name or null}]
create or replace function public.mvp_basket_set(p_code text, p_items jsonb)
returns jsonb
language sql
security definer
set search_path = public
as $$
  insert into public.mvp_baskets (code, items) values (p_code, p_items)
  on conflict (code) do update set items = excluded.items, updated_at = now()
  returning items;
$$;
revoke all on function public.mvp_basket_set(text, jsonb) from public, anon, authenticated;
grant execute on function public.mvp_basket_set(text, jsonb) to service_role;

alter table public.mvp_events drop constraint if exists mvp_events_kind_check;
alter table public.mvp_events add constraint mvp_events_kind_check
  check (kind in ('view', 'card_check', 'search', 'scan', 'share', 'reply', 'basket_add', 'cart_add', 'order'));
