"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n/client";
import { isSidebarCollapsed, setSidebarCollapsed, subscribeSidebar } from "@/lib/sidebar";
import { cn } from "@/lib/utils/cn";

/**
 * Collapses / expands the desktop sidebar. Icons and label visibility follow
 * the `sidebar-collapsed:` CSS variant, so they are right on first paint; the
 * accessible state comes from the store once hydrated.
 */
export function SidebarToggle({ controls }: { controls: string }) {
  const { messages } = useI18n();
  // Server snapshot: expanded (the <html> attribute isn't known on the server).
  const collapsed = useSyncExternalStore(subscribeSidebar, isSidebarCollapsed, () => false);
  const label = collapsed ? messages.nav.expandSidebar : messages.nav.collapseSidebar;

  return (
    <Tooltip content={label} enabled={isSidebarCollapsed}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={!collapsed}
        aria-controls={controls}
        onClick={() => setSidebarCollapsed(!isSidebarCollapsed())}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
          "sidebar-collapsed:justify-center sidebar-collapsed:px-0",
          "[&_svg]:size-[1.125rem] [&_svg]:shrink-0 [&_svg]:rtl:-scale-x-100",
        )}
      >
        <PanelLeftClose aria-hidden className="sidebar-collapsed:hidden" />
        <PanelLeftOpen aria-hidden className="hidden sidebar-collapsed:block" />
        <span aria-hidden className="whitespace-nowrap sidebar-collapsed:sr-only">
          {messages.nav.collapseSidebar}
        </span>
      </button>
    </Tooltip>
  );
}
