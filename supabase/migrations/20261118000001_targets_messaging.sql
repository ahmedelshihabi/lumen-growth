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
