-- 046 · Email one-time codes for customer sign-up and password reset
--
-- mirna-admin generates the codes and sends them over SMTP; the storefront asks
-- it to, server to server. Only hashes are stored: an HMAC keyed with a secret
-- the database never sees, because a plain hash of six digits is reversible.
--
-- A row is written for EVERY request, whether or not the email has an account.
-- Unsent codes are simply impossible to guess, so limits, attempts and answers
-- behave the same either way and can't reveal which emails are registered.
--
-- Every function takes a per-email advisory lock (or changes a single row
-- atomically), so concurrent requests can't both issue a code, and concurrent
-- guesses can't overrun the attempt limit or use a code twice. They use
-- clock_timestamp() because now() is frozen at the start of the transaction,
-- which may be before the lock was acquired.

create table public.auth_otps (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(btrim(email)) and char_length(email) <= 254),
  purpose text not null check (purpose in ('signup', 'recovery')),
  code_hash text not null,
  -- The browser that asked for this code (see auth_otp_issue).
  binding_hash text not null,
  ip_hash text,
  attempts smallint not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  -- The code was correct. Recovery codes stay unconsumed until the password
  -- has actually changed, but can't be verified a second time.
  verified_at timestamptz,
  -- Replaced by a newer code, expired, or out of attempts.
  invalidated_at timestamptz,
  consumed_at timestamptz,
  -- Recovery only: what the storefront holds between the code and the new password.
  reset_token_hash text,
  reset_expires_at timestamptz,
  -- Set while a password change is in flight, so a token is only used once.
  reset_claimed_at timestamptz
);

alter table public.auth_otps enable row level security;
-- No policies: reachable only through the functions below.
revoke all on table public.auth_otps from public, anon, authenticated;

-- At most one live code per email and purpose; also serves verification.
create unique index auth_otps_one_live_idx on public.auth_otps (email, purpose)
  where invalidated_at is null and consumed_at is null;
-- Limits per email and per IP, and removing old rows.
create index auth_otps_email_recent_idx on public.auth_otps (email, purpose, created_at desc);
create index auth_otps_ip_recent_idx on public.auth_otps (ip_hash, created_at desc)
  where ip_hash is not null;
create index auth_otps_created_at_idx on public.auth_otps (created_at);
create unique index auth_otps_reset_token_idx on public.auth_otps (reset_token_hash)
  where reset_token_hash is not null;

create function private.lock_auth_otp(p_email text, p_purpose text)
returns void
language sql
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('auth_otp:' || p_email || ':' || p_purpose, 0)
  );
$$;

revoke all on function private.lock_auth_otp(text, text) from public, anon, authenticated;

