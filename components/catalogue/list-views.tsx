"use client";

import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Shows the list or the grid rendering of the same rows, following ?view=grid.
 * The server sends both, and the toolbar switches views with
 * history.replaceState, so toggling is instant: no server render or refetch.
 */
export function ListViews({ list, grid }: { list: ReactNode; grid: ReactNode }) {
  return useSearchParams().get("view") === "grid" ? grid : list;
}
