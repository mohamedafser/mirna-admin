import { LayoutDashboard } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageSkeleton, StatusState } from "@/components/ui/states";
import { placeholderSections } from "@/config/admin-nav";
import { requireAdmin } from "@/lib/auth/dal";
import { format } from "@/lib/i18n/messages";
import { getLocale, getMessages } from "@/lib/i18n/server";

/**
 * "Coming soon" page for every section not built yet (products, orders, …).
 * Real sections get their own folder in a later phase, which takes
 * precedence over this dynamic route. Unknown segments 404.
 */
export function generateStaticParams() {
  return placeholderSections.map((section) => ({ section: section.segment }));
}

function findPlaceholder(segment: string) {
  return placeholderSections.find((section) => section.segment === segment);
}

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/admin/[section]">): Promise<Metadata> {
  const [{ section }, messages] = await Promise.all([params, getMessages()]);
  const match = findPlaceholder(section);
  return { title: match ? messages.nav[match.key] : messages.errors.notFoundTitle };
}

// The session is read behind <Suspense> so navigations render the skeleton
// instantly (Cache Components instant-navigation rule); requireAdmin() still
// guards everything the inner component renders.
export default async function PlaceholderSectionPage({
  params,
}: PageProps<"/[lang]/admin/[section]">) {
  const messages = await getMessages();
  return (
    <Suspense fallback={<PageSkeleton label={messages.common.loading} />}>
      <PlaceholderSection params={params} />
    </Suspense>
  );
}

async function PlaceholderSection({
  params,
}: Pick<PageProps<"/[lang]/admin/[section]">, "params">) {
  const { section } = await params;
  const match = findPlaceholder(section);
  if (!match) notFound();

  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  await requireAdmin(locale);
  const title = messages.nav[match.key];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <Badge>{messages.comingSoon.badge}</Badge>
      </div>
      <Card>
        <StatusState
          icon={match.icon}
          title={format(messages.comingSoon.title, { section: title })}
          description={messages.comingSoon.body}
          action={
            <Link href={`/${locale}/admin`} className={buttonClassName({ variant: "outline" })}>
              <LayoutDashboard aria-hidden />
              {messages.comingSoon.back}
            </Link>
          }
        />
      </Card>
    </div>
  );
}
