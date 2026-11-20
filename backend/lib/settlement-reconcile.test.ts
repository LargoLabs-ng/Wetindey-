import { describe, expect, it, vi } from "vitest";
import {
  reconcileSettlements,
  reportNeedsAttention,
  settlementAmountMatches,
  type LocalPayment,
  type ProviderSettlement,
  type ProviderSettlementTransaction,
} from "./settlement-reconcile";

// paystack.ts imports the database at load; the parity test below only needs
// its pure amount rule, so the database module is stubbed.
vi.mock("@/db", () => ({ db: {} }));

const DAY1 = new Date("2026-11-10T00:00:00.000Z");
const DAY2 = new Date("2026-11-11T00:00:00.000Z");

function txn(reference: string, naira: number, extra: Partial<ProviderSettlementTransaction> = {}) {
  return {
    reference,
    amountMinor: Math.round(naira * 100),
    feesMinor: null,
    currency: "NGN",
    status: "success",
    ...extra,
  } satisfies ProviderSettlementTransaction;
}

function settlement(id: string, transactions: ProviderSettlementTransaction[], extra: Partial<ProviderSettlement> = {}) {
  return { id, status: "success", settledAt: DAY1, transactions, ...extra } satisfies ProviderSettlement;
}

function payment(reference: string, naira: number, extra: Partial<LocalPayment> = {}): LocalPayment {
  return {
    id: `id-${reference}`,
    provider: "paystack",
    providerReference: reference,
    status: "success",
    amount: naira.toFixed(2),
    settledAt: null,
    settlementReference: null,
    ...extra,
  };
}

