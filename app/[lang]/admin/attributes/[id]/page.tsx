import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AttributeForm } from "@/components/attributes/attribute-form";
import { DeleteButton } from "@/components/attributes/delete-button";
import { StatusBadge } from "@/components/catalogue/status-badge";
import { StatusToggle } from "@/components/catalogue/status-toggle";
import { buttonClassName } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/states";
import { getAttribute } from "@/lib/attributes/queries";
import { requireAdmin } from "@/lib/auth/dal";
import { isUuid } from "@/lib/catalogue/validation";
import { format } from "@/lib/i18n/messages";
import { getLocale, getMessages } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.attributes.attrs.edit };
}

export default async function AttributePage({
  params,
}: PageProps<"/[lang]/admin/attributes/[id]">) {
  const messages = await getMessages();
  return (
    <Suspense fallback={<PageSkeleton label={messages.common.loading} />}>
      <AttributeDetailView params={params} />
    </Suspense>
  );
}

async function AttributeDetailView({
  params,
}: Pick<PageProps<"/[lang]/admin/attributes/[id]">, "params">) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  await requireAdmin(locale);
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const attribute = await getAttribute(id);
  if (!attribute) notFound();

  const common = messages.catalogue.common;
  const a = messages.attributes;
  const t = a.attrs;
  const basePath = `/${locale}/admin/attributes`;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link
          href={basePath}
          aria-label={t.backToList}
          title={t.backToList}
          className={buttonClassName({ variant: "ghost", size: "icon-sm" })}
        >
          <ArrowLeft aria-hidden className="rtl:-scale-x-100" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
              <bdi>{attribute.name}</bdi>
            </h1>
            <StatusBadge
              active={attribute.is_active}
              activeLabel={common.active}
              inactiveLabel={common.inactive}
            />
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            <span className="font-mono" dir="ltr">
              {attribute.code}
            </span>
            {" · "}
            {a.dataTypes[attribute.data_type]}
            {" · "}
            {format(t.typeCount, { count: attribute.typeCount })}
          </p>
        </div>
        <div className="flex gap-1.5">
          <StatusToggle
            kind="attribute"
            id={attribute.id}
            name={attribute.name}
            active={attribute.is_active}
          />
          <DeleteButton
            kind="attribute"
            id={attribute.id}
            name={attribute.name}
            inUse={attribute.usageCount > 0}
            redirectTo={basePath}
          />
        </div>
      </div>
      {/* Keyed by version so a newer save (or status change) reloads the form. */}
      <AttributeForm key={attribute.updated_at} attribute={attribute} />
    </div>
  );
}
