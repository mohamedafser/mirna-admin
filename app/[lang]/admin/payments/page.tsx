import { CircleCheck, CircleSlash, CreditCard } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense, type ReactNode } from "react";
import { Panel } from "@/components/catalogue/panel";
import {
  PaymentDomains,
  PaymentSettingsForm,
  VerifyAccountButton,
} from "@/components/payments/payment-settings";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, PageSkeleton } from "@/components/ui/states";
import { requireAdmin } from "@/lib/auth/dal";
import { listCurrencies } from "@/lib/currencies/queries";
import { formatDateTime } from "@/lib/format";
import { format } from "@/lib/i18n/messages";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { getPaymentSettings, getStripeOverview } from "@/lib/payments/queries";
import { getStoreRegion } from "@/lib/settings/queries";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.nav.payments, robots: { index: false, follow: false } };
}

// The session is read behind <Suspense> (Cache Components); requireAdmin()
// guards the content.
export default async function PaymentsPage() {
  const messages = await getMessages();
  return (
    <Suspense fallback={<PageSkeleton label={messages.common.loading} />}>
      <PaymentsView />
    </Suspense>
  );
}

/** This app's public origin, for the webhook URL to paste into Stripe. */
async function adminOrigin(): Promise<string> {
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host") ?? "localhost:3005";
  const proto = list.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function EnvRow({
  label,
  set,
  t,
}: {
  label: string;
  set: boolean;
  t: { set: string; notSet: string };
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="min-w-0 truncate text-muted-foreground" dir="auto">
        {label}
      </span>
      <Badge tone={set ? "success" : "error"}>
        {set ? <CircleCheck aria-hidden /> : <CircleSlash aria-hidden />}
        {set ? t.set : t.notSet}
      </Badge>
    </div>
  );
}

/**
 * Stripe settings: the server's keys (only whether each is set), the
 * connected account as last checked with Stripe, checkout options
 * (payment_settings) and the Apple Pay domains registered at Stripe. Secret
 * keys stay in the server environment and never reach this page.
 */
async function PaymentsView() {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  await requireAdmin(locale);
  const [settings, overview, currencies, { timezone }, origin] = await Promise.all([
    getPaymentSettings(),
    getStripeOverview(),
    listCurrencies(),
    getStoreRegion(),
    adminOrigin(),
  ]);
  const t = messages.payments;
  const c = t.connection;

  const header = (
    <div className="mb-4 min-w-0">
      <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t.title}</h1>
      <p className="mt-0.5 text-sm text-muted-foreground">{t.subtitle}</p>
    </div>
  );

  if (!settings) {
    return (
      <div className="mx-auto max-w-5xl">
        {header}
        <Card>
          <EmptyState icon={CreditCard} title={t.missingTitle} description={t.missingBody} />
        </Card>
      </div>
    );
  }

  const keyIsLive = overview.mode === "live";
  const modeMismatch =
    settings.stripe_livemode !== null &&
    overview.mode !== null &&
    settings.stripe_livemode !== keyIsLive;
  const row = (label: string, value: ReactNode) => (
    <div className="flex items-start justify-between gap-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end">{value}</dd>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl">
      {header}
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-3">
          <Panel title={t.settings.title}>
            <PaymentSettingsForm
              key={settings.updated_at}
              settings={settings}
              currencies={(currencies ?? []).map((currency) => ({
                code: currency.code,
                decimals: currency.decimals,
                isActive: currency.isActive,
              }))}
            />
          </Panel>

          <Panel title={t.applePay.title}>
            <p className="mb-4 text-sm text-muted-foreground">{t.applePay.body}</p>
            {overview.error ? (
              <Alert>{format(t.applePay.unavailable, { detail: overview.error })}</Alert>
            ) : overview.domains ? (
              <PaymentDomains domains={overview.domains} suggested={overview.storefrontDomain} />
            ) : (
              <Alert tone="warning">{messages.orders.payment.errors.notConfigured}</Alert>
            )}
            {overview.mode === "test" && (
              <p className="mt-3 text-xs text-muted-foreground">{t.applePay.testModeNote}</p>
            )}
          </Panel>
        </div>

        <div className="grid gap-3 lg:sticky lg:top-20">
          <Panel
            title={c.title}
            action={
              overview.mode && (
                <Badge tone={keyIsLive ? "success" : "warning"}>{c.mode[overview.mode]}</Badge>
              )
            }
          >
            <div className="grid gap-2">
              <EnvRow label={c.secretKey} set={overview.secretKey} t={c} />
              <EnvRow label={c.webhookSecret} set={overview.webhookSecret} t={c} />
              <EnvRow label={c.cronSecret} set={overview.cronSecret} t={c} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{c.keysNote}</p>

            <div className="mt-4 border-t pt-3">
              <p className="text-xs text-muted-foreground">{c.webhookUrl}</p>
              <code dir="ltr" className="mt-1 block font-mono text-xs break-all select-all">
                {origin}/api/stripe/webhook
              </code>
              <p className="mt-1 text-xs text-muted-foreground">{c.webhookHint}</p>
            </div>

            <dl className="mt-4 grid gap-2 border-t pt-3">
              {row(
                c.account,
                settings.stripe_account_id ? (
                  <span dir="ltr" className="font-mono text-xs">
                    {settings.stripe_account_id}
                  </span>
                ) : (
                  "—"
                ),
              )}
              {row(c.country, settings.stripe_account_country ?? "—")}
              {row(
                c.charges,
                settings.stripe_verified_at ? (
                  settings.stripe_charges_enabled ? (
                    <Badge tone="success">{c.chargesEnabled}</Badge>
                  ) : (
                    <span className="text-xs text-error">{c.chargesDisabled}</span>
                  )
                ) : (
                  "—"
                ),
              )}
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              {settings.stripe_verified_at
                ? format(c.verifiedOn, {
                    date: formatDateTime(settings.stripe_verified_at, locale, undefined, timezone),
                  })
                : c.notVerified}
            </p>
            {modeMismatch && (
              <Alert tone="warning" className="mt-3">
                {c.liveMismatch}
              </Alert>
            )}
            <div className="mt-3">
              <VerifyAccountButton disabled={!overview.secretKey} />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
