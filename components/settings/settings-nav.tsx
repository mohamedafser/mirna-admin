"use client";

import type { LucideIcon } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
import { cn } from "@/lib/utils/cn";

export interface SettingsNavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  group: string;
  hasError: boolean;
}

/**
 * Jump links to the settings sections, highlighting the one in view.
 * Phones/tablets: a sticky row of chips under the header. Desktop: a sticky
 * side list grouped by topic. Sections with a validation error get a dot.
 */
export function SettingsNav({
  items,
  label,
  errorLabel,
}: {
  items: SettingsNavItem[];
  label: string;
  /** Screen-reader text after a section that has errors. */
  errorLabel: string;
}) {
  const [active, setActive] = useState(items[0]?.id);
  // Observe again only when the set of sections changes, not on every render.
  const ids = items.map((item) => item.id).join(" ");

  useEffect(() => {
    const sections = ids
      .split(" ")
      .map((id) => document.getElementById(id))
      .filter((section): section is HTMLElement => section !== null);
    // A section is "current" once its top passes just under the sticky header.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-112px 0px -55% 0px" },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [ids]);

  function jump(event: MouseEvent<HTMLAnchorElement>, id: string) {
    const section = document.getElementById(id);
    if (!section) return;
    event.preventDefault();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    section.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    window.history.replaceState(null, "", `#${id}`);
    setActive(id);
  }

  const groups = [...new Set(items.map((item) => item.group))];
  const link = (item: SettingsNavItem, variant: "chip" | "row") => {
    const current = item.id === active;
    return (
      <a
        href={`#${item.id}`}
        onClick={(event) => jump(event, item.id)}
        aria-current={current ? "location" : undefined}
        className={cn(
          "flex items-center gap-2 text-sm whitespace-nowrap transition-colors",
          variant === "chip" ? "rounded-full border px-3 py-1.5" : "rounded-lg px-2.5 py-2",
          current
            ? variant === "chip"
              ? "border-primary bg-primary text-primary-foreground"
              : "bg-brand-soft font-medium text-brand-soft-foreground"
            : variant === "chip"
              ? "bg-card text-muted-foreground hover:text-foreground"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        )}
      >
        <item.icon aria-hidden className="size-4 shrink-0" />
        <span className="min-w-0 truncate">{item.label}</span>
        {item.hasError && (
          <>
            <span aria-hidden className="ms-auto size-2 shrink-0 rounded-full bg-error" />
            <span className="sr-only">{errorLabel}</span>
          </>
        )}
      </a>
    );
  };

  return (
    // Sticky on the <nav> itself for phones: its containing block is the whole
    // page grid. On desktop the nav stretches to the form's height and the
    // inner list sticks instead.
    <nav aria-label={label} className="sticky top-16 z-20 lg:static">
      {/* Phones / tablets */}
      <ul className="-mx-4 flex gap-2 overflow-x-auto border-b bg-background/90 px-4 py-2.5 backdrop-blur-md [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:hidden">
        {items.map((item) => (
          <li key={item.id} className="shrink-0">
            {link(item, "chip")}
          </li>
        ))}
      </ul>

      {/* Desktop */}
      <div className="sticky top-24 hidden lg:grid lg:gap-5">
        {groups.map((group) => (
          <div key={group}>
            <p className="caps mb-1.5 px-2.5 text-[0.625rem] text-muted-foreground">{group}</p>
            <ul className="grid gap-0.5">
              {items
                .filter((item) => item.group === group)
                .map((item) => (
                  <li key={item.id}>{link(item, "row")}</li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
