import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CatalogueImage } from "@/components/catalogue/catalogue-image";
import { Panel } from "@/components/catalogue/panel";
import { ProductForm, type EditableProduct } from "@/components/catalogue/product-form";
import { ProductImages } from "@/components/catalogue/product-images";
import { StatusBadge } from "@/components/catalogue/status-badge";
import { StatusToggle } from "@/components/catalogue/status-toggle";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/states";
import { supportedCurrencies } from "@/config/region";
import { requireAdmin } from "@/lib/auth/dal";
import { getProduct, listCategoryOptions, type ProductDetail } from "@/lib/catalogue/queries";
import { isUuid } from "@/lib/catalogue/validation";
import { formatDateTime } from "@/lib/format";
import { format } from "@/lib/i18n/messages";
import { getLocale, getMessages } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.catalogue.products.details };
}

export default async function ProductPage({ params }: PageProps<"/[lang]/admin/products/[id]">) {
  const messages = await getMessages();
  return (
    <Suspense fallback={<PageSkeleton label={messages.common.loading} />}>
      <ProductDetailView params={params} />
    </Suspense>
  );
}

/** Only the fields the form edits are sent to the client. */
function editableProduct(product: ProductDetail): EditableProduct {
  const { id, name, slug, sku, category_id, short_description, description } = product;
  const { price, compare_at_price, currency_code, is_active, updated_at } = product;
  return {
    id,
    name,
    slug,
    sku,
    category_id,
    short_description,
    description,
    price,
    compare_at_price,
    currency_code,
    is_active,
    updated_at,
  };
}

/**
 * Read + edit in one place: a compact header (primary image, status, dates,
 * activate/deactivate), the edit form (always loaded fresh) and the image
 * gallery beside it. One product query (with category and images) and one
 * category-options query per request.
 */
async function ProductDetailView({
  params,
}: Pick<PageProps<"/[lang]/admin/products/[id]">, "params">) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  await requireAdmin(locale);
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [product, categories] = await Promise.all([getProduct(id), listCategoryOptions()]);
  if (!product) notFound();

  const t = messages.catalogue;
  const p = t.products;
  const primary = product.images.find((image) => image.is_primary) ?? product.images[0] ?? null;
  const dateTime = (value: string) => formatDateTime(value, locale);

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link
          href={`/${locale}/admin/products`}
          aria-label={p.backToList}
          title={p.backToList}
          className={buttonClassName({ variant: "ghost", size: "icon-sm" })}
        >
          <ArrowLeft aria-hidden className="rtl:-scale-x-100" />
        </Link>
        <CatalogueImage
          src={primary?.public_url ?? null}
          alt=""
          sizes="48px"
          className="size-12"
          priority
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
              <bdi>{product.name}</bdi>
            </h1>
            <StatusBadge
              active={product.is_active}
              activeLabel={t.common.active}
              inactiveLabel={t.common.inactive}
            />
            {product.category && !product.category.is_active && (
              <Badge tone="warning">
                {format(p.fields.inactiveCategory, { name: product.category.name })}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            <span className="font-mono" dir="ltr">
              {product.sku}
            </span>
            {" · "}
            {format(p.meta, {
              created: dateTime(product.created_at),
              updated: dateTime(product.updated_at),
            })}
          </p>
        </div>
        <StatusToggle
          kind="product"
          id={product.id}
          name={product.name}
          active={product.is_active}
        />
      </div>

      <ProductForm
        product={editableProduct(product)}
        categories={categories}
        currencies={supportedCurrencies}
        defaultCurrency={product.currency_code}
        aside={
          <Panel title={p.sections.images}>
            <ProductImages
              productId={product.id}
              productName={product.name}
              images={product.images}
            />
          </Panel>
        }
      />
    </div>
  );
}
