import { ArrowLeft, History, Layers, Package, SearchX, SlidersHorizontal } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { DeleteButton } from "@/components/attributes/delete-button";
import { CatalogueImage } from "@/components/catalogue/catalogue-image";
import { ListToolbar } from "@/components/catalogue/list-toolbar";
import { Pagination } from "@/components/catalogue/pagination";
import { Panel } from "@/components/catalogue/panel";
import { StatusBadge } from "@/components/catalogue/status-badge";
import { StatusToggle } from "@/components/catalogue/status-toggle";
import { AdjustStockDialog, type AdjustableItem } from "@/components/inventory/adjust-stock-dialog";
import { StockPoolSummary } from "@/components/inventory/stock-pool";
import { getInventoryItem } from "@/lib/inventory/queries";
import { StockStatusBadge } from "@/components/inventory/stock-status-badge";
import { VariantDialog, type EditableVariant } from "@/components/variants/variant-dialog";
import { VariantGenerator } from "@/components/variants/variant-generator";
import {
  SelectAllVariants,
  SelectOutdatedVariants,
  SelectVariant,
  VariantSelection,
} from "@/components/variants/variant-selection";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PageSkeleton } from "@/components/ui/states";
import { requireAdmin } from "@/lib/auth/dal";
import { isUuid } from "@/lib/catalogue/validation";
import { formatCurrency } from "@/lib/format";
import { format } from "@/lib/i18n/messages";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { STOCK_STATUSES } from "@/lib/inventory/rules";
import {
  getVariantAxes,
  getVariantKeys,
  getVariantProduct,
  getVariantWeights,
  listVariants,
  parseVariantParams,
  type VariantRow,
} from "@/lib/variants/queries";
import { combinations } from "@/lib/variants/rules";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.variants.title };
}

