"use client";

import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { currentView } from "./list-toolbar";

/**
 * Shows the list or the grid rendering of the same rows, following ?view=.
 * The server sends both renderings, and the toolbar switches views with
 * history.replaceState, so toggling is instant: no server render or refetch.
 */
export function ListViews({ list, grid }: { list: ReactNode; grid: ReactNode }) {
  return currentView(useSearchParams().get("view")) === "grid" ? grid : list;
}
