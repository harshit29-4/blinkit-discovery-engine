-- Part 4 MVP ("Will it suit me?", mvp/): a shared household basket and a usage log for the usability round.
-- Server-only: RLS on and no grants to anon/authenticated, so only the MVP's server (service role) reads or writes.

create table if not exists public.mvp_baskets (
  code        text primary key check (code ~ '^[a-z0-9]{8}$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  items       jsonb not null default '[]'::jsonb   -- [{"id": item id, "by": "Flat of three", "at": iso time}]
);

create table if not exists public.mvp_events (
  id       bigint generated always as identity primary key,
  at       timestamptz not null default now(),
  session  text not null check (length(session) between 8 and 40),
  shopper  text,                 -- demo persona id, never a real person
  kind     text not null check (kind in ('view', 'card_check', 'search', 'scan', 'share', 'reply', 'basket_add')),
  item     text,
  detail   jsonb not null default '{}'::jsonb
);
create index if not exists mvp_events_at_idx on public.mvp_events (at desc);

alter table public.mvp_baskets enable row level security;
alter table public.mvp_events  enable row level security;
revoke all on public.mvp_baskets, public.mvp_events from anon, authenticated;
grant select, insert, update on public.mvp_baskets to service_role;
grant select, insert on public.mvp_events to service_role;
grant usage on sequence public.mvp_events_id_seq to service_role;

-- Append one item atomically (no lost updates when two people add at once); caps a basket at 30 items.
create or replace function public.mvp_basket_add(p_code text, p_item jsonb)
returns jsonb
language sql
security definer
set search_path = public
as $$
  insert into public.mvp_baskets (code, items) values (p_code, jsonb_build_array(p_item))
  on conflict (code) do update
    set items = case when jsonb_array_length(mvp_baskets.items) >= 30 then mvp_baskets.items
                     else mvp_baskets.items || jsonb_build_array(p_item) end,
        updated_at = now()
  returning items;
$$;
revoke all on function public.mvp_basket_add(text, jsonb) from public, anon, authenticated;
grant execute on function public.mvp_basket_add(text, jsonb) to service_role;
