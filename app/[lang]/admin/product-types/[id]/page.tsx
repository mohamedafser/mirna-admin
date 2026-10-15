import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DeleteButton } from "@/components/attributes/delete-button";
import { ProductTypeForm } from "@/components/attributes/product-type-form";
import { StatusBadge } from "@/components/catalogue/status-badge";
import { StatusToggle } from "@/components/catalogue/status-toggle";
import { buttonClassName } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/states";
import { getAttributeCatalog, getProductType } from "@/lib/attributes/queries";
import { requireAdmin } from "@/lib/auth/dal";
import { isUuid } from "@/lib/catalogue/validation";
import { format } from "@/lib/i18n/messages";
import { getLocale, getMessages } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.attributes.types.edit };
}

export default async function ProductTypePage({
  params,
}: PageProps<"/[lang]/admin/product-types/[id]">) {
  const messages = await getMessages();
  return (
    <Suspense fallback={<PageSkeleton label={messages.common.loading} />}>
      <ProductTypeDetail params={params} />
    </Suspense>
  );
}

async function ProductTypeDetail({
  params,
}: Pick<PageProps<"/[lang]/admin/product-types/[id]">, "params">) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  await requireAdmin(locale);
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [productType, catalog] = await Promise.all([getProductType(id), getAttributeCatalog()]);
  if (!productType) notFound();

  const common = messages.catalogue.common;
  const t = messages.attributes.types;
  const basePath = `/${locale}/admin/product-types`;

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
              <bdi>{productType.name}</bdi>
            </h1>
            <StatusBadge
              active={productType.is_active}
              activeLabel={common.active}
              inactiveLabel={common.inactive}
            />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {format(t.productCount, { count: productType.productCount })}
          </p>
        </div>
        <div className="flex gap-1.5">
          <StatusToggle
            kind="productType"
            id={productType.id}
            name={productType.name}
            active={productType.is_active}
          />
          <DeleteButton
            kind="productType"
            id={productType.id}
            name={productType.name}
            inUse={productType.productCount > 0}
            redirectTo={basePath}
          />
        </div>
      </div>
      {/* Keyed by version so a newer save (or status change) reloads the form. */}
      <ProductTypeForm
        key={productType.updated_at}
        productType={productType}
        attributes={catalog?.attributes ?? []}
      />
    </div>
  );
}
