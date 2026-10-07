"use client";

import { ChevronDown, Settings, UserRound } from "lucide-react";
import Link from "next/link";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { ThemeSwitcher } from "@/components/preferences/theme-switcher";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Dropdown, dropdownItemClassName } from "@/components/ui/dropdown";
import { Separator } from "@/components/ui/separator";
import { useI18n } from "@/lib/i18n/client";
import type { CurrentUser } from "@/types/domain";

export type MenuUser = Pick<CurrentUser, "fullName" | "email" | "role">;

/**
 * Header account menu: identity, Profile / Settings (placeholders for now),
 * theme and sign out. Receives the already-authorized user from the server.
 */
export function UserMenu({ user }: { user: MenuUser }) {
  const { locale, messages } = useI18n();
  const displayName = user.fullName ?? user.email ?? "";

  return (
    <Dropdown
      label={messages.userMenu.open}
      triggerClassName="flex items-center gap-2 p-0.5 transition-colors hover:bg-accent sm:pe-2"
      trigger={
        <>
          <Avatar name={user.fullName} email={user.email} className="size-8" />
          <ChevronDown aria-hidden className="hidden size-4 text-muted-foreground sm:block" />
        </>
      }
    >
      {(close) => (
        <>
          <div className="flex items-center gap-3 px-3 pt-2.5 pb-3">
            <Avatar name={user.fullName} email={user.email} className="size-10" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">
                <bdi>{displayName}</bdi>
              </p>
              {user.fullName && user.email && (
                <p className="truncate text-xs text-muted-foreground">
                  <bdi>{user.email}</bdi>
                </p>
              )}
              <Badge tone="primary" className="mt-1.5">
                {messages.roles[user.role]}
              </Badge>
            </div>
          </div>
          <Separator />
          <Link href={`/${locale}/admin/profile`} onClick={close} className={dropdownItemClassName}>
            <UserRound aria-hidden />
            {messages.nav.profile}
          </Link>
          <Link
            href={`/${locale}/admin/settings`}
            onClick={close}
            className={dropdownItemClassName}
          >
            <Settings aria-hidden />
            {messages.nav.settings}
          </Link>
          <Separator />
          <div className="px-3 py-2">
            <ThemeSwitcher showLegend={false} fullWidth />
          </div>
          <Separator />
          <SignOutButton variant="menuItem" />
        </>
      )}
    </Dropdown>
  );
}
