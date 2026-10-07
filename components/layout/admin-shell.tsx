import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { LocaleMenu } from "@/components/preferences/locale-menu";
import { ThemeMenu } from "@/components/preferences/theme-menu";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { Brand } from "./brand";
import { Breadcrumbs } from "./breadcrumbs";
import { MobileNav } from "./mobile-nav";
import { NavLinks } from "./nav-links";
import { SidebarToggle } from "./sidebar-toggle";

/**
 * Admin application chrome.
 *
 *   ┌─────────┬──────────────────────────────────────────┐
 *   │ Sidebar │ Header: ☰ · breadcrumbs · 文A · ☀ · user │
 *   │ (md+)   ├──────────────────────────────────────────┤
 *   │         │ Main content                             │
 *   └─────────┴──────────────────────────────────────────┘
 *
 * From md up the sidebar can be collapsed to an icon rail (lib/sidebar.ts);
 * collapsed items show their label as a tooltip.
 * Below md the sidebar becomes a sheet opened from the header. Logical
 * properties (border-e, start-*, ms-*) mirror everything in RTL.
 * `userMenu` depends on the session, so it streams in behind Suspense and
 * the rest of the shell renders instantly.
 *
 * Components that read the URL (usePathname) sit in their own Suspense
 * boundaries: on routes whose params aren't known at build time
 * (/admin/products/[id]) the URL is request data, and these boundaries keep
 * the rest of the shell in the prerendered static shell.
 */
export async function AdminShell({
  userMenu,
  children,
}: {
  userMenu: ReactNode;
  children: ReactNode;
}) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);

  return (
    <div className="flex min-h-dvh px-safe">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-card focus:px-3 focus:py-2 focus:shadow-elevated"
      >
        {messages.common.skipToContent}
      </a>

      <aside
        id="admin-sidebar"
        data-sidebar-root
        className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-e bg-card pt-safe transition-[width] duration-200 ease-out md:flex sidebar-collapsed:w-[4.5rem]"
      >
        <div className="flex h-16 shrink-0 items-center px-5 sidebar-collapsed:justify-center sidebar-collapsed:px-0">
          <Link href={`/${locale}/admin`}>
            <Brand name={messages.app.name} nameClassName="sidebar-collapsed:sr-only" />
          </Link>
        </div>
        <nav
          aria-label={messages.nav.primary}
          className="flex-1 overflow-x-hidden overflow-y-auto px-3 pt-2 pb-4"
        >
          <p className="caps mb-2 px-3 text-[0.625rem] font-medium whitespace-nowrap text-muted-foreground sidebar-collapsed:sr-only">
            {messages.nav.menu}
          </p>
          <Suspense fallback={<NavSkeleton />}>
            <NavLinks collapsible />
          </Suspense>
        </nav>
        <div className="shrink-0 border-t px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <SidebarToggle controls="admin-sidebar" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b bg-background/80 pt-safe backdrop-blur-md">
          <div className="flex h-16 items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:px-8">
            <Suspense fallback={<span aria-hidden className="size-10 md:hidden" />}>
              <MobileNav />
            </Suspense>
            <div className="min-w-0 flex-1">
              <Suspense fallback={null}>
                <Breadcrumbs />
              </Suspense>
            </div>
            {/* On phones both controls live in the navigation drawer instead. */}
            <div className="hidden items-center gap-1 sm:flex">
              <Suspense fallback={<span aria-hidden className="h-10 w-28" />}>
                <LocaleMenu />
                <ThemeMenu />
              </Suspense>
            </div>
            <Suspense fallback={<span aria-hidden className="size-9 animate-pulse bg-muted" />}>
              {userMenu}
            </Suspense>
          </div>
        </header>

        <main
          id="main"
          className="flex-1 px-4 pt-6 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:pt-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

/** Placeholder rows while the nav (which reads the URL) streams in. */
function NavSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-1">
      {Array.from({ length: 8 }, (_, index) => (
        <span key={index} className="h-10 animate-pulse rounded-xl bg-muted/60" />
      ))}
    </div>
  );
}
