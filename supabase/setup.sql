-- Lumen Growth: full database setup. Paste all of this into Supabase > SQL Editor and click Run.

-- Lumen Growth: core multi-tenant schema (profiles, workspaces, plans, billing).
--
-- Security model
--   * Every table has RLS enabled. The browser uses the anon key + the user's JWT
--     ("authenticated" role) and can only SELECT rows of workspaces it belongs to.
--   * Billing state (subscriptions, payments) is written ONLY by Edge Functions
--     using the service-role key (which bypasses RLS). The client has no write
--     policy on them, so a user can never grant themselves a plan.
--   * Column-level grants stop users from flipping profiles.is_platform_admin.

-- ---------------------------------------------------------------- plans ----

create table public.plans (
  id              text primary key,                -- e.g. 'growth' (EGP), later 'growth_aed'
  tier            text not null check (tier in ('free', 'starter', 'growth', 'agency')),
  name_en         text not null,
  name_ar         text not null,
  currency        text not null default 'EGP' check (currency ~ '^[A-Z]{3}$'),
  price_minor     integer not null check (price_minor >= 0), -- piasters / fils (1 EGP = 100)
  interval_days   integer not null default 30 check (interval_days > 0),
  max_ad_accounts integer not null check (max_ad_accounts >= 0),
  max_members     integer not null check (max_members >= 1),
  features        text[] not null default '{}',
  is_public       boolean not null default true,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  unique (tier, currency)
);

comment on column public.plans.features is
  'Feature keys the UI gates on: overview, campaigns, pacing, alerts, creatives, recommendations, create_ads, priority_support';

insert into public.plans (id, tier, name_en, name_ar, currency, price_minor, max_ad_accounts, max_members, features, sort_order) values
  ('free',    'free',    'Free',    'مجاني',  'EGP', 0,      1,  1,  '{overview,campaigns}', 0),
  ('starter', 'starter', 'Starter', 'ستارتر', 'EGP', 99900,  2,  2,  '{overview,campaigns,pacing,alerts}', 1),
  ('growth',  'growth',  'Growth',  'جروث',   'EGP', 249900, 5,  5,  '{overview,campaigns,pacing,alerts,creatives,recommendations,create_ads}', 2),
  ('agency',  'agency',  'Agency',  'إيجنسي', 'EGP', 699900, 25, 15, '{overview,campaigns,pacing,alerts,creatives,recommendations,create_ads,priority_support}', 3);
-- To sell in the Gulf later, add rows such as:
--   ('growth_aed', 'growth', 'Growth', 'جروث', 'AED', 19900, 5, 5, '{...}', 2)

-- ------------------------------------------------------------- profiles ----

create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  email             text,
  full_name         text,
  locale            text not null default 'ar' check (locale in ('ar', 'en')),
  is_platform_admin boolean not null default false,
  created_at        timestamptz not null default now()
);

-- ----------------------------------------------------------- workspaces ----

create table public.workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 120),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         text not null default 'viewer' check (role in ('owner', 'admin', 'viewer')),
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);

-- -------------------------------------------------------- subscriptions ----

create table public.subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null unique references public.workspaces (id) on delete cascade,
  plan_id            text not null references public.plans (id),
  status             text not null check (status in ('trialing', 'active', 'past_due', 'canceled')),
  trial_ends_at      timestamptz,
  -- NULL means "does not expire" (used for the Free plan).
  current_period_end timestamptz,
  canceled_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ------------------------------------------------------------- payments ----

create table public.payments (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  plan_id           text not null references public.plans (id),
  provider          text not null check (provider in ('paymob', 'manual')),
  amount_minor      integer not null check (amount_minor >= 0),
  currency          text not null check (currency ~ '^[A-Z]{3}$'),
  status            text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'refunded')),
  -- Our own reference: Paymob special_reference, or 'manual:<idempotency key>'.
  merchant_ref      text not null unique,
  -- Paymob order id (intention_order_id) - used to match the webhook.
  provider_order_id text,
  -- Paymob transaction id, or the InstaPay / Vodafone Cash reference for manual payments.
  provider_ref      text,
  period_days       integer not null default 30,
  period_end        timestamptz,
  raw               jsonb not null default '{}'::jsonb,
  note              text,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  paid_at           timestamptz,
  unique (provider, provider_ref)
);
create index payments_workspace_idx on public.payments (workspace_id, created_at desc);
create index payments_provider_order_idx on public.payments (provider_order_id);

