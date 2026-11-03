import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generateCode,
  generateResetToken,
  hashBinding,
  hashCode,
  hashResetToken,
} from "./crypto.ts";
import { renderOtpEmail } from "./email.ts";

describe("generateCode", () => {
  it("is always six digits", () => {
    for (let i = 0; i < 2000; i += 1) assert.match(generateCode(), /^\d{6}$/);
  });
});

describe("hashing", () => {
  const email = "a@example.com";

  it("is repeatable and never contains the code", () => {
    const hash = hashCode("secret", "signup", email, "123456");
    assert.equal(hash, hashCode("secret", "signup", email, "123456"));
    assert.doesNotMatch(hash, /123456/);
  });

  it("depends on the code, email, purpose and secret", () => {
    const hash = hashCode("secret", "signup", email, "123456");
    assert.notEqual(hash, hashCode("secret", "signup", email, "123457"));
    assert.notEqual(hash, hashCode("secret", "signup", "b@example.com", "123456"));
    assert.notEqual(hash, hashCode("secret", "recovery", email, "123456"));
    assert.notEqual(hash, hashCode("other", "signup", email, "123456"));
  });

  it("keeps each kind of value separate", () => {
    assert.notEqual(hashBinding("secret", "value"), hashResetToken("secret", "value"));
  });

  it("makes reset tokens the API accepts", () => {
    assert.match(generateResetToken(), /^[A-Za-z0-9_-]{32,128}$/);
  });
});

describe("renderOtpEmail", () => {
  const base = { storeName: "Mirna", code: "012345" };

  for (const locale of ["en", "ar"] as const) {
    for (const purpose of ["signup", "recovery"] as const) {
      it(`${locale} ${purpose}: has the code and the 5-minute expiry`, () => {
        const email = renderOtpEmail({ ...base, locale, purpose });
        assert.match(email.html, />012345</);
        assert.match(email.text, /012345/);
        assert.match(email.html, /5/);
        assert.match(email.text, locale === "en" ? /5 minutes/ : /5 دقائق/);
      });

      it(`${locale} ${purpose}: keeps the code out of the subject and preview`, () => {
        const email = renderOtpEmail({ ...base, locale, purpose });
        assert.doesNotMatch(email.subject, /012345/);
        const preview = email.html.match(/<div style="display:none[^>]*>(.*?)<\/div>/)?.[1];
        assert.ok(preview);
        assert.doesNotMatch(preview, /012345/);
      });
    }
  }

  it("mirrors for Arabic", () => {
    const email = renderOtpEmail({ ...base, locale: "ar", purpose: "signup" });
    assert.match(email.html, /<html lang="ar" dir="rtl">/);
    // Digits still read left to right.
    assert.match(email.html, /class="code" dir="ltr"/);
  });

  it("escapes the store name", () => {
    const email = renderOtpEmail({
      ...base,
      storeName: "<b>Shop</b>",
      locale: "en",
      purpose: "signup",
    });
    assert.doesNotMatch(email.html, /<b>Shop/);
    assert.match(email.html, /&lt;b&gt;Shop/);
  });
});
