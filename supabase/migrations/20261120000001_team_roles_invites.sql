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
