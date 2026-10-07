-- 001 · Extensions and shared helpers
--
-- gen_random_uuid() is built into PostgreSQL 13+, so no UUID extension is needed.
-- Add extensions here (e.g. pg_trgm for search) when a later phase needs them.

-- `private` holds security-sensitive helpers. It is NOT in the Data API's exposed
-- schemas, so its functions cannot be called directly through PostgREST.
create schema if not exists private;
revoke all on schema private from public;
-- Functions created here are not executable by API roles unless granted.
alter default privileges in schema private revoke execute on functions from public;

-- Keeps updated_at current on every UPDATE.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
