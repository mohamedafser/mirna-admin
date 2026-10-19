import { Coins, FileSpreadsheet } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { CurrencyDialog } from "@/components/currencies/currency-dialog";
import { CurrencyList } from "@/components/currencies/currency-list";
import { PriceImport } from "@/components/currencies/price-import";
import { buttonClassName } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, PageSkeleton } from "@/components/ui/states";
import { requireAdmin } from "@/lib/auth/dal";
import { listCurrencies, listShippingCountries } from "@/lib/currencies/queries";
import { getLocale, getMessages } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.nav.currencies };
}

// The session is read behind <Suspense> (Cache Components); requireAdmin()
// guards the content.
export default async function CurrenciesPage() {
  const messages = await getMessages();
  return (
    <Suspense fallback={<PageSkeleton label={messages.common.loading} />}>
      <Currencies />
    </Suspense>
  );
}

/** Currencies the store sells in, the default, and bulk price CSV import / export. */
async function Currencies() {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  await requireAdmin(locale);
  const t = messages.currencies;
  const currencies = await listCurrencies();

  if (!currencies) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-4 text-xl font-semibold tracking-tight sm:text-2xl">
          {messages.nav.currencies}
        </h1>
        <Card>
          <EmptyState icon={Coins} title={t.notReadyTitle} description={t.notReadyBody} />
        </Card>
      </div>
    );
  }
  const countries = await listShippingCountries();

  return (
    <div className="mx-auto grid max-w-5xl gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {messages.nav.currencies}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t.subtitle}</p>
        </div>
        <CurrencyDialog existing={currencies.map((currency) => currency.code)} />
      </div>

      <CurrencyList currencies={currencies} countries={countries} />

      <Card>
        <CardHeader
          icon={FileSpreadsheet}
          title={t.csv.title}
          description={t.csv.description}
          action={
            <a
              href={`/${locale}/admin/currencies/export`}
              download
              className={buttonClassName({ variant: "outline", size: "sm" })}
            >
              {t.csv.export}
            </a>
          }
        />
        <PriceImport />
      </Card>
    </div>
  );
}
