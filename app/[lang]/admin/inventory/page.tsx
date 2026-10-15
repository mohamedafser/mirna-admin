import {
  Boxes,
  CircleCheck,
  CircleX,
  History,
  Layers,
  Package,
  SearchX,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { CatalogueImage } from "@/components/catalogue/catalogue-image";
import { ListToolbar } from "@/components/catalogue/list-toolbar";
import { ListViews } from "@/components/catalogue/list-views";
import { ViewLink } from "@/components/catalogue/view-link";
import { Pagination } from "@/components/catalogue/pagination";
import { AdjustStockDialog, type AdjustableItem } from "@/components/inventory/adjust-stock-dialog";
import { ExpandableRows } from "@/components/inventory/expandable-rows";
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
  getVariantStockSummary,
  listInventory,
  listVariantStock,
  parseInventoryParams,
  type InventoryRow,
  type VariantStockRow,
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

/** Table columns (toggle + 9), for full-width detail rows. */
const COLUMN_COUNT = 10;

async function Inventory({
  searchParams,
}: Pick<PageProps<"/[lang]/admin/inventory">, "searchParams">) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  await requireAdmin(locale);
  const { timezone: timeZone } = await getStoreRegion();
  const params = parseInventoryParams(await searchParams);
  const includeInactive = params.product !== "active";

  // Independent queries, in parallel: rows, summaries, category filter options.
  const [result, summary, variantSummary, categories] = await Promise.all([
    listInventory(params),
    getInventorySummary(includeInactive),
    getVariantStockSummary(includeInactive),
    listCategoryOptions(),
  ]);
  // Stock per variant for the products on this page that have variants.
  const variantStock = await listVariantStock(
    result.rows.filter((row) => row.variant_count > 0).map((row) => row.product_id),
  );

  // Full path for subcategories ("Women › Winter").
  const categoryLabel = new Map(categories.map((option) => [option.id, option.name]));

  const listParams = {
    q: params.q,
    stock: params.stock,
    variants: params.variants,
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
  const tv = t.variantRows;
  const filtered =
    Boolean(params.q || params.stock || params.variants || params.category) ||
    params.product !== "active";
  const date = (value: string | null) =>
    value ? formatDateTime(value, locale, { dateStyle: "medium" }, timeZone) : "—";
  const number = (value: number | null) => (value === null ? "—" : value.toLocaleString(locale));
  const historyHref = (row: InventoryRow) => `${basePath}/${row.product_id}`;
  const variantsHref = (row: InventoryRow) =>
    `/${locale}/admin/products/${row.product_id}/variants`;
  const filterHref = (changes: Partial<typeof listParams>) => {
    const query = new URLSearchParams(
      Object.entries({ ...listParams, ...changes }).filter(([, value]) => value),
    );
    return query.size ? `${basePath}?${query}` : basePath;
  };
  const variantLabel = (variant: VariantStockRow) => variant.label || variant.sku;
  // Open a product's variants when they are what the list was narrowed to.
  const q = params.q.toLowerCase();
  const expandByDefault = (row: InventoryRow) =>
    params.variants === "attention" ||
    Boolean(q && row.variant_skus?.toLowerCase().includes(q) && !row.sku.toLowerCase().includes(q));

  // -------------------------------------------------------------------------
  // Summary tiles: each status tile filters the list (click again to clear).
  // -------------------------------------------------------------------------
  const tiles: Array<{
    key: string;
    label: string;
    value: number;
    icon: LucideIcon;
    tone: string;
    href?: string;
    active?: boolean;
    note?: string;
  }> = [
    {
      key: "all",
      label: t.summary.products,
      value: summary.totalProducts,
      icon: Package,
      tone: "text-muted-foreground",
      href: filterHref({ stock: "", variants: "" }),
      active: !params.stock && !params.variants,
    },
    ...(
      [
        ["in_stock", summary.inStock, CircleCheck, "text-success"],
        ["low_stock", summary.lowStock, TriangleAlert, "text-warning"],
        ["out_of_stock", summary.outOfStock, CircleX, "text-error"],
      ] as const
    ).map(([status, value, icon, tone]) => ({
      key: status,
      label: t.status[status],
      value,
      icon,
      tone,
      href: filterHref({ stock: params.stock === status ? "" : status }),
      active: params.stock === status,
    })),
    {
      key: "variants",
      label: t.summary.variantAlerts,
      value: variantSummary.productsWithAlerts,
      icon: Layers,
      tone: variantSummary.productsWithAlerts > 0 ? "text-warning" : "text-muted-foreground",
      href: filterHref({ variants: params.variants ? "" : "attention" }),
      active: params.variants === "attention",
      note:
        variantSummary.productsWithAlerts > 0
          ? format(t.summary.variantAlertsBody, {
              low: number(variantSummary.lowStock),
              out: number(variantSummary.outOfStock),
            })
          : t.summary.allClear,
    },
    {
      key: "units",
      label: t.summary.units,
      value: summary.totalUnits,
      icon: Boxes,
      tone: "text-muted-foreground",
      note: format(t.summary.reservedCount, { count: number(summary.reservedUnits) }),
    },
  ];
  const tile = (item: (typeof tiles)[number]) => {
    const body = (
      <>
        <span className="flex items-start justify-between gap-2">
          <span className="caps text-[0.625rem] text-muted-foreground">{item.label}</span>
          <item.icon aria-hidden className={cn("size-4 shrink-0", item.tone)} />
        </span>
        <span
          className={cn(
            "mt-1 block text-2xl leading-none font-semibold tabular-nums",
            item.key !== "all" && item.key !== "units" && item.value > 0 && item.tone,
          )}
        >
          {item.value.toLocaleString(locale)}
        </span>
        {item.note && (
          <span className="mt-1.5 block truncate text-xs text-muted-foreground">{item.note}</span>
        )}
      </>
    );
    const className = cn(
      "flex flex-col rounded-xl border bg-card px-3.5 py-3",
      item.href && "transition-colors hover:border-primary/40",
      item.active && "border-foreground ring-1 ring-foreground",
    );
    return item.href ? (
      <ViewLink
        key={item.key}
        href={item.href}
        aria-current={item.active ? "true" : undefined}
        className={className}
      >
        {body}
      </ViewLink>
    ) : (
      <div key={item.key} className={className}>
        {body}
      </div>
    );
  };

  // -------------------------------------------------------------------------
  // Shared pieces
  // -------------------------------------------------------------------------
  const iconLink = (href: string, label: string, title: string, icon: ReactNode) => (
    <Link
      href={href}
      aria-label={label}
      title={title}
      className={buttonClassName({ variant: "outline", size: "icon-sm" })}
    >
      {icon}
    </Link>
  );

  const actions = (row: InventoryRow) => {
    const item = adjustable(row);
    if (!item) return <InitializeButton productId={row.product_id} label={t.initialize} />;
    return (
      <>
        {row.variant_count > 0 ? (
          // Stock of a product with variants is their total: adjust per variant.
          iconLink(
            variantsHref(row),
            `${t.manageVariants}: ${row.name}`,
            t.manageVariants,
            <Layers aria-hidden />,
          )
        ) : (
          <AdjustStockDialog compact item={item} />
        )}
        {iconLink(
          historyHref(row),
          format(t.history.linkNamed, { name: row.name }),
          t.history.link,
          <History aria-hidden />,
        )}
      </>
    );
  };

  const variantActions = (row: InventoryRow, variant: VariantStockRow) => (
    <>
      {variant.inventory_id !== null && (
        <AdjustStockDialog
          compact
          item={{
            productId: row.product_id,
            variantId: variant.variant_id,
            name: `${row.name} · ${variantLabel(variant)}`,
            sku: variant.sku,
            quantity: variant.quantity ?? 0,
            reserved: variant.reserved_quantity ?? 0,
            threshold: variant.low_stock_threshold ?? 0,
          }}
        />
      )}
      {iconLink(
        `${historyHref(row)}?variant=${variant.variant_id}`,
        format(t.history.linkNamed, { name: `${row.name} · ${variantLabel(variant)}` }),
        t.history.link,
        <History aria-hidden />,
      )}
    </>
  );

  /** Variant badges: alerts when some are low / out, otherwise the count. */
  const variantBadges = (row: InventoryRow) => {
    if (row.variant_count === 0) return null;
    if (row.variant_alerts === 0) {
      return (
        <Badge className="py-0">
          <Layers aria-hidden />
          {format(t.variantCount, { count: row.variant_count })}
        </Badge>
      );
    }
    return (
      <>
        {row.variant_out_of_stock > 0 && (
          <Badge tone="error" className="py-0">
            <CircleX aria-hidden />
            {format(tv.out, { count: row.variant_out_of_stock })}
          </Badge>
        )}
        {row.variant_low_stock > 0 && (
          <Badge tone="warning" className="py-0">
            <TriangleAlert aria-hidden />
            {format(tv.low, { count: row.variant_low_stock })}
          </Badge>
        )}
      </>
    );
  };

  const product = (row: InventoryRow, size: "sm" | "md") => (
    <div className="flex min-w-0 items-center gap-3">
      <Link href={historyHref(row)} tabIndex={-1} aria-hidden className="shrink-0">
        <CatalogueImage
          src={row.image_url}
          alt=""
          sizes={size === "sm" ? "40px" : "48px"}
          className={size === "sm" ? "size-10" : "size-12"}
        />
      </Link>
      <span className="grid min-w-0 gap-0.5">
        <Link href={historyHref(row)} className="line-clamp-1 font-medium hover:underline">
          <bdi>{row.name}</bdi>
        </Link>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {size === "sm" ? (
            <span className="line-clamp-1">
              {row.category_name ? (
                <bdi>
                  {(row.category_id && categoryLabel.get(row.category_id)) ?? row.category_name}
                </bdi>
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
          {variantBadges(row)}
        </span>
      </span>
    </div>
  );

  /** "Showing 10 of 24 variants" + link, when the preview is partial. */
  const variantFooter = (row: InventoryRow, shown: number) =>
    row.variant_count > shown ? (
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {format(tv.showing, { shown: number(shown), count: number(row.variant_count) })}
        <Link href={variantsHref(row)} className="font-medium text-foreground hover:underline">
          {format(tv.viewAll, { count: number(row.variant_count) })}
        </Link>
      </span>
    ) : null;

  const variantName = (row: InventoryRow, variant: VariantStockRow) => (
    <span className="flex min-w-0 items-center gap-2.5">
      <CatalogueImage
        src={variant.image_url ?? row.image_url}
        alt=""
        sizes="32px"
        className="size-8 rounded-md"
      />
      <span className="grid min-w-0 gap-0.5">
        <bdi className="line-clamp-1 font-medium">{variantLabel(variant)}</bdi>
        {!variant.is_active && (
          <span>
            <Badge className="py-0">{tv.inactive}</Badge>
          </span>
        )}
      </span>
    </span>
  );

  // -------------------------------------------------------------------------
  // Table rows (tablet / desktop)
  // -------------------------------------------------------------------------
  const numbers = (item: {
    quantity: number | null;
    reserved_quantity: number | null;
    available_quantity: number | null;
  }) => (
    <>
      <td className="px-3 py-2 text-end tabular-nums">{number(item.quantity)}</td>
      <td className="px-3 py-2 text-end text-muted-foreground tabular-nums">
        {number(item.reserved_quantity)}
      </td>
      <td className="px-3 py-2 text-end font-semibold tabular-nums">
        {number(item.available_quantity)}
      </td>
    </>
  );

  const tableRow = (row: InventoryRow) => {
    const variants = variantStock.get(row.product_id) ?? [];
    const footer = variantFooter(row, variants.length);
    const details =
      variants.length === 0 ? null : (
        <>
          {variants.map((variant) => (
            <tr
              key={variant.variant_id}
              className={cn(
                "bg-muted/30 transition-colors hover:bg-accent/60",
                !variant.is_active && "text-muted-foreground",
              )}
            >
              <td aria-hidden />
              <td className="max-w-xs py-1.5 ps-6 pe-4">
                <span className="flex border-s-2 ps-3">{variantName(row, variant)}</span>
              </td>
              <td
                className="hidden px-4 py-1.5 font-mono text-xs whitespace-nowrap lg:table-cell"
                dir="ltr"
              >
                {variant.sku}
              </td>
              {numbers(variant)}
              <td className="px-4 py-1.5">
                <StockStatusBadge
                  status={variant.stock_status}
                  label={t.status[variant.stock_status]}
                />
              </td>
              <td className="hidden px-3 py-1.5 text-end text-muted-foreground tabular-nums xl:table-cell">
                {number(variant.low_stock_threshold)}
              </td>
              <td className="hidden px-4 py-1.5 whitespace-nowrap text-muted-foreground xl:table-cell">
                {date(variant.stock_updated_at)}
              </td>
              <td className="px-4 py-1.5">
                <div className="flex justify-end gap-1.5">{variantActions(row, variant)}</div>
              </td>
            </tr>
          ))}
          {footer && (
            <tr className="bg-muted/30">
              <td aria-hidden />
              <td colSpan={COLUMN_COUNT - 1} className="py-2 ps-6 pe-4">
                <span className="block border-s-2 ps-3">{footer}</span>
              </td>
            </tr>
          )}
        </>
      );

    return (
      <ExpandableRows
        key={row.product_id}
        defaultOpen={details !== null && expandByDefault(row)}
        showLabel={format(tv.show, { name: row.name })}
        hideLabel={format(tv.hide, { name: row.name })}
        details={details}
        cells={
          <>
            <td className="max-w-xs py-2 ps-2 pe-4">{product(row, "sm")}</td>
            <td
              className="hidden px-4 py-2 font-mono text-xs whitespace-nowrap lg:table-cell"
              dir="ltr"
            >
              {row.sku}
            </td>
            {numbers(row)}
            <td className="px-4 py-2">
              <StockStatusBadge status={row.stock_status} label={t.status[row.stock_status]} />
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
          </>
        }
      />
    );
  };

  // -------------------------------------------------------------------------
  // Phone rows: key numbers, variants in a native disclosure
  // -------------------------------------------------------------------------
  const stockFigures = (item: {
    quantity: number | null;
    reserved_quantity: number | null;
    available_quantity: number | null;
  }) => (
    <>
      <span>
        {t.columns.available}:{" "}
        <span className="font-semibold text-foreground tabular-nums">
          {number(item.available_quantity)}
        </span>
      </span>
      <span>
        {t.columns.stock}: <span className="tabular-nums">{number(item.quantity)}</span>
      </span>
      <span>
        {t.columns.reserved}: <span className="tabular-nums">{number(item.reserved_quantity)}</span>
      </span>
    </>
  );

  const phoneRow = (row: InventoryRow) => {
    const variants = variantStock.get(row.product_id) ?? [];
    const footer = variantFooter(row, variants.length);
    return (
      <li key={row.product_id} className="grid gap-2 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 text-sm">{product(row, "md")}</div>
          <div className="flex shrink-0 gap-1.5">{actions(row)}</div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <StockStatusBadge status={row.stock_status} label={t.status[row.stock_status]} />
          {row.inventory_id !== null && stockFigures(row)}
        </div>
        {variants.length > 0 && (
          <details open={expandByDefault(row)} className="group rounded-lg border bg-muted/30">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-medium [&::-webkit-details-marker]:hidden">
              {format(t.variantCount, { count: row.variant_count })}
              <Layers aria-hidden className="size-3.5 text-muted-foreground" />
            </summary>
            <ul className="divide-y border-t">
              {variants.map((variant) => (
                <li key={variant.variant_id} className="grid gap-1.5 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1 text-sm">{variantName(row, variant)}</div>
                    <div className="flex shrink-0 gap-1.5">{variantActions(row, variant)}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <StockStatusBadge
                      status={variant.stock_status}
                      label={t.status[variant.stock_status]}
                    />
                    {variant.inventory_id !== null && stockFigures(variant)}
                  </div>
                </li>
              ))}
            </ul>
            {footer && <div className="border-t px-3 py-2">{footer}</div>}
          </details>
        )}
      </li>
    );
  };

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

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map(tile)}
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
            name: "variants",
            label: t.filters.variants,
            options: [
              { value: "", label: t.filters.variantsAll },
              { value: "attention", label: t.filters.variantsAttention },
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
      ) : (
        <ListViews
          grid={
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {result.rows.map((row) => (
                <li
                  key={row.product_id}
                  className="group flex flex-col overflow-hidden rounded-2xl border bg-card transition-[border-color,box-shadow,transform] duration-200 ease-out hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-card"
                >
                  <Link
                    href={historyHref(row)}
                    className="relative block"
                    tabIndex={-1}
                    aria-hidden
                  >
                    <CatalogueImage
                      src={row.image_url}
                      alt=""
                      sizes="(min-width: 1280px) 230px, (min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                      className="w-full rounded-none border-0 border-b"
                    />
                    <span className="absolute start-2 top-2 flex rounded-md bg-card shadow-card">
                      <StockStatusBadge
                        status={row.stock_status}
                        label={t.status[row.stock_status]}
                      />
                    </span>
                  </Link>
                  <div className="flex flex-1 flex-col gap-1 p-3">
                    <Link
                      href={historyHref(row)}
                      className="line-clamp-2 text-sm leading-snug font-medium group-hover:underline"
                    >
                      <bdi>{row.name}</bdi>
                    </Link>
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span className="truncate font-mono" dir="ltr">
                        {row.sku}
                      </span>
                      {!row.product_active && <Badge className="py-0">{t.productInactive}</Badge>}
                      {variantBadges(row)}
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
                          <dt className="text-[0.6875rem] text-muted-foreground">
                            {t.columns.stock}
                          </dt>
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
          }
          list={
            <>
              {/* Tablet / desktop: table; products with variants expand in place */}
              <div className="hidden overflow-hidden rounded-2xl border bg-card md:block">
                <table className="w-full text-sm">
                  <caption className="sr-only">{t.title}</caption>
                  <thead className="caps border-b text-[0.625rem] text-muted-foreground">
                    <tr>
                      <th scope="col" className="w-0 py-3 ps-3 pe-0">
                        <span className="sr-only">{t.filters.variants}</span>
                      </th>
                      <th scope="col" className="py-3 ps-2 pe-4 text-start font-medium">
                        {t.columns.product}
                      </th>
                      <th
                        scope="col"
                        className="hidden px-4 py-3 text-start font-medium lg:table-cell"
                      >
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
                      <th
                        scope="col"
                        className="hidden px-3 py-3 text-end font-medium xl:table-cell"
                      >
                        {t.columns.threshold}
                      </th>
                      <th
                        scope="col"
                        className="hidden px-4 py-3 text-start font-medium xl:table-cell"
                      >
                        {t.columns.updated}
                      </th>
                      <th scope="col" className="w-0 px-4 py-3">
                        <span className="sr-only">{t.columns.actions}</span>
                      </th>
                    </tr>
                  </thead>
                  {result.rows.map(tableRow)}
                </table>
              </div>

              {/* Phones: compact rows with the key numbers */}
              <ul className="divide-y overflow-hidden rounded-2xl border bg-card md:hidden">
                {result.rows.map(phoneRow)}
              </ul>
            </>
          }
        />
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
