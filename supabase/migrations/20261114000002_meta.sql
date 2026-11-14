-- Lumen Growth: Meta connections, ad accounts, cached insights, budgets, plan limits.

-- ---------------------------------------------------- meta_connections ----
-- Holds the long-lived Meta user access token. NEVER readable by the client:
-- RLS is enabled with no policies AND all privileges are revoked from
-- anon/authenticated. Only Edge Functions (service role) read it.

create table public.meta_connections (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null unique references public.workspaces (id) on delete cascade,
  meta_user_id   text not null,
  meta_user_name text,
  access_token   text not null,
  expires_at     timestamptz,
  scopes         text[] not null default '{}',
  connected_by   uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.meta_connections enable row level security;
revoke all on public.meta_connections from anon, authenticated;

-- Safe, token-free status for the UI.
create or replace function public.get_meta_connection(ws uuid)
returns table (connected boolean, meta_user_name text, expires_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select true, c.meta_user_name, c.expires_at, c.updated_at
    from public.meta_connections c
   where c.workspace_id = ws
     and (public.is_workspace_member(ws) or public.is_platform_admin());
$$;
revoke execute on function public.get_meta_connection(uuid) from public, anon;
grant execute on function public.get_meta_connection(uuid) to authenticated;

-- --------------------------------------------------------- ad_accounts ----

create table public.ad_accounts (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  meta_account_id  text not null,           -- 'act_123...'
  name             text not null,
  currency         text not null default 'USD',
  timezone         text not null default 'UTC',
  account_status   integer,
  selected         boolean not null default false,
  selected_at      timestamptz,
  last_synced_at   timestamptz,
  last_sync_error  text,
  created_at       timestamptz not null default now(),
  unique (workspace_id, meta_account_id)
);
create index ad_accounts_ws_idx on public.ad_accounts (workspace_id) where selected;

-- Enforce plan.max_ad_accounts in the database, not just the UI.
create or replace function public.enforce_ad_account_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  lim integer;
  used integer;
begin
  if new.selected and (tg_op = 'INSERT' or not old.selected) then
    if not public.workspace_is_active(new.workspace_id) then
      raise exception 'subscription_inactive' using errcode = 'P0001';
    end if;
    select p.max_ad_accounts into lim
      from public.subscriptions s join public.plans p on p.id = s.plan_id
     where s.workspace_id = new.workspace_id;
    select count(*) into used
      from public.ad_accounts a
     where a.workspace_id = new.workspace_id and a.selected and a.id <> new.id;
    if used >= coalesce(lim, 0) then
      raise exception 'plan_limit_ad_accounts' using errcode = 'P0001', detail = format('limit=%s', coalesce(lim, 0));
    end if;
    new.selected_at := now();
  elsif not new.selected then
    new.selected_at := null;
  end if;
  return new;
end;
$$;

create trigger ad_accounts_limit
  before insert or update of selected on public.ad_accounts
  for each row execute function public.enforce_ad_account_limit();

-- ------------------------------------------------- campaigns / ads cache ----

create table public.campaigns (
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  meta_campaign_id text not null,
  ad_account_id    uuid not null references public.ad_accounts (id) on delete cascade,
  name             text not null,
  objective        text,
  status           text,
  daily_budget     numeric(14, 2),          -- account currency, major units
  start_date       date,
  updated_at       timestamptz not null default now(),
  primary key (workspace_id, meta_campaign_id)
);

create table public.ads (
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  meta_ad_id       text not null,
  meta_campaign_id text not null,
  ad_account_id    uuid not null references public.ad_accounts (id) on delete cascade,
  name             text not null,
  format           text,                    -- video | image | carousel
  headline         text,
  updated_at       timestamptz not null default now(),
  primary key (workspace_id, meta_ad_id)
);

-- ------------------------------------------------------ insights_daily ----

create table public.insights_daily (
  id              bigint generated always as identity primary key,
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  ad_account_id   uuid not null references public.ad_accounts (id) on delete cascade,
  level           text not null check (level in ('campaign', 'ad')),
  date            date not null,
  campaign_id     text not null,
  ad_id           text not null default '',  -- '' for campaign-level rows (keeps the unique key simple)
  spend           numeric(14, 2) not null default 0,
  impressions     bigint not null default 0,
  reach           bigint not null default 0,
  clicks          bigint not null default 0,
  conversions     numeric(14, 2) not null default 0,
  revenue         numeric(14, 2) not null default 0,
  video_views_3s  bigint not null default 0,
  frequency       numeric(8, 3) not null default 0,
  currency        text,
  fetched_at      timestamptz not null default now(),
  unique (workspace_id, level, campaign_id, ad_id, date)
);
create index insights_daily_ws_date_idx on public.insights_daily (workspace_id, level, date);

-- ---------------------------------------------------- campaign_budgets ----
-- Meta has no monthly budget concept; the team enters it in Settings and the
-- pacing page reads it.

create table public.campaign_budgets (
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  campaign_id    text not null,
  monthly_budget numeric(14, 2) not null check (monthly_budget >= 0),
  updated_by     uuid references auth.users (id) on delete set null,
  updated_at     timestamptz not null default now(),
  primary key (workspace_id, campaign_id)
);

-- ------------------------------------------------------------------ RLS ----

alter table public.ad_accounts enable row level security;
alter table public.campaigns enable row level security;
alter table public.ads enable row level security;
alter table public.insights_daily enable row level security;
alter table public.campaign_budgets enable row level security;

create policy ad_accounts_read on public.ad_accounts for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_platform_admin());
-- Members may only toggle `selected` (column grant below), and only while active.
create policy ad_accounts_select_toggle on public.ad_accounts for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id) and public.workspace_is_active(workspace_id));

