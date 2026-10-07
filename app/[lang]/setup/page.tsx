import { CircleCheck, LogIn, Settings2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { NewAccountForm } from "@/components/auth/new-account-form";
import { Brand } from "@/components/layout/brand";
import { LocaleMenu } from "@/components/preferences/locale-menu";
import { ThemeMenu } from "@/components/preferences/theme-menu";
import { buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LoadingState, StatusState } from "@/components/ui/states";
import { setupFirstAdmin } from "@/lib/auth/account-actions";
import { hasAnyAdmin } from "@/lib/auth/admins";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.accounts.setup.title };
}

/**
 * One-time first-admin setup (/[lang]/setup). Only usable while no ADMIN
 * profile exists, and only with ADMIN_SETUP_TOKEN from the server
 * environment. Afterwards admins add each other from /admin/admins.
 */
export default async function SetupPage() {
  const messages = await getMessages();
  return (
    <div className="flex min-h-dvh flex-col px-safe pt-safe">
      <header className="flex items-center justify-between gap-2 p-4 sm:p-6">
        <Brand name={messages.app.name} />
        <div className="flex items-center gap-1">
          <LocaleMenu />
          <ThemeMenu />
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-2 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:items-center">
        <Card className="w-full max-w-md">
          <Suspense fallback={<LoadingState label={messages.common.loading} />}>
            <Setup />
          </Suspense>
        </Card>
      </main>
    </div>
  );
}

async function Setup() {
  await connection();
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  const t = messages.accounts.setup;

  const admin = createAdminClient();
  if (!admin || !process.env.ADMIN_SETUP_TOKEN) {
    return (
      <StatusState
        icon={Settings2}
        headingLevel="h1"
        className="py-6"
        title={t.disabledTitle}
        description={t.disabledBody}
      />
    );
  }

  if (await hasAnyAdmin(admin)) {
    return (
      <StatusState
        icon={CircleCheck}
        headingLevel="h1"
        className="py-6"
        title={t.doneTitle}
        description={t.doneBody}
        action={
          <Link href={`/${locale}/login`} className={buttonClassName()}>
            <LogIn aria-hidden />
            {messages.common.goToSignIn}
          </Link>
        }
      />
    );
  }

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
      <p className="mt-1.5 mb-6 text-sm text-muted-foreground">{t.subtitle}</p>
      <NewAccountForm
        action={setupFirstAdmin}
        locale={locale}
        withSetupToken
        submitLabel={t.submit}
      />
    </>
  );
}
