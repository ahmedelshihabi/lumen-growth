-- Changes Lumen applied on Meta from a recommendation (pause / activate / daily budget),
-- with the value before and after, so they can be audited and undone.
-- Written only by the meta-apply Edge Function (service role); members can read.
create table if not exists public.applied_actions (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  campaign_id   text not null,               -- Meta campaign id
  campaign_name text,
  op            text not null check (op in ('pause', 'activate', 'set_daily_budget')),
  before        jsonb not null,              -- {status, daily_budget}
  after         jsonb not null,
  rec_key       text,
  applied_by    uuid references auth.users (id) on delete set null,
  applied_at    timestamptz not null default now(),
  undone_at     timestamptz,
  undone_by     uuid references auth.users (id) on delete set null
);
create index if not exists applied_actions_ws_idx on public.applied_actions (workspace_id, applied_at desc);

alter table public.applied_actions enable row level security;
drop policy if exists applied_read on public.applied_actions;
create policy applied_read on public.applied_actions for select to authenticated
  using (public.is_workspace_member(workspace_id) or public.is_platform_admin());
revoke all on public.applied_actions from anon;
revoke insert, update, delete, truncate, trigger, references on public.applied_actions from authenticated;
