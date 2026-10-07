import { ShieldCheck, UserPlus } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { NewAccountForm } from "@/components/auth/new-account-form";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/states";
import { addAdmin } from "@/lib/auth/account-actions";
import { listAdmins } from "@/lib/auth/admins";
import { requireAdmin } from "@/lib/auth/dal";
import { formatDateTime } from "@/lib/format";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.nav.admins };
}

// The session is read behind <Suspense> so navigations render the skeleton
// instantly (Cache Components instant-navigation rule); requireAdmin() still
// guards everything the inner component renders.
export default async function AdminsPage() {
  const messages = await getMessages();
  return (
    <Suspense fallback={<PageSkeleton label={messages.common.loading} />}>
      <Admins />
    </Suspense>
  );
}

/** Administrators: who can sign in to Mirna Admin, and adding new ones. */
async function Admins() {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  const user = await requireAdmin(locale);
  const t = messages.accounts.admins;

  const admin = createAdminClient();
  const admins = admin ? await listAdmins(admin) : null;

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-semibold tracking-tight">{messages.nav.admins}</h1>
      <p className="mt-1.5 mb-6 text-sm text-muted-foreground">{t.subtitle}</p>

      {!admins ? (
        <Alert tone="warning">{messages.accounts.errors.notConfigured}</Alert>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader icon={ShieldCheck} title={t.listTitle} />
            <ul className="divide-y">
              {admins.map((account) => (
                <li key={account.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <Avatar name={account.fullName} email={account.email} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <bdi className="truncate">{account.fullName ?? t.noName}</bdi>
                      {account.id === user.id && <Badge tone="primary">{t.you}</Badge>}
                      {!account.isActive && <Badge tone="error">{t.inactive}</Badge>}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      <bdi>{account.email}</bdi>
                    </p>
                  </div>
                  <p className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                    {t.added} {formatDateTime(new Date(account.createdAt), locale)}
                  </p>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader icon={UserPlus} title={t.addTitle} description={t.addBody} />
            <NewAccountForm action={addAdmin} locale={locale} submitLabel={t.submit} />
          </Card>
        </div>
      )}
    </div>
  );
}
