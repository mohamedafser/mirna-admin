import {
  Banknote,
  Boxes,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  Layers,
  Package,
  PackageOpen,
  Plus,
  Receipt,
  ShoppingCart,
  Trophy,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Truck,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { SalesChart, type SalesChartPoint } from "@/components/dashboard/sales-chart";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { Alert } from "@/components/ui/alert";
import { buttonClassName } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/states";
import type { Locale } from "@/config/i18n";
import { requireAdmin } from "@/lib/auth/dal";
import {
  DASHBOARD_PERIODS,
  getDashboardSummary,
  listRecentOrders,
  listStockAlerts,
  parseDashboardPeriod,
  type CurrencySales,
  type DailySales,
  type DashboardPeriod,
} from "@/lib/dashboard/queries";
import { formatCurrency, formatDateTime, toIntlLocale } from "@/lib/format";
import { getInventorySummary, getVariantStockSummary } from "@/lib/inventory/queries";
import { format } from "@/lib/i18n/messages";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { getStoreRegion } from "@/lib/settings/queries";
import { cn } from "@/lib/utils/cn";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.nav.dashboard };
}

// Session + search params are read behind <Suspense> so navigations render
// the skeleton instantly (Cache Components instant-navigation rule);
// requireAdmin() still guards everything the inner component renders.
export default async function DashboardPage({ searchParams }: PageProps<"/[lang]/admin">) {
  const messages = await getMessages();
  return (
    <Suspense fallback={<PageSkeleton label={messages.common.loading} />}>
      <Dashboard searchParams={searchParams} />
    </Suspense>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Store-local YYYY-MM-DD of an instant. */
function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(date);
}

/** The last `days` days, oldest first, ending now. */
function periodDays(days: number): Date[] {
  const now = Date.now();
  return Array.from({ length: days }, (_, index) => new Date(now - (days - 1 - index) * DAY_MS));
}

function storeHour(timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(
      new Date(),
    ),
  );
}

/**
 * Period-over-period change, or null when there's nothing to compare with.
 * Display only: money stays exact text everywhere else.
 */
function change(current: number, previous: number): number | null {
  return previous > 0 ? (current - previous) / previous : null;
}

/** Store's currency first; otherwise the highest-revenue one. */
function primarySales(sales: CurrencySales[], storeCurrency: string): CurrencySales | undefined {
  return sales.find((row) => row.currency_code === storeCurrency) ?? sales[0];
}

/**
 * Admin home: what the store sold, what needs doing now (orders to confirm,
 * prepare and deliver; stock running out), and the latest activity.
 */