-- --------------------------------------------------------------- helpers ----
-- SECURITY DEFINER so RLS policies can call them without recursive RLS checks.

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_platform_admin from public.profiles p where p.id = auth.uid()), false);
$$;

create or replace function public.is_workspace_member(ws uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = auth.uid());
$$;

create or replace function public.is_workspace_owner(ws uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

-- A workspace may write (edit budgets, sync, pick accounts) only while its
-- subscription is trialing/active and not past its period end.
create or replace function public.workspace_is_active(ws uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.subscriptions s
    where s.workspace_id = ws
      and s.status in ('trialing', 'active')
      and (s.current_period_end is null or s.current_period_end > now())
  );
$$;

-- ------------------------------------------------------------------ RLS ----

alter table public.plans enable row level security;
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;

create policy plans_read on public.plans for select to anon, authenticated using (true);

create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_platform_admin());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy workspaces_read on public.workspaces for select to authenticated
  using (public.is_workspace_member(id) or public.is_platform_admin());
create policy workspaces_rename on public.workspaces for update to authenticated
  using (public.is_workspace_owner(id)) with check (public.is_workspace_owner(id));

create policy members_read on public.workspace_members for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_platform_admin());
create policy members_remove on public.workspace_members for delete to authenticated
  using (public.is_workspace_owner(workspace_id) and role <> 'owner');

create policy subscriptions_read on public.subscriptions for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_platform_admin());

create policy payments_read on public.payments for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_platform_admin());

-- Column-level privileges: even with an UPDATE policy, users may only touch
-- harmless columns. is_platform_admin is set from the SQL editor only.
revoke insert, update, delete on public.plans from anon, authenticated;
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (full_name, locale) on public.profiles to authenticated;
revoke insert, update, delete on public.workspaces from anon, authenticated;
grant update (name) on public.workspaces to authenticated;
revoke insert, update on public.workspace_members from anon, authenticated;
revoke insert, update, delete on public.subscriptions from anon, authenticated;
revoke insert, update, delete on public.payments from anon, authenticated;
revoke all on public.profiles, public.workspaces, public.workspace_members,
  public.subscriptions, public.payments from anon;

-- ------------------------------------------------------- signup trigger ----
-- Every new auth user gets a profile, their own workspace (as owner) and a
-- 14-day trial of the Growth plan.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  ws uuid;
  display_name text := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    split_part(coalesce(new.email, 'workspace'), '@', 1)
  );
begin
  insert into public.profiles (id, email, full_name) values (new.id, new.email, display_name);

  insert into public.workspaces (name, owner_id) values (left(display_name, 120), new.id) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, new.id, 'owner');

  insert into public.subscriptions (workspace_id, plan_id, status, trial_ends_at, current_period_end)
  values (ws, 'growth', 'trialing', now() + interval '14 days', now() + interval '14 days');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------- billing write paths ----
-- Called by the paymob-webhook and admin-activate Edge Functions (service role).
-- Idempotent: the payment row flips pending -> paid exactly once; a replayed
-- webhook finds it already paid and changes nothing. The period end is computed
-- in TypeScript (supabase/functions/_shared/period.ts, unit tested) and the
-- payment + subscription are updated in this single transaction.

create or replace function public.apply_paid_payment(
  p_payment_id uuid,
  p_provider_ref text,
  p_raw jsonb,
  p_period_end timestamptz
) returns text language plpgsql security definer set search_path = '' as $$
declare
  ws uuid;
  pl text;
begin
  update public.payments
     set status = 'paid', provider_ref = p_provider_ref, raw = coalesce(p_raw, raw),
         paid_at = now(), period_end = p_period_end
   where id = p_payment_id and status <> 'paid'
  returning workspace_id, plan_id into ws, pl;

  if not found then
    return 'duplicate';
  end if;

  insert into public.subscriptions (workspace_id, plan_id, status, current_period_end)
  values (ws, pl, 'active', p_period_end)
  on conflict (workspace_id) do update
     set plan_id = excluded.plan_id, status = 'active', current_period_end = excluded.current_period_end,
         canceled_at = null, updated_at = now();

  return 'applied';
