import { Boxes, History, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CatalogueImage } from "@/components/catalogue/catalogue-image";
import { ListToolbar } from "@/components/catalogue/list-toolbar";
import { Pagination } from "@/components/catalogue/pagination";
import { AdjustStockDialog, type AdjustableItem } from "@/components/inventory/adjust-stock-dialog";
import { InitializeButton } from "@/components/inventory/initialize-button";
import { StockStatusBadge } from "@/components/inventory/stock-status-badge";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PageSkeleton } from "@/components/ui/states";
import { requireAdmin } from "@/lib/auth/dal";
import { listCategoryOptions } from "@/lib/catalogue/queries";
import {
  getInventorySummary,
  listInventory,
  parseInventoryParams,
  type InventoryRow,
} from "@/lib/inventory/queries";
import { STOCK_STATUSES } from "@/lib/inventory/rules";
import { formatDateTime } from "@/lib/format";
import { format } from "@/lib/i18n/messages";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { getStoreRegion } from "@/lib/settings/queries";
import { cn } from "@/lib/utils/cn";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.inventory.title };
}

// Session + search params are read behind <Suspense> so navigations show the
// skeleton instantly (Cache Components); requireAdmin() guards the content.
export default async function InventoryPage({
  searchParams,
}: PageProps<"/[lang]/admin/inventory">) {
  const messages = await getMessages();
  return (
    <Suspense fallback={<PageSkeleton label={messages.common.loading} />}>
      <Inventory searchParams={searchParams} />
    </Suspense>
  );
}

function adjustable(row: InventoryRow): AdjustableItem | null {
  if (row.inventory_id === null) return null;
  return {
    productId: row.product_id,
    name: row.name,
    sku: row.sku,
    quantity: row.quantity ?? 0,
    reserved: row.reserved_quantity ?? 0,
    threshold: row.low_stock_threshold ?? 0,
  };
}

