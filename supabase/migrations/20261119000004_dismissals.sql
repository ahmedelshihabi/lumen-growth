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
