"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils/cn";

const POLL_MS = 30_000;

/**
 * Count of orders waiting on the store, next to "Orders" in the sidebar.
 * Fetched from /api/admin/new-orders: on mount, on every navigation (so it
 * drops as soon as an order is moved along), when the tab comes back into
 * view and every 30 s while it's visible. Hidden at 0. On the collapsed
 * rail it becomes a small dot-sized count on the icon.
 */
export function NewOrdersBadge() {
  const { messages } = useI18n();
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    async function load() {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch("/api/admin/new-orders", {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = (await response.json()) as { ok?: boolean; count?: number };
        if (!cancelled && body.ok && typeof body.count === "number") setCount(body.count);
      } catch {
        // Offline or aborted: keep the last count.
      }
    }
    void load();
    const timer = window.setInterval(load, POLL_MS);
    document.addEventListener("visibilitychange", load);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [pathname]);

  if (count === 0) return null;
  const label = format(messages.nav.newOrders, { count });
  return (
    <span
      title={label}
      className={cn(
        "ms-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[0.625rem] font-semibold text-brand-foreground tabular-nums",
        "sidebar-collapsed:absolute sidebar-collapsed:end-1.5 sidebar-collapsed:top-1 sidebar-collapsed:ms-0 sidebar-collapsed:h-4 sidebar-collapsed:min-w-4 sidebar-collapsed:px-1",
      )}
    >
      <span aria-hidden>{count > 99 ? "99+" : count}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
