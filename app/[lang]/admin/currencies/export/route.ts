import { getAdminOrNull } from "@/lib/auth/dal";
import { listCurrencies } from "@/lib/currencies/queries";
import { PRICE_CSV_HEADER, priceCsvLine, toCsv } from "@/lib/currency/csv";
import { createClient } from "@/lib/supabase/server";

const PAGE = 1000;

interface ProductRow {
  id: string;
  sku: string;
  variants: { id: string; sku: string }[];
  prices: {
    variant_id: string | null;
    currency_code: string;
    price: number;
    sale_price: number | null;
  }[];
}

/**
 * Downloads every product's prices as CSV (lib/currency/csv.ts), ready to
 * edit and import on the Currencies page: one product-level line per active
 * currency (empty amounts where there's no price yet, to fill in), plus a
 * line for each variant price that exists. Admins only.
 */
export async function GET() {
  if (!(await getAdminOrNull())) return new Response("Forbidden", { status: 403 });
  const currencies = await listCurrencies();
  if (!currencies) return new Response("Not available", { status: 404 });

  const byCode = new Map(currencies.map((currency) => [currency.code, currency]));
  const active = currencies.filter((currency) => currency.isActive);
  const supabase = await createClient();
  const lines: string[][] = [PRICE_CSV_HEADER];

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("products")
      .select(
        "id, sku, variants:product_variants(id, sku), prices:product_prices(variant_id, currency_code, price, sale_price)",
      )
      .order("sku", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error(`[currencies] export failed: code=${error.code || "-"}`);
      return new Response("Export failed", { status: 500 });
    }
    for (const product of data as unknown as ProductRow[]) {
      const price = (variantId: string | null, code: string) => {
        const row = product.prices.find(
          (item) => item.variant_id === variantId && item.currency_code === code,
        );
        return row ? { price: row.price, salePrice: row.sale_price } : null;
      };
      for (const currency of active) {
        lines.push(priceCsvLine(product.sku, "", currency, price(null, currency.code)));
      }
      for (const variant of [...product.variants].sort((a, b) => a.sku.localeCompare(b.sku))) {
        for (const row of product.prices.filter((item) => item.variant_id === variant.id)) {
          const currency = byCode.get(row.currency_code);
          if (currency) {
            lines.push(
              priceCsvLine(
                product.sku,
                variant.sku,
                currency,
                price(variant.id, row.currency_code),
              ),
            );
          }
        }
      }
    }
    if (data.length < PAGE) break;
  }

  const date = new Date().toISOString().slice(0, 10);
  return new Response(toCsv(lines), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="prices-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
