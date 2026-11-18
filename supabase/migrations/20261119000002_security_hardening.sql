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
