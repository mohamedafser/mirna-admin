"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ComponentProps } from "react";

/**
 * Link built on the server that keeps the current list/grid choice. The view
 * changes on the client only (ListViews), so server-built hrefs can be stale.
 */
export function ViewLink({ href, ...props }: ComponentProps<typeof Link> & { href: string }) {
  const grid = useSearchParams().get("view") === "grid";
  const [path, query = ""] = href.split("?");
  const search = new URLSearchParams(query);
  if (grid) search.set("view", "grid");
  else search.delete("view");
  return <Link href={search.size ? `${path}?${search}` : path} {...props} />;
}
