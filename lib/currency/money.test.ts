import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatMinor, minorToDecimal, parseMinor, parsePriceRow } from "./money.ts";

const BHD = { code: "BHD", decimals: 3 };
const KWD = { code: "KWD", decimals: 3 };
const INR = { code: "INR", decimals: 2 };
const USD = { code: "USD", decimals: 2 };

// Intl separates the code from the amount with a (narrow) no-break space.
const plain = (text: string) => text.replace(/[  ]/g, " ");

describe("formatMinor", () => {
  it("shows three decimals for BHD and KWD", () => {
    assert.equal(plain(formatMinor(1500, BHD, "en")), "BHD 1.500");
    assert.equal(plain(formatMinor(BigInt(1), KWD, "en")), "KWD 0.001");
    assert.equal(plain(formatMinor(123456789, KWD, "en")), "KWD 123,456.789");
  });

  it("shows two decimals for two-decimal currencies", () => {
    assert.equal(formatMinor(123456, INR, "en-IN"), "₹1,234.56");
    assert.equal(formatMinor(1999, USD, "en-US"), "$19.99");
    assert.equal(formatMinor(5, USD, "en-US"), "$0.05");
  });

  it("is exact for amounts beyond float precision", () => {
    assert.equal(formatMinor("99999999999999", USD, "en-US"), "$999,999,999,999.99");
  });

  it("uses the currency's decimals, not Intl's default", () => {
    // Intl's own default for JPY is 0; the store's setting wins.
    assert.equal(plain(formatMinor(1234, { code: "JPY", decimals: 2 }, "en-US")), "¥12.34");
  });

  it("formats in Arabic", () => {
    assert.match(formatMinor(1500, BHD, "ar-BH"), /١٫٥٠٠/);
  });
});

describe("minorToDecimal", () => {
  it("pads to the currency's decimals", () => {
    assert.equal(minorToDecimal(1500, 3), "1.500");
    assert.equal(minorToDecimal(5, 3), "0.005");
    assert.equal(minorToDecimal(1250, 2), "12.50");
    assert.equal(minorToDecimal(7, 0), "7");
  });
});

describe("parseMinor", () => {
  it("converts to minor units without floating point", () => {
    assert.deepEqual(parseMinor("1.5", 3), { ok: true, minor: BigInt(1500) });
    assert.deepEqual(parseMinor("0.1", 2), { ok: true, minor: BigInt(10) });
    assert.deepEqual(parseMinor("1,234.56", 2), { ok: true, minor: BigInt(123456) });
    assert.deepEqual(parseMinor("١٢٫٥", 2), { ok: true, minor: BigInt(1250) });
  });

  it("rejects bad input", () => {
    assert.deepEqual(parseMinor("", 2), { ok: false, error: "priceRequired" });
    assert.deepEqual(parseMinor("-1", 2), { ok: false, error: "priceInvalid" });
    assert.deepEqual(parseMinor("0", 2), { ok: false, error: "priceInvalid" });
    assert.deepEqual(parseMinor("1.2345", 3), { ok: false, error: "priceTooManyDecimals" });
    assert.deepEqual(parseMinor("1.234", 2), { ok: false, error: "priceTooManyDecimals" });
    assert.deepEqual(parseMinor("100000000000", 3), { ok: false, error: "priceTooLarge" });
  });

  it("accepts zero only when allowed", () => {
    assert.deepEqual(parseMinor("0.00", 2, { allowZero: true }), { ok: true, minor: BigInt(0) });
    assert.deepEqual(parseMinor("-0", 2, { allowZero: true }), {
      ok: false,
      error: "priceInvalid",
    });
  });
});

describe("parsePriceRow", () => {
  it("treats an empty row as no price", () => {
    assert.deepEqual(parsePriceRow("", " ", 2), { ok: true, minor: null });
  });

  it("requires the sale price to be lower", () => {
    assert.deepEqual(parsePriceRow("10", "10", 2), {
      ok: false,
      errors: { salePrice: "salePriceNotLower" },
    });
    assert.deepEqual(parsePriceRow("10", "9.995", 3), {
      ok: true,
      minor: { price: BigInt(10000), salePrice: BigInt(9995) },
    });
  });

  it("requires a price when a sale price is given", () => {
    assert.deepEqual(parsePriceRow("", "5", 2), { ok: false, errors: { price: "priceRequired" } });
  });
});

describe("readCurrencyPrices", async () => {
  const { readCurrencyPrices, parseSellingRow, sellingRowInput } =
    await import("./product-prices.ts");
  const currencies = [BHD, USD];

  it("stores a selling price alone as the price, with a regular price as a sale", () => {
    const result = readCurrencyPrices(
      JSON.stringify([
        { currency: "BHD", price: "", salePrice: "2.250" },
        { currency: "USD", price: "12", salePrice: "10" },
        { currency: "XXX", price: "1", salePrice: "" },
      ]),
      currencies,
    );
    assert.deepEqual(result.rows, [
      { currency: "BHD", price: BigInt(2250), salePrice: null },
      { currency: "USD", price: BigInt(1200), salePrice: BigInt(1000) },
    ]);
    assert.deepEqual(result.errors, {});
  });

  it("requires a selling price lower than the regular price", () => {
    assert.deepEqual(
      readCurrencyPrices(
        JSON.stringify([
          { currency: "BHD", price: "2", salePrice: "" },
          { currency: "USD", price: "10", salePrice: "12" },
        ]),
        currencies,
      ).errors,
      { BHD: { salePrice: "priceRequired" }, USD: { salePrice: "salePriceNotLower" } },
    );
  });

  it("requires every active currency except the base, and survives bad JSON", () => {
    assert.deepEqual(
      readCurrencyPrices(
        JSON.stringify([{ currency: "USD", price: "", salePrice: "" }]),
        [...currencies, { code: "EUR", decimals: 2, isActive: false }],
        "BHD",
      ).errors,
      { USD: { salePrice: "priceRequired" } },
    );
    assert.deepEqual(readCurrencyPrices("{oops", currencies, "BHD").errors, {
      USD: { salePrice: "priceRequired" },
    });
  });

  it("lets an inactive currency stay empty", () => {
    assert.deepEqual(parseSellingRow("", "", 2, false), { ok: true, minor: null });
  });

  it("shows a saved price without a sale as the selling price", () => {
    assert.deepEqual(sellingRowInput({ price: 1250, salePrice: null }, 2), {
      price: "",
      salePrice: "12.50",
    });
    assert.deepEqual(sellingRowInput({ price: 1250, salePrice: 1000 }, 2), {
      price: "12.50",
      salePrice: "10.00",
    });
  });
});
