import {
  ArrowRightLeft,
  BadgeCheck,
  CalendarClock,
  Clock,
  Coins,
  Languages,
  Mail,
  MapPin,
  ShieldCheck,
  Smartphone,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PwaStatus } from "@/components/pwa/pwa-status";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, DetailList, IconBadge } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/states";
import { navSections, sectionHref } from "@/config/admin-nav";
import { getDirection, localeConfig } from "@/config/i18n";
import { requireAdmin } from "@/lib/auth/dal";
import { formatDateTime } from "@/lib/format";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { getStoreRegion } from "@/lib/settings/queries";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.nav.dashboard };
}

function StatTile({ icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center">
      <IconBadge icon={icon} />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold break-words">{value}</p>
      </div>
    </div>
  );
}

// The session is read behind <Suspense> so navigations render the skeleton
// instantly (Cache Components instant-navigation rule); requireAdmin() still
// guards everything the inner component renders.
export default async function DashboardPage() {
  const messages = await getMessages();
  return (
    <Suspense fallback={<PageSkeleton label={messages.common.loading} />}>
      <Dashboard />
    </Suspense>
  );
}

/**
 * Admin home. Intentionally shows no business metrics yet (no fake numbers):
 * a welcome, the signed-in account, workspace settings and section shortcuts.
 */
async function Dashboard() {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  const user = await requireAdmin(locale);
  const region = await getStoreRegion();
  const t = messages.admin;
  const dir = getDirection(locale);
  const shortcuts = navSections.filter((section) => section.key !== "dashboard");

  return (
    <div className="mx-auto max-w-6xl">
      {/* Welcome */}
      <section className="relative overflow-hidden rounded-2xl border bg-card p-6 sm:p-8">
        <div className="relative flex flex-wrap items-center gap-5">
          <Avatar name={user.fullName} email={user.email} className="size-14 text-base" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t.welcomeTitle}</h1>
            <p className="mt-1.5 text-muted-foreground">{t.welcomeBody}</p>
          </div>
        </div>
      </section>

      {/* Workspace at a glance */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile
          icon={Languages}
          label={t.workspace.locale}
          value={localeConfig[locale].nativeName}
        />
        <StatTile
          icon={ArrowRightLeft}
          label={t.workspace.direction}
          value={messages.direction[dir]}
        />
        <StatTile icon={Coins} label={t.workspace.currency} value={region.currencyCode} />
        <StatTile icon={Clock} label={t.workspace.timezone} value={region.timezone} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader icon={UserRound} title={t.account.title} />
          <DetailList
            items={[
              ...(user.fullName
                ? [{ icon: UserRound, label: t.account.name, value: <bdi>{user.fullName}</bdi> }]
                : []),
              { icon: Mail, label: t.account.email, value: <bdi>{user.email}</bdi> },
              {
                icon: ShieldCheck,
                label: t.account.role,
                value: (
                  <Badge tone="primary">
                    <BadgeCheck aria-hidden />
                    {messages.roles[user.role]}
                  </Badge>
                ),
              },
              {
                icon: BadgeCheck,
                label: t.account.status,
                value: (
                  <Badge tone="success" dot>
                    {t.account.active}
                  </Badge>
                ),
              },
            ]}
          />
        </Card>

        <Card>
          <CardHeader icon={MapPin} title={t.workspace.title} />
          <DetailList
            items={[
              { icon: MapPin, label: t.workspace.country, value: region.countryCode },
              { icon: Coins, label: t.workspace.currency, value: region.currencyCode },
              {
                icon: CalendarClock,
                label: t.workspace.localTime,
                value: formatDateTime(new Date(), locale, undefined, region.timezone),
              },
            ]}
          />
        </Card>

        <Card>
          <CardHeader icon={Smartphone} title={t.pwa.title} />
          <PwaStatus />
        </Card>
      </div>

      {/* Section shortcuts (placeholders until later phases) */}
      <h2 className="mt-8 mb-3 text-sm font-medium text-muted-foreground">{messages.nav.menu}</h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {shortcuts.map((section) => {
          const Icon = section.icon;
          return (
            <li key={section.key}>
              <Link
                href={sectionHref(locale, section)}
                className="group flex h-full flex-col gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
              >
                <Icon aria-hidden className="size-5 text-primary" />
                <span className="text-sm font-medium">{messages.nav[section.key]}</span>
                {!section.available && (
                  <Badge className="self-start">{messages.comingSoon.badge}</Badge>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
