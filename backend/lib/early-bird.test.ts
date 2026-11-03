import { describe, expect, it } from "vitest";
import {
  activeTicketPrice,
  checkoutPriceChanged,
  datetimeLocalFromUtc,
  datetimeLocalToUtc,
  isValidEarlyBirdConfiguration,
  ticketPriceConfigurationAt,
  toMinorUnits,
} from "./early-bird";

describe("activeTicketPrice", () => {
  const tier = {
    price: "5000.00",
    earlyBirdEnabled: true,
    earlyBirdPrice: "3500.00",
    earlyBirdEndsAt: new Date("2026-03-01T12:00:00.000Z"),
  };

  it("uses the early price before its deadline", () => {
    expect(activeTicketPrice(tier, new Date("2026-03-01T11:59:59.999Z"))).toEqual({
      price: 3500,
      priceMinor: 350000,
      earlyBirdActive: true,
    });
  });

  it("uses the regular price at and after the exclusive deadline", () => {
    expect(activeTicketPrice(tier, new Date("2026-03-01T12:00:00.000Z")).price).toBe(5000);
    expect(activeTicketPrice(tier, new Date("2026-03-01T12:00:01.000Z")).price).toBe(5000);
  });

  it("flags checkout at the Early Bird price when payment settles after the deadline", () => {
    const paidAfterDeadline = activeTicketPrice(
      tier,
      new Date("2026-03-01T12:00:00.001Z")
    );
    expect(checkoutPriceChanged("3500.00", paidAfterDeadline)).toBe(true);
  });

  it("uses the regular price when disabled or incompletely configured", () => {
    expect(activeTicketPrice({ ...tier, earlyBirdEnabled: false }, new Date()).price).toBe(5000);
    expect(activeTicketPrice({ ...tier, earlyBirdPrice: null }, new Date()).price).toBe(5000);
  });

  it("uses the preserved Regular price when the organiser edits the tier", () => {
    const updated = { ...tier, price: "6000.00", earlyBirdPrice: "4000.00" };
    expect(activeTicketPrice(updated, new Date("2026-03-01T11:00:00Z")).price).toBe(4000);
    expect(activeTicketPrice(updated, new Date("2026-03-01T12:00:00Z")).price).toBe(6000);
  });
});

describe("Early Bird deadline time zones", () => {
  it("converts local event time and round-trips it", () => {
    const utc = datetimeLocalToUtc("2026-03-01T15:30", "Africa/Lagos");
    expect(utc?.toISOString()).toBe("2026-03-01T14:30:00.000Z");
    expect(datetimeLocalFromUtc(utc!, "Africa/Lagos")).toBe("2026-03-01T15:30");
  });

  it("rejects malformed, impossible and unknown-zone values", () => {
    expect(datetimeLocalToUtc("2026-02-31T12:00", "Africa/Lagos")).toBeNull();
    expect(datetimeLocalToUtc("2026-03-01", "Africa/Lagos")).toBeNull();
    expect(datetimeLocalToUtc("2026-03-01T12:00", "not-a-zone")).toBeNull();
  });
});

it("represents naira prices as integer kobo", () => {
  expect(toMinorUnits("12.34")).toBe(1234);
});

it("validates the lower Early Bird price and deadline", () => {
  expect(isValidEarlyBirdConfiguration(5000, 4000, new Date("2026-03-01T12:00Z"))).toBe(true);
  expect(isValidEarlyBirdConfiguration(5000, 5000, new Date("2026-03-01T12:00Z"))).toBe(false);
  expect(isValidEarlyBirdConfiguration(5000, -1, new Date("2026-03-01T12:00Z"))).toBe(false);
  expect(isValidEarlyBirdConfiguration(5000, 4000, null)).toBe(false);
});

it("detects changed checkout prices while retaining compatibility with historical orders", () => {
  const active = activeTicketPrice({
    price: "5000",
    earlyBirdEnabled: true,
    earlyBirdPrice: "4000",
    earlyBirdEndsAt: "2026-03-01T12:00:00Z",
  }, new Date("2026-03-01T11:00:00Z"));
  expect(checkoutPriceChanged("4000.00", active)).toBe(false);
  expect(checkoutPriceChanged("3500.00", active)).toBe(true);
  expect(checkoutPriceChanged(null, active)).toBe(false);
  expect(checkoutPriceChanged(null, active, 800000, 2)).toBe(false);
  expect(checkoutPriceChanged(null, active, 700000, 2)).toBe(true);
  expect(checkoutPriceChanged("4000.00", null)).toBe(true);
});

it("selects the exact ticket pricing configuration active at payment time", () => {
  const versions = [
    {
      price: "5000.00",
      earlyBirdEnabled: true,
      earlyBirdPrice: "4000.00",
      earlyBirdEndsAt: "2026-03-01T12:00:00.000Z",
      validFrom: "2026-02-01T10:00:00.000Z",
      validUntil: "2026-03-01T13:00:00.000Z",
    },
    {
      price: "6000.00",
      earlyBirdEnabled: false,
      earlyBirdPrice: null,
      earlyBirdEndsAt: null,
      validFrom: "2026-03-01T13:00:00.000Z",
      validUntil: null,
    },
  ];

  expect(
    ticketPriceConfigurationAt(versions, new Date("2026-03-01T12:30:00Z"))
  ).toEqual({
    price: "5000.00",
    earlyBirdEnabled: true,
    earlyBirdPrice: "4000.00",
    earlyBirdEndsAt: "2026-03-01T12:00:00.000Z",
  });
  expect(
    ticketPriceConfigurationAt(versions, new Date("2026-03-01T13:00:00Z"))
  ).toEqual({
    price: "6000.00",
    earlyBirdEnabled: false,
    earlyBirdPrice: null,
    earlyBirdEndsAt: null,
  });
  expect(
    ticketPriceConfigurationAt(versions, new Date("2026-01-31T23:59:59Z"))
  ).toBeNull();
});
