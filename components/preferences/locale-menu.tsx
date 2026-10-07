"use client";

import { Check, Languages } from "lucide-react";
import { usePathname } from "next/navigation";
import { buttonClassName } from "@/components/ui/button";
import { Dropdown, dropdownItemClassName } from "@/components/ui/dropdown";
import { localeConfig, locales } from "@/config/i18n";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";

/**
 * Header button (icon + EN / ع) that opens a language popover. Options are
 * plain <a> links (full navigation) because switching locale swaps the root
 * layout's lang/dir; proxy.ts persists the choice in the NEXT_LOCALE cookie.
 */
export function LocaleMenu() {
  const { locale: current, messages } = useI18n();
  const rest = usePathname().split("/").slice(2).join("/");

  return (
    <Dropdown
      label={messages.locale.label}
      triggerClassName={buttonClassName({ variant: "ghost", size: "md", className: "px-2.5" })}
      trigger={
        <>
          <Languages aria-hidden />
          <span aria-hidden className="font-semibold">
            {localeConfig[current].shortName}
          </span>
        </>
      }
      panelClassName="w-48"
    >
      {() => (
        <ul aria-label={messages.locale.label} className="grid gap-0.5">
          {locales.map((locale) => {
            const active = locale === current;
            return (
              <li key={locale}>
                <a
                  href={`/${locale}${rest ? `/${rest}` : ""}`}
                  hrefLang={locale}
                  lang={locale}
                  aria-current={active ? "true" : undefined}
                  className={cn(dropdownItemClassName, active && "font-medium")}
                >
                  <span className="flex-1">{localeConfig[locale].nativeName}</span>
                  {active && <Check aria-hidden className="text-primary!" />}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </Dropdown>
  );
}
