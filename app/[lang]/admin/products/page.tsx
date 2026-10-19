import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Layers,
  Package,
  Pencil,
  Plus,
  SearchX,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { CatalogueImage } from "@/components/catalogue/catalogue-image";
import { CurrencyPriceSummary } from "@/components/catalogue/currency-price-summary";
import { ListToolbar } from "@/components/catalogue/list-toolbar";
import { ListViews } from "@/components/catalogue/list-views";
import { MotionItem, MotionList } from "@/components/catalogue/motion-list";
import { Pagination } from "@/components/catalogue/pagination";
import {
  ProductSelection,
  SelectAllProducts,
  SelectableCard,
  SelectProduct,
} from "@/components/catalogue/product-selection";
import { StatusBadge } from "@/components/catalogue/status-badge";
import { StatusToggle } from "@/components/catalogue/status-toggle";
import { StockStatusBadge } from "@/components/inventory/stock-status-badge";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PageSkeleton } from "@/components/ui/states";
import { requireAdmin } from "@/lib/auth/dal";
import {
  listCategoryOptions,
  listProductExtras,
  listProducts,
  listTagOptions,
  parseListParams,
  type ProductListExtras,
  type ProductListRow,
  type ProductSort,
} from "@/lib/catalogue/queries";
import { isUuid } from "@/lib/catalogue/validation";
import { listCurrencies } from "@/lib/currencies/queries";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { format } from "@/lib/i18n/messages";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { stockStatus, type StockStatus } from "@/lib/inventory/rules";
import { getStoreRegion } from "@/lib/settings/queries";
import { cn } from "@/lib/utils/cn";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.nav.products };
}