async function Inventory({
  searchParams,
}: Pick<PageProps<"/[lang]/admin/inventory">, "searchParams">) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  await requireAdmin(locale);
  const { timezone: timeZone } = await getStoreRegion();
  const params = parseInventoryParams(await searchParams);

  // Three independent queries, in parallel: rows, summary, category filter options.
  const [result, summary, categories] = await Promise.all([
    listInventory(params),
    getInventorySummary(params.product !== "active"),
    listCategoryOptions(),
  ]);

  const listParams = {
    q: params.q,
    stock: params.stock,
    category: params.category,
    product: params.product === "active" ? "" : params.product,
    view: params.view === "grid" ? "grid" : "",
  };
  const basePath = `/${locale}/admin/inventory`;
  // Past the last page (e.g. after a filter change): go to the last one.
  if (result.rows.length === 0 && result.total > 0) {
    const query = new URLSearchParams(Object.entries(listParams).filter(([, value]) => value));
    if (result.pageCount > 1) query.set("page", String(result.pageCount));
    redirect(`${basePath}${query.size ? `?${query}` : ""}`);
  }

  const t = messages.inventory;
  const filtered =
    Boolean(params.q || params.stock || params.category) || params.product !== "active";
  const date = (value: string | null) =>
    value ? formatDateTime(value, locale, { dateStyle: "medium" }, timeZone) : "—";
  const number = (value: number | null) => (value === null ? "—" : value.toLocaleString(locale));
  const historyHref = (row: InventoryRow) => `${basePath}/${row.product_id}`;
  const filterHref = (stock: string) => {
    const query = new URLSearchParams(
      Object.entries({ ...listParams, stock }).filter(([, value]) => value),
    );
    return query.size ? `${basePath}?${query}` : basePath;
  };

  const tiles = [
    { key: "", label: t.summary.products, value: summary.totalProducts, tone: "" },
    { key: "in_stock", label: t.status.in_stock, value: summary.inStock, tone: "text-success" },
    { key: "low_stock", label: t.status.low_stock, value: summary.lowStock, tone: "text-warning" },
    {
      key: "out_of_stock",
      label: t.status.out_of_stock,
      value: summary.outOfStock,
      tone: "text-error",
    },
  ];

  const actions = (row: InventoryRow) => {
    const item = adjustable(row);
    if (!item) return <InitializeButton productId={row.product_id} label={t.initialize} />;
    return (
      <>
        <AdjustStockDialog compact item={item} />
        <Link
          href={historyHref(row)}
          aria-label={format(t.history.linkNamed, { name: row.name })}
          title={t.history.link}
          className={buttonClassName({ variant: "outline", size: "icon-sm" })}
        >
          <History aria-hidden />
        </Link>
      </>
    );
  };
  const product = (row: InventoryRow, size: "sm" | "md") => (
    <Link href={historyHref(row)} className="group flex min-w-0 items-center gap-3">
      <CatalogueImage
        src={row.image_url}
        alt=""
        sizes={size === "sm" ? "40px" : "48px"}
        className={size === "sm" ? "size-10" : "size-12"}
      />
      <span className="min-w-0">
        <span className="line-clamp-1 font-medium group-hover:underline">
          <bdi>{row.name}</bdi>
        </span>
        <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          {size === "sm" ? (
            <span className="line-clamp-1">
              {row.category_name ? (
                <bdi>{row.category_name}</bdi>
              ) : (
                messages.catalogue.products.noCategory
              )}
            </span>
          ) : (
            <span className="font-mono" dir="ltr">
              {row.sku}
            </span>
          )}
          {!row.product_active && <Badge className="py-0">{t.productInactive}</Badge>}
        </span>
      </span>
    </Link>
  );

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t.title}</h1>
          <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">{t.subtitle}</p>
        </div>
        {summary.unconfigured > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {format(t.initializeAllBody, { count: summary.unconfigured })}
            </span>
            <InitializeButton label={t.initializeAll} />
          </div>
        )}
      </div>

      {/* Summary: each tile filters the list. */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((tile) => (
          <Link
            key={tile.key || "all"}
            href={filterHref(tile.key)}
            aria-current={params.stock === tile.key ? "true" : undefined}
            className={cn(
              "rounded-xl border bg-card px-3 py-2.5 transition-colors hover:border-primary/40",
              params.stock === tile.key && "border-foreground",
            )}
          >
            <span className="caps block text-[0.625rem] text-muted-foreground">{tile.label}</span>
            <span className={cn("block text-xl font-semibold tabular-nums", tile.tone)}>
              {tile.value.toLocaleString(locale)}
            </span>
          </Link>
        ))}
        <div className="rounded-xl border bg-card px-3 py-2.5">
          <span className="caps block text-[0.625rem] text-muted-foreground">
            {t.summary.units}
          </span>
          <span className="block text-xl font-semibold tabular-nums">
            {summary.totalUnits.toLocaleString(locale)}
          </span>
        </div>
        <div className="rounded-xl border bg-card px-3 py-2.5">
          <span className="caps block text-[0.625rem] text-muted-foreground">
            {t.summary.reserved}
          </span>
          <span className="block text-xl font-semibold tabular-nums">
            {summary.reservedUnits.toLocaleString(locale)}
          </span>
        </div>
      </div>

      <ListToolbar
        viewToggle
        searchLabel={t.searchLabel}
        searchPlaceholder={t.searchPlaceholder}
        filters={[
          {
            name: "category",
            label: messages.catalogue.products.categoryFilter,
            options: [
              { value: "", label: messages.catalogue.products.allCategories },
              ...categories.map((option) => ({ value: option.id, label: option.name })),
            ],
          },
          {
            name: "stock",
            label: t.filters.stock,
            options: [
              { value: "", label: t.filters.stockAll },
              ...STOCK_STATUSES.map((status) => ({ value: status, label: t.status[status] })),
            ],
          },
          {
            name: "product",
            label: t.filters.product,
            options: [
              { value: "", label: t.filters.productActive },
              { value: "inactive", label: t.filters.productInactive },
              { value: "all", label: t.filters.productAll },
            ],
          },
        ]}
      />

      {result.total === 0 ? (
        <Card>
          {filtered ? (
            <EmptyState icon={SearchX} title={t.noMatchTitle} description={t.noMatchBody} />
          ) : (
            <EmptyState icon={Boxes} title={t.emptyTitle} description={t.emptyBody} />
          )}
        </Card>
      ) : params.view === "grid" ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {result.rows.map((row) => (
            <li
              key={row.product_id}
              className="group flex flex-col overflow-hidden rounded-2xl border bg-card transition-colors hover:border-primary/40"
            >
              <Link href={historyHref(row)} className="relative block" tabIndex={-1} aria-hidden>
                <CatalogueImage
                  src={row.image_url}
                  alt=""
                  sizes="(min-width: 1280px) 230px, (min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                  className="w-full rounded-none border-0 border-b"
                />
                <span className="absolute start-2 top-2">
                  <StockStatusBadge status={row.stock_status} label={t.status[row.stock_status]} />
                </span>
              </Link>
              <div className="flex flex-1 flex-col gap-1 p-3">
                <Link
                  href={historyHref(row)}
                  className="line-clamp-2 text-sm leading-snug font-medium group-hover:underline"
                >
                  <bdi>{row.name}</bdi>
                </Link>
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span className="truncate font-mono" dir="ltr">
                    {row.sku}
                  </span>
                  {!row.product_active && <Badge className="py-0">{t.productInactive}</Badge>}
                </p>
                {row.inventory_id !== null ? (
                  <dl className="mt-1 grid grid-cols-3 gap-1 rounded-lg bg-muted/40 px-2 py-1.5 text-center">
                    <div>
                      <dt className="text-[0.6875rem] text-muted-foreground">
                        {t.columns.available}
                      </dt>
                      <dd className="text-sm font-semibold tabular-nums">
                        {number(row.available_quantity)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[0.6875rem] text-muted-foreground">{t.columns.stock}</dt>
                      <dd className="text-sm tabular-nums">{number(row.quantity)}</dd>
                    </div>
                    <div>
                      <dt className="text-[0.6875rem] text-muted-foreground">
                        {t.columns.reserved}
                      </dt>
                      <dd className="text-sm text-muted-foreground tabular-nums">
                        {number(row.reserved_quantity)}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">{t.notConfigured}</p>
                )}
                <div className="mt-auto flex justify-end gap-1.5 pt-2">{actions(row)}</div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <>
          {/* Tablet / desktop: table */}
          <div className="hidden overflow-hidden rounded-2xl border bg-card md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">{t.title}</caption>
              <thead className="caps border-b text-[0.625rem] text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 text-start font-medium">
                    {t.columns.product}
                  </th>
                  <th scope="col" className="hidden px-4 py-3 text-start font-medium lg:table-cell">
                    {t.columns.sku}
                  </th>
                  <th scope="col" className="px-3 py-3 text-end font-medium">
                    {t.columns.stock}
                  </th>
                  <th scope="col" className="px-3 py-3 text-end font-medium">
                    {t.columns.reserved}
                  </th>
                  <th scope="col" className="px-3 py-3 text-end font-medium">
                    {t.columns.available}
                  </th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">
                    {t.columns.status}
                  </th>
                  <th scope="col" className="hidden px-3 py-3 text-end font-medium xl:table-cell">
                    {t.columns.threshold}
                  </th>
                  <th scope="col" className="hidden px-4 py-3 text-start font-medium xl:table-cell">
                    {t.columns.updated}
                  </th>
                  <th scope="col" className="w-0 px-4 py-3">
                    <span className="sr-only">{t.columns.actions}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {result.rows.map((row) => (
                  <tr key={row.product_id} className="transition-colors hover:bg-accent/60">
                    <td className="max-w-xs px-4 py-2">{product(row, "sm")}</td>
                    <td
                      className="hidden px-4 py-2 font-mono text-xs whitespace-nowrap lg:table-cell"
                      dir="ltr"
                    >
                      {row.sku}
                    </td>
                    <td className="px-3 py-2 text-end tabular-nums">{number(row.quantity)}</td>
                    <td className="px-3 py-2 text-end text-muted-foreground tabular-nums">
                      {number(row.reserved_quantity)}
                    </td>
                    <td className="px-3 py-2 text-end font-semibold tabular-nums">
                      {number(row.available_quantity)}
                    </td>
                    <td className="px-4 py-2">
                      <StockStatusBadge
                        status={row.stock_status}
                        label={t.status[row.stock_status]}
                      />
                    </td>
                    <td className="hidden px-3 py-2 text-end text-muted-foreground tabular-nums xl:table-cell">
                      {number(row.low_stock_threshold)}
                    </td>
                    <td className="hidden px-4 py-2 whitespace-nowrap text-muted-foreground xl:table-cell">
                      {date(row.updated_at)}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-1.5">{actions(row)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phones: compact rows with the key numbers */}
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card md:hidden">
            {result.rows.map((row) => (
              <li key={row.product_id} className="grid gap-2 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1 text-sm">{product(row, "md")}</div>
                  <div className="flex shrink-0 gap-1.5">{actions(row)}</div>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <StockStatusBadge status={row.stock_status} label={t.status[row.stock_status]} />
                  {row.inventory_id !== null && (
                    <>
                      <span>
                        {t.columns.available}:{" "}
                        <span className="font-semibold text-foreground tabular-nums">
                          {number(row.available_quantity)}
                        </span>
                      </span>
                      <span>
                        {t.columns.stock}:{" "}
                        <span className="tabular-nums">{number(row.quantity)}</span>
                      </span>
                      <span>
                        {t.columns.reserved}:{" "}
                        <span className="tabular-nums">{number(row.reserved_quantity)}</span>
                      </span>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <Pagination
        basePath={basePath}
        params={listParams}
        page={result.page}
        pageCount={result.pageCount}
        pageSize={result.pageSize}
        total={result.total}
        labels={messages.catalogue.common}
      />
    </div>
  );
}