create policy campaigns_read on public.campaigns for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_platform_admin());
create policy ads_read on public.ads for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_platform_admin());
create policy insights_read on public.insights_daily for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_platform_admin());

create policy budgets_read on public.campaign_budgets for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_platform_admin());
create policy budgets_insert on public.campaign_budgets for insert to authenticated
  with check (public.is_workspace_member(workspace_id) and public.workspace_is_active(workspace_id));
create policy budgets_update on public.campaign_budgets for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id) and public.workspace_is_active(workspace_id));
create policy budgets_delete on public.campaign_budgets for delete to authenticated
  using (public.is_workspace_member(workspace_id) and public.workspace_is_active(workspace_id));

revoke all on public.ad_accounts, public.campaigns, public.ads, public.insights_daily, public.campaign_budgets from anon;
revoke insert, update, delete on public.ad_accounts from authenticated;
grant update (selected) on public.ad_accounts to authenticated;
revoke insert, update, delete on public.campaigns, public.ads, public.insights_daily from authenticated;

-- ---------------------------------------------------------- member limit ----

create or replace function public.enforce_member_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  lim integer;
  used integer;
begin
  select p.max_members into lim
    from public.subscriptions s join public.plans p on p.id = s.plan_id
   where s.workspace_id = new.workspace_id;
  select count(*) into used from public.workspace_members m where m.workspace_id = new.workspace_id;
  -- The very first member (the owner, created at signup) is always allowed.
  if used > 0 and used >= coalesce(lim, 1) then
    raise exception 'plan_limit_members' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger workspace_members_limit
  before insert on public.workspace_members
  for each row execute function public.enforce_member_limit();

-- ------------------------------------------------------ downgrade to Free ----
-- Lets a workspace owner keep using the product on the Free plan after a trial
-- or paid period ends. Extra ad accounts beyond the Free limit are deselected
-- (most recently selected first).

create or replace function public.downgrade_to_free(ws uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  lim integer;
begin
  if not public.is_workspace_owner(ws) then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  select max_ad_accounts into lim from public.plans where id = 'free';

  update public.subscriptions
     set plan_id = 'free', status = 'active', current_period_end = null, trial_ends_at = null, updated_at = now()
   where workspace_id = ws;

  update public.ad_accounts a set selected = false
   where a.workspace_id = ws and a.selected
     and a.id not in (
       select b.id from public.ad_accounts b
        where b.workspace_id = ws and b.selected
        order by b.selected_at asc nulls last
        limit lim
     );
end;
$$;
revoke execute on function public.downgrade_to_free(uuid) from public, anon;
grant execute on function public.downgrade_to_free(uuid) to authenticated;
