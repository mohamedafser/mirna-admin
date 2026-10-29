import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Auto-generated product SKUs: MIR-00001, MIR-00002, … The next one is the
 * highest existing MIR-<number> SKU plus one. SKUs the admin typed in another
 * shape are ignored, and a typed SKU always wins. Two admins creating at the
 * same moment can get the same number; saveProduct retries on the unique
 * violation with a fresh one.
 */
export const AUTO_SKU_PREFIX = "MIR-";
const AUTO_SKU_DIGITS = 5;

export async function nextProductSku(supabase: SupabaseClient<Database>): Promise<string> {
  const { data, error } = await supabase
    .from("products")
    .select("sku")
    .like("sku", `${AUTO_SKU_PREFIX}%`)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  const pattern = new RegExp(`^${AUTO_SKU_PREFIX}(\\d+)$`);
  const highest = data.reduce((max, row) => {
    const match = pattern.exec(row.sku);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `${AUTO_SKU_PREFIX}${String(highest + 1).padStart(AUTO_SKU_DIGITS, "0")}`;
}