async function Dashboard({ searchParams }: Pick<PageProps<"/[lang]/admin">, "searchParams">) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  const user = await requireAdmin(locale);
  const region = await getStoreRegion();
  const timeZone = region.timezone;
  const period = parseDashboardPeriod((await searchParams).period);
  const days = DASHBOARD_PERIODS[period];

  const [summary, inventory, variants, recentOrders, stockAlerts] = await Promise.all([
    getDashboardSummary(period, timeZone),
    getInventorySummary(false),
    getVariantStockSummary(false),
    listRecentOrders(),
    listStockAlerts(),
  ]);

  const t = messages.admin.dashboard;
  const basePath = `/${locale}/admin`;
  const number = (value: number) => value.toLocaleString(toIntlLocale(locale));
  const money = (amount: number | string, currency: string) =>
    formatCurrency(amount, currency, locale);
  const percent = (value: number) =>
    new Intl.NumberFormat(toIntlLocale(locale), {
      style: "percent",
      maximumFractionDigits: 0,
      signDisplay: "exceptZero",
    }).format(value);

  const hour = storeHour(timeZone);
  const greeting =
    hour < 12 ? t.greeting.morning : hour < 18 ? t.greeting.afternoon : t.greeting.evening;
  const firstName = user.fullName?.trim().split(/\s+/)[0];

  // -------------------------------------------------------------------------
  // KPIs (store currency; other currencies are listed under revenue)
  // -------------------------------------------------------------------------
  const sales = summary ? primarySales(summary.sales, region.currencyCode) : undefined;
  const currency = sales?.currency_code ?? region.currencyCode;
  const otherSales = summary?.sales.filter((row) => row !== sales && Number(row.revenue) > 0);
  const revenue = Number(sales?.revenue ?? 0);
  const previousRevenue = Number(sales?.previous_revenue ?? 0);
  const orders = sales?.orders ?? 0;
  const previousOrders = sales?.previous_orders ?? 0;
  const average = orders > 0 ? revenue / orders : 0;
  const previousAverage = previousOrders > 0 ? previousRevenue / previousOrders : 0;
  const changeNote = (current: number, previous: number) => {
    const value = change(current, previous);
    return value === null
      ? { text: format(t.kpi.noPrevious, { days }) }
      : { text: format(t.kpi.change, { change: percent(value), days }), trend: value };
  };

  const kpis: Array<{
    key: string;
    label: string;
    icon: LucideIcon;
    value: string;
    note?: { text: string; trend?: number };
    extra?: string;
  }> = summary
    ? [
        {
          key: "revenue",
          label: t.kpi.revenue,
          icon: Banknote,
          value: money(revenue, currency),
          note: changeNote(revenue, previousRevenue),
          extra: otherSales?.length
            ? format(t.kpi.otherCurrencies, {
                amounts: otherSales.map((row) => money(row.revenue, row.currency_code)).join(" · "),
              })
            : format(t.kpi.today, { value: money(sales?.today_revenue ?? 0, currency) }),
        },
        {
          key: "orders",
          label: t.kpi.orders,
          icon: ShoppingCart,
          value: number(orders),
          note: changeNote(orders, previousOrders),
          extra: format(t.kpi.today, { value: number(sales?.today_orders ?? 0) }),
        },
        {
          key: "average",
          label: t.kpi.averageOrder,
          icon: Receipt,
          value: money(average, currency),
          note: changeNote(average, previousAverage),
        },
        {
          key: "customers",
          label: t.kpi.newCustomers,
          icon: UserPlus,
          value: number(summary.customers.new),
          note: changeNote(summary.customers.new, summary.customers.previous_new),
          extra: format(t.kpi.customersTotal, { count: number(summary.customers.total) }),
        },
      ]
    : [];

  // -------------------------------------------------------------------------
  // Daily revenue: one bar per store-local day, zero-filled
  // -------------------------------------------------------------------------
  const byDay = new Map<string, DailySales>(
    (summary?.daily ?? [])
      .filter((row) => row.currency_code === currency)
      .map((row) => [row.day, row]),
  );
  const points: SalesChartPoint[] = periodDays(days).map((date) => {
    const key = dayKey(date, timeZone);
    const row = byDay.get(key);
    return {
      key,
      label: formatDateTime(date, locale, { day: "numeric", month: "short" }, timeZone),
      value: Number(row?.revenue ?? 0),
      valueLabel: money(row?.revenue ?? 0, currency),
      ordersLabel: format(t.chart.orderCount, { count: number(row?.orders ?? 0) }),
    };
  });
  const hasSales = points.some((point) => point.value > 0);

  // -------------------------------------------------------------------------
  // Needs attention: the fulfilment queue and stock problems
  // -------------------------------------------------------------------------
  const statusCounts = summary?.statusCounts ?? {};
  const attention = [
    {
      key: "pending",
      label: t.attention.pending,
      count: statusCounts.PENDING ?? 0,
      icon: Clock,
      tone: "text-warning",
      href: `${basePath}/orders?status=PENDING`,
    },
    {
      key: "prepare",
      label: t.attention.toPrepare,
      count: statusCounts.CONFIRMED ?? 0,
      icon: PackageOpen,
      tone: "text-primary",
      href: `${basePath}/orders?status=CONFIRMED`,
    },
    {
      key: "processing",
      label: t.attention.processing,
      count: statusCounts.PROCESSING ?? 0,
      icon: CircleDashed,
      tone: "text-primary",
      href: `${basePath}/orders?status=PROCESSING`,
    },
    {
      key: "shipped",
      label: t.attention.shipped,
      count: statusCounts.SHIPPED ?? 0,
      icon: Truck,
      tone: "text-primary",
      href: `${basePath}/orders?status=SHIPPED`,
    },
    {
      key: "out",
      label: t.attention.outOfStock,
      count: inventory.outOfStock,
      icon: CircleX,
      tone: "text-error",
      href: `${basePath}/inventory?stock=out_of_stock`,
    },
    {
      key: "low",
      label: t.attention.lowStock,
      count: inventory.lowStock,
      icon: TriangleAlert,
      tone: "text-warning",
      href: `${basePath}/inventory?stock=low_stock`,
    },
    {
      key: "variants",
      label: t.attention.variantAlerts,
      count: variants.productsWithAlerts,
      icon: Layers,
      tone: "text-warning",
      href: `${basePath}/inventory?variants=attention`,
    },
  ].filter(
    (item) => summary || !["pending", "prepare", "processing", "shipped"].includes(item.key),
  );
  const allClear = attention.every((item) => item.count === 0);

  const orderTitle = messages.orders;

  return (
    <div className="mx-auto max-w-7xl">
      {/* Header: greeting, then the period filter and actions on one row */}
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">
          {formatDateTime(new Date(), locale, { dateStyle: "full" }, timeZone)}
        </p>
        <h1 className="mt-0.5 text-2xl font-semibold tracking-tight break-words sm:text-3xl">
          {firstName ? format(t.greeting.withName, { greeting, name: firstName }) : greeting}
        </h1>
        <p className="mt-1 text-muted-foreground">{t.subtitle}</p>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label={t.periodLabel}>
          <ul className="inline-flex rounded-xl border bg-card p-1 text-sm">
            {(Object.keys(DASHBOARD_PERIODS) as DashboardPeriod[]).map((key) => (
              <li key={key}>
                <Link
                  href={`${basePath}?period=${key}`}
                  aria-current={key === period ? "page" : undefined}
                  scroll={false}
                  className={cn(
                    "block rounded-lg px-3 py-1.5 font-medium whitespace-nowrap transition-colors",
                    key === period
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  {t.periods[key]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`${basePath}/orders`}
            className={buttonClassName({ variant: "outline", size: "sm" })}
          >
            <ShoppingCart aria-hidden />
            {t.viewOrders}
          </Link>
          <Link href={`${basePath}/products/new`} className={buttonClassName({ size: "sm" })}>
            <Plus aria-hidden />
            {t.addProduct}
          </Link>
        </div>
      </div>

      {!summary && (
        <Alert tone="warning" className="mt-4">
          {t.migrationMissing}
        </Alert>
      )}

      {/* KPIs */}
      {kpis.length > 0 && (
        <div className="mt-4 grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 sm:gap-4 xl:grid-cols-4">
          {kpis.map((kpi) => (
            <div key={kpi.key} className="flex min-w-0 flex-col rounded-2xl border bg-card p-4">
              <span className="flex items-start justify-between gap-2">
                <span className="caps text-[0.625rem] text-muted-foreground">{kpi.label}</span>
                <kpi.icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </span>
              <span className="mt-2 block text-xl leading-tight font-semibold break-words tabular-nums sm:text-2xl">
                {kpi.value}
              </span>
              {kpi.note && <TrendNote {...kpi.note} />}
              {kpi.extra && (
                <span className="mt-1 block text-xs text-muted-foreground">{kpi.extra}</span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        {/* Daily revenue */}
        {summary && (
          <Card className="flex flex-col xl:col-span-2">
            <CardHeader
              icon={Banknote}
              title={t.chart.title}
              description={format(t.chart.description, { days, currency })}
            />
            {hasSales ? (
              <SalesChart
                points={points}
                caption={t.chart.title}
                labels={{ day: t.chart.day, revenue: t.chart.revenue, orders: t.chart.orders }}
              />
            ) : (
              <p className="flex flex-1 items-center justify-center py-12 text-center text-sm text-muted-foreground">
                {t.chart.empty}
              </p>
            )}
          </Card>
        )}

        {/* Needs attention */}
        <Card className={cn(!summary && "xl:col-span-3")}>
          <CardHeader icon={TriangleAlert} title={t.attention.title} />
          {allClear ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CircleCheck aria-hidden className="size-4 text-success" />
              {t.attention.allClear}
            </p>
          ) : (
            <ul
              className={cn(
                "-mx-2",
                summary ? "divide-y" : "grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3",
              )}
            >
              {attention.map((item) => (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm transition-colors hover:bg-accent/60"
                  >
                    <item.icon
                      aria-hidden
                      className={cn(
                        "size-4 shrink-0",
                        item.count > 0 ? item.tone : "text-muted-foreground",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <span
                      className={cn(
                        "font-semibold tabular-nums",
                        item.count === 0 && "text-muted-foreground",
                      )}
                    >
                      {number(item.count)}
                    </span>
                    <ChevronRight
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground rtl:-scale-x-100"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        {/* Recent orders */}
        <Card className="xl:col-span-2">
          <CardHeader
            icon={ShoppingCart}
            title={t.recentOrders.title}
            action={<ViewAll href={`${basePath}/orders`} label={t.recentOrders.viewAll} />}
          />
          {recentOrders.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t.recentOrders.empty}</p>
          ) : (
            <ul className="-mx-2 divide-y">
              {recentOrders.map((order) => (
                <li key={order.id}>
                  <Link
                    href={`${basePath}/orders/${order.id}`}
                    aria-label={`${orderTitle.view} #${order.order_number}`}
                    className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm transition-colors hover:bg-accent/60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2">
                        <span className="font-medium tabular-nums">#{order.order_number}</span>
                        <span className="truncate text-muted-foreground">
                          <bdi>{order.customer_name || order.recipient || "—"}</bdi>
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {relativeDate(order.created_at, locale, timeZone)}
                      </span>
                    </span>
                    <span className="hidden sm:block">
                      <OrderStatusBadge
                        status={order.status}
                        label={orderTitle.status[order.status]}
                      />
                    </span>
                    <span className="text-end font-medium whitespace-nowrap tabular-nums">
                      {money(order.total, order.currency_code)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="grid content-start gap-4 md:grid-cols-2 xl:grid-cols-1">
          {/* Best sellers */}
          {summary && (
            <Card>
              <CardHeader
                icon={Trophy}
                title={t.topProducts.title}
                description={format(t.topProducts.description, { days })}
              />
              {summary.topProducts.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.topProducts.empty}</p>
              ) : (
                <ol className="space-y-2.5 text-sm">
                  {summary.topProducts.map((product, index) => {
                    const name = <bdi>{product.product_name}</bdi>;
                    return (
                      <li
                        key={product.product_id ?? `${product.product_name}-${index}`}
                        className="flex items-center gap-3"
                      >
                        <span className="w-4 shrink-0 text-xs text-muted-foreground tabular-nums">
                          {number(index + 1)}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {product.product_id ? (
                            <Link
                              href={`${basePath}/products/${product.product_id}`}
                              className="hover:underline"
                            >
                              {name}
                            </Link>
                          ) : (
                            name
                          )}
                        </span>
                        <span className="shrink-0 text-muted-foreground tabular-nums">
                          {format(t.topProducts.units, { count: number(product.units) })}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </Card>
          )}

          {/* Low stock */}
          <Card>
            <CardHeader
              icon={Boxes}
              title={t.stockAlerts.title}
              action={<ViewAll href={`${basePath}/inventory`} label={t.stockAlerts.viewAll} />}
            />
            {stockAlerts.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Package aria-hidden className="size-4 text-success" />
                {t.stockAlerts.empty}
              </p>
            ) : (
              <ul className="space-y-2.5 text-sm">
                {stockAlerts.map((item) => {
                  const out = item.stock_status === "out_of_stock";
                  return (
                    <li key={item.product_id} className="flex items-center gap-3">
                      {out ? (
                        <CircleX aria-hidden className="size-4 shrink-0 text-error" />
                      ) : (
                        <TriangleAlert aria-hidden className="size-4 shrink-0 text-warning" />
                      )}
                      <Link
                        href={`${basePath}/inventory/${item.product_id}`}
                        className="min-w-0 flex-1 truncate hover:underline"
                      >
                        <bdi>{item.name}</bdi>
                      </Link>
                      <span
                        className={cn(
                          "shrink-0 text-xs tabular-nums",
                          out ? "text-error" : "text-warning",
                        )}
                      >
                        {out
                          ? messages.inventory.status.out_of_stock
                          : format(t.stockAlerts.available, {
                              count: number(item.available_quantity ?? 0),
                            })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function TrendNote({ text, trend }: { text: string; trend?: number }) {
  const Icon = trend === undefined || trend === 0 ? null : trend > 0 ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "mt-1.5 flex min-w-0 items-start gap-1 text-xs",
        trend === undefined || trend === 0
          ? "text-muted-foreground"
          : trend > 0
            ? "text-success"
            : "text-error",
      )}
    >
      {Icon && <Icon aria-hidden className="mt-px size-3.5 shrink-0" />}
      <span>{text}</span>
    </span>
  );
}

function ViewAll({ href, label }: { href: string; label: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
    >
      {label}
      <ChevronRight aria-hidden className="size-3.5 rtl:-scale-x-100" />
    </Link>
  );
}

/** "5 minutes ago" for today's orders, the date otherwise. */
function relativeDate(value: string, locale: Locale, timeZone: string): string {
  const minutes = Math.round((Date.now() - Date.parse(value)) / 60000);
  if (minutes < 60 * 12) {
    const rtf = new Intl.RelativeTimeFormat(toIntlLocale(locale), { numeric: "auto" });
    return minutes < 60
      ? rtf.format(-minutes, "minute")
      : rtf.format(-Math.round(minutes / 60), "hour");
  }
  return formatDateTime(value, locale, undefined, timeZone);
}
