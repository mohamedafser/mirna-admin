import { Boxes, History } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { StockUpdateForm } from "@/components/inventory/stock-update-form";
import { buttonClassName } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/states";
import { requireAdmin } from "@/lib/auth/dal";
import { getLocale, getMessages } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.nav.stockUpdate };
}

// The session is read behind <Suspense> (Cache Components); requireAdmin()
// guards the content.
export default async function StockUpdatePage() {
  const messages = await getMessages();
  return (
    <Suspense fallback={<PageSkeleton label={messages.common.loading} />}>
      <StockUpdate />
    </Suspense>
  );
}

/** Receive, count or remove stock for many items in one saved batch. */
async function StockUpdate() {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  await requireAdmin(locale);
  const t = messages.inventory.update;
  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {messages.nav.stockUpdate}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t.subtitle}</p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/${locale}/admin/inventory`}
            className={buttonClassName({ variant: "outline", size: "sm" })}
          >
            <Boxes aria-hidden />
            {messages.nav.inventory}
          </Link>
          <Link
            href={`/${locale}/admin/stock-movements`}
            className={buttonClassName({ variant: "outline", size: "sm" })}
          >
            <History aria-hidden />
            {messages.nav.stockMovements}
          </Link>
        </div>
      </div>
      <StockUpdateForm />
    </div>
  );
}
