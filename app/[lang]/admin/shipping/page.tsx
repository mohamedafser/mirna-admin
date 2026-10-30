import { Globe2, PackageX, Truck } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { AddCountryDialog } from "@/components/shipping/add-country-dialog";
import { ShippingCountryList } from "@/components/shipping/country-list";
import { Card } from "@/components/ui/card";
import { EmptyState, PageSkeleton } from "@/components/ui/states";
import { requireAdmin } from "@/lib/auth/dal";
import { listCurrencies, listShippingCountries } from "@/lib/currencies/queries";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { isDeliverable } from "@/lib/shipping/rules";
import { listShippingConfigs } from "@/lib/shipping/queries";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.nav.shipping };
}

// The session is read behind <Suspense> (Cache Components); requireAdmin()
// guards the content.
export default async function ShippingPage() {
  const messages = await getMessages();
  return (
    <Suspense fallback={<PageSkeleton label={messages.common.loading} />}>
      <Shipping />
    </Suspense>
  );
}

/** Delivery countries: currency, Standard / Express rates and estimates, status. */
async function Shipping() {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  await requireAdmin(locale);
  const t = messages.shipping;
  const [configs, currencies, sellable] = await Promise.all([
    listShippingConfigs(),
    listCurrencies(),
    listShippingCountries(),
  ]);

  const heading = (
    <div className="min-w-0 flex-1">
      <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{messages.nav.shipping}</h1>
      <p className="mt-0.5 text-sm text-muted-foreground">{t.subtitle}</p>
    </div>
  );

  if (!configs) {
    return (
      <div className="mx-auto grid max-w-6xl gap-5">
        {heading}
        <Card>
          <EmptyState icon={Truck} title={t.notReadyTitle} description={t.notReadyBody} />
        </Card>
      </div>
    );
  }

  const configured = new Set(configs.map((config) => config.countryCode));
  const available = sellable.filter((row) => !configured.has(row.countryCode));
  const decimals = Object.fromEntries(
    (currencies ?? []).map((currency) => [currency.code, currency.decimals]),
  );
  const delivering = configs.filter(isDeliverable).length;
  const stats = [
    { label: t.stats.countries, value: configs.length, icon: Globe2 },
    { label: t.stats.delivering, value: delivering, icon: Truck },
    { label: t.stats.disabled, value: configs.length - delivering, icon: PackageX },
  ];

  return (
    <div className="mx-auto grid max-w-6xl gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {heading}
        <AddCountryDialog available={available} />
      </div>

      {configs.length === 0 ? (
        <Card>
          <EmptyState
            icon={Globe2}
            title={t.emptyTitle}
            description={t.emptyBody}
            action={<AddCountryDialog available={available} />}
          />
        </Card>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-3">
            {stats.map(({ label, value, icon: Icon }) => (
              <div key={label} className="rounded-2xl border bg-card p-3 sm:p-4">
                <dt className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Icon aria-hidden className="hidden size-4 shrink-0 sm:block" />
                  {label}
                </dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums sm:text-2xl">{value}</dd>
              </div>
            ))}
          </dl>
          <ShippingCountryList countries={configs} decimals={decimals} />
        </>
      )}
    </div>
  );
}
