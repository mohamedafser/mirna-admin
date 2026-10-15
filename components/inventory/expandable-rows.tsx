"use client";

import { ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * One table row plus optional detail rows (a product and its variants), as
 * its own <tbody>. The first cell holds the show / hide toggle; rows without
 * details get an empty cell so columns stay aligned. Rows are rendered on the
 * server, so stock values refresh with the page after every adjustment.
 */
export function ExpandableRows({
  cells,
  details,
  showLabel,
  hideLabel,
  defaultOpen = false,
}: {
  /** The main row's cells (after the toggle cell). */
  cells: ReactNode;
  /** Detail <tr> rows; null = nothing to expand. */
  details: ReactNode | null;
  showLabel: string;
  hideLabel: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <tbody className="border-t">
      <tr className={cn("transition-colors hover:bg-accent/60", open && "bg-accent/30")}>
        <td className="w-0 py-2 ps-3 pe-0">
          {details !== null && (
            <button
              type="button"
              aria-expanded={open}
              aria-label={open ? hideLabel : showLabel}
              title={open ? hideLabel : showLabel}
              onClick={() => setOpen((value) => !value)}
              className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none"
            >
              <ChevronRight
                aria-hidden
                className={cn("size-4 transition-transform", open ? "rotate-90" : "rtl:rotate-180")}
              />
            </button>
          )}
        </td>
        {cells}
      </tr>
      {open && details}
    </tbody>
  );
}
