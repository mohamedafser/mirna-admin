import { CalendarClock, KeyRound, LogIn, LogOut, Settings2, UserRound } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { LocaleSwitcher } from "@/components/preferences/locale-switcher";
import { ThemeSwitcher } from "@/components/preferences/theme-switcher";
import { PasswordForm, ProfileDetailsForm } from "@/components/profile/profile-forms";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/states";
import { requireAdmin } from "@/lib/auth/dal";
import { formatDateTime } from "@/lib/format";
import { format } from "@/lib/i18n/messages";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { getMyProfile } from "@/lib/profile/queries";
import { getStoreRegion } from "@/lib/settings/queries";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.profile.title };
}

// The session is read behind <Suspense> so navigations render the skeleton
// instantly (Cache Components); requireAdmin() guards the content.
export default async function ProfilePage() {
  const messages = await getMessages();
  return (
    <Suspense fallback={<PageSkeleton label={messages.common.loading} />}>
      <Profile />
    </Suspense>
  );
}

/** The signed-in admin's own account: details, password, preferences, sign out. */
async function Profile() {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  const user = await requireAdmin(locale);
  const [profile, { timezone: timeZone }] = await Promise.all([
    getMyProfile(user.id),
    getStoreRegion(),
  ]);
  if (!profile) notFound();

  const t = messages.profile;
  const date = (value: string) => formatDateTime(value, locale, { dateStyle: "long" }, timeZone);
  const name = profile.fullName ?? profile.email ?? "";

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t.title}</h1>
        <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">{t.subtitle}</p>
      </div>

      {/* Identity */}
      <section className="flex flex-wrap items-center gap-4 rounded-2xl border bg-card p-5 sm:p-6">
        <Avatar name={profile.fullName} email={profile.email} className="size-16 text-lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold">
            <bdi>{name}</bdi>
          </p>
          {profile.fullName && profile.email && (
            <p className="truncate text-sm text-muted-foreground">
              <bdi>{profile.email}</bdi>
            </p>
          )}
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            <Badge tone="primary">{messages.roles[user.role]}</Badge>
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock aria-hidden className="size-3.5" />
              {format(t.memberSince, { date: date(profile.createdAt) })}
            </span>
            {profile.lastSignInAt && (
              <span className="inline-flex items-center gap-1.5">
                <LogIn aria-hidden className="size-3.5 rtl:-scale-x-100" />
                {format(t.lastSignIn, {
                  date: formatDateTime(profile.lastSignInAt, locale, undefined, timeZone),
                })}
              </span>
            )}
          </p>
        </div>
      </section>

      <div className="mt-4 grid gap-4">
        <Card>
          <CardHeader
            icon={UserRound}
            title={t.details.title}
            description={t.details.description}
          />
          <ProfileDetailsForm
            fullName={profile.fullName ?? ""}
            phone={profile.phone ?? ""}
            email={profile.email ?? ""}
          />
        </Card>

        <Card>
          <CardHeader
            icon={KeyRound}
            title={t.password.title}
            description={t.password.description}
          />
          <PasswordForm email={profile.email ?? ""} />
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader
              icon={Settings2}
              title={t.preferences.title}
              description={t.preferences.description}
            />
            <div className="grid gap-4">
              <div className="grid gap-2">
                <p className="text-sm font-medium">{t.preferences.language}</p>
                <LocaleSwitcher className="self-start" />
              </div>
              <div className="grid gap-2">
                <p className="text-sm font-medium">{t.preferences.theme}</p>
                <ThemeSwitcher showLegend={false} />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader icon={LogOut} title={t.session.title} description={t.session.description} />
            <SignOutButton />
          </Card>
        </div>
      </div>
    </div>
  );
}
