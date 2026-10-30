import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { StatusBadge } from "@/components/catalogue/status-badge";
import { DeleteCountryButton } from "@/components/shipping/delete-country-button";
import { countryLabel } from "@/components/shipping/format";
import { ShippingCountryForm } from "@/components/shipping/shipping-country-form";
import { buttonClassName } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/states";
import { requireAdmin } from "@/lib/auth/dal";
import { listCurrencies } from "@/lib/currencies/queries";
import { formatDateTime } from "@/lib/format";
import { format } from "@/lib/i18n/messages";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { getStoreRegion } from "@/lib/settings/queries";
import {
  countryHasOrders,
  countUnweighedProducts,
  getShippingConfig,
} from "@/lib/shipping/queries";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.nav.shipping };
}

export default async function ShippingCountryPage({
  params,
}: PageProps<"/[lang]/admin/shipping/[country]">) {
  const messages = await getMessages();
  return (
    <Suspense fallback={<PageSkeleton label={messages.common.loading} />}>
      <ShippingCountryView params={params} />
    </Suspense>
  );
}

/** One delivery country: status, Standard and Express rates, estimates and thresholds. */
async function ShippingCountryView({
  params,
}: Pick<PageProps<"/[lang]/admin/shipping/[country]">, "params">) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  await requireAdmin(locale);
  const { country: code } = await params;
  if (!/^[A-Z]{2}$/.test(code)) notFound();

  const [config, currencies, inUse, { timezone }, unweighed] = await Promise.all([
    getShippingConfig(code),
    listCurrencies(),
    countryHasOrders(code),
    getStoreRegion(),
    countUnweighedProducts(),
  ]);
  if (!config) notFound();
  const currency = currencies?.find((row) => row.code === config.currencyCode);
  // country_currency → currencies is a foreign key, so this only fails mid-migration.
  if (!currency) throw new Error(`Unknown currency ${config.currencyCode}`);

  const t = messages.shipping;
  const name = countryLabel(config.countryCode, locale);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link
          href={`/${locale}/admin/shipping`}
          aria-label={t.detail.backToList}
          title={t.detail.backToList}
          className={buttonClassName({ variant: "ghost", size: "icon-sm" })}
        >
          <ArrowLeft aria-hidden className="rtl:-scale-x-100" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{name}</h1>
            <StatusBadge
              active={config.isActive}
              activeLabel={messages.catalogue.common.active}
              inactiveLabel={messages.catalogue.common.inactive}
            />
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            <span dir="ltr">{config.countryCode}</span>
            {" · "}
            {format(t.detail.chargedIn, { currency: config.currencyCode })}
            {" · "}
            {format(t.detail.lastUpdated, {
              date: formatDateTime(config.updatedAt, locale, undefined, timezone),
            })}
          </p>
        </div>
        <DeleteCountryButton countryCode={config.countryCode} name={name} inUse={inUse} />
      </div>
      {/* Keyed by version so a save (or a reload after a conflict) resets the form. */}
      <ShippingCountryForm
        key={config.updatedAt}
        config={config}
        currency={{ code: currency.code, decimals: currency.decimals }}
        countryName={name}
        unweighedProducts={unweighed}
      />
    </div>
  );
}
