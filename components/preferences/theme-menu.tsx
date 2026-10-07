"use client";

import { Check, SunMoon } from "lucide-react";
import { useLayoutEffect, useSyncExternalStore } from "react";
import { buttonClassName } from "@/components/ui/button";
import { Dropdown, dropdownItemClassName } from "@/components/ui/dropdown";
import { useI18n } from "@/lib/i18n/client";
import { applyTheme, readTheme, setTheme, subscribeTheme, themes } from "@/lib/theme";
import { cn } from "@/lib/utils/cn";
import { themeIcons } from "./theme-switcher";

/** Header icon button that opens a Light / Dark / System popover. */
export function ThemeMenu() {
  const { messages } = useI18n();
  // Server snapshot is null, so the first client render matches the server HTML.
  const current = useSyncExternalStore(subscribeTheme, readTheme, () => null);
  const CurrentIcon = current ? themeIcons[current] : SunMoon;

  // React's dev Strict Mode remount resets <html> attributes; re-apply. No-op in production.
  useLayoutEffect(() => {
    applyTheme(readTheme());
  }, []);

  return (
    <Dropdown
      label={messages.theme.label}
      triggerClassName={buttonClassName({ variant: "ghost", size: "icon" })}
      trigger={<CurrentIcon aria-hidden />}
      panelClassName="w-48"
    >
      {(close) => (
        <ul aria-label={messages.theme.label} className="grid gap-0.5">
          {themes.map((theme) => {
            const Icon = themeIcons[theme];
            const active = current === theme;
            return (
              <li key={theme}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setTheme(theme);
                    close();
                  }}
                  className={cn(dropdownItemClassName, active && "font-medium")}
                >
                  <Icon aria-hidden />
                  <span className="flex-1">{messages.theme[theme]}</span>
                  {active && <Check aria-hidden className="text-primary!" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Dropdown>
  );
}