export default async function VariantsPage({
  params,
  searchParams,
}: PageProps<"/[lang]/admin/products/[id]/variants">) {
  const messages = await getMessages();
  return (
    <Suspense fallback={<PageSkeleton label={messages.common.loading} />}>
      <Variants params={params} searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * A product's variants: generator (adds missing combinations, never changes
 * existing ones), searchable list with price, image, stock status, edit,
 * activate/deactivate, delete (empty only), stock adjustment and history.
 */
async function Variants({
  params,
  searchParams,
}: Pick<PageProps<"/[lang]/admin/products/[id]/variants">, "params" | "searchParams">) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  await requireAdmin(locale);
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const listParams = parseVariantParams(await searchParams);

  const [product, axes, keys, result, weights, stockItem] = await Promise.all([
    getVariantProduct(id),
    getVariantAxes(id),
    getVariantKeys(id),
    listVariants(id, listParams),
    getVariantWeights(id),
    getInventoryItem(id),
  ]);
  if (!product) notFound();
  const rows = result.rows;

  const variantsPath = `/${locale}/admin/products/${id}/variants`;
  const pageParams = {
    q: listParams.q,
    stock: listParams.stock,
    status: listParams.status === "all" ? "" : listParams.status,
  };
  // Past the last page (e.g. after filtering or deletions): go to the last one.
  if (rows.length === 0 && result.total > 0) {
    const query = new URLSearchParams(Object.entries(pageParams).filter(([, value]) => value));
    if (result.pageCount > 1) query.set("page", String(result.pageCount));
    redirect(`${variantsPath}${query.size ? `?${query}` : ""}`);
  }

  const t = messages.variants;
  const common = messages.catalogue.common;
  const inventory = messages.inventory;
  const productPath = `/${locale}/admin/products/${id}`;
  const historyPath = `/${locale}/admin/inventory/${id}`;
  const filtered =
    Boolean(listParams.q) || Boolean(listParams.stock) || listParams.status !== "all";
  const hasVariants = keys.length > 0;
  // Combinations the product's current options can produce (to flag outdated variants).
  const current = new Set(combinations(axes, 5000).map((combination) => combination.key));
  const stockToMove = hasVariants ? 0 : (product.stock?.quantity ?? 0);
  const primary = product.images.find((image) => image.is_primary) ?? product.images[0];

  const number = (value: number | null) => (value ?? 0).toLocaleString(locale);
  const money = (value: number | string) => formatCurrency(value, product.currency_code, locale);
  const label = (row: VariantRow) => row.label || row.sku;
  const editable = (row: VariantRow): EditableVariant => ({
    id: row.variant_id,
    label: label(row),
    sku: row.sku,
    price: row.price,
    compare_at_price: row.compare_at_price,
    image_id: row.image_id,
    is_active: row.is_active,
    updated_at: row.updated_at,
    weight_grams: weights ? (weights.get(row.variant_id) ?? null) : undefined,
  });
  const adjustable = (row: VariantRow): AdjustableItem => ({
    productId: id,
    variantId: row.variant_id,
    name: `${product.name} · ${label(row)}`,
    sku: row.sku,
    quantity: row.quantity ?? 0,
    reserved: row.reserved_quantity ?? 0,
    threshold: row.low_stock_threshold ?? 0,
    // A variant holds part of its product's stock pool (migration 042).
    poolAvailable: stockItem?.unallocated_quantity ?? undefined,
  });
  const images = product.images.map(({ id: imageId, public_url, alt_text }) => ({
    id: imageId,
    public_url,
    alt_text,
  }));

  // Reserved units block deletion (stock is cleared first, history is kept).
  const inUse = (row: VariantRow) => (row.reserved_quantity ?? 0) > 0;
  const deletable = rows
    .filter((row) => !inUse(row))
    .map((row) => ({
      id: row.variant_id,
      quantity: row.quantity ?? 0,
      outdated: !current.has(row.combination_key),
    }));
  const anyOutdated = deletable.some((variant) => variant.outdated);
  const select = (row: VariantRow, className?: string) => (
    <SelectVariant
      id={row.variant_id}
      name={label(row)}
      disabled={inUse(row)}
      className={className}
    />
  );

  const outdated = (row: VariantRow) =>
    !current.has(row.combination_key) && (
      <Badge tone="warning" title={t.outdatedHint} className="py-0">
        {t.outdated}
      </Badge>
    );
  const price = (row: VariantRow) => (
    <span className="whitespace-nowrap tabular-nums">
      {money(row.price)}
      {row.compare_at_price !== null && (
        <s className="ms-1.5 text-xs text-muted-foreground">{money(row.compare_at_price)}</s>
      )}
    </span>
  );
  const actions = (row: VariantRow) => (
    <>
      <VariantDialog variant={editable(row)} currency={product.currency_code} images={images} />
      <AdjustStockDialog compact item={adjustable(row)} />
      <Link
        href={`${historyPath}?variant=${row.variant_id}`}
        aria-label={format(t.historyLink, { name: label(row) })}
        title={inventory.history.title}
        className={buttonClassName({ variant: "outline", size: "icon-sm" })}
      >
        <History aria-hidden />
      </Link>
      <StatusToggle
        compact
        kind="variant"
        id={row.variant_id}
        name={label(row)}
        active={row.is_active}
      />
      <DeleteButton
        compact
        kind="variant"
        id={row.variant_id}
        name={label(row)}
        inUse={inUse(row)}
      />
    </>
  );

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link
          href={productPath}
          aria-label={t.backToProduct}
          title={t.backToProduct}
          className={buttonClassName({ variant: "ghost", size: "icon-sm" })}
        >
          <ArrowLeft aria-hidden className="rtl:-scale-x-100" />
        </Link>
        <CatalogueImage src={primary?.public_url ?? null} alt="" sizes="48px" className="size-12" />
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
            <span className="truncate">{t.title}</span>
            {keys.length > 0 && <Badge className="tabular-nums">{number(keys.length)}</Badge>}
          </h1>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            <bdi className="font-medium text-foreground">{product.name}</bdi>
            {" · "}
            <span className="font-mono" dir="ltr">
              {product.sku}
            </span>
          </p>
        </div>
        <Link href={productPath} className={buttonClassName({ variant: "outline" })}>
          <Package aria-hidden />
          {t.editProduct}
        </Link>
        {hasVariants && (
          <Link href={historyPath} className={buttonClassName({ variant: "outline" })}>
            <History aria-hidden />
            {inventory.history.title}
          </Link>
        )}
      </div>

      {hasVariants && stockItem?.inventory_id && (
        <StockPoolSummary
          className="mb-4"
          item={{
            productId: id,
            name: product.name,
            sku: product.sku,
            quantity: stockItem.quantity ?? 0,
            reserved: stockItem.reserved_quantity ?? 0,
            threshold: stockItem.low_stock_threshold ?? 0,
            allocated: stockItem.allocated_quantity,
          }}
        />
      )}

      <div className="grid gap-4">
        {axes.length === 0 ? (
          <Card>
            <EmptyState
              icon={Layers}
              title={t.noOptionsTitle}
              description={`${t.noOptionsBody}${hasVariants ? "" : ` ${t.simpleProduct}`}`}
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Link href={productPath} className={buttonClassName()}>
                    {t.editProduct}
                  </Link>
                  <Link
                    href={`/${locale}/admin/attributes`}
                    className={buttonClassName({ variant: "outline" })}
                  >
                    <SlidersHorizontal aria-hidden />
                    {t.manageAttributes}
                  </Link>
                </div>
              }
            />
          </Card>
        ) : (
          <details
            open={!hasVariants}
            className="group rounded-2xl border bg-card text-card-foreground"
          >
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold hover:bg-accent/50 sm:px-5 [&::-webkit-details-marker]:hidden">
              <Layers aria-hidden className="size-4 text-muted-foreground" />
              <span className="flex-1">{t.generator.title}</span>
              <span className="text-xs font-normal text-muted-foreground group-open:hidden">
                {t.generator.show}
              </span>
              <span className="hidden text-xs font-normal text-muted-foreground group-open:inline">
                {t.generator.hide}
              </span>
            </summary>
            <div className="border-t p-4 sm:p-5">
              <VariantGenerator
                productId={id}
                axes={axes}
                existingKeys={keys.map((variant) => variant.combination_key)}
                stockToMove={stockToMove}
              />
            </div>
          </details>
        )}

        {hasVariants && (
          <div>
            <ListToolbar
              searchLabel={t.searchLabel}
              searchPlaceholder={t.searchPlaceholder}
              filters={[
                {
                  name: "stock",
                  label: t.stockFilter,
                  options: [
                    { value: "", label: t.stockAll },
                    ...STOCK_STATUSES.filter((status) => status !== "unconfigured").map(
                      (status) => ({ value: status, label: inventory.status[status] }),
                    ),
                  ],
                },
                {
                  name: "status",
                  label: common.status,
                  options: [
                    { value: "", label: common.statusAll },
                    { value: "active", label: common.active },
                    { value: "inactive", label: common.inactive },
                  ],
                },
              ]}
            />

            {rows.length === 0 ? (
              <Card>
                <EmptyState
                  icon={SearchX}
                  title={filtered ? common.noResultsTitle : t.emptyTitle}
                  description={filtered ? common.noResultsBody : t.emptyBody}
                />
              </Card>
            ) : (
              // A new page or filter starts a fresh selection.
              <VariantSelection
                key={JSON.stringify({ ...pageParams, page: result.page })}
                productId={id}
                variants={deletable}
              >
                <div
                  className={`mb-2 flex flex-wrap items-center gap-2 px-1 text-sm text-muted-foreground ${anyOutdated ? "" : "lg:hidden"}`}
                >
                  <SelectAllVariants withLabel className="me-auto lg:invisible" />
                  <SelectOutdatedVariants />
                </div>

                {/* Desktop: table */}
                <div className="hidden overflow-hidden rounded-2xl border bg-card lg:block">
                  <table className="w-full text-sm">
                    <caption className="sr-only">{t.title}</caption>
                    <thead className="caps border-b text-[0.625rem] text-muted-foreground">
                      <tr>
                        <th scope="col" className="w-0 ps-4 py-3 text-start font-medium">
                          <SelectAllVariants className="align-middle" />
                        </th>
                        <th scope="col" className="px-4 py-3 text-start font-medium">
                          {t.columns.variant}
                        </th>
                        <th scope="col" className="px-4 py-3 text-start font-medium">
                          {t.columns.price}
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
                        <th scope="col" className="w-0 px-4 py-3 text-end font-medium">
                          <span className="sr-only">{t.columns.actions}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {rows.map((row) => (
                        <tr key={row.variant_id} className="transition-colors hover:bg-accent/60">
                          <td className="ps-4 py-2">{select(row, "align-middle")}</td>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-3">
                              <CatalogueImage
                                src={row.image_url ?? primary?.public_url ?? null}
                                alt=""
                                sizes="40px"
                                className="size-10"
                              />
                              <div className="min-w-0">
                                <p className="flex flex-wrap items-center gap-1.5 font-medium">
                                  <bdi className="line-clamp-1">{label(row)}</bdi>
                                  {outdated(row)}
                                </p>
                                <p
                                  className="truncate font-mono text-xs text-muted-foreground"
                                  dir="ltr"
                                >
                                  {row.sku}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-2">{price(row)}</td>
                          <td className="px-3 py-2 text-end tabular-nums">
                            {number(row.quantity)}
                          </td>
                          <td className="px-3 py-2 text-end text-muted-foreground tabular-nums">
                            {number(row.reserved_quantity)}
                          </td>
                          <td className="px-3 py-2 text-end font-medium tabular-nums">
                            {number(row.available_quantity)}
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex flex-wrap gap-1.5">
                              <StockStatusBadge
                                status={row.stock_status}
                                label={inventory.status[row.stock_status]}
                              />
                              {!row.is_active && (
                                <StatusBadge
                                  active={false}
                                  activeLabel={common.active}
                                  inactiveLabel={common.inactive}
                                />
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex justify-end gap-1.5">{actions(row)}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Phones / tablets: cards */}
                <ul className="grid gap-2 lg:hidden">
                  {rows.map((row) => (
                    <li
                      key={row.variant_id}
                      className="grid gap-2.5 rounded-2xl border bg-card p-3"
                    >
                      <div className="flex items-start gap-3">
                        {select(row, "mt-4")}
                        <CatalogueImage
                          src={row.image_url ?? primary?.public_url ?? null}
                          alt=""
                          sizes="48px"
                          className="size-12"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                            <bdi className="line-clamp-1">{label(row)}</bdi>
                            {outdated(row)}
                          </p>
                          <p className="truncate font-mono text-xs text-muted-foreground" dir="ltr">
                            {row.sku}
                          </p>
                          <p className="mt-0.5 text-sm">{price(row)}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                        <StockStatusBadge
                          status={row.stock_status}
                          label={inventory.status[row.stock_status]}
                        />
                        {!row.is_active && (
                          <StatusBadge
                            active={false}
                            activeLabel={common.active}
                            inactiveLabel={common.inactive}
                          />
                        )}
                        <span>
                          {t.columns.stock}:{" "}
                          <span className="font-medium text-foreground tabular-nums">
                            {number(row.quantity)}
                          </span>
                        </span>
                        <span>
                          {t.columns.reserved}:{" "}
                          <span className="tabular-nums">{number(row.reserved_quantity)}</span>
                        </span>
                        <span>
                          {t.columns.available}:{" "}
                          <span className="font-medium text-foreground tabular-nums">
                            {number(row.available_quantity)}
                          </span>
                        </span>
                      </div>
                      <div className="flex flex-wrap justify-end gap-1.5 border-t pt-2.5">
                        {actions(row)}
                      </div>
                    </li>
                  ))}
                </ul>
              </VariantSelection>
            )}

            <Pagination
              basePath={variantsPath}
              params={pageParams}
              page={result.page}
              pageCount={result.pageCount}
              pageSize={result.pageSize}
              total={result.total}
              labels={common}
            />
          </div>
        )}

        {!hasVariants && axes.length > 0 && (
          <Panel>
            <p className="text-sm text-muted-foreground">{t.simpleProduct}</p>
          </Panel>
        )}
      </div>
    </div>
  );
}
