-- 030 · Store contact information (Settings → Contact information)
--
-- Extends the single store_settings row (020) instead of adding a table:
-- 020 already holds the contact email, phone and address. This adds the
-- WhatsApp number, weekly business hours, social profile links and a
-- "published" switch, and exposes ONLY the published contact subset to the
-- storefront through public.store_contact().
--
-- store_settings itself stays admin-only (it also holds tax, fees, limits and
-- the notification email). Visitors never read the table: store_contact() is
-- SECURITY DEFINER, returns a fixed list of contact columns, and returns no
-- row at all while contact_published is false. Admins still update the row
-- through RLS + column grants, as in 020.
--
-- Supersedes mirna-storefront's docs/proposed-migrations/…030_public_store_contact.sql
-- (same function name; this version adds columns to its result, so the old
-- definition is dropped first). Additive only: no data is changed or removed.
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.store_settings
  add column if not exists contact_whatsapp text,
  -- {"mon": {"open": "09:00", "close": "18:00"}, "tue": null, …}: all seven
  -- days, null = closed that day. A close time earlier than the open time
  -- means the store closes after midnight. NULL column = hours not shown.
  add column if not exists business_hours jsonb,
  add column if not exists social_instagram text,
  add column if not exists social_facebook text,
  add column if not exists social_tiktok text,
  add column if not exists social_snapchat text,
  add column if not exists social_x text,
  add column if not exists social_youtube text,
  -- Off by default: nothing is shown publicly until an admin publishes it.
  add column if not exists contact_published boolean not null default false;

-- Business hours shape, enforced by a CHECK constraint (the admin form and
-- Server Action validate the same rules first).
create or replace function private.store_business_hours_valid(hours jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  day_key text;
  day_value jsonb;
  time_pattern constant text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
begin
  if hours is null then
    return true;
  end if;
  if jsonb_typeof(hours) <> 'object' then
    return false;
  end if;
  if (select count(*) from jsonb_object_keys(hours)) <> 7 then
    return false;
  end if;
  for day_key, day_value in select key, value from jsonb_each(hours) loop
    if day_key not in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun') then
      return false;
    end if;
    continue when jsonb_typeof(day_value) = 'null';
    if jsonb_typeof(day_value) <> 'object'
      or (select count(*) from jsonb_object_keys(day_value)) <> 2
      or jsonb_typeof(day_value -> 'open') is distinct from 'string'
      or jsonb_typeof(day_value -> 'close') is distinct from 'string'
      or (day_value ->> 'open') !~ time_pattern
      or (day_value ->> 'close') !~ time_pattern
      or (day_value ->> 'open') = (day_value ->> 'close')
    then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

-- CHECK constraints run as the updating role, so admins need EXECUTE. It only
-- validates its argument and reads no data.
revoke all on function private.store_business_hours_valid(jsonb) from public;
grant execute on function private.store_business_hours_valid(jsonb) to authenticated, service_role;

-- Constraints are (re)created so the migration can be re-run.
alter table public.store_settings
  drop constraint if exists store_settings_contact_whatsapp_check,
  drop constraint if exists store_settings_business_hours_check,
  drop constraint if exists store_settings_social_links_check;

alter table public.store_settings
  -- International format (country code), as wa.me links need.
  add constraint store_settings_contact_whatsapp_check check (
    contact_whatsapp is null or contact_whatsapp ~ '^\+[0-9 ()-]{6,32}$'
  ),
  add constraint store_settings_business_hours_check check (
    private.store_business_hours_valid(business_hours)
  ),
  -- https links only (never javascript:, data: or plain http). Which site a
  -- link points at is checked by the admin app.
  add constraint store_settings_social_links_check check (
    (social_instagram is null or (char_length(social_instagram) <= 500 and social_instagram ~ '^https://[^[:space:]/?#]+\.[^[:space:]]+$'))
    and (social_facebook is null or (char_length(social_facebook) <= 500 and social_facebook ~ '^https://[^[:space:]/?#]+\.[^[:space:]]+$'))
    and (social_tiktok is null or (char_length(social_tiktok) <= 500 and social_tiktok ~ '^https://[^[:space:]/?#]+\.[^[:space:]]+$'))
    and (social_snapchat is null or (char_length(social_snapchat) <= 500 and social_snapchat ~ '^https://[^[:space:]/?#]+\.[^[:space:]]+$'))
    and (social_x is null or (char_length(social_x) <= 500 and social_x ~ '^https://[^[:space:]/?#]+\.[^[:space:]]+$'))
    and (social_youtube is null or (char_length(social_youtube) <= 500 and social_youtube ~ '^https://[^[:space:]/?#]+\.[^[:space:]]+$'))
  );

-- ---------------------------------------------------------------------------
-- Grants: admins may update the new columns (RLS from 020 still applies).
-- ---------------------------------------------------------------------------
grant update (
  contact_whatsapp, business_hours,
  social_instagram, social_facebook, social_tiktok, social_snapchat, social_x, social_youtube,
  contact_published
) on table public.store_settings to authenticated;

-- ---------------------------------------------------------------------------
-- Public read: the published contact subset only
-- ---------------------------------------------------------------------------
drop function if exists public.store_contact();

create function public.store_contact()
returns table (
  store_name text,
  contact_email text,
  contact_phone text,
  contact_whatsapp text,
  address_line1 text,
  address_line2 text,
  city text,
  state_region text,
  postal_code text,
  country_code text,
  business_hours jsonb,
  social_instagram text,
  social_facebook text,
  social_tiktok text,
  social_snapchat text,
  social_x text,
  social_youtube text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.store_name,
    nullif(btrim(s.contact_email), ''),
    nullif(btrim(s.contact_phone), ''),
    nullif(btrim(s.contact_whatsapp), ''),
    nullif(btrim(s.address_line1), ''),
    nullif(btrim(s.address_line2), ''),
    nullif(btrim(s.city), ''),
    nullif(btrim(s.state_region), ''),
    nullif(btrim(s.postal_code), ''),
    s.country_code::text,
    s.business_hours,
    nullif(btrim(s.social_instagram), ''),
    nullif(btrim(s.social_facebook), ''),
    nullif(btrim(s.social_tiktok), ''),
    nullif(btrim(s.social_snapchat), ''),
    nullif(btrim(s.social_x), ''),
    nullif(btrim(s.social_youtube), '')
  from public.store_settings s
  where s.id and s.contact_published;
$$;

comment on function public.store_contact() is
  'Published store contact details for the storefront (no row while unpublished). Never returns tax, fee, limit or notification settings.';

revoke all on function public.store_contact() from public;
grant execute on function public.store_contact() to anon, authenticated, service_role;
