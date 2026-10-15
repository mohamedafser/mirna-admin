import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AttributeForm } from "@/components/attributes/attribute-form";
import { buttonClassName } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/states";
import { requireAdmin } from "@/lib/auth/dal";
import { getLocale, getMessages } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.attributes.attrs.create };
}

export default async function NewAttributePage() {
  const messages = await getMessages();
  return (
    <Suspense fallback={<PageSkeleton label={messages.common.loading} />}>
      <NewAttribute />
    </Suspense>
  );
}

async function NewAttribute() {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  await requireAdmin(locale);
  const t = messages.attributes.attrs;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex items-center gap-2">
        <Link
          href={`/${locale}/admin/attributes`}
          aria-label={t.backToList}
          title={t.backToList}
          className={buttonClassName({ variant: "ghost", size: "icon-sm" })}
        >
          <ArrowLeft aria-hidden className="rtl:-scale-x-100" />
        </Link>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t.create}</h1>
      </div>
      <AttributeForm />
    </div>
  );
}