end;
$$;

revoke execute on function public.apply_paid_payment(uuid, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_paid_payment(uuid, text, jsonb, timestamptz) to service_role;

-- Mark lapsed subscriptions as past_due. Safe to run any time; schedule it daily
-- with pg_cron (see SETUP_AR.md). The UI treats an expired period as locked even
-- before this runs.
create or replace function public.expire_lapsed_subscriptions()
returns integer language sql security definer set search_path = '' as $$
  with upd as (
    update public.subscriptions
       set status = 'past_due', updated_at = now()
     where status in ('trialing', 'active')
       and current_period_end is not null
       and current_period_end < now()
    returning 1
  )
  select count(*)::int from upd;
$$;
revoke execute on function public.expire_lapsed_subscriptions() from public, anon, authenticated;
grant execute on function public.expire_lapsed_subscriptions() to service_role;

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

-- ============================================================================
-- 20261118000001_targets_messaging.sql
-- ============================================================================
-- 1) Account goals (target CPA / ROAS) are stored per workspace instead of in the browser,
--    so every device and every team member sees the same goals.
-- 2) Conversations started from click-to-message ads (WhatsApp / Messenger / Instagram Direct),
--    so messaging campaigns are judged by cost per conversation instead of ROAS.
-- Safe to run more than once.

create table if not exists public.account_targets (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  ad_account_id text not null,  -- Meta "act_123"
  target_cpa    numeric(14, 2) not null check (target_cpa > 0),
  target_roas   numeric(8, 2)  not null check (target_roas > 0),
  updated_by    uuid references auth.users (id) on delete set null,
  updated_at    timestamptz not null default now(),
  primary key (workspace_id, ad_account_id)
);

alter table public.account_targets enable row level security;

drop policy if exists targets_read on public.account_targets;
create policy targets_read on public.account_targets for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_platform_admin());
drop policy if exists targets_insert on public.account_targets;
create policy targets_insert on public.account_targets for insert to authenticated
  with check (public.is_workspace_member(workspace_id) and public.workspace_is_active(workspace_id));
drop policy if exists targets_update on public.account_targets;
create policy targets_update on public.account_targets for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id) and public.workspace_is_active(workspace_id));
drop policy if exists targets_delete on public.account_targets;
create policy targets_delete on public.account_targets for delete to authenticated
  using (public.is_workspace_member(workspace_id) and public.workspace_is_active(workspace_id));

revoke all on public.account_targets from anon;

alter table public.insights_daily
  add column if not exists messaging_conversations bigint not null default 0;

-- ============================================================================
-- 20261119000002_security_hardening.sql
-- ============================================================================
-- P0 security hardening (defence in depth; RLS was already enabled everywhere).
-- Safe to run more than once.

-- 1) TRUNCATE bypasses RLS and TRIGGER/REFERENCES are never needed by the app. Supabase grants
--    them to anon/authenticated by default; take them away on every table, now and in future.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate, trigger, references on tables from anon, authenticated;

-- 2) Trigger functions are never called directly.
revoke execute on function public.enforce_ad_account_limit() from public, anon, authenticated;
revoke execute on function public.enforce_member_limit()    from public, anon, authenticated;
revoke execute on function public.handle_new_user()         from public, anon, authenticated;

-- 3) Policy helpers: logged-in users only (RLS policies for `authenticated` call them).
--    Anonymous visitors only ever read `plans`, whose policy does not use them.
revoke execute on function public.is_platform_admin()          from public, anon;
revoke execute on function public.is_workspace_member(uuid)    from public, anon;
revoke execute on function public.is_workspace_owner(uuid)     from public, anon;
revoke execute on function public.workspace_is_active(uuid)    from public, anon;
grant  execute on function public.is_platform_admin()          to authenticated;
grant  execute on function public.is_workspace_member(uuid)    to authenticated;
grant  execute on function public.is_workspace_owner(uuid)     to authenticated;
grant  execute on function public.workspace_is_active(uuid)    to authenticated;

