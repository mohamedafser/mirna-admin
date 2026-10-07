"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { adminPathSegments, adminSections, findSectionBySegment } from "@/config/admin-nav";
import { useI18n } from "@/lib/i18n/client";

/**
 * Breadcrumbs generated from the URL: /en/admin/products → Dashboard › Products.
 * Known segments use their section label; nested pages get a readable name
 * (e.g. /products/<id> → "Product details"). On small screens only the current page is shown.
 */
export function Breadcrumbs() {
  const { locale, messages } = useI18n();
  const segments = adminPathSegments(usePathname()) ?? [];

  const dashboard = adminSections[0];

  // Readable names for nested pages instead of raw ids.
  function childLabel(section: string, segment: string): string {
    if (section === "products") {
      return segment === "new"
        ? messages.catalogue.products.new
        : messages.catalogue.products.details;
    }
    if (section === "inventory") return messages.inventory.history.title;
    return decodeURIComponent(segment);
  }
  const crumbs = [
    { href: `/${locale}/admin`, label: messages.nav[dashboard.key] },
    ...segments.map((segment, index) => ({
      href: `/${locale}/admin/${segments.slice(0, index + 1).join("/")}`,
      label:
        index === 0
          ? messages.nav[findSectionBySegment(segment)?.key ?? "dashboard"]
          : childLabel(segments[0], segment),
    })),
  ];

  return (
    <nav aria-label={messages.nav.breadcrumb} className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <li
              key={crumb.href}
              className={
                last ? "flex min-w-0 items-center gap-1.5" : "hidden items-center gap-1.5 sm:flex"
              }
            >
              {last ? (
                <span aria-current="page" className="truncate font-semibold">
                  {crumb.label}
                </span>
              ) : (
                <>
                  <Link
                    href={crumb.href}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {crumb.label}
                  </Link>
                  {/* Separator points along the reading direction. */}
                  <ChevronRight
                    aria-hidden
                    className="size-4 text-muted-foreground/60 rtl:-scale-x-100"
                  />
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
