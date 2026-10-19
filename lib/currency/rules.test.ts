import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { currencyDefaults, validateCurrencyInput } from "./rules.ts";

const input = (code: string, symbol = "X", decimals = "2") => ({
  code,
  symbol,
  decimals,
  isActive: true,
});

describe("currencyDefaults", () => {
  it("knows each currency's decimals", () => {
    assert.equal(currencyDefaults("OMR")?.decimals, 3);
    assert.equal(currencyDefaults("JOD")?.decimals, 3);
    assert.equal(currencyDefaults("CHF")?.decimals, 2);
    assert.equal(currencyDefaults("JPY")?.decimals, 0);
  });

  it("suggests a short symbol", () => {
    assert.equal(currencyDefaults("JPY")?.symbol, "¥");
    assert.ok((currencyDefaults("OMR")?.symbol.length ?? 0) <= 8);
  });
});

describe("validateCurrencyInput", () => {
  it("accepts a new ISO currency", () => {
    assert.deepEqual(validateCurrencyInput(input("OMR", "OMR", "3"), ["INR", "AED"]), {});
  });

  it("rejects unknown, malformed and existing codes", () => {
    assert.equal(validateCurrencyInput(input("XYZ"), []).code, "codeInvalid");
    assert.equal(validateCurrencyInput(input("om"), []).code, "codeInvalid");
    assert.equal(validateCurrencyInput(input(""), []).code, "codeRequired");
    assert.equal(validateCurrencyInput(input("AED"), ["AED"]).code, "codeTaken");
  });

  it("checks the symbol and decimals", () => {
    assert.equal(validateCurrencyInput(input("OMR", ""), []).symbol, "symbolRequired");
    assert.equal(validateCurrencyInput(input("OMR", "TOOLONGSYM"), []).symbol, "symbolTooLong");
    assert.equal(validateCurrencyInput(input("OMR", "R", "4"), []).decimals, "decimalsInvalid");
    assert.equal(validateCurrencyInput(input("OMR", "R", ""), []).decimals, "decimalsInvalid");
  });
});
