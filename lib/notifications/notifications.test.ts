import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderOrderEmail, type OrderEmailData } from "./order-email.ts";
import { afterFailure, describeError, isStale, MAX_ATTEMPTS } from "./rules.ts";

const STATUSES = [
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
] as const;

const data = (overrides: Partial<OrderEmailData> = {}): OrderEmailData => ({
  locale: "en",
  status: "SHIPPED",
  storeName: "Mirna",
  customerName: "Sara",
  orderNumber: 1042,
  placedAt: "3 November 2026",
  awaitingPayment: false,
  items: [
    { name: "Silk scarf", sku: "SC-1", quantity: "2", unitPrice: "AED 100", total: "AED 200" },
  ],
  subtotal: "AED 200",
  discount: null,
  tax: null,
  shipping: "AED 15",
  total: "AED 215",
  shippingMethod: "STANDARD",
  deliveryDays: "3–5",
  addressLines: ["Sara", "Dubai"],
  orderUrl: "https://shop.example.com/en/account/orders/abc",
  contactEmail: null,
  contactPhone: null,
  ...overrides,
});

describe("renderOrderEmail", () => {
  it("has the order number, status and summary in every status and language", () => {
    for (const locale of ["en", "ar"] as const) {
      for (const status of STATUSES) {
        const { subject, html, text } = renderOrderEmail(data({ locale, status }));
        assert.match(subject, /1042/);
        for (const body of [html, text]) {
          assert.match(body, /#1042/);
          assert.match(body, /Silk scarf/);
          assert.match(body, /AED 215/);
        }
      }
    }
  });

  it("writes the order number once in the subject", () => {
    assert.match(renderOrderEmail(data()).subject, /order #1042 /);
  });

  it("gives each status its own subject", () => {
    const subjects = STATUSES.map((status) => renderOrderEmail(data({ status })).subject);
    assert.equal(new Set(subjects).size, STATUSES.length);
  });

  it("escapes customer-controlled values in the HTML", () => {
    const attack = `<img src=x onerror="alert(1)">`;
    const { html } = renderOrderEmail(
      data({
        customerName: attack,
        addressLines: [attack],
        items: [{ name: attack, sku: attack, quantity: "1", unitPrice: "1", total: "1" }],
      }),
    );
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img/);
  });

  it("keeps the subject on one line", () => {
    const { subject } = renderOrderEmail(data({ storeName: "Mirna\r\nBcc: x@example.com" }));
    assert.doesNotMatch(subject, /[\r\n]/);
  });

  it("is right-to-left in Arabic only", () => {
    assert.match(renderOrderEmail(data({ locale: "ar" })).html, /<html lang="ar" dir="rtl">/);
    assert.match(renderOrderEmail(data()).html, /<html lang="en" dir="ltr">/);
  });

  it("leaves out what doesn't apply", () => {
    const { html, text } = renderOrderEmail(
      data({ orderUrl: null, discount: null, tax: null, contactEmail: null }),
    );
    assert.doesNotMatch(html, /View your order/);
    assert.doesNotMatch(text, /Discount|Tax|Need help/);
  });

  it("shows the payment note only while an order awaits payment", () => {
    const note = /waiting for your payment/;
    assert.match(renderOrderEmail(data({ status: "PENDING", awaitingPayment: true })).text, note);
    assert.doesNotMatch(
      renderOrderEmail(data({ status: "CANCELLED", awaitingPayment: true })).text,
      note,
    );
  });
});

describe("afterFailure", () => {
  const now = new Date("2026-11-03T00:00:00Z");

  it("waits longer after each attempt", () => {
    const times = [1, 2, 3, 4].map((attempt) => {
      const decision = afterFailure(attempt, now);
      assert.equal(decision.state, "PENDING");
      return decision.state === "PENDING" ? Date.parse(decision.nextAttemptAt) : 0;
    });
    assert.deepEqual(
      times,
      [...times].sort((a, b) => a - b),
    );
    assert.equal(times[0], now.getTime() + 60_000);
  });

  it("gives up after the last attempt", () => {
    assert.deepEqual(afterFailure(MAX_ATTEMPTS, now), { state: "FAILED" });
  });
});

describe("isStale", () => {
  const now = new Date("2026-11-10T00:00:00Z");

  it("is true only after three days", () => {
    assert.equal(isStale("2026-11-09T00:00:00Z", now), false);
    assert.equal(isStale("2026-11-06T00:00:00Z", now), true);
  });
});

describe("describeError", () => {
  it("keeps SMTP codes", () => {
    const error = Object.assign(new Error("x"), {
      code: "EAUTH",
      responseCode: 535,
      command: "AUTH PLAIN",
    });
    assert.match(describeError(error), /EAUTH 535/);
  });

  it("never includes the message, which can quote addresses or secrets", () => {
    const error = new Error("550 rejected sara@example.com pass=hunter2");
    assert.equal(describeError(error), "Error");
  });

  it("copes with anything thrown", () => {
    assert.equal(describeError("boom"), "unknown");
    assert.equal(describeError(null), "unknown");
  });
});
