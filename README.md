# Mirna Admin

Back-office application for the **Mirna** ecommerce platform: catalogue, inventory, orders and customers (built in phases).

Mirna launches in the **UAE** (AE · AED · Asia/Dubai · English/Arabic) and is designed to add countries, currencies and languages without a rewrite.

> **Status: Phase 4 (inventory management).** Phase 1 foundation (schema, RLS, storage, i18n, theme, PWA), Phase 2 auth + admin shell, Phase 3 catalogue (categories, products, images, pricing) and Phase 4 inventory (stock levels, adjustments with history, low-stock thresholds). Orders, Customers and Settings are still "Coming soon" placeholders.

---

## Architecture

```text
                 ┌───────────────────────────┐
                 │   Supabase (one project)  │
                 │ PostgreSQL · Auth · RLS   │
                 │ Storage                   │
                 └─────────────┬─────────────┘
              ┌────────────────┴────────────────┐
     ┌────────▼─────────┐              ┌────────▼──────────┐
     │   mirna-admin    │              │ mirna-storefront  │
     │  (this repo)     │              │ (separate repo)   │
     │  Admin PWA       │              │ Customer PWA      │
     └──────────────────┘              └───────────────────┘
```

- **Two independent repositories**, not a monorepo. Both are Next.js (App Router) + TypeScript + Tailwind.
- **One shared Supabase project**: same database, auth users, storage and RLS policies.
- **This repo owns the database schema.** All migrations live in `supabase/migrations/`. `mirna-storefront` must not add its own migrations; schema changes it needs are made here.
- No separate backend: server logic runs in Next.js Server Components / Server Actions, and authorization is enforced by PostgreSQL RLS.

### Stack

| Concern      | Choice                                                                                |
| ------------ | ------------------------------------------------------------------------------------- |
| Framework    | Next.js 16 (App Router, Cache Components, `proxy.ts`), React 19                       |
| Language     | TypeScript (strict)                                                                   |
| Styling      | Tailwind CSS v4 with semantic design tokens                                           |
| Backend      | Supabase: PostgreSQL, Auth, Storage, RLS                                              |
| Auth/session | `@supabase/ssr` (cookie sessions, SSR-safe)                                           |
| i18n         | Built-in: `app/[lang]` routing + `next/root-params` + JSON messages (no i18n library) |
| Lint/format  | ESLint (`eslint-config-next`), Prettier                                               |

### Project layout

```text
app/
  [lang]/                 # every page lives under a locale: /en/..., /ar/...
    layout.tsx            # root layout: <html lang dir>, fonts, theme script, providers
    login/                # /[lang]/login (static page + client form + Server Action)
    admin/                # /[lang]/admin/* (protected admin area)
      layout.tsx          # AdminShell + user menu (requireAdmin)
      page.tsx            # dashboard
      [section]/page.tsx  # "Coming soon" placeholder for unbuilt sections
      loading.tsx         # skeleton while pages stream in
    access-denied/        # signed-in customers / deactivated users land here
    error.tsx, not-found.tsx
  manifest.ts             # PWA manifest (/manifest.webmanifest)
  global-not-found.tsx    # 404 for URLs outside any locale
  global-error.tsx
components/
  ui/                     # Button, Input, Textarea, Select, Field, Label, Card, Badge, Avatar,
                          # Alert, Separator, Dropdown, Sheet, Dialog/ConfirmDialog, Toast,
                          # Tooltip, Loading/Empty/Status states
  catalogue/              # category dialog, product form, image manager, list toolbar,
                          # pagination, status badge/toggle, image dropzone
  layout/                 # AdminShell, NavLinks, MobileNav, Breadcrumbs, UserMenu, Brand
  preferences/            # ThemeSwitcher, LocaleSwitcher
  pwa/                    # service worker registration, PWA status
  auth/                   # SignOutButton
config/
  admin-nav.ts            # admin sections: nav, breadcrumbs, titles, placeholders
  i18n.ts                 # supported locales + direction
  region.ts               # country / currency / timezone (the only place they're set)
lib/
  supabase/               # client.ts (browser), server.ts (RSC/actions), proxy.ts, env, DB types
  auth/                   # dal.ts (authorization), actions.ts (sign in/out),
                          # validation.ts (login rules), redirect.ts (?redirect= safety)
  i18n/                   # message loading (server + client), Accept-Language matching
  catalogue/              # queries (server reads), actions (Server Actions), validation,
                          # images (upload rules), slug
  money.ts                # exact decimal money parsing (no floats)
  format.ts               # currency + date formatting (Intl)
  theme.ts
messages/en.json, ar.json # translations
types/domain.ts           # domain types derived from the DB types
proxy.ts                  # locale redirect + session refresh + optimistic auth redirect
public/sw.js, offline.html, icons/
supabase/
  config.toml, migrations/, seed.sql
```

