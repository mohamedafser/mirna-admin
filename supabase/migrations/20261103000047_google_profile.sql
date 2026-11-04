-- 047 · Customer profile details from Google sign-in
--
-- Supabase Auth owns the sign-in and links a Google identity to the account with
-- the same verified email, so nothing here creates users or merges accounts.
-- on_auth_user_created (migration 003) already makes the profile of a new user.
-- This adds the profile picture, and fills in a missing name for an existing
-- customer who signs in with Google for the first time.

-- Not in the column grants of migration 011, so customers can't set it
-- themselves. Limited to Google's image host, which next/image also allows.
alter table public.profiles
  add column avatar_url text
  constraint profiles_avatar_url_google check (
    avatar_url is null
    or (char_length(avatar_url) <= 2048
      and avatar_url ~ '^https://[a-z0-9-]+\.googleusercontent\.com/')
  );

-- Copies the caller's details from their Google identity. They come from
-- auth.identities, which only Google's answer writes, and not from
-- raw_user_meta_data, which any signed-in user can change through the Auth API.
-- A name the customer already has is kept; the picture follows Google's.
create function public.sync_google_profile()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_data jsonb;
  v_avatar text;
  v_name text;
begin
  if v_user is null then
    return;
  end if;

  select identity_data into v_data
  from auth.identities
  where user_id = v_user and provider = 'google'
  order by last_sign_in_at desc nulls last
  limit 1;

  if v_data is null then
    return;
  end if;

  v_avatar := coalesce(v_data ->> 'avatar_url', v_data ->> 'picture');
  if v_avatar is null
    or char_length(v_avatar) > 2048
    or v_avatar !~ '^https://[a-z0-9-]+\.googleusercontent\.com/' then
    v_avatar := null;
  end if;
  v_name := nullif(left(btrim(coalesce(v_data ->> 'full_name', v_data ->> 'name')), 200), '');

  update public.profiles
  set avatar_url = coalesce(v_avatar, avatar_url),
      full_name = coalesce(nullif(btrim(full_name), ''), v_name)
  where id = v_user
    and role = 'CUSTOMER'
    and (
      avatar_url is distinct from coalesce(v_avatar, avatar_url)
      or full_name is distinct from coalesce(nullif(btrim(full_name), ''), v_name)
    );
end;
$$;

revoke all on function public.sync_google_profile() from public, anon;
grant execute on function public.sync_google_profile() to authenticated;
