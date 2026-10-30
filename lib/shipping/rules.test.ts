import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  gramsToKg,
  isDeliverable,
  parseWeightGrams,
  parseDays,
  validateShippingForm,
  type ShippingFormInput,
  type ShippingMethodInput,
} from "./rules.ts";

const method = (overrides: Partial<ShippingMethodInput> = {}): ShippingMethodInput => ({
  isActive: true,
  rateType: "FLAT",
  amount: "15",
  bands: [],
  freeShippingThreshold: "",
  minDays: "1",
  maxDays: "3",
  ...overrides,
});

const form = (
  standard: Partial<ShippingMethodInput> = {},
  express: Partial<ShippingMethodInput> = {},
  isActive = true,
): ShippingFormInput => ({
  isActive,
  methods: { STANDARD: method(standard), EXPRESS: method(express) },
});

describe("parseDays", () => {
  it("accepts whole days up to a year", () => {
    assert.equal(parseDays("0"), 0);
    assert.equal(parseDays("٣"), 3);
    assert.equal(parseDays("365"), 365);
  });

  it("rejects everything else", () => {
    assert.equal(parseDays(""), null);
    assert.equal(parseDays("1.5"), null);
    assert.equal(parseDays("-1"), null);
    assert.equal(parseDays("366"), null);
  });
});

describe("validateShippingForm", () => {
  it("returns minor units in the currency's decimals", () => {
    const result = validateShippingForm(
      form({ amount: "2.5", freeShippingThreshold: "50" }, { amount: "0" }),
      3,
    );
    assert.ok(result.ok);
    assert.deepEqual(result.methods[0], {
      code: "STANDARD",
      is_active: true,
      rate_type: "FLAT",
      amount: "2500",
      free_shipping_threshold: "50000",
      min_delivery_days: 1,
      max_delivery_days: 3,
    });
    // A free (0) rate is allowed.
    assert.equal(result.methods[1].amount, "0");
  });

  it("flags bad amounts, thresholds and days per method", () => {
    const result = validateShippingForm(
      form(
        { amount: "", freeShippingThreshold: "0" },
        { amount: "1.234", minDays: "5", maxDays: "2" },
      ),
      2,
    );
    assert.ok(!result.ok);
    assert.deepEqual(result.fieldErrors, {
      "STANDARD.amount": "priceRequired",
      "STANDARD.freeShippingThreshold": "priceInvalid",
      "EXPRESS.amount": "priceTooManyDecimals",
      "EXPRESS.maxDays": "daysOrder",
    });
  });

  it("rejects unknown rate types", () => {
    const result = validateShippingForm(form({ rateType: "DISTANCE" }), 2);
    assert.ok(!result.ok);
    assert.equal(result.fieldErrors["STANDARD.rateType"], "rateTypeUnsupported");
  });

  it("turns order value bands into contiguous minor-unit tiers", () => {
    const result = validateShippingForm(
      form({
        rateType: "ORDER_BASED",
        bands: [
          { upTo: "100", amount: "25" },
          { upTo: "250.5", amount: "15" },
          { upTo: "", amount: "0" },
        ],
      }),
      2,
    );
    assert.ok(result.ok);
    assert.deepEqual(result.methods[0].rates, [
      { min_value: "0", max_value: "10000", amount: "2500" },
      { min_value: "10000", max_value: "25050", amount: "1500" },
      { min_value: "25050", max_value: null, amount: "0" },
    ]);
    assert.equal(result.methods[0].amount, undefined);
  });

  it("reads weight bands in kg as grams", () => {
    const result = validateShippingForm(
      form({
        rateType: "WEIGHT_BASED",
        bands: [
          { upTo: "0.5", amount: "10" },
          { upTo: "", amount: "20" },
        ],
      }),
      3,
    );
    assert.ok(result.ok);
    assert.deepEqual(result.methods[0].rates, [
      { min_value: "0", max_value: "500", amount: "10000" },
      { min_value: "500", max_value: null, amount: "20000" },
    ]);
  });

  it("flags missing, unordered and empty bands", () => {
    const result = validateShippingForm(
      form(
        {
          rateType: "WEIGHT_BASED",
          bands: [
            { upTo: "2", amount: "10" },
            { upTo: "1", amount: "" },
            { upTo: "", amount: "5" },
          ],
        },
        { rateType: "ORDER_BASED", bands: [] },
      ),
      2,
    );
    assert.ok(!result.ok);
    assert.deepEqual(result.fieldErrors, {
      "STANDARD.bands.1.upTo": "upToNotHigher",
      "STANDARD.bands.1.amount": "priceRequired",
      "EXPRESS.bands": "bandsRequired",
    });
  });

  it("needs an active method for an active country", () => {
    const off = { isActive: false };
    assert.deepEqual(validateShippingForm(form(off, off), 2), {
      ok: false,
      fieldErrors: {},
      formError: "noActiveMethod",
    });
    assert.ok(validateShippingForm(form(off, off, false), 2).ok);
  });
});

describe("isDeliverable", () => {
  it("needs the country and one of its methods on", () => {
    const methods = [{ isActive: false }, { isActive: true }] as never;
    assert.equal(isDeliverable({ isActive: true, methods }), true);
    assert.equal(isDeliverable({ isActive: false, methods }), false);
    assert.equal(isDeliverable({ isActive: true, methods: [] }), false);
  });
});

describe("weights", () => {
  it("parses kg to grams without floating point", () => {
    assert.deepEqual(parseWeightGrams("1.25"), { ok: true, grams: 1250 });
    assert.deepEqual(parseWeightGrams("0.001"), { ok: true, grams: 1 });
    assert.deepEqual(parseWeightGrams("١٫٥"), { ok: true, grams: 1500 });
    assert.deepEqual(parseWeightGrams("0"), { ok: false, error: "weightInvalid" });
    assert.deepEqual(parseWeightGrams("1.2345"), { ok: false, error: "weightTooManyDecimals" });
    assert.deepEqual(parseWeightGrams("1000.001"), { ok: false, error: "weightTooLarge" });
  });

  it("formats grams as kg", () => {
    assert.equal(gramsToKg(1250), "1.25");
    assert.equal(gramsToKg(2000), "2");
    assert.equal(gramsToKg(5), "0.005");
  });
});

describe("parseOptionalWeight", () => {
  it("treats empty or missing input as no weight", async () => {
    const { parseOptionalWeight } = await import("./rules.ts");
    assert.deepEqual(parseOptionalWeight(""), { ok: true, grams: null });
    assert.deepEqual(parseOptionalWeight(undefined), { ok: true, grams: null });
    assert.deepEqual(parseOptionalWeight(null), { ok: true, grams: null });
    assert.deepEqual(parseOptionalWeight(" 2.5 "), { ok: true, grams: 2500 });
  });
});
