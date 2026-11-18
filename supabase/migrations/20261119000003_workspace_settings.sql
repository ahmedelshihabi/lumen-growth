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
