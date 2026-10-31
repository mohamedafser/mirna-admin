-- 044 · Online payments (Stripe)
--
-- Card and Apple Pay payments through Stripe Payment Intents. Card details
-- never reach this database: the storefront's Payment Element sends them to
-- Stripe directly, and only Stripe's references (pi_…, ch_…, re_…), the card
-- brand / last four digits and the wallet used are stored here.
--
-- Flow
--   1. place_order() (unchanged) creates the order and takes its stock. When
--      Stripe is switched on (payment_settings), a BEFORE INSERT trigger marks
--      the order payment_status PENDING with a payment deadline, and refuses a
--      currency Stripe isn't enabled for (payment_currency_unavailable).
--   2. The storefront (customer session) reads order_payment_state(), creates
--      the PaymentIntent on its server for the amount computed HERE from the
--      stored order total, and links it with attach_payment_intent().
--   3. Stripe webhooks reach mirna-admin, which re-reads the PaymentIntent
--      from Stripe and applies its current state with sync_stripe_payment()
--      (service role only). Nothing is ever marked paid from the browser.
--   4. Unpaid orders past their deadline are cancelled (their PaymentIntent is
--      cancelled at Stripe first) through cancel_unpaid_order(): the existing
--      cancel trigger (migration 043) puts their stock back.
--
-- Tables
--   payment_settings  single row: Stripe on/off, enabled currencies (checked
--                     against the Stripe account by mirna-admin), deadline
--   payments          one row per PaymentIntent (an order normally has one)
--   refunds           Stripe refunds, from mirna-admin or the Stripe Dashboard
--   payment_events    processed webhook events (idempotency + audit trail)
--   orders            + payment_status (summary of its payments; null = no
--                     online payment, e.g. orders placed before this
--                     migration or while Stripe is off), payment_due_at, paid_at
--
-- Order workflow additions (orders_guard_status, API roles):
--   - an order whose payment is required can't move forward until paid;
--   - a paid order can't be cancelled (refund it instead: a full refund moves
--     it to REFUNDED, restocking it when it hadn't shipped);
--   - an order with an open payment is cancelled through mirna-admin, which
--     cancels the PaymentIntent first.
--
-- Requires migrations 031 (currencies), 037 and 043. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Types
-- ---------------------------------------------------------------------------