// Session + search params are read behind <Suspense> so navigations show the
// skeleton instantly (Cache Components); requireAdmin() guards the content.
export default async function ProductsPage({ searchParams }: PageProps<"/[lang]/admin/products">) {
  const messages = await getMessages();
  return (
    <Suspense fallback={<PageSkeleton label={messages.common.loading} />}>
      <Products searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * Product list (table) and grid. Both show the same page of products with
 * their prices in every currency, variants, stock, tags and status; rows and
 * cards can be selected for bulk activate / deactivate. Search, filters, sort
 * and page live in the URL (?q=&category=&tag=&status=&sort=&page=), so the
 * server filters, sorts and paginates.
 */
async function Products({
  searchParams,
}: Pick<PageProps<"/[lang]/admin/products">, "searchParams">) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  await requireAdmin(locale);
  const { timezone: timeZone } = await getStoreRegion();
  const params = parseListParams(await searchParams);
  if (params.category && !isUuid(params.category)) params.category = "";
  if (params.tag && !isUuid(params.tag)) params.tag = "";

  // Independent queries run in parallel.
  const [result, categories, tags, currencies] = await Promise.all([
    listProducts(params),
    listCategoryOptions(),
    listTagOptions(),
    listCurrencies(),
  ]);
  const extras = await listProductExtras(result.rows);
  const activeCurrencies = currencies?.filter((currency) => currency.isActive) ?? null;

  const listParams = {
    q: params.q,
    status: params.status === "all" ? "" : params.status,
    category: params.category,
    tag: params.tag,
    sort: params.sort,
    view: params.view === "grid" ? "grid" : "",
  };
  // Past the last page (e.g. after filtering or deactivations): go to the last one.
  if (result.rows.length === 0 && result.total > 0) {
    const query = new URLSearchParams(Object.entries(listParams).filter(([, value]) => value));
    if (result.pageCount > 1) query.set("page", String(result.pageCount));
    redirect(`/${locale}/admin/products${query.size ? `?${query}` : ""}`);
  }

  const t = messages.catalogue;
  const p = t.products;
  const l = p.list;
  const filtered =
    Boolean(params.q) || params.status !== "all" || Boolean(params.category) || Boolean(params.tag);
  const date = (value: string) => formatDateTime(value, locale, { dateStyle: "medium" }, timeZone);
  const href = (id: string) => `/${locale}/admin/products/${id}`;
  const extra = (id: string) => extras.get(id)!;

  // Same rule as the Inventory page: available = stock - reserved.
  const available = (product: ProductListRow) =>
    product.inventory
      ? Math.max(0, product.inventory.quantity - product.inventory.reserved_quantity)
      : null;
  const number = (value: number) => value.toLocaleString(locale);
  const stockOf = (product: ProductListRow): StockStatus => {
    const stock = product.inventory;
    return stock
      ? stockStatus(stock.quantity, stock.reserved_quantity, stock.low_stock_threshold)
      : "unconfigured";
  };
  const needsAttention = (product: ProductListRow) =>
    product.is_active && ["low_stock", "out_of_stock"].includes(stockOf(product));
  const stockBadge = (product: ProductListRow) => (
    <StockStatusBadge
      status={stockOf(product)}
      label={messages.inventory.status[stockOf(product)]}
    />
  );
  /** "12 available" (or "—" without an inventory row). */
  const availableText = (product: ProductListRow) => {
    const count = available(product);
    return count === null ? "—" : format(p.availableCount, { count: number(count) });
  };
  const status = (active: boolean) => (
    <StatusBadge active={active} activeLabel={t.common.active} inactiveLabel={t.common.inactive} />
  );

  const basePrice = (product: ProductListRow) => (
    <span className="whitespace-nowrap tabular-nums">
      <span className="font-semibold">
        {formatCurrency(product.price, product.currency_code, locale)}
      </span>
      {product.compare_at_price !== null && (
        <s className="ms-1.5 text-xs text-muted-foreground">
          {formatCurrency(product.compare_at_price, product.currency_code, locale)}
        </s>
      )}
    </span>
  );
  const prices = (product: ProductListRow, align: "start" | "end") => (
    <CurrencyPriceSummary
      base={basePrice(product)}
      prices={extra(product.id).prices}
      currencies={activeCurrencies}
      align={align}
    />
  );

  // Full path for subcategories ("Women › Winter"), from the category options.
  const categoryLabel = new Map(categories.map((option) => [option.id, option.name]));
  const category = (product: ProductListRow) => {
    const more = extra(product.id).extraCategoryCount;
    return (
      <>
        {product.category ? (
          <bdi>{categoryLabel.get(product.category.id) ?? product.category.name}</bdi>
        ) : (
          p.noCategory
        )}
        {more > 0 && <span className="ms-1">{format(l.moreCategories, { count: more })}</span>}
      </>
    );
  };
  const variants = (info: ProductListExtras) =>
    info.variantCount > 0 ? (
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <Layers aria-hidden className="size-3.5" />
        {format(l.variantCount, { count: info.activeVariantCount, total: info.variantCount })}
      </span>
    ) : null;
  const tagChips = (info: ProductListExtras, max: number) =>
    info.tags.length > 0 ? (
      <span className="flex flex-wrap gap-1">
        {info.tags.slice(0, max).map((tag) => (
          <span
            key={tag}
            className="rounded-full border px-2 py-px text-[0.6875rem] text-muted-foreground"
          >
            <bdi>{tag}</bdi>
          </span>
        ))}
        {info.tags.length > max && (
          <span className="px-1 text-[0.6875rem] text-muted-foreground">
            {format(l.moreTags, { count: info.tags.length - max })}
          </span>
        )}
      </span>
    ) : null;
  const editLink = (product: ProductListRow, className?: string) => (
    <Link
      href={href(product.id)}
      aria-label={`${t.common.edit}: ${product.name}`}
      title={t.common.edit}
      className={cn(buttonClassName({ variant: "outline", size: "icon-sm" }), className)}
    >
      <Pencil aria-hidden />
    </Link>
  );
  const toggle = (product: ProductListRow) => (
    <StatusToggle
      compact
      kind="product"
      id={product.id}
      name={product.name}
      active={product.is_active}
    />
  );
  const addButton = (
    <Link href={`/${locale}/admin/products/new`} className={buttonClassName()}>
      <Plus aria-hidden />
      {p.add}
    </Link>
  );

  /** Column header that sorts by `column`: ascending, then descending, and so on. */
  const sortHeader = (label: string, column: "name" | "price" | "updated", end = false) => {
    // [ascending, descending]; recently updated first is the default ("").
    const [asc, desc] = (
      {
        name: ["name-asc", "name-desc"],
        price: ["price-asc", "price-desc"],
        updated: ["updated-asc", ""],
      } as const satisfies Record<string, readonly [ProductSort, ProductSort]>
    )[column];
    const current = params.sort === asc ? "asc" : params.sort === desc ? "desc" : null;
    const next: ProductSort = current === "asc" ? desc : asc;
    const query = new URLSearchParams(
      Object.entries({ ...listParams, sort: next }).filter(([, value]) => value),
    );
    const Icon = current === "asc" ? ArrowUp : current === "desc" ? ArrowDown : ArrowUpDown;
    return (
      <Link
        href={`/${locale}/admin/products${query.size ? `?${query}` : ""}`}
        scroll={false}
        aria-label={format(l.sortBy, { column: label })}
        className={cn(
          "inline-flex items-center gap-1 rounded-md transition-colors hover:text-foreground",
          current && "text-foreground",
          end && "justify-end",
        )}
      >
        {label}
        <Icon aria-hidden className={cn("size-3", !current && "opacity-40")} />
      </Link>
    );
  };
  const th = (children: ReactNode, className?: string) => (
    <th scope="col" className={cn("px-3 py-3 font-medium", className)}>
      {children}
    </th>
  );

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
            {messages.nav.products}
            {result.total > 0 && <Badge className="tabular-nums">{result.total}</Badge>}
          </h1>
          <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">{p.subtitle}</p>
        </div>
        {addButton}
      </div>

      <ListToolbar
        viewToggle
        searchLabel={p.searchLabel}
        searchPlaceholder={p.searchPlaceholder}
        filters={[
          {
            name: "category",
            label: p.categoryFilter,
            options: [
              { value: "", label: p.allCategories },
              ...categories.map((option) => ({ value: option.id, label: option.name })),
            ],
          },
          ...(tags && tags.length > 0
            ? [
                {
                  name: "tag",
                  label: p.tagFilter,
                  options: [
                    { value: "", label: p.allTags },
                    ...tags.map((tag) => ({
                      value: tag.id,
                      label: tag.isActive
                        ? tag.name
                        : format(p.fields.inactiveTag, { name: tag.name }),
                    })),
                  ],
                },
              ]
            : []),
          {
            name: "status",
            label: t.common.status,
            options: [
              { value: "", label: t.common.statusAll },
              { value: "active", label: t.common.active },
              { value: "inactive", label: t.common.inactive },
            ],
          },
          {
            name: "sort",
            label: l.sortLabel,
            options: (
              [
                ["", l.sort.updatedDesc],
                ["updated-asc", l.sort.updatedAsc],
                ["created-desc", l.sort.createdDesc],
                ["name-asc", l.sort.nameAsc],
                ["name-desc", l.sort.nameDesc],
                ["price-asc", l.sort.priceAsc],
                ["price-desc", l.sort.priceDesc],
              ] as const
            ).map(([value, label]) => ({ value, label })),
          },
        ]}
      />

      {result.total === 0 ? (
        <Card>
          {filtered ? (
            <EmptyState
              icon={SearchX}
              title={t.common.noResultsTitle}
              description={t.common.noResultsBody}
            />
          ) : (
            <EmptyState
              icon={Package}
              title={p.emptyTitle}
              description={p.emptyBody}
              action={addButton}
            />
          )}
        </Card>
      ) : (
        // A new page, filter or sort starts a fresh selection.
        <ProductSelection
          key={JSON.stringify({ ...listParams, page: result.page })}
          ids={result.rows.map((product) => product.id)}
        >
          <ListViews
            grid={
              <>
                <div className="mb-3 flex items-center justify-between gap-3 px-1 text-sm text-muted-foreground">
                  <SelectAllProducts withLabel />
                  {params.sort === "price-asc" || params.sort === "price-desc" ? (
                    <span className="text-xs">{l.priceSortNote}</span>
                  ) : null}
                </div>
                <MotionList className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
                  {result.rows.map((product) => {
                    const info = extra(product.id);
                    const attention = needsAttention(product);
                    return (
                      <MotionItem key={product.id}>
                        <SelectableCard
                          id={product.id}
                          className={cn(
                            "group relative flex h-full flex-col rounded-2xl border bg-card transition-[border-color,box-shadow] duration-200 hover:border-brand/40 hover:shadow-card",
                            attention && "border-warning/50",
                            "data-[selected]:border-brand data-[selected]:ring-2 data-[selected]:ring-brand/30",
                            !product.is_active && "opacity-80",
                          )}
                        >
                          <div className="relative overflow-hidden rounded-t-2xl">
                            <Link href={href(product.id)} tabIndex={-1} aria-hidden>
                              <CatalogueImage
                                src={product.image?.public_url ?? null}
                                alt=""
                                sizes="(min-width: 1280px) 230px, (min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                                className="aspect-[4/5]! w-full rounded-none border-0 transition-transform duration-500 ease-out group-hover:scale-[1.04]"
                              />
                            </Link>
                            <span className="absolute start-2 top-2 flex rounded-md bg-card/95 shadow-card backdrop-blur">
                              {status(product.is_active)}
                            </span>
                            <span className="absolute end-2 top-2 flex size-7 items-center justify-center rounded-md bg-card/95 shadow-card backdrop-blur">
                              <SelectProduct id={product.id} name={product.name} />
                            </span>
                            {/* Quick actions: on hover / focus (mouse), always on touch. */}
                            <div className="absolute inset-x-2 bottom-2 flex justify-end gap-1.5 transition-opacity duration-200 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
                              {editLink(product, "bg-card/95 backdrop-blur")}
                              <span className="rounded-md bg-card/95 backdrop-blur">
                                {toggle(product)}
                              </span>
                            </div>
                          </div>
                          <div className="flex flex-1 flex-col gap-1.5 p-3">
                            <p className="caps truncate text-[0.625rem] text-muted-foreground">
                              {category(product)}
                            </p>
                            <Link
                              href={href(product.id)}
                              className="line-clamp-2 text-sm leading-snug font-medium hover:underline"
                            >
                              <bdi>{product.name}</bdi>
                            </Link>
                            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                              <span className="truncate font-mono" dir="ltr">
                                {product.sku}
                              </span>
                              {variants(info)}
                            </p>
                            {tagChips(info, 2)}
                            <div className="mt-auto grid gap-2 pt-2">
                              <div className="text-sm">{prices(product, "start")}</div>
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-2">
                                {stockBadge(product)}
                                <span className="text-xs text-muted-foreground tabular-nums">
                                  {availableText(product)}
                                </span>
                              </div>
                            </div>
                          </div>
                        </SelectableCard>
                      </MotionItem>
                    );
                  })}
                </MotionList>
              </>
            }
            list={
              <>
                {/* Tablet / desktop: table (header sticks under the top bar). */}
                <div className="hidden rounded-2xl border bg-card md:block">
                  <table className="w-full text-sm">
                    <caption className="sr-only">{messages.nav.products}</caption>
                    <thead className="caps sticky top-[calc(4rem+env(safe-area-inset-top))] z-10 border-b bg-card/95 text-[0.625rem] text-muted-foreground backdrop-blur">
                      <tr className="[&>th:first-child]:rounded-ss-2xl [&>th:last-child]:rounded-se-2xl">
                        {th(<SelectAllProducts />, "w-0 ps-4 text-start")}
                        {th(sortHeader(p.columns.name, "name"), "text-start")}
                        {th(p.columns.sku, "hidden text-start lg:table-cell")}
                        {th(
                          <span className="flex justify-end">
                            {sortHeader(p.columns.price, "price", true)}
                          </span>,
                          "w-0 text-end whitespace-nowrap",
                        )}
                        {th(p.columns.available, "text-end")}
                        {th(p.columns.stock, "text-start")}
                        {th(p.columns.status, "text-start")}
                        {th(
                          sortHeader(p.columns.updated, "updated"),
                          "hidden text-start xl:table-cell",
                        )}
                        {th(
                          <span className="sr-only">{p.columns.actions}</span>,
                          "w-0 pe-4 text-end",
                        )}
                      </tr>
                    </thead>
                    <MotionList as="tbody" className="divide-y">
                      {result.rows.map((product) => {
                        const info = extra(product.id);
                        const attention = needsAttention(product);
                        return (
                          <MotionItem
                            as="tr"
                            key={product.id}
                            className={cn(
                              "group transition-colors hover:bg-accent/50",
                              attention && "bg-warning/[0.04]",
                            )}
                          >
                            <td className="w-0 py-3 ps-4 pe-1 align-middle">
                              <SelectProduct id={product.id} name={product.name} />
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-3">
                                <Link href={href(product.id)} tabIndex={-1} aria-hidden>
                                  <CatalogueImage
                                    src={product.image?.public_url ?? null}
                                    alt=""
                                    sizes="48px"
                                    className="size-12"
                                  />
                                </Link>
                                <div className="grid min-w-0 gap-0.5">
                                  <Link
                                    href={href(product.id)}
                                    className="line-clamp-1 font-medium hover:underline"
                                  >
                                    <bdi>{product.name}</bdi>
                                  </Link>
                                  <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                                    <span className="line-clamp-1">{category(product)}</span>
                                    {info.productType && (
                                      <span className="whitespace-nowrap">
                                        · {info.productType}
                                      </span>
                                    )}
                                    {variants(info) && <span>· {variants(info)}</span>}
                                  </span>
                                  {tagChips(info, 3)}
                                </div>
                              </div>
                            </td>
                            <td
                              className="hidden px-3 py-3 font-mono text-xs whitespace-nowrap text-muted-foreground lg:table-cell"
                              dir="ltr"
                            >
                              {product.sku}
                            </td>
                            <td className="px-3 py-3 text-end align-middle whitespace-nowrap">
                              {prices(product, "end")}
                            </td>
                            <td
                              className={cn(
                                "px-3 py-3 text-end font-medium tabular-nums",
                                attention && "text-warning",
                              )}
                            >
                              {available(product) === null ? "—" : number(available(product)!)}
                            </td>
                            <td className="px-3 py-3 whitespace-nowrap">{stockBadge(product)}</td>
                            <td className="px-3 py-3">{status(product.is_active)}</td>
                            <td className="hidden px-3 py-3 whitespace-nowrap text-muted-foreground xl:table-cell">
                              {date(product.updated_at)}
                            </td>
                            <td className="py-3 ps-3 pe-4">
                              <div className="flex justify-end gap-1.5 transition-opacity [@media(hover:hover)]:opacity-60 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
                                {editLink(product)}
                                {toggle(product)}
                              </div>
                            </td>
                          </MotionItem>
                        );
                      })}
                    </MotionList>
                  </table>
                </div>

                {/* Phones: compact rows. */}
                <div className="md:hidden">
                  <div className="mb-2 px-1 text-sm text-muted-foreground">
                    <SelectAllProducts withLabel />
                  </div>
                  <MotionList className="divide-y overflow-hidden rounded-2xl border bg-card">
                    {result.rows.map((product) => {
                      const info = extra(product.id);
                      return (
                        <MotionItem
                          key={product.id}
                          className={cn(
                            "flex items-center gap-3 px-3 py-3",
                            needsAttention(product) && "bg-warning/[0.04]",
                          )}
                        >
                          <SelectProduct id={product.id} name={product.name} />
                          <Link href={href(product.id)} tabIndex={-1} aria-hidden>
                            <CatalogueImage
                              src={product.image?.public_url ?? null}
                              alt=""
                              sizes="56px"
                              className="size-14"
                            />
                          </Link>
                          <div className="grid min-w-0 flex-1 gap-1">
                            <Link
                              href={href(product.id)}
                              className="line-clamp-1 text-sm font-medium"
                            >
                              <bdi>{product.name}</bdi>
                            </Link>
                            <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                              <span className="truncate font-mono" dir="ltr">
                                {product.sku}
                              </span>
                              {variants(info)}
                            </span>
                            <div className="text-sm">{prices(product, "start")}</div>
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              {status(product.is_active)}
                              {stockBadge(product)}
                              <span className="text-xs text-muted-foreground tabular-nums">
                                {availableText(product)}
                              </span>
                            </span>
                          </div>
                          {editLink(product, "shrink-0")}
                        </MotionItem>
                      );
                    })}
                  </MotionList>
                </div>
              </>
            }
          />
        </ProductSelection>
      )}

      <Pagination
        basePath={`/${locale}/admin/products`}
        params={listParams}
        page={result.page}
        pageCount={result.pageCount}
        pageSize={result.pageSize}
        total={result.total}
        labels={t.common}
      />
    </div>
  );
}
