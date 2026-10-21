-- 033 · Dashboard summary
--
-- admin_dashboard_summary(...) returns every figure the admin dashboard shows
-- in one call, aggregated in PostgreSQL (no order rows leave the database):
--
--   sales          per currency: orders and revenue for the period, the
--                  previous period of the same length, and today
--   daily          per store-local day and currency: orders and revenue
--   status_counts  all orders by status (the fulfilment queue)
--   top_products   best sellers of the period by units
--   customers      total customer accounts, new in the period / previous one
--
-- "Sales" exclude CANCELLED and REFUNDED orders. Amounts are returned as text
-- so NUMERIC values never pass through floats. Days are bucketed in the
-- store's timezone (p_time_zone, from Settings).
--
-- SECURITY INVOKER: RLS already limits orders, order_items and profiles to an
-- active admin; the explicit is_admin() check turns a non-admin's empty
-- result into a clear refusal. Read-only and additive, safe to re-run.

create or replace function public.admin_dashboard_summary(
  p_from timestamptz,
  p_previous_from timestamptz,
  p_today timestamptz,
  p_time_zone text default 'Asia/Dubai',
  p_top_limit integer default 5
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tz text := coalesce(nullif(btrim(p_time_zone), ''), 'Asia/Dubai');
  v_limit integer := least(greatest(coalesce(p_top_limit, 5), 1), 20);
begin
  if not private.is_admin() then
    raise exception 'dashboard:forbidden' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'sales', coalesce((
      select jsonb_agg(row_to_json(s)::jsonb order by s.revenue_sort desc)
      from (
        select
          o.currency_code::text as currency_code,
          count(*) filter (where o.created_at >= p_from) as orders,
          coalesce(sum(o.total) filter (where o.created_at >= p_from), 0)::text as revenue,
          count(*) filter (where o.created_at < p_from) as previous_orders,
          coalesce(sum(o.total) filter (where o.created_at < p_from), 0)::text as previous_revenue,
          count(*) filter (where o.created_at >= p_today) as today_orders,
          coalesce(sum(o.total) filter (where o.created_at >= p_today), 0)::text as today_revenue,
          coalesce(sum(o.total) filter (where o.created_at >= p_from), 0) as revenue_sort
        from public.orders o
        where o.created_at >= p_previous_from
          and o.status not in ('CANCELLED', 'REFUNDED')
        group by o.currency_code
      ) s
    ), '[]'::jsonb),

    'daily', coalesce((
      select jsonb_agg(row_to_json(d)::jsonb order by d.day, d.currency_code)
      from (
        select
          (o.created_at at time zone v_tz)::date as day,
          o.currency_code::text as currency_code,
          count(*) as orders,
          sum(o.total)::text as revenue
        from public.orders o
        where o.created_at >= p_from
          and o.status not in ('CANCELLED', 'REFUNDED')
        group by 1, 2
      ) d
    ), '[]'::jsonb),

    'status_counts', coalesce((
      select jsonb_object_agg(c.status, c.count)
      from (
        select o.status::text as status, count(*) as count
        from public.orders o
        group by o.status
      ) c
    ), '{}'::jsonb),

    'top_products', coalesce((
      select jsonb_agg(row_to_json(t)::jsonb order by t.units desc, t.product_name)
      from (
        select
          i.product_id,
          (array_agg(i.product_name order by i.created_at desc))[1] as product_name,
          sum(i.quantity) as units,
          count(distinct i.order_id) as orders
        from public.order_items i
        join public.orders o on o.id = i.order_id
        where o.created_at >= p_from
          and o.status not in ('CANCELLED', 'REFUNDED')
        group by i.product_id, case when i.product_id is null then i.sku end
        order by units desc, product_name
        limit v_limit
      ) t
    ), '[]'::jsonb),

    'customers', (
      select jsonb_build_object(
        'total', count(*),
        'new', count(*) filter (where p.created_at >= p_from),
        'previous_new', count(*) filter (where p.created_at >= p_previous_from and p.created_at < p_from)
      )
      from public.profiles p
      where p.role = 'CUSTOMER'
    )
  );
end;
$$;

revoke all on function public.admin_dashboard_summary(timestamptz, timestamptz, timestamptz, text, integer)
  from public, anon;
grant execute on function public.admin_dashboard_summary(timestamptz, timestamptz, timestamptz, text, integer)
  to authenticated;
