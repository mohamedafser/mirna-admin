"use client";

import { Languages } from "lucide-react";
import { usePathname } from "next/navigation";
import { localeConfig, locales } from "@/config/i18n";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";

/**
 * Links to the current page in each locale. Plain <a> (full navigation)
 * because switching locale swaps the root layout's lang/dir.
 * proxy.ts persists the choice in the NEXT_LOCALE cookie.
 * Inline segmented control (navigation drawer); headers use LocaleMenu.
 */
export function LocaleSwitcher({ className }: { className?: string }) {
  const { locale: current, messages } = useI18n();
  const pathname = usePathname();
  const rest = pathname.split("/").slice(2).join("/");

  return (
    <nav
      aria-label={messages.locale.label}
      className={cn("inline-flex items-center gap-1 border bg-card p-1", className)}
    >
      <Languages aria-hidden className="mx-1.5 size-4 text-muted-foreground" />
      {locales.map((locale) => {
        const active = locale === current;
        const { nativeName } = localeConfig[locale];
        return (
          <a
            key={locale}
            href={`/${locale}${rest ? `/${rest}` : ""}`}
            hrefLang={locale}
            lang={locale}
            aria-current={active ? "true" : undefined}
            className={cn(
              "flex h-8 items-center rounded-lg px-3 text-sm transition-colors",
              active
                ? "bg-foreground font-medium text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {nativeName}
          </a>
        );
      })}
    </nav>
  );
}