-- 4) New functions are not executable by anon/public unless granted explicitly.
alter default privileges in schema public revoke execute on functions from public, anon;

-- ============================================================================
-- 20261119000003_workspace_settings.sql
-- ============================================================================
-- Workspace-level settings shared by the whole team (not the browser):
-- display currency, reporting timezone, attribution window, and the alert rules.
-- Safe to run more than once.
create table if not exists public.workspace_settings (
  workspace_id        uuid primary key references public.workspaces (id) on delete cascade,
  currency            text check (currency is null or currency ~ '^[A-Z]{3}$'),
  timezone            text check (timezone is null or length(timezone) between 3 and 64),
  attribution_window  text not null default 'default'
                        check (attribution_window in ('default', '1d_click', '7d_click', '7d_click_1d_view', '28d_click')),
  -- { disabled: [...rule ids], cpaSpikePct, cpaRecentDays, cpaBaselineDays, minConversions,
  --   roasDropPct, freqCapProspecting, freqCapRetargeting, minActiveDays, recMinConversions }
  alert_config        jsonb not null default '{}'::jsonb check (jsonb_typeof(alert_config) = 'object'),
  updated_by          uuid references auth.users (id) on delete set null,
  updated_at          timestamptz not null default now()
);

alter table public.workspace_settings enable row level security;

drop policy if exists ws_settings_read on public.workspace_settings;
create policy ws_settings_read on public.workspace_settings for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_platform_admin());
drop policy if exists ws_settings_insert on public.workspace_settings;
create policy ws_settings_insert on public.workspace_settings for insert to authenticated
  with check (public.is_workspace_member(workspace_id) and public.workspace_is_active(workspace_id));
drop policy if exists ws_settings_update on public.workspace_settings;
create policy ws_settings_update on public.workspace_settings for update to authenticated
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id) and public.workspace_is_active(workspace_id));

revoke all on public.workspace_settings from anon;
revoke truncate, trigger, references, delete on public.workspace_settings from authenticated;

-- ============================================================================
-- 20261119000004_dismissals.sql
-- ============================================================================
-- Dismissed / snoozed alerts and recommendations, shared by the team.
-- item_key is stable across days ("cpa_spike:<campaign>", "pause_campaign:<campaign>").
-- snoozed_until null = dismissed until the user restores it.
create table if not exists public.dismissals (
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  item_key      text not null check (length(item_key) between 3 and 200),
  snoozed_until timestamptz,
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (workspace_id, item_key)
);

alter table public.dismissals enable row level security;

drop policy if exists dismissals_read on public.dismissals;
create policy dismissals_read on public.dismissals for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_platform_admin());
drop policy if exists dismissals_insert on public.dismissals;
create policy dismissals_insert on public.dismissals for insert to authenticated
  with check (public.is_workspace_member(workspace_id));
drop policy if exists dismissals_update on public.dismissals;
create policy dismissals_update on public.dismissals for update to authenticated
  using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
drop policy if exists dismissals_delete on public.dismissals;
create policy dismissals_delete on public.dismissals for delete to authenticated
  using (public.is_workspace_member(workspace_id));

revoke all on public.dismissals from anon;
revoke truncate, trigger, references on public.dismissals from authenticated;

-- ============================================================================
-- 20261120000001_team_roles_invites.sql
-- ============================================================================
-- Team: roles owner / admin / viewer, invite links, and server-side enforcement.
--   owner  - everything, incl. billing, removing members and changing roles
--   admin  - edit goals/budgets/rules, hide alerts, create ads, apply recommendations, invite
--   viewer - read only
-- Safe to run more than once.

-- 1) Roles ('member' becomes 'admin', which is what it could do before).
alter table public.workspace_members drop constraint if exists workspace_members_role_check;
update public.workspace_members set role = 'admin' where role = 'member';
alter table public.workspace_members alter column role set default 'viewer';
alter table public.workspace_members add constraint workspace_members_role_check check (role in ('owner', 'admin', 'viewer'));

