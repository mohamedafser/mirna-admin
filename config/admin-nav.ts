import {
  Boxes,
  Coins,
  FolderTree,
  GalleryHorizontalEnd,
  History,
  LayoutDashboard,
  Package,
  PackagePlus,
  Settings,
  Shapes,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Tags,
  Truck,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * Admin sections — single source for the sidebar, mobile drawer, breadcrumbs,
 * page titles and placeholder routes. Labels live in messages.nav[key].
 *
 * Every section has its own folder under app/[lang]/admin/. A section added
 * before its pages exist can be marked `available: false`: the sidebar then
 * shows a "Coming soon" badge on it.
 */
export type AdminSectionKey =
  | "dashboard"
  | "products"
  | "categories"
  | "tags"
  | "productTypes"
  | "attributes"
  | "inventory"
  | "stockUpdate"
  | "stockMovements"
  | "orders"
  | "customers"
  | "admins"
  | "banner"
  | "currencies"
  | "shipping"
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
  group?: "catalogue" | "inventory" | "sales" | "store" | "admin";
}

export const adminSections: readonly AdminSection[] = [
  { key: "dashboard", segment: "", icon: LayoutDashboard, inNav: true, available: true },
  // Catalogue
  {
    key: "products",
    segment: "products",
    icon: Package,
    inNav: true,
    available: true,
    group: "catalogue",
  },
  {
    key: "categories",
    segment: "categories",
    icon: FolderTree,
    inNav: true,
    available: true,
    group: "catalogue",
  },
  { key: "tags", segment: "tags", icon: Tags, inNav: true, available: true, group: "catalogue" },
  {
    key: "productTypes",
    segment: "product-types",
    icon: Shapes,
    inNav: true,
    available: true,
    group: "catalogue",
  },
  {
    key: "attributes",
    segment: "attributes",
    icon: SlidersHorizontal,
    inNav: true,
    available: true,
    group: "catalogue",
  },
  // Inventory
  {
    key: "inventory",
    segment: "inventory",
    icon: Boxes,
    inNav: true,
    available: true,
    group: "inventory",
  },
  {
    key: "stockUpdate",
    segment: "stock-update",
    icon: PackagePlus,
    inNav: true,
    available: true,
    group: "inventory",
  },
  {
    key: "stockMovements",
    segment: "stock-movements",
    icon: History,
    inNav: true,
    available: true,
    group: "inventory",
  },
  // Sales
  {
    key: "orders",
    segment: "orders",
    icon: ShoppingCart,
    inNav: true,
    available: true,
    group: "sales",
  },
  {
    key: "customers",
    segment: "customers",
    icon: Users,
    inNav: true,
    available: true,
    group: "sales",
  },
  // Store setup
  {
    key: "banner",
    segment: "banner",
    icon: GalleryHorizontalEnd,
    inNav: true,
    available: true,
    group: "store",
  },
  {
    key: "currencies",
    segment: "currencies",
    icon: Coins,
    inNav: true,
    available: true,
    group: "store",
  },
  {
    key: "shipping",
    segment: "shipping",
    icon: Truck,
    inNav: true,
    available: true,
    group: "store",
  },
  // Administration
  {
    key: "admins",
    segment: "admins",
    icon: ShieldCheck,
    inNav: true,
    available: true,
    group: "admin",
  },
  {
    key: "settings",
    segment: "settings",
    icon: Settings,
    inNav: true,
    available: true,
    group: "admin",
  },
  { key: "profile", segment: "profile", icon: UserRound, inNav: false, available: true },
];

export const navSections = adminSections.filter((section) => section.inNav);

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
