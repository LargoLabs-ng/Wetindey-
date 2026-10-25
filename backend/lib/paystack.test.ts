import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

import {
  matchesPaystackAmount,
  paystackFeeFromStoredResponse,
} from "./paystack";

describe("matchesPaystackAmount", () => {
  it("matches the amount initialized with Paystack, before customer fees", () => {
    expect(
      matchesPaystackAmount(
        { amount: 300000, currency: "NGN", fees: 4500 },
        3000
      )
    ).toBe(true);
  });

  it("matches a transaction amount including its separately reported buyer fee", () => {
    expect(
      matchesPaystackAmount(
        { amount: 304500, currency: "NGN", fees: 4500 },
        3000
      )
    ).toBe(true);
  });

  it("rejects different amounts and currencies", () => {
    expect(
      matchesPaystackAmount(
        { amount: 314721, currency: "NGN", fees: 4500 },
        3000
      )
    ).toBe(false);
    expect(
      matchesPaystackAmount(
        { amount: 300000, currency: "USD", fees: 4500 },
        3000
      )
    ).toBe(false);
  });
});

describe("paystackFeeFromStoredResponse", () => {
  it("reads the verified fee in kobo and returns naira", () => {
    expect(
      paystackFeeFromStoredResponse({
        initialization: {},
        verification: {
          status: true,
          data: { fees: 12550 },
        },
      })
    ).toBe(125.5);
  });

  it("returns null when there is no verified fee", () => {
    expect(paystackFeeFromStoredResponse({ initialization: {} })).toBeNull();
    expect(
      paystackFeeFromStoredResponse({
        verification: { data: { fees: null } },
      })
    ).toBeNull();
  });
});
