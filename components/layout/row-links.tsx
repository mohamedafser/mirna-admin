"use client";

import { useEffect } from "react";

/** Clicks on these keep their own behaviour instead of opening the row. */
const INTERACTIVE =
  "a, button, input, select, textarea, label, details, dialog, [role=button], [role=checkbox], [role=switch], [role=menuitem], [data-row-ignore]";

/**
 * Makes a whole list row or card clickable: a click anywhere on the <tr> / <li>
 * that holds an `a[data-row-link]` follows that link. The link stays the real
 * target, so keyboard use, prefetching and ctrl/cmd-click work as usual, and
 * dragging to select text in a row doesn't navigate. Listening once on the
 * document lets server-rendered rows opt in with just the attribute.
 */
export function RowLinks() {
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || !(event.target instanceof Element)) return;
      const row = event.target.closest("tr, li");
      const link = row?.querySelector("a[data-row-link]");
      if (!row || !link) return;
      const interactive = event.target.closest(INTERACTIVE);
      if (interactive && row.contains(interactive)) return;
      if (!(window.getSelection()?.isCollapsed ?? true)) return;
      const { ctrlKey, metaKey, shiftKey, altKey } = event;
      link.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          ctrlKey,
          metaKey,
          shiftKey,
          altKey,
        }),
      );
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return null;
}
