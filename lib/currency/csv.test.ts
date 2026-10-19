import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCsv, priceCsvLine, readPriceCsv, toCsv } from "./csv.ts";

const currencies = [
  { code: "INR", decimals: 2 },
  { code: "BHD", decimals: 3 },
];
const HEADER = "product_sku,variant_sku,currency,price,sale_price";

describe("parseCsv / toCsv", () => {
  it("round-trips quotes, commas and newlines", () => {
    const rows = [
      ["a,b", 'say "hi"', "line\nbreak"],
      ["", "x", ""],
    ];
    assert.deepEqual(parseCsv(toCsv(rows)), rows);
  });

  it("handles a BOM and CRLF", () => {
    assert.deepEqual(parseCsv("﻿a,b\r\nc,d\r\n"), [
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("neutralises spreadsheet formulas on export", () => {
    assert.equal(toCsv([["=SUM(A1)"]]), "'=SUM(A1)\r\n");
  });
});

describe("readPriceCsv", () => {
  it("reads product and variant rows in each currency's decimals", () => {
    const { rows, issues } = readPriceCsv(
      `${HEADER}\nAB-1,,INR,1499,1299.50\nAB-1,AB-1-M,bhd,1.5,\nAB-2,,INR,,\n`,
      currencies,
    );
    assert.deepEqual(issues, []);
    assert.deepEqual(rows, [
      {
        line: 2,
        productSku: "AB-1",
        variantSku: "",
        currency: "INR",
        minor: { price: BigInt(149900), salePrice: BigInt(129950) },
      },
      {
        line: 3,
        productSku: "AB-1",
        variantSku: "AB-1-M",
        currency: "BHD",
        minor: { price: BigInt(1500), salePrice: null },
      },
      { line: 4, productSku: "AB-2", variantSku: "", currency: "INR", minor: null },
    ]);
  });

  it("reports every problem with its line", () => {
    const { issues } = readPriceCsv(
      [
        HEADER,
        "AB-1,,XXX,10,",
        ",,INR,10,",
        "AB-1,,BHD,1.2345,",
        "AB-1,,INR,10,12",
        "AB-1,,INR,10,",
        "AB-1,,INR,11,",
        "too,few",
      ].join("\n"),
      currencies,
    );
    assert.deepEqual(issues, [
      { line: 2, error: "currencyUnknown" },
      { line: 3, error: "skuRequired" },
      { line: 4, error: "priceTooManyDecimals" },
      { line: 5, error: "salePriceNotLower" },
      { line: 6, error: "duplicate" },
      { line: 7, error: "duplicate" },
      { line: 8, error: "columns" },
    ]);
  });

  it("rejects a file without the expected header", () => {
    assert.deepEqual(readPriceCsv("sku,price\nA,1\n", currencies).issues, [
      { line: 1, error: "header" },
    ]);
  });
});

describe("priceCsvLine", () => {
  it("writes amounts with the currency's decimals", () => {
    assert.deepEqual(priceCsvLine("AB-1", "", currencies[1], { price: 1500, salePrice: 1250 }), [
      "AB-1",
      "",
      "BHD",
      "1.500",
      "1.250",
    ]);
    assert.deepEqual(priceCsvLine("AB-1", "M", currencies[0], null), ["AB-1", "M", "INR", "", ""]);
  });
});
