"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { controlClassName } from "@/components/ui/form";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";

export interface ComboboxOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** Lists longer than this get a search box when `searchable` is "auto". */
const AUTO_SEARCH_THRESHOLD = 8;

/** Case- and accent-insensitive text for matching ("Crème" matches "creme"). */
function normalize(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase();
}

/**
 * Custom select (replaces native <select>): a button that opens a listbox,
 * with an optional search box for long lists.
 *
 * Accessibility follows the ARIA combobox/listbox pattern: the trigger is a
 * labelled `role="combobox"` button; while open, focus moves to the search box
 * (or the listbox) and `aria-activedescendant` tracks the highlighted option.
 * Keys: ↑/↓, Home/End, Enter/Space to choose, Escape to close, Tab to leave,
 * and type-ahead when there is no search box.
 *
 * Works in forms through a hidden input (`name`), controlled (`value` +
 * `onChange`) or uncontrolled (`defaultValue`). Opens upward when there is no
 * room below, and aligns to the inline start (mirrors in RTL).
 */
export function Combobox({
  id,
  name,
  options,
  value,
  defaultValue = "",
  onChange,
  placeholder,
  disabled = false,
  searchable = "auto",
  className,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
  "aria-label": ariaLabel,
  dataField,
}: {
  id?: string;
  /** Submits the value with the surrounding form (hidden input). */
  name?: string;
  options: ComboboxOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** true / false, or "auto": only when the list is long. */
  searchable?: boolean | "auto";
  className?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-label"?: string;
  /** Lets forms focus this control by field name after validation. */
  dataField?: string;
}) {
  const { messages } = useI18n();
  const fallbackId = useId();
  const triggerId = id ?? fallbackId;
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;

  const [innerValue, setInnerValue] = useState(defaultValue);
  const selectedValue = value ?? innerValue;
  const selected = options.find((option) => option.value === selectedValue);

  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const typeahead = useRef({ text: "", at: 0 });

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const withSearch = searchable === "auto" ? options.length > AUTO_SEARCH_THRESHOLD : searchable;

  const filtered = useMemo(() => {
    const needle = normalize(query.trim());
    return needle ? options.filter((option) => normalize(option.label).includes(needle)) : options;
  }, [options, query]);

  const firstEnabled = (list: ComboboxOption[], from = 0, step = 1) => {
    for (let index = from; index >= 0 && index < list.length; index += step) {
      if (!list[index].disabled) return index;
    }
    return -1;
  };

  function openList() {
    if (disabled) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const below = window.innerHeight - rect.bottom;
      setOpenUp(below < 300 && rect.top > below);
    }
    setQuery("");
    const current = options.findIndex((option) => option.value === selectedValue);
    setActive(current >= 0 && !options[current].disabled ? current : firstEnabled(options));
    setOpen(true);
  }

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function choose(option: ComboboxOption | undefined) {
    if (!option || option.disabled) return;
    if (value === undefined) setInnerValue(option.value);
    if (option.value !== selectedValue) onChange?.(option.value);
    close(true);
  }

  // Focus the search box (or the list) when opening.
  useEffect(() => {
    if (open) (searchRef.current ?? listRef.current)?.focus();
  }, [open]);

  // Keep the highlighted option visible.
  useEffect(() => {
    if (open && active >= 0) {
      document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    }
    // optionId only depends on listId, which is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  // Close on outside pointer down.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function onListKeyDown(event: KeyboardEvent) {
    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        const next = firstEnabled(filtered, active + 1);
        if (next >= 0) setActive(next);
        return;
      }
      case "ArrowUp": {
        event.preventDefault();
        const previous = firstEnabled(filtered, active - 1, -1);
        if (previous >= 0) setActive(previous);
        return;
      }
      case "Home":
        if (withSearch) return; // keep caret movement in the search box
        event.preventDefault();
        setActive(firstEnabled(filtered));
        return;
      case "End":
        if (withSearch) return;
        event.preventDefault();
        setActive(firstEnabled(filtered, filtered.length - 1, -1));
        return;
      case "Enter":
        event.preventDefault();
        choose(filtered[active]);
        return;
      case " ":
        if (withSearch) return; // typing a space in the search box
        event.preventDefault();
        choose(filtered[active]);
        return;
      case "Escape":
        event.preventDefault();
        event.stopPropagation(); // don't also close a surrounding dialog
        close(true);
        return;
      case "Tab":
        close(false);
        return;
    }
    // Type-ahead (no search box): jump to the next option starting with the typed text.
    if (!withSearch && event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      const now = Date.now();
      const state = typeahead.current;
      state.text = now - state.at > 700 ? event.key : state.text + event.key;
      state.at = now;
      const needle = normalize(state.text);
      const match = filtered.findIndex(
        (option) => !option.disabled && normalize(option.label).startsWith(needle),
      );
      if (match >= 0) setActive(match);
    }
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        aria-label={ariaLabel}
        data-field={dataField}
        disabled={disabled}
        onClick={() => (open ? close(true) : openList())}
        onKeyDown={(event) => {
          if (!open && ["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
            event.preventDefault();
            openList();
          }
        }}
        className={cn(
          controlClassName,
          "flex h-11 items-center gap-2 text-start",
          open && "border-foreground",
        )}
      >
        <span className={cn("min-w-0 flex-1 truncate", !selected && "text-muted-foreground")}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {name && <input type="hidden" name={name} value={selectedValue} readOnly />}

      {open && (
        <div
          className={cn(
            "absolute start-0 z-50 w-max max-w-[min(22rem,calc(100vw-2rem))] min-w-full rounded-xl border bg-popover p-1 text-popover-foreground shadow-card",
            openUp ? "bottom-full mb-1.5" : "top-full mt-1.5",
          )}
        >
          {withSearch && (
            <div className="relative mb-1">
              <Search
                aria-hidden
                className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <input
                ref={searchRef}
                type="text"
                role="combobox"
                aria-label={messages.common.searchOptions}
                aria-expanded="true"
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={active >= 0 ? optionId(active) : undefined}
                value={query}
                placeholder={messages.common.searchOptions}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  const nextQuery = event.target.value;
                  setQuery(nextQuery);
                  const needle = normalize(nextQuery.trim());
                  const next = needle
                    ? options.filter((option) => normalize(option.label).includes(needle))
                    : options;
                  setActive(firstEnabled(next));
                }}
                onKeyDown={onListKeyDown}
                className="h-9 w-full border border-border bg-card ps-8 pe-2.5 text-base focus-visible:border-foreground focus-visible:outline-none sm:text-sm"
              />
            </div>
          )}
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-labelledby={ariaLabel ? undefined : triggerId}
            aria-label={ariaLabel}
            tabIndex={withSearch ? -1 : 0}
            aria-activedescendant={!withSearch && active >= 0 ? optionId(active) : undefined}
            onKeyDown={withSearch ? undefined : onListKeyDown}
            className="max-h-64 overflow-y-auto overscroll-contain focus-visible:outline-none"
          >
            {filtered.length === 0 ? (
              <li role="presentation" className="px-3 py-2.5 text-sm text-muted-foreground">
                {messages.common.noOptions}
              </li>
            ) : (
              filtered.map((option, index) => {
                const isSelected = option.value === selectedValue;
                return (
                  <li
                    key={option.value}
                    id={optionId(index)}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={option.disabled || undefined}
                    onPointerMove={() => !option.disabled && setActive(index)}
                    onPointerDown={(event) => event.preventDefault()} // keep focus inside
                    onClick={() => choose(option)}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm",
                      index === active && "bg-accent text-accent-foreground",
                      isSelected && "font-medium",
                      option.disabled && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {isSelected && <Check aria-hidden className="size-4 shrink-0" />}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
