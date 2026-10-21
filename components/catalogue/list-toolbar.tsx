"use client";

import { LayoutGrid, List, LoaderCircle, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/form";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";

export interface ToolbarFilter {
  name: string;
  label: string;
  options: Array<{ value: string; label: string }>;
}

const SEARCH_DEBOUNCE_MS = 350;

/**
 * Search + filters for a server-rendered list. State lives in the URL
 * (?q=&status=&category=), so the server does the filtering and pagination.
 * - Typing is debounced; Enter searches immediately.
 * - A navigation is skipped when the URL wouldn't change (no duplicate requests).
 * - Changing search or a filter returns to page 1; switching List/Grid keeps the page.
 */
export function ListToolbar({
  searchLabel,
  searchPlaceholder,
  filters,
  viewToggle = false,
}: {
  searchLabel: string;
  searchPlaceholder: string;
  filters: ToolbarFilter[];
  /** Show the List / Grid switch (?view=grid). */
  viewToggle?: boolean;
}) {
  const { messages } = useI18n();
  const t = messages.catalogue.common;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const paramQ = searchParams.get("q") ?? "";
  const [q, setQ] = useState(paramQ);
  const [syncedQ, setSyncedQ] = useState(paramQ);
  // Last query this toolbar put in the URL (to tell our updates from external ones).
  const [lastSent, setLastSent] = useState(paramQ);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // The URL changed from elsewhere (Reset, back/forward): show its query.
  // Our own debounced updates are ignored so in-progress typing isn't lost.
  if (paramQ !== syncedQ) {
    setSyncedQ(paramQ);
    if (paramQ !== lastSent) {
      setLastSent(paramQ);
      setQ(paramQ);
    }
  }

  function navigate(update: Record<string, string>, keepPage = false) {
    // Read the live URL (not a render-time snapshot) so quick successive
    // changes never drop each other.
    const current = new URLSearchParams(window.location.search);
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(update)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!keepPage) next.delete("page");
    if (next.toString() === current.toString()) return;
    if ("q" in update) setLastSent(update.q);
    const query = next.toString();
    startTransition(() =>
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }),
    );
  }

  // The page already has both renderings (ListViews), so the view changes
  // without a server request: replaceState updates useSearchParams directly.
  function switchView(option: View) {
    const next = new URLSearchParams(window.location.search);
    if (option === "list") next.delete("view");
    else next.set("view", option);
    const query = next.toString();
    window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
  }

  function searchNow(value: string) {
    clearTimeout(timer.current);
    navigate({ q: value.trim() });
  }

  const hasFilters = Boolean(paramQ) || filters.some((filter) => searchParams.get(filter.name));
  const view = currentView(searchParams.get("view"));

  return (
    <form
      role="search"
      aria-label={searchLabel}
      onSubmit={(event) => {
        event.preventDefault();
        searchNow(q);
      }}
      className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center"
    >
      <div className="min-w-0 lg:flex-1">
        <label htmlFor="list-search" className="sr-only">
          {searchLabel}
        </label>
        <Input
          id="list-search"
          type="search"
          icon={Search}
          value={q}
          placeholder={searchPlaceholder}
          maxLength={100}
          enterKeyHint="search"
          onChange={(event) => {
            const value = event.target.value;
            setQ(value);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => navigate({ q: value.trim() }), SEARCH_DEBOUNCE_MS);
          }}
          trailing={
            pending ? (
              <span role="status" className="flex size-9 items-center justify-center">
                <LoaderCircle aria-hidden className="size-4 animate-spin text-muted-foreground" />
                <span className="sr-only">{t.searching}</span>
              </span>
            ) : undefined
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {filters.map((filter) => (
          <div key={filter.name} className="min-w-0 flex-1 sm:w-44 sm:flex-none">
            <label htmlFor={`list-filter-${filter.name}`} className="sr-only">
              {filter.label}
            </label>
            <Combobox
              id={`list-filter-${filter.name}`}
              value={searchParams.get(filter.name) ?? ""}
              onChange={(value) => navigate({ [filter.name]: value })}
              options={filter.options}
            />
          </div>
        ))}
        {hasFilters && (
          <Button
            variant="ghost"
            className="h-11"
            onClick={() => {
              clearTimeout(timer.current);
              setLastSent("");
              setQ("");
              const keep = new URLSearchParams();
              if (view !== "list") keep.set("view", view);
              startTransition(() =>
                router.replace(keep.size ? `${pathname}?${keep}` : pathname, { scroll: false }),
              );
            }}
          >
            <X aria-hidden />
            {t.reset}
          </Button>
        )}

        {viewToggle && (
          <div
            role="group"
            aria-label={t.view}
            className="ms-auto inline-flex h-11 shrink-0 rounded-md border bg-card p-1"
          >
            {VIEWS.map((option) => {
              const Icon = { list: List, grid: LayoutGrid }[option];
              const label = { list: t.viewList, grid: t.viewGrid }[option];
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={view === option}
                  aria-label={label}
                  title={label}
                  onClick={() => switchView(option)}
                  className={cn(
                    "inline-flex w-9 items-center justify-center rounded-lg transition-colors",
                    // Exclusive classes: cn() doesn't dedupe, so a shared
                    // hover:text-* would recolour the selected icon to match its fill.
                    view === option
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon aria-hidden className="size-4" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </form>
  );
}

const VIEWS = ["list", "grid"] as const;
type View = (typeof VIEWS)[number];

/** The view in ?view=, falling back to the list. */
export function currentView(param: string | null): View {
  return param === "grid" ? "grid" : "list";
}
