import { SearchX, Tags } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListToolbar } from "@/components/catalogue/list-toolbar";
import { Pagination } from "@/components/catalogue/pagination";
import { StatusBadge } from "@/components/catalogue/status-badge";
import { StatusToggle } from "@/components/catalogue/status-toggle";
import { TagDialog, type EditableTag } from "@/components/catalogue/tag-dialog";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, PageSkeleton } from "@/components/ui/states";
import { requireAdmin } from "@/lib/auth/dal";
import { listTags, parseListParams, type TagRow } from "@/lib/catalogue/queries";
import { formatDateTime } from "@/lib/format";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { getStoreRegion } from "@/lib/settings/queries";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.nav.tags };
}

// Session + search params are read behind <Suspense> so navigations show the
// skeleton instantly (Cache Components); requireAdmin() guards the content.
export default async function TagsPage({ searchParams }: PageProps<"/[lang]/admin/tags">) {
  const messages = await getMessages();
  return (
    <Suspense fallback={<PageSkeleton label={messages.common.loading} />}>
      <TagList searchParams={searchParams} />
    </Suspense>
  );
}

function editable({ id, name, slug, is_active, updated_at }: TagRow): EditableTag {
  return { id, name, slug, is_active, updated_at };
}

async function TagList({ searchParams }: Pick<PageProps<"/[lang]/admin/tags">, "searchParams">) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  await requireAdmin(locale);
  const { timezone: timeZone } = await getStoreRegion();
  const params = parseListParams(await searchParams);
  const result = await listTags(params);

  const t = messages.catalogue;
  const c = t.tags;
  if (!result) {
    return (
      <div className="mx-auto max-w-7xl">
        <h1 className="mb-4 text-xl font-semibold tracking-tight sm:text-2xl">
          {messages.nav.tags}
        </h1>
        <Card>
          <EmptyState icon={Tags} title={c.notReadyTitle} description={c.notReadyBody} />
        </Card>
      </div>
    );
  }

  const listParams = { q: params.q, status: params.status === "all" ? "" : params.status };
  // Past the last page (e.g. after filtering): go to the last one.
  if (result.rows.length === 0 && result.total > 0) {
    const query = new URLSearchParams(Object.entries(listParams).filter(([, value]) => value));
    if (result.pageCount > 1) query.set("page", String(result.pageCount));
    redirect(`/${locale}/admin/tags${query.size ? `?${query}` : ""}`);
  }

  const filtered = Boolean(params.q) || params.status !== "all";
  const date = (value: string) => formatDateTime(value, locale, { dateStyle: "medium" }, timeZone);
  const status = (active: boolean) => (
    <StatusBadge active={active} activeLabel={t.common.active} inactiveLabel={t.common.inactive} />
  );
  const actions = (tag: TagRow) => (
    <>
      <TagDialog compact tag={editable(tag)} />
      <StatusToggle compact kind="tag" id={tag.id} name={tag.name} active={tag.is_active} />
    </>
  );

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
            {messages.nav.tags}
            {result.total > 0 && <Badge className="tabular-nums">{result.total}</Badge>}
          </h1>
          <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">{c.subtitle}</p>
        </div>
        <TagDialog />
      </div>

      <ListToolbar
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
              icon={Tags}
              title={c.emptyTitle}
              description={c.emptyBody}
              action={<TagDialog />}
            />
          )}
        </Card>
      ) : (
        <>
          {/* Tablet / desktop: table */}
          <div className="hidden overflow-hidden rounded-2xl border bg-card md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">{messages.nav.tags}</caption>
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
                  <th scope="col" className="hidden px-4 py-3 text-start font-medium lg:table-cell">
                    {c.columns.updated}
                  </th>
                  <th scope="col" className="w-0 px-4 py-3 text-end font-medium">
                    <span className="sr-only">{c.columns.actions}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {result.rows.map((tag) => (
                  <tr key={tag.id} className="transition-colors hover:bg-accent/60">
                    <td className="px-4 py-2.5">
                      <p className="line-clamp-1 font-medium">
                        <bdi>{tag.name}</bdi>
                      </p>
                      <p className="truncate font-mono text-xs text-muted-foreground" dir="ltr">
                        {tag.slug}
                      </p>
                    </td>
                    <td className="px-4 py-2.5">{status(tag.is_active)}</td>
                    <td className="px-4 py-2.5 text-end tabular-nums">{tag.productCount}</td>
                    <td className="hidden px-4 py-2.5 whitespace-nowrap text-muted-foreground lg:table-cell">
                      {date(tag.updated_at)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1.5">{actions(tag)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phones: compact rows */}
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card md:hidden">
            {result.rows.map((tag) => (
              <li key={tag.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 text-sm font-medium">
                    <bdi>{tag.name}</bdi>
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {status(tag.is_active)}
                    <span>
                      {c.columns.products}:{" "}
                      <span className="font-medium text-foreground tabular-nums">
                        {tag.productCount}
                      </span>
                    </span>
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">{actions(tag)}</div>
              </li>
            ))}
          </ul>
        </>
      )}

      <Pagination
        basePath={`/${locale}/admin/tags`}
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
