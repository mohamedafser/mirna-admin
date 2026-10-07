"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tooltip } from "@/components/ui/tooltip";
import { activeSection, navEntries, sectionHref, type AdminSection } from "@/config/admin-nav";
import { useI18n } from "@/lib/i18n/client";
import { isSidebarCollapsed } from "@/lib/sidebar";
import { cn } from "@/lib/utils/cn";

/**
 * Sidebar / drawer navigation. The active item is derived from the URL, so
 * nested routes (/admin/products/42) highlight their section automatically.
 * Grouped sections (Catalogue) are nested lists under a heading.
 *
 * `collapsible` (desktop sidebar): when the sidebar is collapsed the labels are
 * visually hidden (still read by screen readers) and shown as tooltips.
 */
export function NavLinks({
  onNavigate,
  collapsible = false,
}: {
  onNavigate?: () => void;
  collapsible?: boolean;
}) {
  const { locale, messages } = useI18n();
  const current = activeSection(usePathname());

  function item(section: AdminSection) {
    const { key, icon: Icon, available } = section;
    const active = current?.key === key;
    return (
      <li key={key}>
        <Tooltip content={messages.nav[key]} enabled={() => collapsible && isSidebarCollapsed()}>
          <Link
            href={sectionHref(locale, section)}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-3 px-3 py-2.5 font-display text-[0.8125rem] transition-colors",
              "sidebar-collapsed:justify-center sidebar-collapsed:px-0",
              active
                ? "bg-brand-soft font-semibold text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {active && (
              <span aria-hidden className="absolute inset-y-0 start-0 w-0.5 bg-foreground" />
            )}
            <Icon aria-hidden className="size-[1.125rem] shrink-0" />
            <span className="flex-1 whitespace-nowrap sidebar-collapsed:sr-only">
              {messages.nav[key]}
            </span>
            {!available && (
              <span
                aria-hidden
                title={messages.comingSoon.badge}
                className="size-1.5 rounded-full bg-muted-foreground/40 sidebar-collapsed:absolute sidebar-collapsed:end-2.5 sidebar-collapsed:top-2"
              />
            )}
          </Link>
        </Tooltip>
      </li>
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      {navEntries.map((entry) => {
        if (entry.type === "item") return item(entry.section);
        const headingId = `nav-group-${entry.group}${collapsible ? "-rail" : ""}`;
        return (
          <li key={entry.group} className="my-2 first:mt-0">
            <p
              id={headingId}
              className="caps mb-1 px-3 text-[0.625rem] font-medium whitespace-nowrap text-muted-foreground sidebar-collapsed:sr-only"
            >
              {messages.nav.groups[entry.group]}
            </p>
            {/* Collapsed rail: a divider stands in for the heading. */}
            <hr aria-hidden className="mx-2 mb-1 hidden border-border sidebar-collapsed:block" />
            <ul aria-labelledby={headingId} className="flex flex-col gap-1">
              {entry.sections.map(item)}
            </ul>
            <hr aria-hidden className="mx-2 mt-1 hidden border-border sidebar-collapsed:block" />
          </li>
        );
      })}
    </ul>
  );
}