do $$
begin
  create type public.payment_status as enum (
    'PENDING',             -- awaiting payment (incl. 3D Secure in progress)
    'PROCESSING',          -- submitted, Stripe hasn't confirmed the outcome
    'PAID',
    'FAILED',              -- last attempt declined; the customer may retry
    'CANCELLED',
    'PARTIALLY_REFUNDED',
    'REFUNDED'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.refund_status as enum (
    'PENDING', 'REQUIRES_ACTION', 'SUCCEEDED', 'FAILED', 'CANCELLED'
  );
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Payment settings (single row)
-- ---------------------------------------------------------------------------

create table if not exists public.payment_settings (
  id boolean primary key default true constraint payment_settings_single_row check (id),
  stripe_enabled boolean not null default false,
  -- Currencies customers may pay in. Always a subset of what the Stripe
  -- account supports (stripe_supported_currencies, read from Stripe).
  enabled_currencies text[] not null default '{}'
    check (array_to_string(enabled_currencies, ',') ~ '^([A-Z]{3}(,[A-Z]{3})*)?$'),
  -- How long an unpaid order holds its stock.
  payment_window_minutes integer not null default 60
    check (payment_window_minutes between 15 and 1440),

  -- The connected Stripe account, as last verified by mirna-admin.
  stripe_account_id text check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  stripe_account_country text check (stripe_account_country ~ '^[A-Z]{2}$'),
  stripe_livemode boolean,
  stripe_charges_enabled boolean not null default false,
  stripe_supported_currencies text[] not null default '{}'
    check (array_to_string(stripe_supported_currencies, ',') ~ '^([A-Z]{3}(,[A-Z]{3})*)?$'),
  stripe_verified_at timestamptz,

  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,

  constraint payment_settings_currencies_supported
    check (enabled_currencies <@ stripe_supported_currencies),
  constraint payment_settings_enabled_ready check (
    not stripe_enabled
    or (stripe_charges_enabled and stripe_verified_at is not null
        and cardinality(enabled_currencies) > 0)
  )
);

insert into public.payment_settings (id) values (true) on conflict (id) do nothing;

alter table public.payment_settings enable row level security;

drop trigger if exists payment_settings_set_updated_at on public.payment_settings;
create trigger payment_settings_set_updated_at
  before update on public.payment_settings
  for each row execute function private.set_updated_at();

revoke all on table public.payment_settings from anon, authenticated;
grant select on table public.payment_settings to authenticated, service_role;
grant update (
  stripe_enabled, enabled_currencies, payment_window_minutes,
  stripe_account_id, stripe_account_country, stripe_livemode, stripe_charges_enabled,
  stripe_supported_currencies, stripe_verified_at, updated_by
) on table public.payment_settings to authenticated;

drop policy if exists payment_settings_select_admin on public.payment_settings;
create policy payment_settings_select_admin on public.payment_settings
  for select to authenticated
  using ((select private.is_admin()));

drop policy if exists payment_settings_update_admin on public.payment_settings;
create policy payment_settings_update_admin on public.payment_settings
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- What the storefront may know (no account details): is online payment on,
-- and in which currencies.
create or replace function public.checkout_payment_options()
returns table (enabled boolean, currencies text[], payment_window_minutes integer)
language sql
stable
security definer
set search_path = ''
as $$
  select s.stripe_enabled, s.enabled_currencies, s.payment_window_minutes
  from public.payment_settings s
  where s.id;
$$;

revoke all on function public.checkout_payment_options() from public;
grant execute on function public.checkout_payment_options() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Orders: payment summary
-- ---------------------------------------------------------------------------

alter table public.orders
  add column if not exists payment_status public.payment_status,
  add column if not exists payment_due_at timestamptz,
  add column if not exists paid_at timestamptz;

-- Admin filter, and the expiry job's "unpaid past the deadline" scan.
create index if not exists orders_payment_status_created_at_idx
  on public.orders (payment_status, created_at desc) where payment_status is not null;
create index if not exists orders_payment_due_idx
  on public.orders (payment_due_at)
  where status = 'PENDING' and payment_status in ('PENDING', 'FAILED');

-- Orders placed while Stripe is on must be paid online, in an enabled
-- currency. Runs inside place_order()'s transaction: refusing here rolls the
-- whole order (and its stock deduction) back.
create or replace function private.orders_payment_required()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.payment_settings%rowtype;
begin
  if new.payment_status is not null then
    return new;
  end if;
  select * into v_settings from public.payment_settings where id;
  -- Nothing to charge (e.g. fully discounted): no online payment needed.
  if found and v_settings.stripe_enabled and new.total > 0 then
    if not (new.currency_code::text = any (v_settings.enabled_currencies)) then
      raise exception 'payment_currency_unavailable' using errcode = 'P0001';
    end if;
    new.payment_status := 'PENDING';
    new.payment_due_at := now() + make_interval(mins => v_settings.payment_window_minutes);
  end if;
  return new;
end;
$$;

revoke all on function private.orders_payment_required() from public, anon, authenticated;

drop trigger if exists orders_payment_required on public.orders;
create trigger orders_payment_required
  before insert on public.orders
  for each row execute function private.orders_payment_required();

-- Status changes by API roles (admins) also respect the payment. SQL run as
-- the owner (SECURITY DEFINER functions below, migrations) is trusted.
create or replace function private.guard_order_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if new.status is distinct from old.status then
    if not private.order_status_transition_allowed(old.status, new.status) then
      raise exception 'orders:invalid_transition' using errcode = '23514';
    end if;
    if new.status = 'CANCELLED' then
      -- Money was taken: refund instead.
      if old.payment_status in ('PROCESSING', 'PAID', 'PARTIALLY_REFUNDED') then
        raise exception 'orders:payment_captured' using errcode = '23514';
      end if;
      -- A PaymentIntent may still be paid: cancel_unpaid_order() (mirna-admin
      -- cancels it at Stripe first).
      if old.payment_status in ('PENDING', 'FAILED') then
        raise exception 'orders:payment_open' using errcode = '23514';
      end if;
    elsif old.payment_status is not null
          and old.payment_status not in ('PAID', 'PARTIALLY_REFUNDED') then
      raise exception 'orders:payment_required' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.guard_order_status() from public;

-- ---------------------------------------------------------------------------
-- 4. Payments, refunds, webhook events
-- ---------------------------------------------------------------------------

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  provider text not null default 'stripe' check (provider = 'stripe'),
  stripe_payment_intent_id text not null unique
    check (stripe_payment_intent_id ~ '^pi_[A-Za-z0-9]+$'),
  status public.payment_status not null default 'PENDING',
  -- The PaymentIntent's amount: always the order total (checked on insert
  -- and on every sync).
  amount public.money_amount not null check (amount > 0),
  amount_minor bigint not null check (amount_minor > 0),
  currency_code public.currency_code not null,
  amount_received_minor bigint not null default 0 check (amount_received_minor >= 0),
  amount_refunded_minor bigint not null default 0 check (amount_refunded_minor >= 0),
  -- Stripe's own status (requires_action, processing, …), for support.
  stripe_status text check (char_length(stripe_status) <= 40),
  stripe_charge_id text check (stripe_charge_id ~ '^(ch|py)_[A-Za-z0-9]+$'),
  -- "card", "link", …; wallet: "apple_pay", "google_pay", … (never card numbers).
  payment_method_type text check (char_length(payment_method_type) <= 40),
  wallet text check (char_length(wallet) <= 40),
  card_brand text check (char_length(card_brand) <= 40),
  card_last4 text check (card_last4 ~ '^[0-9]{4}$'),
  failure_code text check (char_length(failure_code) <= 100),
  failure_message text check (char_length(failure_message) <= 500),
  livemode boolean not null default false,
  paid_at timestamptz,
  failed_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_order_fkey foreign key (order_id, currency_code)
    references public.orders (id, currency_code) on delete restrict
);

