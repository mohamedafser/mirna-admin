import { FolderTree, SearchX } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CatalogueImage } from "@/components/catalogue/catalogue-image";
import { CategoryDialog, type EditableCategory } from "@/components/catalogue/category-dialog";
import { ListToolbar } from "@/components/catalogue/list-toolbar";
import { Pagination } from "@/components/catalogue/pagination";
import { StatusBadge } from "@/components/catalogue/status-badge";
import { StatusToggle } from "@/components/catalogue/status-toggle";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, PageSkeleton } from "@/components/ui/states";
import { requireAdmin } from "@/lib/auth/dal";
import { listCategories, parseListParams, type CategoryRow } from "@/lib/catalogue/queries";
import { formatDateTime } from "@/lib/format";
import { getLocale, getMessages } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.nav.categories };
}

// Session + search params are read behind <Suspense> so navigations show the
// skeleton instantly (Cache Components); requireAdmin() guards the content.
export default async function CategoriesPage({
  searchParams,
}: PageProps<"/[lang]/admin/categories">) {
  const messages = await getMessages();
  return (
    <Suspense fallback={<PageSkeleton label={messages.common.loading} />}>
      <Categories searchParams={searchParams} />
    </Suspense>
  );
}

function editable(category: CategoryRow): EditableCategory {
  const { id, name, slug, description, image_url, sort_order, is_active, updated_at } = category;
  return { id, name, slug, description, image_url, sort_order, is_active, updated_at };
}

async function Categories({
  searchParams,
}: Pick<PageProps<"/[lang]/admin/categories">, "searchParams">) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  await requireAdmin(locale);
  const params = parseListParams(await searchParams);
  const result = await listCategories(params);

  const listParams = {
    q: params.q,
    status: params.status === "all" ? "" : params.status,
    view: params.view === "grid" ? "grid" : "",
  };
  // Past the last page (e.g. after filtering or deactivations): go to the last one.
  if (result.rows.length === 0 && result.total > 0) {
    const query = new URLSearchParams(Object.entries(listParams).filter(([, value]) => value));
    if (result.pageCount > 1) query.set("page", String(result.pageCount));
    redirect(`/${locale}/admin/categories${query.size ? `?${query}` : ""}`);
  }

  const t = messages.catalogue;
  const c = t.categories;
  const filtered = Boolean(params.q) || params.status !== "all";
  const date = (value: string) => formatDateTime(value, locale, { dateStyle: "medium" });
  const status = (active: boolean) => (
    <StatusBadge active={active} activeLabel={t.common.active} inactiveLabel={t.common.inactive} />
  );
  const actions = (category: CategoryRow) => (
    <>
      <CategoryDialog compact category={editable(category)} />
      <StatusToggle
        compact
        kind="category"
        id={category.id}
        name={category.name}
        active={category.is_active}
      />
    </>
  );
  const meta = (category: CategoryRow) => (
    <>
      <span>
        {c.columns.products}:{" "}
        <span className="font-medium text-foreground tabular-nums">{category.productCount}</span>
      </span>
      <span>
        {c.columns.sortOrder}:{" "}
        <span className="font-medium text-foreground tabular-nums">{category.sort_order}</span>
      </span>
    </>
  );

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
            {messages.nav.categories}
            {result.total > 0 && <Badge className="tabular-nums">{result.total}</Badge>}
          </h1>
          <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">{c.subtitle}</p>
        </div>
        <CategoryDialog />
      </div>

      <ListToolbar
        viewToggle
        searchLabel={c.searchLabel}
        searchPlaceholder={c.searchPlaceholder}
        filters={[
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
              icon={FolderTree}
              title={c.emptyTitle}
              description={c.emptyBody}
              action={<CategoryDialog />}
            />
          )}
        </Card>
      ) : params.view === "grid" ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {result.rows.map((category) => (
            <li
              key={category.id}
              className="flex flex-col overflow-hidden rounded-2xl border bg-card"
            >
              <div className="relative">
                <CatalogueImage
                  src={category.image_url}
                  alt=""
                  aspect="wide"
                  sizes="(min-width: 1280px) 230px, (min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                  className="w-full rounded-none border-0 border-b"
                />
                <span className="absolute start-2 top-2">{status(category.is_active)}</span>
              </div>
              <div className="flex flex-1 flex-col gap-1 p-3">
                <p className="line-clamp-2 text-sm leading-snug font-medium">
                  <bdi>{category.name}</bdi>
                </p>
                <p className="truncate font-mono text-xs text-muted-foreground" dir="ltr">
                  {category.slug}
                </p>
                <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  {meta(category)}
                </p>
                <div className="mt-auto flex justify-end gap-1.5 pt-2">{actions(category)}</div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <>
          {/* Tablet / desktop: table */}
          <div className="hidden overflow-hidden rounded-2xl border bg-card md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">{messages.nav.categories}</caption>
              <thead className="caps border-b text-[0.625rem] text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 text-start font-medium">
                    {c.columns.name}
                  </th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">
                    {c.columns.status}
                  </th>
                  <th scope="col" className="px-4 py-3 text-end font-medium">
                    {c.columns.products}
                  </th>
                  <th scope="col" className="px-4 py-3 text-end font-medium">
                    {c.columns.sortOrder}
                  </th>
                  <th scope="col" className="hidden px-4 py-3 text-start font-medium lg:table-cell">
                    {c.columns.updated}
                  </th>
                  <th scope="col" className="w-0 px-4 py-3 text-end font-medium">
                    <span className="sr-only">{c.columns.actions}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {result.rows.map((category) => (
                  <tr key={category.id} className="transition-colors hover:bg-accent/60">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-3">
                        <CatalogueImage
                          src={category.image_url}
                          alt=""
                          sizes="40px"
                          className="size-10"
                        />
                        <div className="min-w-0">
                          <p className="line-clamp-1 font-medium">
                            <bdi>{category.name}</bdi>
                          </p>
                          <p className="truncate font-mono text-xs text-muted-foreground" dir="ltr">
                            {category.slug}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2">{status(category.is_active)}</td>
                    <td className="px-4 py-2 text-end tabular-nums">{category.productCount}</td>
                    <td className="px-4 py-2 text-end tabular-nums">{category.sort_order}</td>
                    <td className="hidden px-4 py-2 whitespace-nowrap text-muted-foreground lg:table-cell">
                      {date(category.updated_at)}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-1.5">{actions(category)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phones: compact rows */}
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card md:hidden">
            {result.rows.map((category) => (
              <li key={category.id} className="flex items-center gap-3 px-3 py-2.5">
                <CatalogueImage src={category.image_url} alt="" sizes="48px" className="size-12" />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 text-sm font-medium">
                    <bdi>{category.name}</bdi>
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {status(category.is_active)}
                    {meta(category)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">{actions(category)}</div>
              </li>
            ))}
          </ul>
        </>
      )}

      <Pagination
        basePath={`/${locale}/admin/categories`}
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