---

## Development

Requirements: Node.js ≥ 20.9, npm. Docker only if you want a local Supabase stack.

```bash
npm install
cp .env.example .env.local      # then fill in the two values below
npm run dev                     # http://localhost:3005 → redirects to /en/admin
```

| Command                           | Purpose                                                             |
| --------------------------------- | ------------------------------------------------------------------- |
| `npm run dev`                     | Dev server                                                          |
| `npm run lint`                    | ESLint                                                              |
| `npm run typecheck`               | Generate route types + `tsc --noEmit`                               |
| `npm run build` / `npm start`     | Production build / server                                           |
| `npm run format` / `format:check` | Prettier                                                            |
| `npm run db:types`                | Regenerate `lib/supabase/database.types.ts` from the linked project |

### Environment variables

| Variable                               | Where                             | Notes                                                                                          |
| -------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Supabase → Project Settings → API | Project URL                                                                                    |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | same                              | `sb_publishable_…` key (the legacy `anon` key also works). Public by design; RLS protects data |
| `NEXT_PUBLIC_REGION`                   | optional                          | Market key from `config/region.ts` (default `AE`)                                              |

`.env*` files are git-ignored (except `.env.example`). **Never** expose `SUPABASE_SERVICE_ROLE_KEY`: it must never get a `NEXT_PUBLIC_` prefix or be imported by client code. Phase 1 does not use it.

---

## Supabase

### Project setup (hosted)