describe("reconcileSettlements", () => {
  it("marks a successful Paystack payment found in a successful settlement", () => {
    const report = reconcileSettlements(
      [settlement("S1", [txn("WD-1", 5000)])],
      [payment("WD-1", 5000)]
    );
    expect(report.toMark).toEqual([
      { paymentId: "id-WD-1", providerReference: "WD-1", settledAt: DAY1, settlementReference: "S1" },
    ]);
    expect(reportNeedsAttention(report)).toBe(false);
  });

  it("accepts a Paystack amount that includes the buyer-paid fee", () => {
    const report = reconcileSettlements(
      [settlement("S1", [txn("WD-1", 5182.24, { feesMinor: 18224 })])],
      [payment("WD-1", 5000)]
    );
    expect(report.toMark).toHaveLength(1);
  });

  it("never marks on an amount or currency mismatch", () => {
    const report = reconcileSettlements(
      [
        settlement("S1", [
          txn("WD-1", 4999),
          txn("WD-2", 5000, { currency: "USD" }),
        ]),
      ],
      [payment("WD-1", 5000), payment("WD-2", 5000)]
    );
    expect(report.toMark).toHaveLength(0);
    expect(report.amountMismatch.map((r) => r.reference)).toEqual(["WD-1", "WD-2"]);
    expect(reportNeedsAttention(report)).toBe(true);
  });

  it("ignores settlements that are not successful", () => {
    const report = reconcileSettlements(
      [settlement("S1", [txn("WD-1", 5000)], { status: "pending" })],
      [payment("WD-1", 5000)]
    );
    expect(report.toMark).toHaveLength(0);
    expect(report.settlementsSkipped).toBe(1);
    expect(report.stillUnsettled).toEqual({ count: 1, amount: 5000 });
  });

  it("ignores non-success transactions inside a successful settlement", () => {
    const report = reconcileSettlements(
      [settlement("S1", [txn("WD-1", 5000, { status: "reversed" })])],
      [payment("WD-1", 5000)]
    );
    expect(report.toMark).toHaveLength(0);
    expect(report.nonSuccessTransactions).toEqual([{ reference: "WD-1", status: "reversed" }]);
  });

  it("does not mark a payment that is not successful here, and flags it", () => {
    const report = reconcileSettlements(
      [settlement("S1", [txn("WD-1", 5000)])],
      [payment("WD-1", 5000, { status: "initialized" })]
    );
    expect(report.toMark).toHaveLength(0);
    expect(report.notSuccessLocally).toEqual([
      { reference: "WD-1", localStatus: "initialized", settlementReference: "S1" },
    ]);
  });

  it("never marks a non-Paystack payment, including legacy Monnify", () => {
    const report = reconcileSettlements(
      [settlement("S1", [txn("MN-1", 5000)])],
      [payment("MN-1", 5000, { provider: "monnify" })]
    );
    expect(report.toMark).toHaveLength(0);
    expect(report.wrongProvider).toEqual([{ reference: "MN-1", provider: "monnify" }]);
    // Monnify rows are not counted as unsettled Paystack money either.
    expect(report.stillUnsettled.count).toBe(0);
  });

  it("lists references Paystack settled that we have no record of", () => {
    const report = reconcileSettlements([settlement("S1", [txn("OTHER-1", 100)])], []);
    expect(report.notFound).toEqual([
      { reference: "OTHER-1", settlementReference: "S1", amountMinor: 10000 },
    ]);
  });

  it("refuses a reference that appears in two different settlements", () => {
    const report = reconcileSettlements(
      [
        settlement("S1", [txn("WD-1", 5000)]),
        settlement("S2", [txn("WD-1", 5000)], { settledAt: DAY2 }),
      ],
      [payment("WD-1", 5000)]
    );
    expect(report.toMark).toHaveLength(0);
    expect(report.duplicateInProvider).toEqual([
      { reference: "WD-1", settlementReferences: ["S1", "S2"] },
    ]);
  });

  it("treats the same transaction listed twice in one settlement as one", () => {
    const report = reconcileSettlements(
      [settlement("S1", [txn("WD-1", 5000), txn("WD-1", 5000)])],
      [payment("WD-1", 5000)]
    );
    expect(report.toMark).toHaveLength(1);
    expect(report.duplicateInProvider).toHaveLength(0);
  });

  it("is idempotent: applying the marks and running again finds nothing to do", () => {
    const settlements = [settlement("S1", [txn("WD-1", 5000), txn("WD-2", 2500)])];
    const local = [payment("WD-1", 5000), payment("WD-2", 2500), payment("WD-3", 1000)];
    const first = reconcileSettlements(settlements, local);
    expect(first.toMark).toHaveLength(2);
    expect(first.stillUnsettled).toEqual({ count: 1, amount: 1000 });

    const applied = local.map((p) => {
      const mark = first.toMark.find((m) => m.paymentId === p.id);
      return mark
        ? { ...p, settledAt: mark.settledAt, settlementReference: mark.settlementReference }
        : p;
    });
    const second = reconcileSettlements(settlements, applied);
    expect(second.toMark).toHaveLength(0);
    expect(second.alreadyRecorded).toBe(2);
    expect(second.conflicts).toHaveLength(0);
    expect(second.stillUnsettled).toEqual({ count: 1, amount: 1000 });
  });

  it("flags a payment already recorded under a different settlement", () => {
    const report = reconcileSettlements(
      [settlement("S2", [txn("WD-1", 5000)])],
      [payment("WD-1", 5000, { settledAt: DAY1, settlementReference: "S1" })]
    );
    expect(report.toMark).toHaveLength(0);
    expect(report.conflicts).toEqual([
      { reference: "WD-1", recordedSettlement: "S1", providerSettlement: "S2" },
    ]);
  });
});

describe("settlementAmountMatches", () => {
  it("agrees with matchesPaystackAmount, the rule payment verification uses", async () => {
    const { matchesPaystackAmount } = await import("./paystack");
    const cases: [number, number | null, string, number][] = [
      [500000, null, "NGN", 5000],
      [518224, 18224, "NGN", 5000],
      [518224, 18000, "NGN", 5000],
      [499999, null, "NGN", 5000],
      [500000, null, "USD", 5000],
      [0, null, "NGN", 0],
      [123456, 0, "NGN", 1234.56],
    ];
    for (const [amountMinor, feesMinor, currency, expected] of cases) {
      const ours = settlementAmountMatches({ amountMinor, feesMinor, currency }, expected);
      const theirs = matchesPaystackAmount(
        { amount: amountMinor, fees: feesMinor, currency },
        expected
      );
      expect(ours, `${amountMinor}/${feesMinor}/${currency}/${expected}`).toBe(theirs);
    }
  });
});