create or replace function public.is_workspace_editor(ws uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
     where m.workspace_id = ws and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  );
$$;
revoke execute on function public.is_workspace_editor(uuid) from public, anon;
grant execute on function public.is_workspace_editor(uuid) to authenticated;

-- 2) Writes need owner/admin (viewers keep read access through the *_read policies).
drop policy if exists ad_accounts_select_toggle on public.ad_accounts;
create policy ad_accounts_select_toggle on public.ad_accounts for update to authenticated
  using (public.is_workspace_editor(workspace_id))
  with check (public.is_workspace_editor(workspace_id) and public.workspace_is_active(workspace_id));

drop policy if exists budgets_insert on public.campaign_budgets;
create policy budgets_insert on public.campaign_budgets for insert to authenticated
  with check (public.is_workspace_editor(workspace_id) and public.workspace_is_active(workspace_id));
drop policy if exists budgets_update on public.campaign_budgets;
create policy budgets_update on public.campaign_budgets for update to authenticated
  using (public.is_workspace_editor(workspace_id))
  with check (public.is_workspace_editor(workspace_id) and public.workspace_is_active(workspace_id));
drop policy if exists budgets_delete on public.campaign_budgets;
create policy budgets_delete on public.campaign_budgets for delete to authenticated
  using (public.is_workspace_editor(workspace_id) and public.workspace_is_active(workspace_id));

drop policy if exists targets_insert on public.account_targets;
create policy targets_insert on public.account_targets for insert to authenticated
  with check (public.is_workspace_editor(workspace_id) and public.workspace_is_active(workspace_id));
drop policy if exists targets_update on public.account_targets;
create policy targets_update on public.account_targets for update to authenticated
  using (public.is_workspace_editor(workspace_id))
  with check (public.is_workspace_editor(workspace_id) and public.workspace_is_active(workspace_id));
drop policy if exists targets_delete on public.account_targets;
create policy targets_delete on public.account_targets for delete to authenticated
  using (public.is_workspace_editor(workspace_id) and public.workspace_is_active(workspace_id));

drop policy if exists ws_settings_insert on public.workspace_settings;
create policy ws_settings_insert on public.workspace_settings for insert to authenticated
  with check (public.is_workspace_editor(workspace_id) and public.workspace_is_active(workspace_id));
drop policy if exists ws_settings_update on public.workspace_settings;
create policy ws_settings_update on public.workspace_settings for update to authenticated
  using (public.is_workspace_editor(workspace_id))
  with check (public.is_workspace_editor(workspace_id) and public.workspace_is_active(workspace_id));

drop policy if exists dismissals_insert on public.dismissals;
create policy dismissals_insert on public.dismissals for insert to authenticated
  with check (public.is_workspace_editor(workspace_id));
drop policy if exists dismissals_update on public.dismissals;
create policy dismissals_update on public.dismissals for update to authenticated
  using (public.is_workspace_editor(workspace_id)) with check (public.is_workspace_editor(workspace_id));
drop policy if exists dismissals_delete on public.dismissals;
create policy dismissals_delete on public.dismissals for delete to authenticated
  using (public.is_workspace_editor(workspace_id));

-- 3) Invites: a link with a random token, for one email address, valid 7 days.
create table if not exists public.workspace_invites (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email        text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role         text not null check (role in ('admin', 'viewer')),
  token        text not null unique,
  invited_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '7 days',
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users (id) on delete set null
);
create index if not exists workspace_invites_ws_idx on public.workspace_invites (workspace_id);

alter table public.workspace_invites enable row level security;
-- Editors see their workspace's invites (token included, so they can re-copy the link).
-- All writes go through the functions below.
drop policy if exists invites_read on public.workspace_invites;
create policy invites_read on public.workspace_invites for select to authenticated
  using (public.is_workspace_editor(workspace_id) or public.is_platform_admin());
revoke all on public.workspace_invites from anon;
revoke insert, update, delete, truncate, trigger, references on public.workspace_invites from authenticated;