-- Records a new code, replacing the previous one, unless a limit applies:
--   60 seconds between codes and 5 an hour per email and purpose, 30 an hour per IP.
-- Returns { status: 'issued' | 'skipped' | 'rate_limited', retry_after? }.
--
-- A resend carries no details, only the browser's binding, and is 'skipped'
-- (the caller sends nothing, and answers as if it had) unless that browser made
-- the latest request. Otherwise someone who re-registered an unverified email
-- with their own password could get the owner to activate it, by having the
-- owner press "resend" and type in the new code.
create function public.auth_otp_issue(
  p_email text,
  p_purpose text,
  p_code_hash text,
  p_binding_hash text,
  p_ip_hash text,
  p_resend boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_latest public.auth_otps%rowtype;
  v_count integer;
  v_oldest timestamptz;
begin
  perform private.lock_auth_otp(p_email, p_purpose);
  v_now := pg_catalog.clock_timestamp();

  select * into v_latest
  from public.auth_otps
  where email = p_email and purpose = p_purpose
  order by created_at desc
  limit 1;

  if p_resend and (v_latest.id is null or v_latest.binding_hash <> p_binding_hash) then
    return jsonb_build_object('status', 'skipped');
  end if;

  if v_latest.created_at > v_now - interval '60 seconds' then
    return jsonb_build_object(
      'status', 'rate_limited',
      'retry_after', greatest(1, ceil(extract(epoch from
        v_latest.created_at + interval '60 seconds' - v_now))::integer)
    );
  end if;

  select count(*), min(created_at) into v_count, v_oldest
  from public.auth_otps
  where email = p_email and purpose = p_purpose and created_at > v_now - interval '1 hour';
  if v_count >= 5 then
    return jsonb_build_object(
      'status', 'rate_limited',
      'retry_after', greatest(1, ceil(extract(epoch from
        v_oldest + interval '1 hour' - v_now))::integer)
    );
  end if;

  if p_ip_hash is not null then
    select count(*), min(created_at) into v_count, v_oldest
    from public.auth_otps
    where ip_hash = p_ip_hash and created_at > v_now - interval '1 hour';
    if v_count >= 30 then
      return jsonb_build_object(
        'status', 'rate_limited',
        'retry_after', greatest(1, ceil(extract(epoch from
          v_oldest + interval '1 hour' - v_now))::integer)
      );
    end if;
  end if;

  update public.auth_otps
  set invalidated_at = v_now
  where email = p_email and purpose = p_purpose
    and invalidated_at is null and consumed_at is null;

  insert into public.auth_otps (
    email, purpose, code_hash, binding_hash, ip_hash, created_at, expires_at
  )
  values (
    p_email, p_purpose, p_code_hash, p_binding_hash, p_ip_hash, v_now, v_now + interval '5 minutes'
  );

  -- Longer than any window above.
  delete from public.auth_otps where created_at < v_now - interval '1 day';

  return jsonb_build_object('status', 'issued');
end;
$$;

revoke all on function public.auth_otp_issue(text, text, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.auth_otp_issue(text, text, text, text, text, boolean)
  to service_role;

-- Checks a code. Returns { status: 'ok' | 'invalid' | 'expired' | 'locked' }.
-- A guess from another browser counts for nothing, so nobody can use up the
-- attempts on someone else's code. The fifth wrong guess ends the code.
create function public.auth_otp_verify(
  p_email text,
  p_purpose text,
  p_code_hash text,
  p_binding_hash text,
  p_reset_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_otp public.auth_otps%rowtype;
begin
  perform private.lock_auth_otp(p_email, p_purpose);
  v_now := pg_catalog.clock_timestamp();

  select * into v_otp
  from public.auth_otps
  where email = p_email and purpose = p_purpose
    and invalidated_at is null and consumed_at is null;

  if v_otp.id is null or v_otp.binding_hash <> p_binding_hash or v_otp.verified_at is not null then
    return jsonb_build_object('status', 'invalid');
  end if;

  if v_now >= v_otp.expires_at then
    update public.auth_otps set invalidated_at = v_now where id = v_otp.id;
    return jsonb_build_object('status', 'expired');
  end if;

  if v_otp.code_hash <> p_code_hash then
    update public.auth_otps
    set attempts = attempts + 1,
        invalidated_at = case when attempts + 1 >= 5 then v_now end
    where id = v_otp.id;
    return jsonb_build_object('status', case when v_otp.attempts + 1 >= 5 then 'locked' else 'invalid' end);
  end if;

  if p_purpose = 'recovery' then
    update public.auth_otps
    set verified_at = v_now,
        reset_token_hash = p_reset_token_hash,
        reset_expires_at = v_now + interval '10 minutes'
    where id = v_otp.id;
  else
    update public.auth_otps set verified_at = v_now, consumed_at = v_now where id = v_otp.id;
  end if;

  return jsonb_build_object('status', 'ok');
end;
$$;

revoke all on function public.auth_otp_verify(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.auth_otp_verify(text, text, text, text, text) to service_role;

-- Takes a reset token for one password change: returns its email, or null if
-- it's invalid, expired, used, or already being used. The claim lapses after
-- 30 seconds in case the server stops midway.
create function public.auth_otp_claim_reset(p_token_hash text)
returns text
language sql
security definer
set search_path = ''
as $$
  update public.auth_otps
  set reset_claimed_at = pg_catalog.clock_timestamp()
  where reset_token_hash = p_token_hash
    and invalidated_at is null and consumed_at is null
    and reset_expires_at > pg_catalog.clock_timestamp()
    and (reset_claimed_at is null
      or reset_claimed_at < pg_catalog.clock_timestamp() - interval '30 seconds')
  returning email;
$$;

revoke all on function public.auth_otp_claim_reset(text) from public, anon, authenticated;
grant execute on function public.auth_otp_claim_reset(text) to service_role;

-- The password change failed, so the customer may try again with the same token.
create function public.auth_otp_release_reset(p_token_hash text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.auth_otps
  set reset_claimed_at = null
  where reset_token_hash = p_token_hash and consumed_at is null;
$$;

revoke all on function public.auth_otp_release_reset(text) from public, anon, authenticated;
grant execute on function public.auth_otp_release_reset(text) to service_role;

-- The password has changed: uses up the code, ends every other live code for
-- this email, and signs the account out everywhere. Returns whether the
-- sessions could be removed; the password change stands either way.
create function public.auth_otp_finish_reset(p_token_hash text, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_email text;
begin
  update public.auth_otps
  set consumed_at = v_now
  where reset_token_hash = p_token_hash and consumed_at is null
  returning email into v_email;

  if v_email is not null then
    update public.auth_otps
    set invalidated_at = v_now
    where email = v_email and invalidated_at is null and consumed_at is null;
  end if;

  begin
    delete from auth.sessions where user_id = p_user_id;
  exception when insufficient_privilege then
    return false;
  end;
  return true;
end;
$$;

revoke all on function public.auth_otp_finish_reset(text, uuid) from public, anon, authenticated;
grant execute on function public.auth_otp_finish_reset(text, uuid) to service_role;

-- The account behind an email, if any. Auth's admin API can only list users.
create function public.auth_otp_find_account(p_email text)
returns table (user_id uuid, email_confirmed boolean, role text, is_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.email_confirmed_at is not null, p.role::text, coalesce(p.is_active, false)
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.email = p_email and u.is_sso_user = false and u.deleted_at is null
  limit 1;
$$;

revoke all on function public.auth_otp_find_account(text) from public, anon, authenticated;
grant execute on function public.auth_otp_find_account(text) to service_role;

-- Registering again before verifying replaces the earlier details, so that
-- nothing an earlier, unproven request typed survives on the account.
create function public.auth_otp_set_pending_name(p_user_id uuid, p_full_name text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles p
  set full_name = p_full_name
  from auth.users u
  where p.id = p_user_id and u.id = p.id and u.email_confirmed_at is null;
$$;

revoke all on function public.auth_otp_set_pending_name(uuid, text)
  from public, anon, authenticated;
grant execute on function public.auth_otp_set_pending_name(uuid, text) to service_role;