1. Create one Supabase project (shared by admin and storefront).
2. Copy the URL and publishable key into `.env.local`.
3. Link and push migrations:
   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push            # applies supabase/migrations/*
   npm run db:types                # optional: regenerate TS types from the live schema
   ```
4. Seed **development** projects only: run `supabase/seed.sql` in the SQL editor (or `npx supabase db push --include-seed`). Never seed production.
5. Auth → URL Configuration: set Site URL / redirect URLs to your admin domain(s).

### Local stack (optional, needs Docker)

```bash
npx supabase start      # local Postgres/Auth/Storage
npx supabase db reset   # applies migrations + seed.sql
```

Use the printed API URL and publishable (or anon) key in `.env.local`.

### Migrations

All schema changes are migrations; never edit production tables by hand.

| #   | File                             | Contents                                                                                                                                                                                                       |
| --- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 001 | `…01_extensions_and_helpers.sql` | `private` schema (not exposed by the API), `set_updated_at()` trigger                                                                                                                                          |
| 002 | `…02_enums_and_domains.sql`      | `user_role` (ADMIN, CUSTOMER), `order_status`; domains `money_amount` (NUMERIC(14,3) ≥ 0), `currency_code` (ISO 4217), `country_code` (ISO 3166-1)                                                             |
| 003 | `…03_profiles.sql`               | `profiles` (1:1 `auth.users`), auto-created CUSTOMER profile on signup                                                                                                                                         |
| 004 | `…04_categories.sql`             | `categories` (unique slug, active flag, sort order)                                                                                                                                                            |
| 005 | `…05_products.sql`               | `products` (unique slug & SKU, NUMERIC prices, explicit currency, compare-at > price)                                                                                                                          |
| 006 | `…06_product_images.sql`         | `product_images` (path must be `products/{product_id}/…`, one primary image per product)                                                                                                                       |
| 007 | `…07_inventory.sql`              | `inventory` (one row per product, auto-created; quantity ≥ reserved ≥ 0)                                                                                                                                       |
| 008 | `…08_addresses.sql`              | international `addresses` (only universal fields required; one default per user)                                                                                                                               |
| 009 | `…09_orders.sql`                 | `orders` (immutable JSONB address snapshots, total = subtotal − discount + shipping + tax)                                                                                                                     |
| 010 | `…10_order_items.sql`            | `order_items` (name/SKU/price snapshots; currency must equal the order's)                                                                                                                                      |
| 011 | `…11_rls_policies.sql`           | `is_admin()`, profile privilege-escalation guard, explicit GRANTs, all RLS policies                                                                                                                            |
| 012 | `…12_storage.sql`                | `product-images` bucket + admin-only write policies                                                                                                                                                            |
| 013 | `…13_service_role_grants.sql`    | Explicit `service_role` grants on `profiles` for admin account provisioning                                                                                                                                    |
| 014 | `…14_catalogue_management.sql`   | `categories.image_path`, `category-images` bucket + admin-only policies, image RPCs (set primary / reorder / delete), `products.updated_at` index                                                              |
| 015 | `…15_inventory_management.sql`   | `inventory.low_stock_threshold`, `inventory_adjustments` (append-only history), `inventory_overview` view, `adjust_inventory()` / `inventory_summary()` / `initialize_inventory()`, tightened inventory grants |

Design notes:

- **Money** is never floating point. Scale 3 also covers KWD/BHD/OMR.
- **Soft delete**: categories and products are deactivated (`is_active = false`). API roles have no DELETE grant on them, and an ordered product cannot be hard-deleted.
- **Orders** cannot be inserted by API roles; admins can only update `status`. Checkout (later phase) will create orders through a server-side `SECURITY DEFINER` function that prices items from the database.
- **Localisation of catalogue text** can be added later as `*_translations` tables without changing these tables.
- New tables must add explicit `GRANT`s and RLS policies (011 shows the pattern). Access never depends on Supabase's "auto-expose new tables" setting.

### Seed data

`supabase/seed.sql` creates 2 categories, 3 products (AED) and their inventory, all prefixed `[DEV]` / `dev-`. It creates no users and contains no real data.

### Creating admin accounts

Admins are never created by self-signup, email allow-lists or signup metadata. Both flows below create a confirmed user with the Auth admin API (service role, server-only — `lib/supabase/admin.ts`) and then promote its profile to ADMIN (`lib/auth/admins.ts`). If promotion fails, the new user is deleted again.

Server environment (see `.env.example`): `SUPABASE_SERVICE_ROLE_KEY` (never `NEXT_PUBLIC_`), plus `ADMIN_SETUP_TOKEN` for first-time setup.

**First admin — `/[lang]/setup`**

1. Set `ADMIN_SETUP_TOKEN` (`openssl rand -hex 16`) and restart.
2. Open `/en/setup`, enter the setup key, name, email and password. You are signed straight into `/admin`.
3. The page locks itself once any ADMIN profile exists. Remove `ADMIN_SETUP_TOKEN` afterwards.

**More admins — Admins section (`/[lang]/admin/admins`)**

Signed-in admins see all administrators and can add one (name, email, password); the new admin can sign in immediately. Promotion runs through the caller's own session, so RLS and the profiles guard trigger re-check that the caller is an active admin.

**Without the UI:** Supabase Dashboard → Authentication → Users → Add user (auto-confirm), then in the SQL editor:

```sql
update public.profiles
set role = 'ADMIN'
where id = (select id from auth.users where email = 'you@your-domain.com');
```

### Authentication

- **Login** (`/[lang]/login`, Server Action `signIn` in `lib/auth/actions.ts`): email + password via Supabase Auth.
  - Validation runs on the client for instant feedback (`lib/auth/validation.ts`) and again on the server: email required + valid format, password required.
  - Error messages are mapped to safe, translated codes. Raw Supabase errors are only logged server-side.

    | Situation                                           | Message                                                                      |
    | --------------------------------------------------- | ---------------------------------------------------------------------------- |
    | Wrong password **or** unknown email                 | One generic "Incorrect email or password" (no user enumeration)              |
    | Email not verified                                  | "Email not verified" (Supabase only reports this after the password matched) |
    | Deactivated account (`is_active = false`) or banned | "Account deactivated"                                                        |
    | Valid user without the ADMIN role                   | "No access to Mirna Admin"                                                   |
    | Rate limited                                        | "Too many attempts"                                                          |
    | Browser offline / Supabase unreachable              | "Can't reach the server"                                                     |
    | Anything else                                       | Generic "couldn't sign you in"                                               |

  - After a successful password check, the action reads `profiles.role` and `profiles.is_active`. Anyone who is not an active ADMIN is **signed straight back out**, so no non-admin session is left in the admin app.
  - **One request at a time:** the button is disabled with a spinner while pending, and repeated clicks or Enter presses are ignored.
  - "Remember session" is not offered: Supabase SSR sessions are cookie-based and refresh automatically, so every session persists until sign-out or expiry.
- **Sessions** live in **HTTP cookies** managed by `@supabase/ssr`. Tokens are never copied into localStorage, sessionStorage or IndexedDB. They survive refresh, navigation and PWA relaunch.
- **Redirects** (`proxy.ts`, optimistic and session-only):
  - signed out + `/[lang]/admin/*` → `/[lang]/login?redirect=<that path>`. After login the user lands back on that page. `?redirect=` is validated to same-locale admin paths, so there are no open redirects.
  - signed in + `/[lang]/login` → `/[lang]/admin`.
- **Authorization** (`lib/auth/dal.ts`, the real boundary):
  - `getCurrentUser()` verifies the JWT (`getClaims()`) and reads the profile once per request (memoised with React `cache`). The shell, user menu and page share that one query.
  - `requireAdmin()` lets through only `role = ADMIN` **and** `is_active = true`; everyone else goes to `/[lang]/access-denied`. The admin layout and **every admin page** call it (layouts don't re-render on client navigation). Every future Server Action must call it too.
  - `/[lang]/access-denied` explains _why_ (no permission vs. deactivated) and offers only **Sign out**, so there is no redirect loop.
  - RLS remains the final guard: even with a forged UI, the database rejects non-admin writes.
- **Logout** (`signOut` Server Action): `supabase.auth.signOut({ scope: "local" })` clears the auth cookies, then redirects to `/[lang]/login`. The button shows a pending state and can't be double-submitted. Refresh, Back, or a bookmarked admin URL afterwards all land on login.

### Row Level Security

RLS is enabled on every table. Explicit grants give least privilege, and policies narrow the rows.

| Table                    | anon                        | customer (authenticated)                     | active ADMIN                                   |
| ------------------------ | --------------------------- | -------------------------------------------- | ---------------------------------------------- |
| profiles                 | —                           | read/update **own** (not `role`/`is_active`) | read all, change others' role/status           |
| categories, products     | read active                 | read active                                  | read all, insert, update (no delete)           |
| product_images           | read if product active      | same                                         | full                                           |
| inventory                | —                           | —                                            | read, insert, update                           |
| addresses                | —                           | full CRUD on **own**                         | read all                                       |
| orders                   | —                           | read **own**                                 | read all, update `status` only                 |
| order_items              | —                           | read items of **own** orders                 | read all                                       |
| storage `product-images` | public read (public bucket) | no writes                                    | upload/replace/delete under `products/{uuid}/` |

Role protection:

- `private.is_admin()` is `SECURITY DEFINER` (avoids recursive policies on `profiles`), lives in a non-exposed schema, and requires `is_active`.
- The `profiles_guard_update` trigger blocks any API-role change to `role`/`is_active` unless the caller is an active admin, and never on their own row. Signup metadata is never used for the role.

### Storage

| Bucket            | Path                                  | Read   | Write       | Limits                     |
| ----------------- | ------------------------------------- | ------ | ----------- | -------------------------- |
| `product-images`  | `products/{product-id}/{uuid}.ext`    | public | admins only | 5 MB, JPEG/PNG/WebP (AVIF) |
| `category-images` | `categories/{category-id}/{uuid}.ext` | public | admins only | 5 MB, JPEG/PNG/WebP        |

Anonymous and customer uploads are rejected by Storage RLS policies (migrations 012, 014). The database stores the object path (`product_images.storage_path`, `categories.image_path`) and its public URL, never image bytes.

---

## Admin shell

```text
┌──────────┬───────────────────────────────────────────────┐
│ Sidebar  │ Header: ☰ · Dashboard › Products · EN/ع · ☀ · 👤 │
│ (md+)    ├───────────────────────────────────────────────┤
│          │ Main content                                  │
└──────────┴───────────────────────────────────────────────┘
```

- **Sections** are defined once in `config/admin-nav.ts`: Dashboard, **Catalogue** (Categories, Products), **Inventory** (Stock levels), Orders, Customers, Admins, Settings (+ Profile from the user menu). Sections with the same `group` render under one sidebar heading. That file drives the sidebar, the mobile drawer, breadcrumbs, page titles and the placeholder route.
- **Collapsible sidebar** (md+): collapses to an icon rail; collapsed items show their label as a tooltip. The choice is stored in a cookie and applied before first paint (`lib/sidebar.ts`).
- **Language / theme** are header popovers (`LocaleMenu`, `ThemeMenu`).
- **Placeholders:** Orders, Customers and Settings render "Coming soon" through `app/[lang]/admin/[section]`. To build a real section, add its own folder (e.g. `app/[lang]/admin/products/`), which takes precedence over `[section]`, and set `available: true`.
- **Active navigation** is derived from the URL, so nested routes (`/admin/products/…`) highlight their section automatically.
- **Breadcrumbs** are generated from the route (`Dashboard › Products`). On phones only the current page title is shown.
- **Mobile (< 768 px):** the sidebar becomes a `Sheet` (native modal `<dialog>`). It traps focus, closes with Escape, the backdrop, a route change, or when the viewport grows to desktop size. It slides in from the right in Arabic. The language and theme switchers move into the drawer.
- **User menu** (`Dropdown`): name/email, role, Profile and Settings (placeholders), theme, Sign out. Escape or an outside click closes it and focus returns to the trigger.
- **Page titles** use the `%s | Mirna Admin` template (`Dashboard | Mirna Admin`, localized in Arabic).
- **Loading:** pages stream in behind a skeleton (`admin/loading.tsx`); the user menu shows an avatar placeholder until the session is verified.
- **Dashboard** shows a welcome, the signed-in account, workspace settings (locale, currency, timezone) and section shortcuts. It deliberately shows **no business metrics** until real data exists.

## Catalogue (Phase 3)

Routes (all under `/[lang]/admin`, all require an active ADMIN):

| Route            | Purpose                                                                |
| ---------------- | ---------------------------------------------------------------------- |
| `/categories`    | List, search, filter, create/edit (dialog), activate/deactivate, image |
| `/products`      | List, search, filter by category/status, paginate, activate/deactivate |
| `/products/new`  | Create a product                                                       |
| `/products/[id]` | Overview + edit form + image management + activate/deactivate          |

### Data flow

- **Reads** (`lib/catalogue/queries.ts`, server-only) run in Server Components with the signed-in user's Supabase client, so RLS decides visibility. Each list is **one query**: search (`ILIKE` on name/slug, plus SKU for products), filters and pagination (`range` + exact count) run in PostgreSQL. Category product counts come from an embedded `products(count)` aggregate in the same query (no N+1). The product list embeds only the primary image. `getProduct` and the category options are memoised per request with React `cache`, so the page and its components share one query each.
- **Writes** (`lib/catalogue/actions.ts`) are Server Actions. Each re-checks that the caller is an active admin, validates with the same rules as the forms (`lib/catalogue/validation.ts`), writes through the caller's session (RLS + constraints are final) and maps database errors to translated messages (raw errors are only logged).
- **List state lives in the URL** (`?q=&status=&category=&page=`): shareable, back/forward friendly. The toolbar debounces typing (350 ms), searches immediately on Enter, skips navigations that wouldn't change the URL, and resets to page 1 on any filter change. Page sizes: 25 categories, 20 products. Default product order: `updated_at desc`.

### Categories

- Fields: name, slug, description, image, sort order (lower first), active.
- **Slug** is generated from the name (`Men's Shoes` → `mens-shoes`) until the admin edits it; an existing slug is never overwritten automatically. Changing it shows a warning (storefront URLs; no redirects yet). Duplicates are rejected: "A category with this slug already exists."
- **Image** (optional): uploaded with the form; type checked by file signature (JPEG/PNG/WebP), ≤ 5 MB. The new file is uploaded first, then linked, then the old file deleted; failures are reported, never silently ignored.
- **Status**: Active ↔ Inactive (`is_active`), deactivation asks for confirmation. Categories are never deleted.

### Products

- Fields: name, slug (auto, editable), SKU (unique), category (required, active ones; a product's existing inactive category stays selectable), short description, description (plain textarea), price, compare-at price, currency, active. **No inventory, order or payment fields** (later phases).
- **Money**: amounts stay exact decimal strings from input to PostgreSQL `NUMERIC(14,3)` (no floating point). Input accepts Arabic-Indic digits; decimals are limited to the currency's precision (AED 2). Compare-at price is optional and must be **higher** than the price (matches the existing `products_compare_at_price_gt_price` constraint). Display always uses `formatCurrency()` (`lib/format.ts`, `Intl.NumberFormat`), e.g. `AED 199.00`.
- **Currency**: choices come from `supportedCurrencies` in `config/region.ts` (every configured market's currency; AED today), the default from `activeRegion`. Nothing hard-codes AED.
- **Create flow**: save → product page, where images can be added (images need the product id for their Storage path).
- **Concurrency**: forms save only if the record still has the `updated_at` they loaded; otherwise the admin is asked to reload instead of overwriting someone else's change. Without unsaved edits, the product form reloads itself when a newer version arrives.
- **Unsaved changes**: leaving the page with unsaved edits triggers the browser's confirmation.

### Product images

- Upload by click or drag and drop (multiple files, uploaded one at a time with per-file status). Client checks type/size instantly; the server re-checks the real file signature.
- First image becomes primary automatically. **Set primary**, **reorder** (move earlier/later — works with keyboard and touch) and **delete** run in PostgreSQL functions inside one transaction each, so there is never more than one primary image (also enforced by a unique partial index). Deleting the primary promotes the next image.
- Delete removes the row, then the Storage file; if the file can't be removed the admin is told.
- Alt text per image (≤ 300 chars) for accessibility and storefront SEO.
- Thumbnails use `next/image` (resized copies via `images.remotePatterns` for this project's public Storage URLs), so lists never download originals.

### Catalogue security

| Who       | Categories / products / images                  | Storage uploads |
| --------- | ----------------------------------------------- | --------------- |
| Anonymous | read **active** rows only; no writes (no grant) | denied          |
| CUSTOMER  | read active rows only; no writes (RLS)          | denied          |
| ADMIN     | read all, create, update, activate/deactivate   | allowed         |

No DELETE grant exists for categories/products. Image RPCs run as the caller (`SECURITY INVOKER`) and also check `is_admin()`. The service-role key is not used by the catalogue.

### Manual test checklist

Categories: create, edit, search, filter, activate, deactivate, duplicate slug rejected, image upload/replace/remove.
Products: create, edit, search (name/SKU/slug), filter by category and status, pagination, duplicate SKU and slug rejected, activate, deactivate.
Images: upload, preview, set primary, reorder, alt text, delete, invalid type rejected, > 5 MB rejected.
Repeat in English/Arabic, light/dark, at 320–1920 px, and in the installed PWA.

## Inventory (Phase 4)

Route: `/[lang]/admin/inventory` (sidebar group **Inventory → Stock levels**) and `/[lang]/admin/inventory/[productId]` (one product's stock and history). Active ADMIN only.

### Schema

| Object                                           | Purpose                                                                                                                                                                                                                    |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inventory` (007 + 015)                          | One row per product (`UNIQUE(product_id)`, auto-created by a trigger on product insert). `quantity >= reserved_quantity >= 0`, integer only. New: `low_stock_threshold integer >= 0` (default 0).                          |
| `inventory_adjustments` (015)                    | Append-only history: type (`increase`/`decrease`/`set`), `quantity_before`, signed `adjustment_quantity`, `quantity_after` (CHECK before + change = after), reason (enum), notes, `created_by` → `profiles`, `created_at`. |
| `inventory_overview` (view, 015)                 | Products ⟕ inventory ⟕ category + primary image, with derived `available_quantity` and `stock_status`. `security_invoker` + `is_admin()` filter: returns nothing to non-admins.                                            |
| `adjust_inventory()` (015)                       | The only way to change `quantity`.                                                                                                                                                                                         |
| `inventory_summary()` / `initialize_inventory()` | Summary counts in one query / explicit creation of missing inventory rows.                                                                                                                                                 |

Nothing is duplicated: product name, SKU, category and image come through `product_id`; available quantity and status are computed.

### Stock rules

- `available = quantity − reserved_quantity` (never stored).
- Status: **Not configured** (no row) · **Out of stock** (available ≤ 0) · **Low stock** (0 < available ≤ threshold) · **In stock** (available > threshold). Threshold 0 = no low-stock alert. The same rule is in the view (SQL) and `lib/inventory/rules.ts` (UI previews).
- **Reserved stock** is displayed and respected (stock can never go below it) but not managed here: future order/checkout functions will change `reserved_quantity` server-side.

### Adjustment flow

`Adjust` (dialog) → Server Action `adjustStock` (re-checks the admin session, validates) → RPC `adjust_inventory()` which, in **one transaction**:

1. checks `is_admin()` (SECURITY DEFINER, so this is the authorization),
2. locks the inventory row (`SELECT … FOR UPDATE`) — concurrent adjustments queue instead of overwriting,
3. computes the new quantity in the database (increase / decrease relative to the locked value; **set** is refused if the stock changed since the admin opened the dialog),
4. rejects: quantity < 0 or non-integer, 0 for increase/decrease, result < 0, result < reserved, no change, missing notes for reason "Other",
5. inserts the history row (`created_by = auth.uid()`, never a client value) and updates the stock.

Any failure rolls back both. The UI shows success only after the database committed (no optimistic updates), then `refresh()` re-renders the list, summary and history. If the request can't reach the server, the admin is told nothing was changed.

Reasons: Stock received, Stock count correction, Damaged, Lost, Returned, Manual correction, Other (notes required).

### Security

| Who       | `inventory`                                 | `inventory_adjustments` | `inventory_overview` / functions |
| --------- | ------------------------------------------- | ----------------------- | -------------------------------- |
| Anonymous | no access                                   | no access               | no access (no grant)             |
| CUSTOMER  | no rows (RLS)                               | no rows (RLS)           | empty / "forbidden"              |
| ADMIN     | read; update **only** `low_stock_threshold` | read (append via RPC)   | full                             |

API roles have no INSERT/UPDATE on `inventory` quantities and no write access to history at all, so stock cannot change without a history entry. The service-role key is not used.

### Performance

List, filters (category, stock status, product status), search (name/SKU) and pagination (25/page) run in one query on the view; the summary is one RPC; history is paginated (20/page) using index `inventory_adjustments(product_id, created_at desc)`. The service worker never caches pages, data or Server Actions, and there is no offline editing.

### Testing inventory

1. `npx supabase db push` (applies 015).
2. Inventory list: search, filter by category / stock / product status, pagination, summary tiles (click to filter).
3. Adjust: increase, decrease, set; try 0, decimals, negative, below reserved (set `reserved_quantity` with SQL to test), "Other" without notes.
4. History: every successful adjustment adds one row with correct before/change/after, reason and admin; failed ones add none.
5. Threshold: 0, positive, negative and decimal (rejected); status changes accordingly.
6. Two tabs: "Set" in both — the second is refused with a "stock changed" message.

## Internationalization

| Locale         | Language | Direction |
| -------------- | -------- | --------- |
| `en` (default) | English  | LTR       |
| `ar`           | Arabic   | RTL       |

- URLs are locale-prefixed (`/en/admin`, `/ar/admin`). `proxy.ts` sends unprefixed URLs to the saved locale (`NEXT_LOCALE` cookie), then `Accept-Language`, then the region default.
- The root layout sets `<html lang dir>` from the locale, so every component mirrors automatically. There are no Arabic-specific components.
- Server Components: `getMessages()` / `getLocale()` (`lib/i18n/server.ts`). Client Components: `useI18n()`.
- Layout uses logical utilities (`ms-*`, `ps-*`, `border-e`, `start-*`, `text-start/end`) so it mirrors in RTL.
- The language switcher (header, drawer, login page) keeps the current route: `/en/admin/orders` ⇄ `/ar/admin/orders`. Icons that indicate direction (sign-out, breadcrumb chevrons, the sign-in arrow) mirror in RTL; other icons don't.
- **Add a language:** add the code to `config/i18n.ts` (with its direction), create `messages/<code>.json` with the same keys as `en.json` (TypeScript enforces this), and register it in `lib/i18n/messages.ts`.

## Regional configuration

`config/region.ts` is the single source for country, currency, default locale and timezone. Today: `AE` / `AED` / `en` / `Asia/Dubai`.

- Format money with `formatCurrency(amount, currencyCode, locale)` and dates with `formatDateTime(date, locale)` (`lib/format.ts`). Don't hard-code symbols, decimals or `AED` in components.
- Products and orders store `currency_code` explicitly. No currency conversion is done.
- Tax is stored per order (`orders.tax`). Rates are not hard-coded anywhere.

## Theme

**Light**, **Dark** and **System** (follows the OS).

- Tokens in `app/globals.css` (`background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `border`, `input`, `ring`, `success`, `warning`, `error`, each with `-foreground` where relevant), exposed to Tailwind as `bg-primary`, `text-muted-foreground`, etc. Use tokens, not raw hex values.
- The choice is stored in a `theme` cookie and applied by an inline `<head>` script before first paint (no flash), in the browser and in the installed PWA. "System" removes `data-theme` so `prefers-color-scheme` applies.
- The switcher appears on the login page, in the header (desktop), in the user menu and in the mobile drawer. All of them use the same cookie and stay in sync.
- All token pairs meet WCAG AA contrast in both themes.

## PWA

- **Manifest**: `app/manifest.ts` → `/manifest.webmanifest` (`start_url: /admin`, `display: standalone`, `orientation: any`, theme/background colors, 192/512/maskable icons).
- **Icons**: `public/icons/`. **These are temporary development icons (marked "DEV").** Replace them with final brand assets (192, 512, maskable 512, apple-touch 180) before launch.
- **Service worker**: `public/sw.js`, registered only in production builds.
  - Caches only hashed build assets (`/_next/static/*`), icons and `offline.html`.
  - **Never caches** HTML pages, RSC payloads, Server Actions, non-GET requests or any cross-origin request. That covers all Supabase Auth/REST/Storage traffic: tokens, orders, inventory, customer data.
  - Offline navigations show `offline.html`. There's no offline data sync; the server stays authoritative.
  - Bump `VERSION` in `sw.js` to purge old caches.
  - Because pages are never cached, sign-in and sign-out behave the same in the installed app as in the browser. After logout, relaunching the PWA opens `/admin` and the server redirects to login.
  - No custom install prompt yet. Browsers offer installation natively, and a future banner can hook into `beforeinstallprompt`.
- **Safe areas**: `viewport-fit=cover` plus `pt-safe` / `pb-safe` / `px-safe` utilities (notch, Dynamic Island, home indicator).
- **Local development**: the service worker is disabled in `npm run dev`. Test it with `npm run build && npm start` on `http://localhost` (a secure context). Installing on a phone needs **HTTPS**, either a deployed URL or `next dev --experimental-https` / a tunnel. Production must be served over HTTPS.

## Security summary

- RLS on every table; database policies are the security boundary, and UI checks are only UX.
- Roles come only from `profiles.role`; no email-based authorization; no client-side role escalation (trigger + grants).
- Cookie-based sessions via `@supabase/ssr`; no manual token storage.
- Only the public URL and publishable key reach the browser.
- Storage writes are admin-only and path-restricted.
- Raw auth/database errors are logged server-side and never shown to users.
- Security headers (`nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`); admin pages are `noindex`.

## Future architecture

`mirna-storefront` (separate repo) will use this same Supabase project:

- Anonymous catalogue reads already work through the existing RLS policies (active categories/products/images).
- Customers will sign up via Supabase Auth and get CUSTOMER profiles automatically; they can only see their own profile, addresses and orders.
- Checkout will be a server-side `SECURITY DEFINER` RPC (added here as a migration) that reads prices from `products`, reserves inventory and writes the order with address snapshots.
