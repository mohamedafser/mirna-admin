import { ArrowLeft, FolderTree } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ProductForm } from "@/components/catalogue/product-form";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PageSkeleton } from "@/components/ui/states";
import { activeRegion, supportedCurrencies } from "@/config/region";
import { requireAdmin } from "@/lib/auth/dal";
import { listCategoryOptions } from "@/lib/catalogue/queries";
import { getLocale, getMessages } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.catalogue.products.new };
}

export default async function NewProductPage() {
  const messages = await getMessages();
  return (
    <Suspense fallback={<PageSkeleton label={messages.common.loading} />}>
      <NewProduct />
    </Suspense>
  );
}

async function NewProduct() {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  await requireAdmin(locale);
  const categories = await listCategoryOptions();
  const p = messages.catalogue.products;
  const hasActiveCategory = categories.some((category) => category.isActive);

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex items-center gap-2">
        <Link
          href={`/${locale}/admin/products`}
          aria-label={p.backToList}
          title={p.backToList}
          className={buttonClassName({ variant: "ghost", size: "icon-sm" })}
        >
          <ArrowLeft aria-hidden className="rtl:-scale-x-100" />
        </Link>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{p.new}</h1>
      </div>

      {hasActiveCategory ? (
        <ProductForm
          categories={categories}
          currencies={supportedCurrencies}
          defaultCurrency={activeRegion.currencyCode}
        />
      ) : (
        <Card>
          <EmptyState
            icon={FolderTree}
            title={p.needCategoryTitle}
            description={p.needCategoryBody}
            action={
              <Link href={`/${locale}/admin/categories`} className={buttonClassName()}>
                {p.goToCategories}
              </Link>
            }
          />
        </Card>
      )}
    </div>
  );
}
