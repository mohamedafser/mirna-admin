// Domain types derived from the database schema — do not redeclare columns by hand.
import type { Enums, Tables } from "@/lib/supabase/database.types";

export type { Direction, Locale } from "@/config/i18n";
export type { CountryCode, CurrencyCode, RegionConfig } from "@/config/region";

export type Role = Enums<"user_role">;
export type OrderStatus = Enums<"order_status">;

export type Profile = Tables<"profiles">;
export type Category = Tables<"categories">;
export type Product = Tables<"products">;
export type ProductImage = Tables<"product_images">;
export type Inventory = Tables<"inventory">;
export type Address = Tables<"addresses">;
export type Order = Tables<"orders">;
export type OrderItem = Tables<"order_items">;

/** The authenticated user as the app sees it (narrow, safe to pass to the client). */
export interface CurrentUser {
  id: string;
  email: string | null;
  fullName: string | null;
  role: Role;
  isActive: boolean;
}
