import { ChevronRight, Package, Pencil, Plus, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CatalogueImage } from "@/components/catalogue/catalogue-image";
import { ListToolbar } from "@/components/catalogue/list-toolbar";
import { Pagination } from "@/components/catalogue/pagination";
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
  listProducts,
  parseListParams,
  type ProductListRow,
} from "@/lib/catalogue/queries";
import { isUuid } from "@/lib/catalogue/validation";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { format } from "@/lib/i18n/messages";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { getStoreRegion } from "@/lib/settings/queries";
import { stockStatus } from "@/lib/inventory/rules";

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

async function Products({
  searchParams,
}: Pick<PageProps<"/[lang]/admin/products">, "searchParams">) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  await requireAdmin(locale);
  const { timezone: timeZone } = await getStoreRegion();
  const params = parseListParams(await searchParams);
  if (params.category && !isUuid(params.category)) params.category = "";

  // Independent queries run in parallel.
  const [result, categories] = await Promise.all([listProducts(params), listCategoryOptions()]);

  const listParams = {
    q: params.q,
    status: params.status === "all" ? "" : params.status,
    category: params.category,
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
  const filtered = Boolean(params.q) || params.status !== "all" || Boolean(params.category);
  const date = (value: string) => formatDateTime(value, locale, { dateStyle: "medium" }, timeZone);
  const href = (id: string) => `/${locale}/admin/products/${id}`;

  const price = (product: ProductListRow) => (
    <span className="whitespace-nowrap tabular-nums">
      <span className="font-medium">
        {formatCurrency(product.price, product.currency_code, locale)}
      </span>
      {product.compare_at_price !== null && (
        <s className="ms-1.5 text-xs text-muted-foreground">
          {formatCurrency(product.compare_at_price, product.currency_code, locale)}
        </s>
      )}
    </span>
  );
  const status = (active: boolean) => (
    <StatusBadge active={active} activeLabel={t.common.active} inactiveLabel={t.common.inactive} />
  );
  // Same rule as the Inventory page: available = stock - reserved.
  const available = (product: ProductListRow) =>
    product.inventory
      ? Math.max(0, product.inventory.quantity - product.inventory.reserved_quantity)
      : null;
  const number = (value: number) => value.toLocaleString(locale);
  const stockBadge = (product: ProductListRow) => {
    const stock = product.inventory;
    const value = stock
      ? stockStatus(stock.quantity, stock.reserved_quantity, stock.low_stock_threshold)
      : "unconfigured";
    return <StockStatusBadge status={value} label={messages.inventory.status[value]} />;
  };
  /** "12 available" (or "—" without an inventory row). */
  const availableText = (product: ProductListRow) => {
    const count = available(product);
    return count === null ? "—" : format(p.availableCount, { count: number(count) });
  };
  const category = (product: ProductListRow) =>
    product.category ? <bdi>{product.category.name}</bdi> : p.noCategory;
  const editLink = (product: ProductListRow) => (
    <Link
      href={href(product.id)}
      aria-label={`${t.common.edit}: ${product.name}`}
      title={t.common.edit}
      className={buttonClassName({ variant: "outline", size: "icon-sm" })}
    >
      <Pencil aria-hidden />
    </Link>
  );
  const addButton = (
    <Link href={`/${locale}/admin/products/new`} className={buttonClassName()}>
      <Plus aria-hidden />
      {p.add}
    </Link>
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
          {
            name: "status",
            label: t.common.status,
            options: [
              { value: "", label: t.common.statusAll },
              { value: "active", label: t.common.active },
              { value: "inactive", label: t.common.inactive },
            ],
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
      ) : params.view === "grid" ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {result.rows.map((product) => (
            <li
              key={product.id}
              className="group flex flex-col overflow-hidden rounded-2xl border bg-card transition-colors hover:border-primary/40"
            >
              <Link href={href(product.id)} className="relative block" tabIndex={-1} aria-hidden>
                <CatalogueImage
                  src={product.image?.public_url ?? null}
                  alt=""
                  sizes="(min-width: 1280px) 230px, (min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                  className="w-full rounded-none border-0 border-b"
                />
                <span className="absolute start-2 top-2">{status(product.is_active)}</span>
              </Link>
              <div className="flex flex-1 flex-col gap-1 p-3">
                <Link
                  href={href(product.id)}
                  className="line-clamp-2 text-sm leading-snug font-medium group-hover:underline"
                >
                  <bdi>{product.name}</bdi>
                </Link>
                <p className="truncate font-mono text-xs text-muted-foreground" dir="ltr">
                  {product.sku}
                </p>
                <p className="truncate text-xs text-muted-foreground">{category(product)}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  {stockBadge(product)}
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {availableText(product)}
                  </span>
                </div>
                <div className="mt-auto flex items-end justify-between gap-2 pt-2">
                  <span className="min-w-0 text-sm">{price(product)}</span>
                  <StatusToggle
                    compact
                    kind="product"
                    id={product.id}
                    name={product.name}
                    active={product.is_active}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <>
          {/* Tablet / desktop: table */}
          <div className="hidden overflow-hidden rounded-2xl border bg-card md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">{messages.nav.products}</caption>
              <thead className="caps border-b text-[0.625rem] text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 text-start font-medium">
                    {p.columns.name}
                  </th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">
                    {p.columns.sku}
                  </th>
                  <th scope="col" className="px-4 py-3 text-end font-medium">
                    {p.columns.price}
                  </th>
                  <th scope="col" className="px-4 py-3 text-end font-medium">
                    {p.columns.available}
                  </th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">
                    {p.columns.stock}
                  </th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">
                    {p.columns.status}
                  </th>
                  <th scope="col" className="hidden px-4 py-3 text-start font-medium xl:table-cell">
                    {p.columns.updated}
                  </th>
                  <th scope="col" className="w-0 px-4 py-3 text-end font-medium">
                    <span className="sr-only">{p.columns.actions}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {result.rows.map((product) => (
                  <tr key={product.id} className="transition-colors hover:bg-accent/60">
                    <td className="px-4 py-2">
                      <Link href={href(product.id)} className="group flex items-center gap-3">
                        <CatalogueImage
                          src={product.image?.public_url ?? null}
                          alt=""
                          sizes="40px"
                          className="size-10"
                        />
                        <span className="min-w-0">
                          <span className="line-clamp-1 font-medium group-hover:underline">
                            <bdi>{product.name}</bdi>
                          </span>
                          <span className="line-clamp-1 text-xs text-muted-foreground">
                            {category(product)}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs whitespace-nowrap" dir="ltr">
                      {product.sku}
                    </td>
                    <td className="px-4 py-2 text-end">{price(product)}</td>
                    <td className="px-4 py-2 text-end font-medium tabular-nums">
                      {available(product) === null ? "—" : number(available(product)!)}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{stockBadge(product)}</td>
                    <td className="px-4 py-2">{status(product.is_active)}</td>
                    <td className="hidden px-4 py-2 whitespace-nowrap text-muted-foreground xl:table-cell">
                      {date(product.updated_at)}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-1.5">
                        {editLink(product)}
                        <StatusToggle
                          compact
                          kind="product"
                          id={product.id}
                          name={product.name}
                          active={product.is_active}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phones: compact rows */}
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card md:hidden">
            {result.rows.map((product) => (
              <li key={product.id}>
                <Link
                  href={href(product.id)}
                  className="flex items-center gap-3 px-3 py-2.5 active:bg-muted/40"
                >
                  <CatalogueImage
                    src={product.image?.public_url ?? null}
                    alt=""
                    sizes="48px"
                    className="size-12"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-1 text-sm font-medium">
                      <bdi>{product.name}</bdi>
                    </span>
                    <span
                      className="block truncate font-mono text-xs text-muted-foreground"
                      dir="ltr"
                    >
                      {product.sku}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      {price(product)}
                      {status(product.is_active)}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      {stockBadge(product)}
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {availableText(product)}
                      </span>
                    </span>
                  </span>
                  <ChevronRight
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground rtl:-scale-x-100"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </>
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
