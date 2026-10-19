"use client";

import { Check, ChevronDown, LoaderCircle, Plus, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { controlClassName } from "@/components/ui/form";
import { useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils/cn";

export interface MultiSelectOption {
  value: string;
  label: string;
  /** Can't be newly selected (an already selected one can still be removed). */
  disabled?: boolean;
}

/** Case- and accent-insensitive text for matching ("Crème" matches "creme"). */
function normalize(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase().trim();
}

const CREATE = "__create__";

/**
 * Multi-select: the chosen values show as removable chips, and a searchable
 * listbox toggles values on and off (it stays open for several picks).
 * Optionally offers "Create …" for a search text that matches nothing.
 *
 * Same accessibility model as Combobox: a labelled `role="combobox"` trigger,
 * focus moves to the search box while open, `aria-activedescendant` tracks the
 * highlighted option and the listbox is `aria-multiselectable`. Keys: ↑/↓,
 * Enter to toggle, Escape to close, Tab to leave; Backspace in an empty search
 * removes the last chip.
 *
 * Submits through one hidden input per value (`name`), so the server reads
 * them with FormData.getAll(name).
 */
export function MultiSelect({
  id,
  name,
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
  onCreate,
  createLabel,
  creating = false,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
  dataField,
}: {
  id?: string;
  name?: string;
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Called with the search text when the admin picks "Create …". */
  onCreate?: (text: string) => void;
  createLabel?: (text: string) => string;
  /** A create request is in flight. */
  creating?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  dataField?: string;
}) {
  const { messages } = useI18n();
  const fallbackId = useId();
  const triggerId = id ?? fallbackId;
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;

  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = new Set(value);
  const byValue = new Map(options.map((option) => [option.value, option]));
  const chips = value.map((item) => byValue.get(item) ?? { value: item, label: item });

  const filtered = useMemo(() => {
    const needle = normalize(query);
    return needle ? options.filter((option) => normalize(option.label).includes(needle)) : options;
  }, [options, query]);
  const text = query.trim();
  const canCreate =
    Boolean(onCreate) &&
    text !== "" &&
    !options.some((option) => normalize(option.label) === normalize(text));
  // Rendered rows: the filtered options, then "Create …".
  const rows: MultiSelectOption[] = canCreate
    ? [...filtered, { value: CREATE, label: createLabel?.(text) ?? text, disabled: creating }]
    : filtered;
  const isDisabled = (option: MultiSelectOption) =>
    Boolean(option.disabled) && !selected.has(option.value);

  function openList() {
    if (disabled) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      const below = window.innerHeight - rect.bottom;
      setOpenUp(below < 320 && rect.top > below);
    }
    setQuery("");
    setActive(options.findIndex((option) => !isDisabled(option)));
    setOpen(true);
  }

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function toggle(option: MultiSelectOption | undefined) {
    if (!option) return;
    if (option.value === CREATE) {
      if (!creating) {
        onCreate?.(text);
        setQuery("");
      }
      return;
    }
    if (selected.has(option.value)) onChange(value.filter((item) => item !== option.value));
    else if (!option.disabled) onChange([...value, option.value]);
  }

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (open && active >= 0) {
      document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    }
    // optionId only depends on listId, which is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const step = (from: number, delta: 1 | -1) => {
    for (let index = from; index >= 0 && index < rows.length; index += delta) {
      if (!isDisabled(rows[index])) return index;
    }
    return -1;
  };

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        const next = step(active + 1, 1);
        if (next >= 0) setActive(next);
        return;
      }
      case "ArrowUp": {
        event.preventDefault();
        const previous = step(active - 1, -1);
        if (previous >= 0) setActive(previous);
        return;
      }
      case "Enter":
        event.preventDefault(); // never submits the surrounding form
        toggle(rows[active]);
        return;
      case "Escape":
        event.preventDefault();
        event.stopPropagation(); // don't also close a surrounding dialog
        close(true);
        return;
      case "Tab":
        close(false);
        return;
      case "Backspace":
        if (query === "" && value.length > 0) onChange(value.slice(0, -1));
        return;
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <div
        className={cn(
          controlClassName,
          "flex min-h-11 flex-wrap items-center gap-1.5 py-1.5",
          "focus-within:border-foreground focus-within:ring-[3px] focus-within:ring-ring/15",
          open && "border-foreground",
          invalid && "border-error",
          disabled && "cursor-not-allowed opacity-60",
        )}
        onClick={(event) => {
          if (event.target === event.currentTarget && !open) openList();
        }}
      >
        {chips.map((chip) => (
          <span
            key={chip.value}
            className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted py-0.5 ps-2 pe-0.5 text-sm"
          >
            <bdi className="truncate">{chip.label}</bdi>
            <button
              type="button"
              disabled={disabled}
              aria-label={format(messages.catalogue.common.removeNamed, { name: chip.label })}
              onClick={() => onChange(value.filter((item) => item !== chip.value))}
              className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </span>
        ))}
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
          data-field={dataField}
          disabled={disabled}
          onClick={() => (open ? close(true) : openList())}
          onKeyDown={(event) => {
            if (!open && ["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
              event.preventDefault();
              openList();
            }
          }}
          className="flex h-8 min-w-24 flex-1 items-center gap-2 text-start text-muted-foreground focus-visible:outline-none"
        >
          <span className="min-w-0 flex-1 truncate">
            {value.length === 0
              ? placeholder
              : format(messages.catalogue.common.selectedCount, { count: value.length })}
          </span>
          {creating ? (
            <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin" />
          ) : (
            <ChevronDown
              aria-hidden
              className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")}
            />
          )}
        </button>
      </div>
      {name &&
        value.map((item) => <input key={item} type="hidden" name={name} value={item} readOnly />)}

      {open && (
        <div
          className={cn(
            "absolute inset-x-0 z-50 rounded-xl border bg-popover p-1 text-popover-foreground shadow-card",
            openUp ? "bottom-full mb-1.5" : "top-full mt-1.5",
          )}
        >
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
                const needle = normalize(nextQuery);
                const next = needle
                  ? options.filter((option) => normalize(option.label).includes(needle))
                  : options;
                const first = next.findIndex((option) => !isDisabled(option));
                // Nothing matches: highlight "Create …" (rendered after the matches).
                setActive(first >= 0 ? first : onCreate && needle ? next.length : -1);
              }}
              onKeyDown={onSearchKeyDown}
              className="h-9 w-full rounded-md border border-border bg-card ps-8 pe-2.5 text-base focus-visible:border-foreground focus-visible:outline-none sm:text-sm"
            />
          </div>
          <ul
            id={listId}
            role="listbox"
            aria-multiselectable="true"
            aria-labelledby={triggerId}
            tabIndex={-1}
            className="max-h-64 overflow-y-auto overscroll-contain focus-visible:outline-none"
          >
            {rows.length === 0 ? (
              <li role="presentation" className="px-3 py-2.5 text-sm text-muted-foreground">
                {messages.common.noOptions}
              </li>
            ) : (
              rows.map((option, index) => {
                const isCreate = option.value === CREATE;
                const isSelected = selected.has(option.value);
                const off = isDisabled(option);
                return (
                  <li
                    key={option.value}
                    id={optionId(index)}
                    role="option"
                    aria-selected={isCreate ? undefined : isSelected}
                    aria-disabled={off || undefined}
                    onPointerMove={() => !off && setActive(index)}
                    onPointerDown={(event) => event.preventDefault()} // keep focus in search
                    onClick={() => toggle(option)}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm",
                      index === active && "bg-accent text-accent-foreground",
                      isCreate && "border-t font-medium text-primary",
                      off && "cursor-not-allowed opacity-50",
                    )}
                  >
                    {isCreate ? (
                      <Plus aria-hidden className="size-4 shrink-0" />
                    ) : (
                      <span
                        aria-hidden
                        className={cn(
                          "flex size-4 shrink-0 items-center justify-center rounded border",
                          isSelected && "border-primary bg-primary text-primary-foreground",
                        )}
                      >
                        {isSelected && <Check className="size-3" />}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
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
