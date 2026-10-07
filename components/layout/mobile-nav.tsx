"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LocaleSwitcher } from "@/components/preferences/locale-switcher";
import { ThemeSwitcher } from "@/components/preferences/theme-switcher";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { useI18n } from "@/lib/i18n/client";
import { Brand } from "./brand";
import { NavLinks } from "./nav-links";

// Must match the `md` breakpoint where the desktop sidebar appears.
const DESKTOP_QUERY = "(min-width: 48rem)";

/** Menu button + navigation sheet for small screens (hidden from md up). */
export function MobileNav() {
  const { messages } = useI18n();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [openedAt, setOpenedAt] = useState(pathname);

  // Close after navigating (including browser back/forward).
  if (open && openedAt !== pathname) setOpen(false);

  // Close if the viewport grows to desktop, so a hidden modal can't leave the
  // page inert (e.g. rotating a tablet).
  useEffect(() => {
    if (!open) return;
    const media = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => media.matches && setOpen(false);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [open]);

  return (
    <div className="md:hidden">
      <Button
        variant="ghost"
        size="icon"
        aria-label={messages.nav.openMenu}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpenedAt(pathname);
          setOpen(true);
        }}
      >
        <Menu aria-hidden />
      </Button>

      <Sheet open={open} onOpenChange={setOpen} label={messages.nav.menu}>
        <div className="flex h-16 shrink-0 items-center justify-between px-4">
          <Brand name={messages.app.name} />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={messages.nav.closeMenu}
            onClick={() => setOpen(false)}
          >
            <X aria-hidden />
          </Button>
        </div>
        <nav aria-label={messages.nav.primary} className="flex-1 overflow-y-auto px-3 py-2">
          <NavLinks onNavigate={() => setOpen(false)} />
        </nav>
        <div className="grid gap-3 border-t p-4">
          <LocaleSwitcher />
          <ThemeSwitcher showLegend={false} fullWidth />
        </div>
      </Sheet>
    </div>
  );
}
