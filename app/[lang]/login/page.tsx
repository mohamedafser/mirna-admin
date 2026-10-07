import { Languages, MonitorSmartphone, ShieldCheck, Store } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Brand } from "@/components/layout/brand";
import { LocaleMenu } from "@/components/preferences/locale-menu";
import { ThemeMenu } from "@/components/preferences/theme-menu";
import { LoadingState } from "@/components/ui/states";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { LoginForm } from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.auth.signInTitle };
}

// Signed-in users are redirected to /admin by proxy.ts, so this page stays static.
export default async function LoginPage() {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  const t = messages.auth;

  const features = [
    { icon: ShieldCheck, text: t.features.secure },
    { icon: Languages, text: t.features.bilingual },
    { icon: MonitorSmartphone, text: t.features.installable },
  ];

  return (
    <div className="flex min-h-dvh px-safe lg:p-3">
      {/* Brand panel (large screens) */}
      <aside className="relative hidden w-[44%] max-w-xl flex-col justify-between overflow-hidden rounded-3xl bg-primary p-10 text-primary-foreground lg:flex">
        <div className="relative inline-flex items-center gap-2.5">
          <span className="inline-flex size-11 items-center justify-center rounded-xl bg-primary-foreground/15 ring-1 ring-primary-foreground/20">
            <Store aria-hidden className="size-5" />
          </span>
          <span className="text-lg font-semibold">{messages.app.name}</span>
        </div>
        <div className="relative">
          <p className="text-3xl leading-tight font-semibold tracking-tight">{t.welcomeTitle}</p>
          <p className="mt-3 max-w-sm text-primary-foreground/80">{t.tagline}</p>
          <ul className="mt-8 grid gap-4">
            {features.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <span className="inline-flex size-9 items-center justify-center rounded-lg bg-primary-foreground/15">
                  <Icon aria-hidden className="size-[1.125rem]" />
                </span>
                <span className="text-sm">{text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-primary-foreground/70">{t.secureNote}</p>
      </aside>

      {/* Form */}
      <div className="flex flex-1 flex-col pt-safe">
        <header className="flex items-center justify-between gap-2 p-4 sm:p-6">
          <Brand name={messages.app.name} className="lg:invisible" />
          <div className="flex items-center gap-1">
            <LocaleMenu />
            <ThemeMenu />
          </div>
        </header>
        <main className="flex flex-1 items-start justify-center px-4 pt-6 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:items-center sm:pt-0">
          <div className="w-full max-w-sm">
            <h1 className="text-2xl font-semibold tracking-tight">{t.signInTitle}</h1>
            <p className="mt-1.5 mb-8 text-sm text-muted-foreground">{t.signInSubtitle}</p>
            {/* useSearchParams (for ?next=) needs a Suspense boundary. */}
            <Suspense fallback={<LoadingState label={messages.common.loading} />}>
              <LoginForm locale={locale} />
            </Suspense>
            <p className="mt-8 flex items-center justify-center gap-2 text-xs text-muted-foreground lg:hidden">
              <ShieldCheck aria-hidden className="size-4" />
              {t.secureNote}
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