-- One live attempt per order (a declined attempt is retried on the same
-- PaymentIntent, so FAILED stays "live").
create unique index if not exists payments_one_open_per_order_idx
  on public.payments (order_id) where status in ('PENDING', 'PROCESSING', 'FAILED');
create index if not exists payments_order_id_idx on public.payments (order_id, created_at desc);

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function private.set_updated_at();

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete restrict,
  order_id uuid not null,
  stripe_refund_id text not null unique check (stripe_refund_id ~ '^(re|pyr)_[A-Za-z0-9]+$'),
  status public.refund_status not null default 'PENDING',
  amount public.money_amount not null check (amount > 0),
  amount_minor bigint not null check (amount_minor > 0),
  currency_code public.currency_code not null,
  reason text check (
    reason in ('duplicate', 'fraudulent', 'requested_by_customer', 'expired_uncaptured_charge')
  ),
  note text check (char_length(note) <= 500),
  failure_reason text check (char_length(failure_reason) <= 100),
  -- The admin who asked for it (null: made in the Stripe Dashboard, or the
  -- automatic refund of an order cancelled before its payment arrived).
  requested_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refunds_order_fkey foreign key (order_id, currency_code)
    references public.orders (id, currency_code) on delete restrict
);

create index if not exists refunds_payment_id_idx on public.refunds (payment_id);
create index if not exists refunds_order_id_idx on public.refunds (order_id, created_at desc);

drop trigger if exists refunds_set_updated_at on public.refunds;
create trigger refunds_set_updated_at
  before update on public.refunds
  for each row execute function private.set_updated_at();

-- Every verified Stripe event received. A redelivered event that was already
-- processed is acknowledged without doing anything.
create table if not exists public.payment_events (
  stripe_event_id text primary key check (stripe_event_id ~ '^evt_[A-Za-z0-9]+$'),
  event_type text not null check (char_length(event_type) <= 100),
  stripe_object_id text check (char_length(stripe_object_id) <= 100),
  payment_intent_id text check (char_length(payment_intent_id) <= 100),
  order_id uuid references public.orders (id) on delete set null,
  livemode boolean not null,
  stripe_created_at timestamptz not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  -- applied | ignored | failed (retried by Stripe)
  outcome text check (outcome in ('applied', 'ignored', 'failed')),
  detail text check (char_length(detail) <= 500)
);

