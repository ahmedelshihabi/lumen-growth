-- Google Ads (read-only) connector.
-- Ids: Google rows reuse the existing text id columns with a 'gads_' prefix
-- (ad_accounts.meta_account_id = 'gads_<customer id>', campaigns.meta_campaign_id and
-- insights_daily.campaign_id = 'gads_<campaign id>'), so unique keys and RLS stay as
-- they are. `platform` says which network a row came from.
-- Safe to run more than once.

alter table public.ad_accounts
  add column if not exists platform text not null default 'meta';
alter table public.campaigns
  add column if not exists platform text not null default 'meta';
alter table public.insights_daily
  add column if not exists platform text not null default 'meta';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ad_accounts_platform_check') then
    alter table public.ad_accounts add constraint ad_accounts_platform_check check (platform in ('meta', 'google', 'tiktok'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'campaigns_platform_check') then
    alter table public.campaigns add constraint campaigns_platform_check check (platform in ('meta', 'google', 'tiktok'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'insights_daily_platform_check') then
    alter table public.insights_daily add constraint insights_daily_platform_check check (platform in ('meta', 'google', 'tiktok'));
  end if;
end $$;

-- Refresh tokens: service role only (no client policies), like meta_connections.
create table if not exists public.google_connections (
  workspace_id      uuid primary key references public.workspaces (id) on delete cascade,
  google_email      text,
  refresh_token     text not null,
  login_customer_id text,
  scopes            text[] not null default '{}',
  connected_by      uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.google_connections enable row level security;
revoke all on public.google_connections from anon, authenticated;

-- Safe, token-free status for the UI.
create or replace function public.get_google_connection(ws uuid)
returns table (connected boolean, google_email text, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select true, c.google_email, c.updated_at
    from public.google_connections c
   where c.workspace_id = ws
     and (public.is_workspace_member(ws) or public.is_platform_admin());
$$;
revoke execute on function public.get_google_connection(uuid) from public, anon;
grant execute on function public.get_google_connection(uuid) to authenticated;
