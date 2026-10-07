import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { buttonClassName } from "@/components/ui/button";
import { format } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils/cn";

interface Labels {
  previous: string;
  next: string;
  pagination: string;
  pageSummary: string;
  pageOf: string;
}

/**
 * Previous / Next pagination as plain links, so filters and search in the URL
 * are preserved and every page is shareable. Arrows mirror in RTL.
 */
export function Pagination({
  basePath,
  params,
  page,
  pageCount,
  pageSize,
  total,
  labels,
}: {
  basePath: string;
  /** Current list params (q, status, …) to keep on every link. */
  params: Record<string, string>;
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  labels: Labels;
}) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const href = (target: number) => {
    const search = new URLSearchParams(Object.entries(params).filter(([, value]) => value));
    if (target > 1) search.set("page", String(target));
    else search.delete("page");
    const query = search.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  const control = (target: number, enabled: boolean, label: string, next: boolean) => {
    const Icon = next ? ChevronRight : ChevronLeft;
    const content = (
      <>
        {!next && <Icon aria-hidden className="rtl:-scale-x-100" />}
        <span className="hidden sm:inline">{label}</span>
        {next && <Icon aria-hidden className="rtl:-scale-x-100" />}
      </>
    );
    const className = buttonClassName({ variant: "outline", size: "sm", className: "h-9" });
    return enabled ? (
      <Link
        href={href(target)}
        rel={next ? "next" : "prev"}
        aria-label={label}
        className={className}
      >
        {content}
      </Link>
    ) : (
      <span
        aria-disabled="true"
        aria-label={label}
        className={cn(className, "pointer-events-none opacity-50")}
      >
        {content}
      </span>
    );
  };

  return (
    <nav
      aria-label={labels.pagination}
      className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground"
    >
      <p>{format(labels.pageSummary, { from, to, total })}</p>
      <div className="flex items-center gap-2">
        {control(page - 1, page > 1, labels.previous, false)}
        <span className="px-1 whitespace-nowrap">{format(labels.pageOf, { page, pageCount })}</span>
        {control(page + 1, page < pageCount, labels.next, true)}
      </div>
    </nav>
  );
}