-- Create an invite (owner/admin). Members + pending invites may not exceed the plan.
create or replace function public.create_invite(ws uuid, invite_email text, invite_role text)
returns table (id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  lim integer;
  used integer;
  tok text;
  e text := lower(trim(invite_email));
begin
  if not public.is_workspace_editor(ws) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if not public.workspace_is_active(ws) then raise exception 'subscription_inactive' using errcode = 'P0001'; end if;
  if invite_role not in ('admin', 'viewer') then raise exception 'invalid_role' using errcode = '22023'; end if;
  if exists (select 1 from public.workspace_members m join public.profiles p on p.id = m.user_id
              where m.workspace_id = ws and lower(p.email) = e) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;
  select p.max_members into lim from public.subscriptions s join public.plans p on p.id = s.plan_id where s.workspace_id = ws;
  select (select count(*) from public.workspace_members m where m.workspace_id = ws)
       + (select count(*) from public.workspace_invites i
           where i.workspace_id = ws and i.accepted_at is null and i.expires_at > now() and lower(i.email) <> e)
    into used;
  if used >= coalesce(lim, 1) then raise exception 'plan_limit_members' using errcode = 'P0001'; end if;
  -- One pending invite per email: replace an older one.
  delete from public.workspace_invites i where i.workspace_id = ws and lower(i.email) = e and i.accepted_at is null;
  tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  return query
    insert into public.workspace_invites (workspace_id, email, role, token, invited_by)
    values (ws, e, invite_role, tok, auth.uid())
    returning workspace_invites.id, workspace_invites.token, workspace_invites.expires_at;
end;
$$;

-- Accept an invite: must be logged in with the invited email address.
create or replace function public.accept_invite(invite_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  inv public.workspace_invites;
  me text;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select * into inv from public.workspace_invites where token = invite_token for update;
  if not found or inv.accepted_at is not null then raise exception 'invite_invalid' using errcode = 'P0001'; end if;
  if inv.expires_at < now() then raise exception 'invite_expired' using errcode = 'P0001'; end if;
  select lower(p.email) into me from public.profiles p where p.id = auth.uid();
  if me is distinct from lower(inv.email) then raise exception 'invite_wrong_email' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.workspace_members m where m.workspace_id = inv.workspace_id and m.user_id = auth.uid()) then
    insert into public.workspace_members (workspace_id, user_id, role) values (inv.workspace_id, auth.uid(), inv.role);
  end if;
  update public.workspace_invites set accepted_at = now(), accepted_by = auth.uid() where id = inv.id;
  return inv.workspace_id;
end;
$$;

create or replace function public.revoke_invite(invite_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare ws uuid;
begin
  select workspace_id into ws from public.workspace_invites where id = invite_id;
  if ws is null or not public.is_workspace_editor(ws) then raise exception 'not_allowed' using errcode = '42501'; end if;
  delete from public.workspace_invites where id = invite_id and accepted_at is null;
end;
$$;

-- Members with emails (profiles are otherwise private to their owner).
create or replace function public.list_members(ws uuid)
returns table (user_id uuid, email text, full_name text, role text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.user_id, p.email, p.full_name, m.role, m.created_at
    from public.workspace_members m join public.profiles p on p.id = m.user_id
   where m.workspace_id = ws and (public.is_workspace_member(ws) or public.is_platform_admin())
   order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, m.created_at;
$$;

-- Owner changes a member's role (never their own, never to owner).
create or replace function public.set_member_role(ws uuid, member uuid, new_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_workspace_owner(ws) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if new_role not in ('admin', 'viewer') then raise exception 'invalid_role' using errcode = '22023'; end if;
  update public.workspace_members set role = new_role
   where workspace_id = ws and user_id = member and role <> 'owner';
end;
$$;

revoke execute on function public.create_invite(uuid, text, text) from public, anon;
revoke execute on function public.accept_invite(text) from public, anon;
revoke execute on function public.revoke_invite(uuid) from public, anon;
revoke execute on function public.list_members(uuid) from public, anon;
revoke execute on function public.set_member_role(uuid, uuid, text) from public, anon;
grant execute on function public.create_invite(uuid, text, text) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.revoke_invite(uuid) to authenticated;
grant execute on function public.list_members(uuid) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
