-- 019 · Customer management (Phase 15)
--
-- Admins list and inspect CUSTOMER accounts. Names, phones and status live in
-- public.profiles (already readable by admins under RLS); the sign-in email
-- lives in auth.users, which API roles can't read. These two functions join
-- them server-side and return only safe, display-level fields (no tokens,
-- metadata, password or provider data).
--
-- SECURITY DEFINER (to read auth.users), so the explicit is_admin() check is
-- the authorization: anyone else gets 'customers:forbidden'. Customers keep
-- reading only their own profile/orders through the existing RLS policies.
--
-- Activate / deactivate needs no new function: admins may already UPDATE
-- profiles.is_active (column grant + profiles_update_own_or_admin), and
-- profiles_guard_update lets only an active admin change it, never on their
-- own row. place_order() already refuses inactive customers.

-- Paginated customer list as one JSON object: {"total": n, "rows": [...]}.
-- The total is returned even when the page is past the end, so the app can
-- jump to the last page. Search matches name, email or phone (ILIKE, with
-- LIKE wildcards in the input escaped).
create or replace function public.admin_list_customers(
  p_search text default null,
  -- 'active' | 'inactive' | null (all)
  p_status text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pattern text;
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'customers:forbidden' using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_search, '')), '') is not null then
    v_pattern := '%' || replace(replace(replace(
      left(btrim(p_search), 100), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with matches as (
    select
      p.id,
      p.full_name,
      u.email::text as email,
      coalesce(p.phone, u.phone::text) as phone,
      p.is_active,
      p.created_at
    from public.profiles p
    left join auth.users u on u.id = p.id
    where p.role = 'CUSTOMER'
      and (p_status is null
        or (p_status = 'active' and p.is_active)
        or (p_status = 'inactive' and not p.is_active))
      and (v_pattern is null
        or p.full_name ilike v_pattern
        or u.email ilike v_pattern
        or p.phone ilike v_pattern
        or u.phone ilike v_pattern)
  ),
  page as (
    select m.*
    from matches m
    order by m.created_at desc, m.id
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from matches),
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', pg.id,
          'full_name', pg.full_name,
          'email', pg.email,
          'phone', pg.phone,
          'is_active', pg.is_active,
          'created_at', pg.created_at,
          'order_count', s.order_count,
          'last_order_at', s.last_order_at
        )
        order by pg.created_at desc, pg.id
      )
      from page pg
      -- Uses orders_user_id_created_at_idx.
      cross join lateral (
        select count(*) as order_count, max(o.created_at) as last_order_at
        from public.orders o
        where o.user_id = pg.id
      ) s
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- One customer (null when the id isn't a CUSTOMER profile).
create or replace function public.admin_get_customer(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'customers:forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', p.id,
    'full_name', p.full_name,
    'email', u.email,
    'phone', coalesce(p.phone, u.phone::text),
    'is_active', p.is_active,
    'created_at', p.created_at,
    'updated_at', p.updated_at,
    'last_sign_in_at', u.last_sign_in_at,
    'order_count', (select count(*) from public.orders o where o.user_id = p.id),
    'last_order_at', (select max(o.created_at) from public.orders o where o.user_id = p.id)
  )
  into v_result
  from public.profiles p
  left join auth.users u on u.id = p.id
  where p.id = p_id and p.role = 'CUSTOMER';

  return v_result;
end;
$$;

revoke all on function public.admin_list_customers(text, text, integer, integer) from public, anon;
revoke all on function public.admin_get_customer(uuid) from public, anon;
grant execute on function public.admin_list_customers(text, text, integer, integer) to authenticated;
grant execute on function public.admin_get_customer(uuid) to authenticated;