create index if not exists payment_events_order_id_idx
  on public.payment_events (order_id, stripe_created_at desc) where order_id is not null;
create index if not exists payment_events_payment_intent_idx
  on public.payment_events (payment_intent_id) where payment_intent_id is not null;

alter table public.payments enable row level security;
alter table public.refunds enable row level security;
alter table public.payment_events enable row level security;

-- Read only for API roles: every write goes through the functions below.
revoke all on table public.payments, public.refunds, public.payment_events from anon, authenticated;
grant select on table public.payments, public.refunds to authenticated;
grant select on table public.payment_events to authenticated;
grant select on table public.payments, public.refunds, public.payment_events to service_role;

drop policy if exists payments_select_own_or_admin on public.payments;
create policy payments_select_own_or_admin on public.payments
  for select to authenticated
  using (
    (select private.is_admin())
    or exists (
      select 1 from public.orders o
      where o.id = payments.order_id and o.user_id = (select auth.uid())
    )
  );

drop policy if exists refunds_select_own_or_admin on public.refunds;
create policy refunds_select_own_or_admin on public.refunds
  for select to authenticated
  using (
    (select private.is_admin())
    or exists (
      select 1 from public.orders o
      where o.id = refunds.order_id and o.user_id = (select auth.uid())
    )
  );

drop policy if exists payment_events_select_admin on public.payment_events;
create policy payment_events_select_admin on public.payment_events
  for select to authenticated
  using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- 5. Helpers
-- ---------------------------------------------------------------------------

-- The order total in the currency's minor units (what Stripe charges).
create or replace function private.order_amount_minor(p_order public.orders)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select private.to_minor(p_order.total, c.decimals)
  from public.currencies c
  where c.code = p_order.currency_code;
$$;

-- Can the customer pay this order now?
create or replace function private.order_is_payable(p_order public.orders)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_order.status = 'PENDING'
    and p_order.payment_status in ('PENDING', 'FAILED')
    and p_order.payment_due_at > now()
    and p_order.total > 0
    and exists (
      select 1 from public.payment_settings s
      where s.id and s.stripe_enabled
        and p_order.currency_code::text = any (s.enabled_currencies)
    );
$$;

-- The order's payment summary: the payment that took money, else the latest.
create or replace function private.order_payment_summary(p_order_id uuid)
returns public.payment_status
language sql
stable
security definer
set search_path = ''
as $$
  select p.status
  from public.payments p
  where p.order_id = p_order_id
  order by
    case
      when p.status in ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED') then 0
      when p.status = 'PROCESSING' then 1
      else 2
    end,
    p.created_at desc
  limit 1;
$$;

