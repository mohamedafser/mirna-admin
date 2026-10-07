"use client";

import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n/client";

interface Position {
  top: number;
  /** Distance from the left edge (LTR) or the right edge (RTL). */
  inset: number;
}

/**
 * Hover/focus label shown beside its trigger, on the inline-end side (right in
 * LTR, left in RTL). Rendered into <body> with fixed positioning so scrolling
 * containers (e.g. the sidebar nav) can't clip it.
 *
 * Visual only (aria-hidden): the trigger must already have the same
 * accessible name. `enabled` is checked each time it would open, e.g. to show
 * labels only while the sidebar is collapsed.
 */
export function Tooltip({
  content,
  enabled = () => true,
  className,
  children,
}: {
  content: ReactNode;
  enabled?: () => boolean;
  className?: string;
  children: ReactNode;
}) {
  const { dir } = useI18n();
  const [position, setPosition] = useState<Position | null>(null);

  function show(target: HTMLElement) {
    if (!enabled()) return;
    const rect = target.getBoundingClientRect();
    const gap = 8;
    setPosition({
      top: rect.top + rect.height / 2,
      inset: dir === "rtl" ? window.innerWidth - rect.left + gap : rect.right + gap,
    });
  }
  const hide = () => setPosition(null);

  return (
    <div
      className={className}
      onPointerEnter={(event) => show(event.currentTarget)}
      onPointerLeave={hide}
      onFocus={(event) => {
        if (event.target.matches(":focus-visible")) show(event.currentTarget);
      }}
      onBlur={hide}
      onClick={hide}
    >
      {children}
      {position &&
        createPortal(
          <span
            aria-hidden
            style={{
              top: position.top,
              [dir === "rtl" ? "right" : "left"]: position.inset,
            }}
            className="pointer-events-none fixed z-50 -translate-y-1/2 rounded-lg bg-foreground px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-background shadow-elevated"
          >
            {content}
          </span>,
          document.body,
        )}
    </div>
  );
}
