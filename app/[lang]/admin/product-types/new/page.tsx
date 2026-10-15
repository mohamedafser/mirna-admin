import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ProductTypeForm } from "@/components/attributes/product-type-form";
import { buttonClassName } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/states";
import { getAttributeCatalog } from "@/lib/attributes/queries";
import { requireAdmin } from "@/lib/auth/dal";
import { getLocale, getMessages } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.attributes.types.create };
}

export default async function NewProductTypePage() {
  const messages = await getMessages();
  return (
    <Suspense fallback={<PageSkeleton label={messages.common.loading} />}>
      <NewProductType />
    </Suspense>
  );
}

async function NewProductType() {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  await requireAdmin(locale);
  const catalog = await getAttributeCatalog();
  const t = messages.attributes.types;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex items-center gap-2">
        <Link
          href={`/${locale}/admin/product-types`}
          aria-label={t.backToList}
          title={t.backToList}
          className={buttonClassName({ variant: "ghost", size: "icon-sm" })}
        >
          <ArrowLeft aria-hidden className="rtl:-scale-x-100" />
        </Link>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t.create}</h1>
      </div>
      <ProductTypeForm attributes={catalog?.attributes ?? []} />
    </div>
  );
}
