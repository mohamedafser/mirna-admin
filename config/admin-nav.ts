import {
  Boxes,
  FolderTree,
  LayoutDashboard,
  Package,
  Settings,
  ShieldCheck,
  ShoppingCart,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * Admin sections — single source for the sidebar, mobile drawer, breadcrumbs,
 * page titles and placeholder routes. Labels live in messages.nav[key].
 *
 * `available: false` sections render a "Coming soon" page through
 * app/[lang]/admin/[section]. When a later phase builds a real section, add
 * its folder (e.g. app/[lang]/admin/products/) — static routes take
 * precedence over [section] — and set available: true.
 */
export type AdminSectionKey =
  | "dashboard"
  | "products"
  | "categories"
  | "inventory"
  | "orders"
  | "customers"
  | "admins"
  | "settings"
  | "profile";

export interface AdminSection {
  key: AdminSectionKey;
  /** URL segment after /[lang]/admin ("" for the dashboard). */
  segment: string;
  icon: LucideIcon;
  /** Shown in the sidebar (profile is reached from the user menu). */
  inNav: boolean;
  available: boolean;
  /** Sidebar group heading (label: messages.nav.groups[group]). */
  group?: "catalogue" | "inventory";
}

export const adminSections: readonly AdminSection[] = [
  { key: "dashboard", segment: "", icon: LayoutDashboard, inNav: true, available: true },
  {
    key: "categories",
    segment: "categories",
    icon: FolderTree,
    inNav: true,
    available: true,
    group: "catalogue",
  },
  {
    key: "products",
    segment: "products",
    icon: Package,
    inNav: true,
    available: true,
    group: "catalogue",
  },
  {
    key: "inventory",
    segment: "inventory",
    icon: Boxes,
    inNav: true,
    available: true,
    group: "inventory",
  },
  { key: "orders", segment: "orders", icon: ShoppingCart, inNav: true, available: true },
  { key: "customers", segment: "customers", icon: Users, inNav: true, available: true },
  { key: "admins", segment: "admins", icon: ShieldCheck, inNav: true, available: true },
  { key: "settings", segment: "settings", icon: Settings, inNav: true, available: true },
  { key: "profile", segment: "profile", icon: UserRound, inNav: false, available: false },
];

export const navSections = adminSections.filter((section) => section.inNav);
export const placeholderSections = adminSections.filter((section) => !section.available);

export function sectionHref(locale: string, section: AdminSection): string {
  return `/${locale}/admin${section.segment ? `/${section.segment}` : ""}`;
}

export function findSectionBySegment(segment: string | undefined): AdminSection | undefined {
  return adminSections.find((section) => section.segment === (segment ?? ""));
}

/**
 * Admin path segments after /[lang]/admin, e.g. "/en/admin/products/42" →
 * ["products", "42"]. Returns null for paths outside the admin area.
 */
export function adminPathSegments(pathname: string): string[] | null {
  const [, , area, ...rest] = pathname.split("/");
  return area === "admin" ? rest.filter(Boolean) : null;
}

/**
 * Sidebar structure: consecutive sections sharing a `group` are nested under
 * one heading; ungrouped sections stand alone.
 */
export type NavEntry =
  | { type: "item"; section: AdminSection }
  | { type: "group"; group: NonNullable<AdminSection["group"]>; sections: AdminSection[] };

export const navEntries: NavEntry[] = navSections.reduce<NavEntry[]>((entries, section) => {
  const last = entries.at(-1);
  if (!section.group) entries.push({ type: "item", section });
  else if (last?.type === "group" && last.group === section.group) last.sections.push(section);
  else entries.push({ type: "group", group: section.group, sections: [section] });
  return entries;
}, []);

/** Section owning a pathname — works for nested routes (/admin/products/42). */
export function activeSection(pathname: string): AdminSection | undefined {
  const segments = adminPathSegments(pathname);
  return segments ? findSectionBySegment(segments[0]) : undefined;
}
