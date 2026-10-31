import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decimalsMatchStripe,
  isCaptured,
  isOpen,
  normalizeDomain,
  parsePaymentWindow,
  refundableMinor,
  stripeDecimals,
  stripeKeyMode,
} from "./rules.ts";

const n = (value: number) => BigInt(value);

describe("refundableMinor", () => {
  it("is the amount received when nothing was refunded", () => {
    assert.equal(refundableMinor(n(12500), []), n(12500));
  });

  it("subtracts succeeded and pending refunds", () => {
    const refunds = [
      { amountMinor: n(2000), status: "SUCCEEDED" as const },
      { amountMinor: n(500), status: "PENDING" as const },
    ];
    assert.equal(refundableMinor(n(12500), refunds), n(10000));
  });

  it("ignores failed and cancelled refunds", () => {
    const refunds = [
      { amountMinor: n(12500), status: "FAILED" as const },
      { amountMinor: n(12500), status: "CANCELLED" as const },
    ];
    assert.equal(refundableMinor(n(12500), refunds), n(12500));
  });

  it("never goes below zero", () => {
    assert.equal(refundableMinor(n(100), [{ amountMinor: n(150), status: "SUCCEEDED" }]), n(0));
  });
});

describe("stripeDecimals", () => {
  it("uses three decimals for the dinars and the rial", () => {
    for (const code of ["KWD", "BHD", "OMR"]) assert.equal(stripeDecimals(code), 3);
  });

  it("uses two decimals for AED, SAR, QAR, USD and GBP", () => {
    for (const code of ["AED", "SAR", "QAR", "USD", "GBP"]) assert.equal(stripeDecimals(code), 2);
  });

  it("knows zero-decimal currencies", () => {
    assert.equal(stripeDecimals("jpy"), 0);
  });

  it("flags a store currency configured with the wrong decimals", () => {
    assert.equal(decimalsMatchStripe("KWD", 3), true);
    assert.equal(decimalsMatchStripe("KWD", 2), false);
  });
});

describe("payment status groups", () => {
  it("treats paid and refunded payments as captured", () => {
    assert.equal(isCaptured("PAID"), true);
    assert.equal(isCaptured("PARTIALLY_REFUNDED"), true);
    assert.equal(isCaptured("REFUNDED"), true);
    assert.equal(isCaptured("FAILED"), false);
    assert.equal(isCaptured(null), false);
  });

  it("treats a declined attempt as still open (the customer can retry)", () => {
    assert.equal(isOpen("FAILED"), true);
    assert.equal(isOpen("PROCESSING"), true);
    assert.equal(isOpen("CANCELLED"), false);
  });
});

describe("stripeKeyMode", () => {
  it("reads the mode from secret and restricted keys", () => {
    assert.equal(stripeKeyMode("sk_test_123"), "test");
    assert.equal(stripeKeyMode("rk_live_123"), "live");
    assert.equal(stripeKeyMode("pk_live_123"), null);
    assert.equal(stripeKeyMode(undefined), null);
  });
});

describe("normalizeDomain", () => {
  it("keeps only the host name", () => {
    assert.equal(normalizeDomain("https://Shop.Mirna.ae/en/checkout"), "shop.mirna.ae");
    assert.equal(normalizeDomain("www.mirna.ae"), "www.mirna.ae");
  });

  it("rejects hosts Stripe can't verify", () => {
    assert.equal(normalizeDomain("localhost:3006"), null);
    assert.equal(normalizeDomain("not a domain"), null);
    assert.equal(normalizeDomain(""), null);
  });
});

describe("parsePaymentWindow", () => {
  it("accepts 15 minutes to 24 hours", () => {
    assert.equal(parsePaymentWindow("60"), 60);
    assert.equal(parsePaymentWindow("15"), 15);
    assert.equal(parsePaymentWindow("1440"), 1440);
  });

  it("rejects values outside the range or not whole minutes", () => {
    assert.equal(parsePaymentWindow("10"), null);
    assert.equal(parsePaymentWindow("2000"), null);
    assert.equal(parsePaymentWindow("30.5"), null);
  });
});