-- Moves that a newer Stripe state may make. Anything else is a stale read
-- (two deliveries racing) and is ignored, so a paid payment never goes back.
create or replace function private.payment_status_allowed(
  p_from public.payment_status,
  p_to public.payment_status
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_from = p_to or case p_from
    when 'PENDING' then p_to in ('PROCESSING', 'PAID', 'FAILED', 'CANCELLED')
    when 'FAILED' then p_to in ('PENDING', 'PROCESSING', 'PAID', 'CANCELLED')
    when 'PROCESSING' then p_to in ('PAID', 'FAILED', 'CANCELLED')
    when 'PAID' then p_to in ('PARTIALLY_REFUNDED', 'REFUNDED')
    when 'PARTIALLY_REFUNDED' then p_to = 'REFUNDED'
    else false
  end;
$$;

revoke all on function private.order_amount_minor(public.orders) from public, anon, authenticated;
revoke all on function private.order_is_payable(public.orders) from public, anon, authenticated;
revoke all on function private.order_payment_summary(uuid) from public, anon, authenticated;
revoke all on function private.payment_status_allowed(public.payment_status, public.payment_status)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Storefront (customer session)
-- ---------------------------------------------------------------------------

-- The customer's own order as the payment page needs it. Empty for anyone
-- else's order. amount_minor is computed here from the stored total: the
-- storefront charges exactly this, never an amount from the browser.
create or replace function public.order_payment_state(p_order_id uuid)
returns table (
  order_id uuid,
  order_number bigint,
  order_status public.order_status,
  payment_status public.payment_status,
  total text,
  currency_code text,
  currency_decimals smallint,
  amount_minor bigint,
  payment_due_at timestamptz,
  payable boolean,
  payment_intent_id text,
  customer_email text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_order public.orders%rowtype;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id and o.user_id = v_user;
  if not found then
    return;
  end if;

  return query
  select v_order.id, v_order.order_number, v_order.status, v_order.payment_status,
         v_order.total::text, v_order.currency_code::text,
         (select c.decimals from public.currencies c where c.code = v_order.currency_code),
         private.order_amount_minor(v_order),
         v_order.payment_due_at,
         coalesce(private.order_is_payable(v_order), false),
         (
           select p.stripe_payment_intent_id from public.payments p
           where p.order_id = v_order.id and p.status in ('PENDING', 'PROCESSING', 'FAILED')
           order by p.created_at desc
           limit 1
         ),
         v_order.shipping_address_snapshot -> 'customer' ->> 'email';
end;
$$;

revoke all on function public.order_payment_state(uuid) from public;
grant execute on function public.order_payment_state(uuid) to authenticated;

-- Links the PaymentIntent the storefront created for the customer's order.
-- The amount and currency must be the order's. Nothing here can mark it
-- paid: only sync_stripe_payment() does, from Stripe's own state, and it
-- re-checks that the PaymentIntent was created for this order (metadata set
-- server-side), so linking someone else's PaymentIntent achieves nothing.
create or replace function public.attach_payment_intent(
  p_order_id uuid,
  p_payment_intent_id text,
  p_amount_minor bigint,
  p_currency_code text,
  p_livemode boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_order_id is null or p_payment_intent_id is null
     or p_payment_intent_id !~ '^pi_[A-Za-z0-9]+$' then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  select * into v_order from public.orders o
  where o.id = p_order_id and o.user_id = v_user
  for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  -- Already linked (a second tab, a retry): the same PaymentIntent is fine.
  select * into v_payment from public.payments p
  where p.stripe_payment_intent_id = p_payment_intent_id;
  if found then
    if v_payment.order_id <> v_order.id then
      raise exception 'payment_amount_mismatch' using errcode = 'P0001';
    end if;
    return v_payment.id;
  end if;

  if not coalesce(private.order_is_payable(v_order), false) then
    raise exception 'order_not_payable' using errcode = 'P0001';
  end if;
  if p_amount_minor is distinct from private.order_amount_minor(v_order)
     or upper(p_currency_code) is distinct from v_order.currency_code::text then
    raise exception 'payment_amount_mismatch' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.payments p
    where p.order_id = v_order.id and p.status in ('PENDING', 'PROCESSING', 'FAILED')
  ) then
    raise exception 'payment_in_progress' using errcode = 'P0001';
  end if;

  insert into public.payments (
    order_id, stripe_payment_intent_id, status, amount, amount_minor, currency_code,
    stripe_status, livemode
  ) values (
    v_order.id, p_payment_intent_id, 'PENDING', v_order.total, p_amount_minor,
    v_order.currency_code, 'requires_payment_method', coalesce(p_livemode, false)
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.attach_payment_intent(uuid, text, bigint, text, boolean) from public;
grant execute on function public.attach_payment_intent(uuid, text, bigint, text, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 7. mirna-admin (service role only)
-- ---------------------------------------------------------------------------

-- Records a verified webhook event. Returns true when it was already
-- processed (a redelivery): the caller acknowledges it and stops.
create or replace function public.claim_payment_event(
  p_event_id text,
  p_event_type text,
  p_object_id text,
  p_livemode boolean,
  p_created_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.payment_events (
    stripe_event_id, event_type, stripe_object_id, livemode, stripe_created_at
  ) values (
    p_event_id, p_event_type, left(p_object_id, 100), p_livemode, p_created_at
  )
  on conflict (stripe_event_id) do nothing;

  return exists (
    select 1 from public.payment_events e
    where e.stripe_event_id = p_event_id and e.processed_at is not null
  );
end;
$$;

create or replace function public.finish_payment_event(
  p_event_id text,
  p_outcome text,
  p_payment_intent_id text,
  p_order_id uuid,
  p_detail text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.payment_events
  set outcome = p_outcome,
      payment_intent_id = coalesce(left(p_payment_intent_id, 100), payment_intent_id),
      order_id = coalesce(
        (select o.id from public.orders o where o.id = p_order_id), order_id
      ),
      detail = left(p_detail, 500),
      -- A failure stays unprocessed, so Stripe's retry processes it again.
      processed_at = case when p_outcome = 'failed' then null else now() end
  where stripe_event_id = p_event_id;
$$;

-- Applies a PaymentIntent's CURRENT state, as just read from Stripe by
-- mirna-admin (webhooks, refunds, cancellations, "refresh from Stripe").
-- State-based, so running it twice or out of order is harmless.
--
-- p_state (jsonb, Stripe's values):
--   payment_intent_id, order_id (metadata.order_id), status, amount,
--   amount_received, currency, livemode, charge_id, amount_refunded,
--   payment_method_type, wallet, card_brand, card_last4,
--   failure_code, failure_message,
--   refunds: [{ id, amount, currency, status, reason, failure_reason,
--               created (unix), requested_by, note }]
--
-- Returns { outcome: applied | ignored, detail, order_id, payment_status,
--           order_status, refund_required }.
-- refund_required: the payment arrived for an order that had already been
-- cancelled (its stock released); mirna-admin refunds it automatically.
create or replace function public.sync_stripe_payment(p_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pi text := p_state ->> 'payment_intent_id';
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_decimals smallint;
  v_amount bigint := (p_state ->> 'amount')::bigint;
  v_received bigint := coalesce((p_state ->> 'amount_received')::bigint, 0);
  v_refunded bigint := coalesce((p_state ->> 'amount_refunded')::bigint, 0);
  v_currency text := upper(p_state ->> 'currency');
  v_failure text := nullif(p_state ->> 'failure_code', '');
  v_status public.payment_status;
  v_previous public.payment_status;
  v_summary public.payment_status;
  v_refund_required boolean := false;
  v_refund record;
  v_order_status public.order_status;
  v_stock_deducted boolean;
begin
  if v_pi is null or v_pi !~ '^pi_[A-Za-z0-9]+$' then
    return jsonb_build_object('outcome', 'ignored', 'detail', 'invalid_payment_intent');
  end if;
  begin
    v_order_id := (p_state ->> 'order_id')::uuid;
  exception when invalid_text_representation then
    v_order_id := null;
  end;
  if v_order_id is null then
    -- Not created by Mirna's checkout (e.g. a Dashboard payment).
    return jsonb_build_object('outcome', 'ignored', 'detail', 'no_order_metadata');
  end if;

  select * into v_order from public.orders o where o.id = v_order_id for update;
  if not found then
    return jsonb_build_object('outcome', 'ignored', 'detail', 'unknown_order');
  end if;
  select c.decimals into v_decimals from public.currencies c where c.code = v_order.currency_code;

  -- The PaymentIntent must charge exactly this order's total.
  if v_currency is distinct from v_order.currency_code::text
     or v_amount is distinct from private.order_amount_minor(v_order) then
    return jsonb_build_object('outcome', 'ignored', 'detail', 'amount_mismatch',
                              'order_id', v_order.id);
  end if;

  select * into v_payment from public.payments p
  where p.stripe_payment_intent_id = v_pi
  for update;
  if found and v_payment.order_id <> v_order.id then
    return jsonb_build_object('outcome', 'ignored', 'detail', 'order_mismatch',
                              'order_id', v_order.id);
  end if;
  if not found then
    -- Created at Stripe but never linked (the storefront failed in between).
    insert into public.payments (
      order_id, stripe_payment_intent_id, status, amount, amount_minor, currency_code,
      livemode
    ) values (
      v_order.id, v_pi, 'PENDING', v_order.total, v_amount, v_order.currency_code,
      coalesce((p_state ->> 'livemode')::boolean, false)
    )
    on conflict do nothing
    returning * into v_payment;
    if v_payment.id is null then
      -- Another live attempt exists for the order: keep it, ignore this one.
      return jsonb_build_object('outcome', 'ignored', 'detail', 'another_payment_open',
                                'order_id', v_order.id);
    end if;
  end if;

  v_refunded := greatest(v_refunded, v_payment.amount_refunded_minor);
  v_status := case p_state ->> 'status'
    when 'succeeded' then
      case
        when v_received > 0 and v_refunded >= v_received then 'REFUNDED'
        when v_refunded > 0 then 'PARTIALLY_REFUNDED'
        else 'PAID'
      end
    when 'processing' then 'PROCESSING'
    when 'requires_capture' then 'PROCESSING'
    when 'canceled' then 'CANCELLED'
    when 'requires_payment_method' then
      case when v_failure is not null then 'FAILED' else 'PENDING' end
    else 'PENDING'  -- requires_confirmation, requires_action (3D Secure)
  end::public.payment_status;

  v_previous := v_payment.status;
  if not private.payment_status_allowed(v_previous, v_status) then
    v_status := v_previous;  -- stale read: keep what we have
  end if;

  update public.payments set
    status = v_status,
    stripe_status = left(p_state ->> 'status', 40),
    amount_received_minor = greatest(v_received, amount_received_minor),
    amount_refunded_minor = v_refunded,
    stripe_charge_id = coalesce(nullif(p_state ->> 'charge_id', ''), stripe_charge_id),
    payment_method_type = coalesce(left(nullif(p_state ->> 'payment_method_type', ''), 40),
                                   payment_method_type),
    wallet = coalesce(left(nullif(p_state ->> 'wallet', ''), 40), wallet),
    card_brand = coalesce(left(nullif(p_state ->> 'card_brand', ''), 40), card_brand),
    card_last4 = coalesce(
      case when p_state ->> 'card_last4' ~ '^[0-9]{4}$' then p_state ->> 'card_last4' end,
      card_last4
    ),
    failure_code = case when v_status = 'FAILED' then left(v_failure, 100)
                        when v_status in ('PAID', 'PROCESSING') then null
                        else failure_code end,
    failure_message = case when v_status = 'FAILED'
                             then left(p_state ->> 'failure_message', 500)
                           when v_status in ('PAID', 'PROCESSING') then null
                           else failure_message end,
    livemode = coalesce((p_state ->> 'livemode')::boolean, livemode),
    paid_at = case when v_status in ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
                   then coalesce(paid_at, now()) else paid_at end,
    failed_at = case when v_status = 'FAILED' and v_previous <> 'FAILED' then now()
                     else failed_at end,
    canceled_at = case when v_status = 'CANCELLED' then coalesce(canceled_at, now())
                       else canceled_at end
  where id = v_payment.id;

  -- Refunds (Stripe's list for this PaymentIntent).
  for v_refund in
    select *
    from jsonb_to_recordset(coalesce(p_state -> 'refunds', '[]'::jsonb)) as r(
      id text, amount bigint, currency text, status text, reason text,
      failure_reason text, created bigint, requested_by text, note text
    )
    where r.id ~ '^(re|pyr)_[A-Za-z0-9]+$' and r.amount > 0
      and upper(r.currency) = v_order.currency_code::text
  loop
    insert into public.refunds (
      payment_id, order_id, stripe_refund_id, status, amount, amount_minor, currency_code,
      reason, note, failure_reason, requested_by, created_at
    ) values (
      v_payment.id, v_order.id, v_refund.id,
      case v_refund.status
        when 'succeeded' then 'SUCCEEDED'
        when 'failed' then 'FAILED'
        when 'canceled' then 'CANCELLED'
        when 'requires_action' then 'REQUIRES_ACTION'
        else 'PENDING'
      end::public.refund_status,
      private.from_minor(v_refund.amount, v_decimals), v_refund.amount, v_order.currency_code,
      case when v_refund.reason in ('duplicate', 'fraudulent', 'requested_by_customer',
                                    'expired_uncaptured_charge') then v_refund.reason end,
      left(nullif(v_refund.note, ''), 500),
      left(v_refund.failure_reason, 100),
      (select pr.id from public.profiles pr
       where pr.role = 'ADMIN'
         and pr.id = case
           when v_refund.requested_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then v_refund.requested_by::uuid
         end),
      coalesce(to_timestamp(v_refund.created), now())
    )
    on conflict (stripe_refund_id) do update set
      status = excluded.status,
      failure_reason = excluded.failure_reason;
  end loop;

  -- The order follows its payments.
  v_summary := private.order_payment_summary(v_order.id);
  v_order_status := v_order.status;
  v_stock_deducted := v_order.stock_deducted;

  if v_summary in ('PAID', 'PARTIALLY_REFUNDED') then
    if v_order_status = 'PENDING' then
      v_order_status := 'CONFIRMED';
    elsif v_order_status = 'CANCELLED'
          and v_previous not in ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED') then
      v_refund_required := true;
    end if;
  elsif v_summary = 'REFUNDED' then
    if v_order_status in ('PENDING', 'CONFIRMED', 'PROCESSING') then
      -- Not shipped: its units go back to stock, once.
      if v_stock_deducted then
        perform private.apply_order_stock(v_order.id, 1);
        v_stock_deducted := false;
      end if;
      v_order_status := 'REFUNDED';
    elsif v_order_status in ('SHIPPED', 'DELIVERED') then
      v_order_status := 'REFUNDED';  -- returns are restocked by hand
    end if;
  elsif v_summary = 'CANCELLED' and v_order_status = 'PENDING' then
    -- Releases the stock (orders_status_restock trigger, migration 043).
    v_order_status := 'CANCELLED';
  end if;

  update public.orders set
    status = v_order_status,
    stock_deducted = v_stock_deducted,
    payment_status = v_summary,
    paid_at = case when v_summary in ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
                   then coalesce(paid_at, now()) else paid_at end
  where id = v_order.id;

  return jsonb_build_object(
    'outcome', 'applied',
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'payment_status', v_status,
    'order_status', v_order_status,
    'refund_required', v_refund_required
  );
end;
$$;

-- Cancels an unpaid order (deadline passed, or an admin cancelled it). The
-- caller has already cancelled its PaymentIntents at Stripe. Refuses once
-- money is involved. Returns cancelled | not_found | not_pending | paid.
create or replace function public.cancel_unpaid_order(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    return 'not_found';
  end if;
  if v_order.status = 'CANCELLED' then
    return 'cancelled';
  end if;
  if v_order.status <> 'PENDING' then
    return 'not_pending';
  end if;
  if exists (
    select 1 from public.payments p
    where p.order_id = v_order.id
      and p.status in ('PROCESSING', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
  ) then
    return 'paid';
  end if;

  update public.payments
  set status = 'CANCELLED', stripe_status = 'canceled', canceled_at = coalesce(canceled_at, now())
  where order_id = v_order.id and status in ('PENDING', 'FAILED');

  -- Stock goes back through orders_status_restock (migration 043).
  update public.orders
  set status = 'CANCELLED',
      payment_status = case when payment_status is null then null
                            else 'CANCELLED'::public.payment_status end
  where id = v_order.id;
  return 'cancelled';
end;
$$;

-- Unpaid orders past their deadline, oldest first, with their live
-- PaymentIntents (to cancel at Stripe before cancel_unpaid_order()).
create or replace function public.expired_unpaid_orders(p_limit integer default 50)
returns table (order_id uuid, order_number bigint, payment_intent_ids text[])
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.order_number,
         coalesce(array_agg(p.stripe_payment_intent_id order by p.created_at)
                    filter (where p.id is not null), '{}')
  from public.orders o
  left join public.payments p
    on p.order_id = o.id and p.status in ('PENDING', 'PROCESSING', 'FAILED')
  where o.status = 'PENDING'
    and o.payment_status in ('PENDING', 'FAILED')
    and o.payment_due_at < now()
  group by o.id, o.order_number, o.payment_due_at
  order by o.payment_due_at
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

revoke all on function public.claim_payment_event(text, text, text, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.finish_payment_event(text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.sync_stripe_payment(jsonb) from public, anon, authenticated;
revoke all on function public.cancel_unpaid_order(uuid) from public, anon, authenticated;
revoke all on function public.expired_unpaid_orders(integer) from public, anon, authenticated;

grant execute on function public.claim_payment_event(text, text, text, boolean, timestamptz) to service_role;
grant execute on function public.finish_payment_event(text, text, text, uuid, text) to service_role;
grant execute on function public.sync_stripe_payment(jsonb) to service_role;
grant execute on function public.cancel_unpaid_order(uuid) to service_role;
grant execute on function public.expired_unpaid_orders(integer) to service_role;
