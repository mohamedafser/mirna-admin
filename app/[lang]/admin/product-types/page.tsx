import { Pencil, Plus, SearchX, Shapes } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DeleteButton } from "@/components/attributes/delete-button";
import { ListToolbar } from "@/components/catalogue/list-toolbar";
import { Pagination } from "@/components/catalogue/pagination";
import { StatusBadge } from "@/components/catalogue/status-badge";
import { StatusToggle } from "@/components/catalogue/status-toggle";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PageSkeleton } from "@/components/ui/states";
import { listProductTypes, type ProductTypeRow } from "@/lib/attributes/queries";
import { requireAdmin } from "@/lib/auth/dal";
import { parseListParams } from "@/lib/catalogue/queries";
import { formatDateTime } from "@/lib/format";
import { format } from "@/lib/i18n/messages";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { getStoreRegion } from "@/lib/settings/queries";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.nav.productTypes };
}

export default async function ProductTypesPage({
  searchParams,
}: PageProps<"/[lang]/admin/product-types">) {
  const messages = await getMessages();
  return (
    <Suspense fallback={<PageSkeleton label={messages.common.loading} />}>
      <ProductTypes searchParams={searchParams} />
    </Suspense>
  );
}

async function ProductTypes({
  searchParams,
}: Pick<PageProps<"/[lang]/admin/product-types">, "searchParams">) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  await requireAdmin(locale);
  const { timezone: timeZone } = await getStoreRegion();
  const params = parseListParams(await searchParams);
  const result = await listProductTypes(params);

  const basePath = `/${locale}/admin/product-types`;
  const listParams = { q: params.q, status: params.status === "all" ? "" : params.status };
  // Past the last page (e.g. after filtering or deletions): go to the last one.
  if (result.rows.length === 0 && result.total > 0) {
    const query = new URLSearchParams(Object.entries(listParams).filter(([, value]) => value));
    if (result.pageCount > 1) query.set("page", String(result.pageCount));
    redirect(`${basePath}${query.size ? `?${query}` : ""}`);
  }

  const common = messages.catalogue.common;
  const a = messages.attributes;
  const t = a.types;
  const filtered = Boolean(params.q) || params.status !== "all";
  const date = (value: string) => formatDateTime(value, locale, { dateStyle: "medium" }, timeZone);
  const status = (active: boolean) => (
    <StatusBadge active={active} activeLabel={common.active} inactiveLabel={common.inactive} />
  );
  const createLink = (
    <Link href={`${basePath}/new`} className={buttonClassName()}>
      <Plus aria-hidden />
      {t.create}
    </Link>
  );
  const actions = (type: ProductTypeRow) => (
    <>
      <Link
        href={`${basePath}/${type.id}`}
        aria-label={`${common.edit}: ${type.name}`}
        title={common.edit}
        className={buttonClassName({ variant: "outline", size: "icon-sm" })}
      >
        <Pencil aria-hidden />
      </Link>
      <StatusToggle
        compact
        kind="productType"
        id={type.id}
        name={type.name}
        active={type.is_active}
      />
      <DeleteButton
        compact
        kind="productType"
        id={type.id}
        name={type.name}
        inUse={type.productCount > 0}
      />
    </>
  );

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
            {messages.nav.productTypes}
            {result.total > 0 && <Badge className="tabular-nums">{result.total}</Badge>}
          </h1>
          <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">{t.subtitle}</p>
        </div>
        {createLink}
      </div>

      <ListToolbar
        searchLabel={t.searchLabel}
        searchPlaceholder={t.searchPlaceholder}
        filters={[
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

      {result.total === 0 ? (
        <Card>
          {filtered ? (
            <EmptyState
              icon={SearchX}
              title={common.noResultsTitle}
              description={common.noResultsBody}
            />
          ) : (
            <EmptyState
              icon={Shapes}
              title={t.emptyTitle}
              description={t.emptyBody}
              action={createLink}
            />
          )}
        </Card>
      ) : (
        <>
          {/* Tablet / desktop: table */}
          <div className="hidden overflow-hidden rounded-2xl border bg-card md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">{messages.nav.productTypes}</caption>
              <thead className="caps border-b text-[0.625rem] text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 text-start font-medium">
                    {t.columns.name}
                  </th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">
                    {t.columns.status}
                  </th>
                  <th scope="col" className="px-4 py-3 text-end font-medium">
                    {t.columns.attributes}
                  </th>
                  <th scope="col" className="px-4 py-3 text-end font-medium">
                    {t.columns.products}
                  </th>
                  <th scope="col" className="hidden px-4 py-3 text-start font-medium lg:table-cell">
                    {t.columns.updated}
                  </th>
                  <th scope="col" className="w-0 px-4 py-3 text-end font-medium">
                    <span className="sr-only">{t.columns.actions}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {result.rows.map((type) => (
                  <tr key={type.id} className="transition-colors hover:bg-accent/60">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`${basePath}/${type.id}`}
                        className="line-clamp-1 font-medium hover:underline"
                      >
                        <bdi>{type.name}</bdi>
                      </Link>
                      <p className="truncate font-mono text-xs text-muted-foreground" dir="ltr">
                        {type.slug}
                      </p>
                    </td>
                    <td className="px-4 py-2.5">{status(type.is_active)}</td>
                    <td className="px-4 py-2.5 text-end tabular-nums">{type.attributeCount}</td>
                    <td className="px-4 py-2.5 text-end tabular-nums">{type.productCount}</td>
                    <td className="hidden px-4 py-2.5 whitespace-nowrap text-muted-foreground lg:table-cell">
                      {date(type.updated_at)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1.5">{actions(type)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phones: compact rows */}
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card md:hidden">
            {result.rows.map((type) => (
              <li key={type.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`${basePath}/${type.id}`}
                    className="line-clamp-1 text-sm font-medium hover:underline"
                  >
                    <bdi>{type.name}</bdi>
                  </Link>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {status(type.is_active)}
                    <span>{format(t.attributeCount, { count: type.attributeCount })}</span>
                    <span>{format(t.productCount, { count: type.productCount })}</span>
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">{actions(type)}</div>
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
        labels={common}
      />
    </div>
  );
}
