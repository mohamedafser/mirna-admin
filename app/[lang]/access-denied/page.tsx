import { ShieldX, UserX } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Brand } from "@/components/layout/brand";
import { Card } from "@/components/ui/card";
import { LoadingState, StatusState } from "@/components/ui/states";
import { getAdminAccess, requireUser } from "@/lib/auth/dal";
import { format } from "@/lib/i18n/messages";
import { getLocale, getMessages } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.errors.accessDeniedTitle };
}

/**
 * Shown to signed-in users who may not use the admin app (customers and
 * deactivated accounts). It only offers sign-out — never a link back to
 * /admin — so there is no redirect loop.
 */
export default async function AccessDeniedPage() {
  const messages = await getMessages();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 pt-safe pb-safe">
      <Brand name={messages.app.name} />
      <Card className="w-full max-w-md">
        <Suspense fallback={<LoadingState label={messages.common.loading} />}>
          <AccessDenied />
        </Suspense>
      </Card>
    </main>
  );
}

async function AccessDenied() {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  const user = await requireUser(locale);
  const access = getAdminAccess(user);
  if (access === "granted") redirect(`/${locale}/admin`);

  const inactive = access === "inactive";

  return (
    <StatusState
      icon={inactive ? UserX : ShieldX}
      tone="error"
      headingLevel="h1"
      className="py-6"
      title={inactive ? messages.errors.accountInactiveTitle : messages.errors.accessDeniedTitle}
      description={
        <>
          <p>{inactive ? messages.errors.accountInactiveBody : messages.errors.accessDeniedBody}</p>
          <p className="mt-3 font-medium text-foreground">
            {format(messages.auth.signedInAs, { email: "" })}
            <bdi>{user.email}</bdi>
          </p>
        </>
      }
      action={<SignOutButton />}
    />
  );
}
