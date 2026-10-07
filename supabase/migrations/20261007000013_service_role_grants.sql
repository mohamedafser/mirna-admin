-- 013 · Service role grants
--
-- Admin account provisioning (lib/auth/admins.ts) uses the service role to
-- check whether any admin exists, list admins and promote the first admin.
-- Granted explicitly so it never depends on the project's default privileges
-- or "auto-expose new tables" setting. service_role bypasses RLS, and the
-- profiles guard trigger (migration 011) only restricts anon/authenticated.

grant select, update on table public.profiles to service_role;
