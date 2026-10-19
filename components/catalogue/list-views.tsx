"use client";

import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { currentView } from "./list-toolbar";

/**
 * Shows the list or the grid rendering of the same rows (or, when given, the
 * structure tree), following ?view=. The server sends every rendering, and
 * the toolbar switches views with history.replaceState, so toggling is
 * instant: no server render or refetch.
 */
export function ListViews({
  list,
  grid,
  tree,
}: {
  list: ReactNode;
  grid: ReactNode;
  /** Optional Structure view, shown by default when present. */
  tree?: ReactNode;
}) {
  const view = currentView(useSearchParams().get("view"), tree !== undefined);
  return { tree, list, grid }[view];
}
