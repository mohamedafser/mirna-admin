-- 045 · Order status email notifications
--
-- An order's status changes in many places: place_order() (storefront),
-- admins, sync_stripe_payment(), cancel_unpaid_order(), customer cancellation.
-- So the database itself records each change, in the same transaction, in an
-- outbox that mirna-admin delivers from (lib/notifications/delivery.ts):
--
--   orders insert / status change → trigger → order_notifications (PENDING)
--   mirna-admin → claim_order_notifications() → SMTP → SENT / retry / FAILED
--
-- UNIQUE (order_id, status) is what prevents duplicates: statuses never repeat
-- on an order, and however many code paths or webhook redeliveries touch it,
-- each status gets one row, so one email.
--
-- Orders that already exist get no rows, so applying this sends nothing old.
-- Only the service role reads this table; recipients aren't stored (the address
-- is read from auth.users when sending). Safe to re-run.

create table if not exists public.order_notifications (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  status public.order_status not null,
  -- PENDING: waiting or to retry · SENDING: claimed by a worker
  -- SENT · FAILED: retries used up · SKIPPED: nothing to send (see last_error)
  state text not null default 'PENDING'
    check (state in ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED')),
  attempts smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  -- A short reason code (never credentials, addresses or message content).
  last_error text check (char_length(last_error) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_notifications_order_status_key unique (order_id, status)
);

-- The worker's scan: only open rows, so it stays small as history grows.
create index if not exists order_notifications_open_idx
  on public.order_notifications (created_at)
  where state in ('PENDING', 'SENDING');

drop trigger if exists order_notifications_set_updated_at on public.order_notifications;
create trigger order_notifications_set_updated_at
  before update on public.order_notifications
  for each row execute function private.set_updated_at();

alter table public.order_notifications enable row level security;

revoke all on table public.order_notifications from anon, authenticated;
grant select, update on table public.order_notifications to service_role;
-- What the worker reads to build an email (explicit, as in migration 013).
grant select on table public.orders, public.order_items to service_role;

-- Records the status. SECURITY DEFINER: admins and customers changing an order
-- have no access to the outbox. A failure here is logged and swallowed, so a
-- notification problem can never roll back the order change itself.
create or replace function private.enqueue_order_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  begin
    insert into public.order_notifications (order_id, status)
    values (new.id, new.status)
    on conflict (order_id, status) do nothing;
  exception when others then
    raise warning 'order_notifications: enqueue failed for order %: %', new.id, sqlstate;
  end;
  return null;
end;
$$;

revoke all on function private.enqueue_order_notification() from public, anon, authenticated;

drop trigger if exists orders_enqueue_notification_insert on public.orders;
create trigger orders_enqueue_notification_insert
  after insert on public.orders
  for each row execute function private.enqueue_order_notification();

drop trigger if exists orders_enqueue_notification_status on public.orders;
create trigger orders_enqueue_notification_status
  after update of status on public.orders
  for each row execute function private.enqueue_order_notification();

-- Claims the emails due now. SKIP LOCKED lets several workers run at once (the
-- scheduler and an admin action) without taking the same row. A row waits while
-- an earlier one for the same order is open, so customers get them in order. A
-- worker that died mid-send leaves its row SENDING: it's claimed again after 5
-- minutes.
create or replace function public.claim_order_notifications(p_limit integer default 5)
returns table (
  id uuid,
  order_id uuid,
  status public.order_status,
  attempts smallint,
  created_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  with due as (
    select n.id
    from public.order_notifications n
    where (
        (n.state = 'PENDING' and n.next_attempt_at <= now())
        or (n.state = 'SENDING' and n.locked_at < now() - interval '5 minutes')
      )
      and not exists (
        select 1 from public.order_notifications earlier
        where earlier.order_id = n.order_id
          and earlier.state in ('PENDING', 'SENDING')
          and (earlier.created_at, earlier.status) < (n.created_at, n.status)
      )
    order by n.created_at, n.status
    limit least(greatest(coalesce(p_limit, 5), 1), 50)
    for update of n skip locked
  )
  update public.order_notifications t
  set state = 'SENDING', locked_at = now(), attempts = t.attempts + 1
  from due
  where t.id = due.id
  returning t.id, t.order_id, t.status, t.attempts, t.created_at;
$$;

revoke all on function public.claim_order_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_order_notifications(integer) to service_role;
