import { Settings } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { SettingsForm } from "@/components/settings/settings-form";
import { Card } from "@/components/ui/card";
import { EmptyState, PageSkeleton } from "@/components/ui/states";
import { requireAdmin } from "@/lib/auth/dal";
import { formatDateTime } from "@/lib/format";
import { format } from "@/lib/i18n/messages";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { getStoreSettings } from "@/lib/settings/queries";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.nav.settings, robots: { index: false, follow: false } };
}

// The session is read behind <Suspense> (Cache Components); requireAdmin()
// guards the content.
export default async function SettingsPage() {
  const messages = await getMessages();
  return (
    <Suspense fallback={<PageSkeleton label={messages.common.loading} />}>
      <StoreSettingsView />
    </Suspense>
  );
}

/** The single store configuration (store_settings), loaded fresh per request. */
async function StoreSettingsView() {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  await requireAdmin(locale);
  const settings = await getStoreSettings();
  const t = messages.settings;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t.title}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {t.subtitle}
          {settings && (
            <>
              {" · "}
              {format(t.lastUpdated, {
                date: formatDateTime(settings.updated_at, locale, undefined, settings.timezone),
              })}
            </>
          )}
        </p>
      </div>

      {settings ? (
        <SettingsForm settings={settings} />
      ) : (
        <Card>
          <EmptyState icon={Settings} title={t.missingTitle} description={t.missingBody} />
        </Card>
      )}
    </div>
  );
}
