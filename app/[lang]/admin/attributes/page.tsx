import { Pencil, Plus, SearchX, SlidersHorizontal } from "lucide-react";
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
import { listAttributes, parseDataTypeFilter, type AttributeRow } from "@/lib/attributes/queries";
import { ATTRIBUTE_DATA_TYPES, isChoiceType } from "@/lib/attributes/rules";
import { requireAdmin } from "@/lib/auth/dal";
import { parseListParams } from "@/lib/catalogue/queries";
import { formatDateTime } from "@/lib/format";
import { format } from "@/lib/i18n/messages";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { getStoreRegion } from "@/lib/settings/queries";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.nav.attributes };
}

export default async function AttributesPage({
  searchParams,
}: PageProps<"/[lang]/admin/attributes">) {
  const messages = await getMessages();
  return (
    <Suspense fallback={<PageSkeleton label={messages.common.loading} />}>
      <Attributes searchParams={searchParams} />
    </Suspense>
  );
}

async function Attributes({
  searchParams,
}: Pick<PageProps<"/[lang]/admin/attributes">, "searchParams">) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  await requireAdmin(locale);
  const { timezone: timeZone } = await getStoreRegion();
  const rawParams = await searchParams;
  const params = parseListParams(rawParams);
  const dataType = parseDataTypeFilter(rawParams);
  const result = await listAttributes(params, dataType);

  const basePath = `/${locale}/admin/attributes`;
  const listParams = {
    q: params.q,
    status: params.status === "all" ? "" : params.status,
    type: dataType,
  };
  if (result.rows.length === 0 && result.total > 0) {
    const query = new URLSearchParams(Object.entries(listParams).filter(([, value]) => value));
    if (result.pageCount > 1) query.set("page", String(result.pageCount));
    redirect(`${basePath}${query.size ? `?${query}` : ""}`);
  }

  const common = messages.catalogue.common;
  const a = messages.attributes;
  const t = a.attrs;
  const filtered = Boolean(params.q) || params.status !== "all" || Boolean(dataType);
  const date = (value: string) => formatDateTime(value, locale, { dateStyle: "medium" }, timeZone);
  const status = (active: boolean) => (
    <StatusBadge active={active} activeLabel={common.active} inactiveLabel={common.inactive} />
  );
  const typeLabel = (attribute: AttributeRow) =>
    `${a.dataTypes[attribute.data_type]}${attribute.unit ? ` (${attribute.unit})` : ""}`;
  const valueCount = (attribute: AttributeRow) =>
    isChoiceType(attribute.data_type) ? attribute.valueCount : "—";
  const createLink = (
    <Link href={`${basePath}/new`} className={buttonClassName()}>
      <Plus aria-hidden />
      {t.create}
    </Link>
  );
  const actions = (attribute: AttributeRow) => (
    <>
      <Link
        href={`${basePath}/${attribute.id}`}
        aria-label={`${common.edit}: ${attribute.name}`}
        title={common.edit}
        className={buttonClassName({ variant: "outline", size: "icon-sm" })}
      >
        <Pencil aria-hidden />
      </Link>
      <StatusToggle
        compact
        kind="attribute"
        id={attribute.id}
        name={attribute.name}
        active={attribute.is_active}
      />
      <DeleteButton
        compact
        kind="attribute"
        id={attribute.id}
        name={attribute.name}
        inUse={attribute.usageCount > 0}
      />
    </>
  );

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
            {messages.nav.attributes}
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
            name: "type",
            label: t.typeFilter,
            options: [
              { value: "", label: t.allTypes },
              ...ATTRIBUTE_DATA_TYPES.map((type) => ({ value: type, label: a.dataTypes[type] })),
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
              icon={SlidersHorizontal}
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
              <caption className="sr-only">{messages.nav.attributes}</caption>
              <thead className="caps border-b text-[0.625rem] text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 text-start font-medium">
                    {t.columns.name}
                  </th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">
                    {t.columns.dataType}
                  </th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">
                    {t.columns.status}
                  </th>
                  <th scope="col" className="px-4 py-3 text-end font-medium">
                    {t.columns.values}
                  </th>
                  <th scope="col" className="px-4 py-3 text-end font-medium">
                    {t.columns.types}
                  </th>
                  <th scope="col" className="hidden px-4 py-3 text-start font-medium xl:table-cell">
                    {t.columns.updated}
                  </th>
                  <th scope="col" className="w-0 px-4 py-3 text-end font-medium">
                    <span className="sr-only">{t.columns.actions}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {result.rows.map((attribute) => (
                  <tr key={attribute.id} className="transition-colors hover:bg-accent/60">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`${basePath}/${attribute.id}`}
                        className="line-clamp-1 font-medium hover:underline"
                      >
                        <bdi>{attribute.name}</bdi>
                      </Link>
                      <p className="truncate font-mono text-xs text-muted-foreground" dir="ltr">
                        {attribute.code}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{typeLabel(attribute)}</td>
                    <td className="px-4 py-2.5">{status(attribute.is_active)}</td>
                    <td className="px-4 py-2.5 text-end tabular-nums">{valueCount(attribute)}</td>
                    <td className="px-4 py-2.5 text-end tabular-nums">{attribute.typeCount}</td>
                    <td className="hidden px-4 py-2.5 whitespace-nowrap text-muted-foreground xl:table-cell">
                      {date(attribute.updated_at)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1.5">{actions(attribute)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phones: compact rows */}
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card md:hidden">
            {result.rows.map((attribute) => (
              <li key={attribute.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`${basePath}/${attribute.id}`}
                    className="line-clamp-1 text-sm font-medium hover:underline"
                  >
                    <bdi>{attribute.name}</bdi>
                  </Link>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {status(attribute.is_active)}
                    <span>{typeLabel(attribute)}</span>
                    {isChoiceType(attribute.data_type) && (
                      <span>{format(t.valueCount, { count: attribute.valueCount })}</span>
                    )}
                    <span>{format(t.typeCount, { count: attribute.typeCount })}</span>
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">{actions(attribute)}</div>
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
