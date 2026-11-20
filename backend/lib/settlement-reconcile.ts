/**
 * Matching Paystack settlements to Wetin Dey payments.
 *
 * Pure: no database, no network, no imports. The app's sync, the admin
 * dry-run and the command-line dry-run script all call this one function,
 * so the report a person reads before any write is produced by exactly the
 * code that decides what gets written.
 *
 * The rule, stated once: a payment is marked settled ONLY when
 *   1. it is a Paystack payment we already recorded as successful,
 *   2. its reference appears in exactly one SUCCESSFUL Paystack settlement,
 *      as a successful transaction,
 *   3. the amounts agree (the same rule verification uses), and
 *   4. it has no settled date yet.
 * Anything else is reported for a person to look at, never written.
 */

export type ProviderSettlementTransaction = {
  reference: string;
  /** Kobo, as Paystack reports it. */
  amountMinor: number;
  /** Kobo, or null when Paystack did not send it. */
  feesMinor: number | null;
  currency: string;
  status: string;
};

export type ProviderSettlement = {
  id: string;
  status: string;
  /** When Paystack paid this batch out. */
  settledAt: Date;
  transactions: ProviderSettlementTransaction[];
};

export type LocalPayment = {
  id: string;
  provider: string;
  providerReference: string;
  status: string;
  /** Naira, as stored in payments.amount. */
  amount: string | number;
  settledAt: Date | null;
  settlementReference: string | null;
};

export type SettlementMark = {
  paymentId: string;
  providerReference: string;
  settledAt: Date;
  settlementReference: string;
};

export type ReconcileReport = {
  settlementsRead: number;
  /** Settlements skipped because their status was not `success`. */
  settlementsSkipped: number;
  transactionsRead: number;
  /** Safe to write. */
  toMark: SettlementMark[];
  /** Already recorded against the same settlement. Nothing to do. */
  alreadyRecorded: number;
  /** Already recorded against a DIFFERENT settlement. Needs a person. */
  conflicts: {
    reference: string;
    recordedSettlement: string;
    providerSettlement: string;
  }[];
  /** In a Paystack settlement, but no payment with that reference here. */
  notFound: { reference: string; settlementReference: string; amountMinor: number }[];
  /** A payment with that reference exists here, but not as a Paystack payment. */
  wrongProvider: { reference: string; provider: string }[];
  /** Paystack settled it, but this payment is not marked successful here. */
  notSuccessLocally: { reference: string; localStatus: string; settlementReference: string }[];
  /** Amounts or currency disagree. Not marked. */
  amountMismatch: {
    reference: string;
    localAmount: number;
    providerAmountMinor: number;
    providerFeesMinor: number | null;
    currency: string;
  }[];
  /** The same reference appears in more than one settlement. Not marked. */
  duplicateInProvider: { reference: string; settlementReferences: string[] }[];
  /** Transactions inside a successful settlement whose own status is not success. */
  nonSuccessTransactions: { reference: string; status: string }[];
  /**
   * Successful Paystack payments here that are still unsettled after this
   * run would be applied. Normal for recent sales.
   */
  stillUnsettled: { count: number; amount: number };
};

/**
 * The amount rule, identical to `matchesPaystackAmount` in lib/paystack.ts
 * (a test holds the two together). Copied rather than imported so this file
 * stays free of the database imports that paystack.ts pulls in.
 *
 * `payments.amount` is what we asked Paystack to charge before any buyer-paid
 * processing fee; Paystack's `amount` may include that fee, in which case it
 * equals ours plus `fees`.
 */
export function settlementAmountMatches(
  transaction: Pick<ProviderSettlementTransaction, "amountMinor" | "feesMinor" | "currency">,
  expectedAmountNaira: number
): boolean {
  const amountMinor = transaction.amountMinor;
  const expectedMinor = Math.round(expectedAmountNaira * 100);
  const fee = transaction.feesMinor;
  const includesBuyerFee =
    fee !== null &&
    Number.isSafeInteger(fee) &&
    fee >= 0 &&
    amountMinor === expectedMinor + fee;
  return (
    transaction.currency === "NGN" &&
    Number.isSafeInteger(amountMinor) &&
    (amountMinor === expectedMinor || includesBuyerFee)
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function reconcileSettlements(
  settlements: ProviderSettlement[],
  payments: LocalPayment[]
): ReconcileReport {
  const report: ReconcileReport = {
    settlementsRead: settlements.length,
    settlementsSkipped: 0,
    transactionsRead: 0,
    toMark: [],
    alreadyRecorded: 0,
    conflicts: [],
    notFound: [],
    wrongProvider: [],
    notSuccessLocally: [],
    amountMismatch: [],
    duplicateInProvider: [],
    nonSuccessTransactions: [],
    stillUnsettled: { count: 0, amount: 0 },
  };

  // Every successful transaction, grouped by reference, so a reference that
  // shows up in two settlements is caught before anything is marked.
  const seen = new Map<
    string,
    { settlement: ProviderSettlement; transaction: ProviderSettlementTransaction }[]
  >();

  for (const settlement of settlements) {
    if (settlement.status !== "success") {
      report.settlementsSkipped += 1;
      continue;
    }
    for (const transaction of settlement.transactions) {
      report.transactionsRead += 1;
      if (transaction.status !== "success") {
        report.nonSuccessTransactions.push({
          reference: transaction.reference,
          status: transaction.status,
        });
        continue;
      }
      const list = seen.get(transaction.reference) ?? [];
      // The same transaction listed twice in ONE settlement (a paging
      // overlap) is one sighting, not a duplicate.
      if (!list.some((entry) => entry.settlement.id === settlement.id)) {
        list.push({ settlement, transaction });
      }
      seen.set(transaction.reference, list);
    }
  }

  const byReference = new Map(payments.map((p) => [p.providerReference, p]));
  const markedIds = new Set<string>();

  for (const [reference, sightings] of seen) {
    if (sightings.length > 1) {
      report.duplicateInProvider.push({
        reference,
        settlementReferences: sightings.map((s) => s.settlement.id),
      });
      continue;
    }
    const { settlement, transaction } = sightings[0];
    const payment = byReference.get(reference);

    if (!payment) {
      report.notFound.push({
        reference,
        settlementReference: settlement.id,
        amountMinor: transaction.amountMinor,
      });
      continue;
    }
    if (payment.provider !== "paystack") {
      report.wrongProvider.push({ reference, provider: payment.provider });
      continue;
    }
    if (payment.settledAt || payment.settlementReference) {
      if (payment.settlementReference === settlement.id) {
        report.alreadyRecorded += 1;
      } else {
        report.conflicts.push({
          reference,
          recordedSettlement: payment.settlementReference ?? "(date only)",
          providerSettlement: settlement.id,
        });
      }
      continue;
    }
    if (payment.status !== "success") {
      report.notSuccessLocally.push({
        reference,
        localStatus: payment.status,
        settlementReference: settlement.id,
      });
      continue;
    }
    const localAmount = Number(payment.amount);
    if (!Number.isFinite(localAmount) || !settlementAmountMatches(transaction, localAmount)) {
      report.amountMismatch.push({
        reference,
        localAmount,
        providerAmountMinor: transaction.amountMinor,
        providerFeesMinor: transaction.feesMinor,
        currency: transaction.currency,
      });
      continue;
    }

    report.toMark.push({
      paymentId: payment.id,
      providerReference: reference,
      settledAt: settlement.settledAt,
      settlementReference: settlement.id,
    });
    markedIds.add(payment.id);
  }

  let unsettledCount = 0;
  let unsettledAmount = 0;
  for (const payment of payments) {
    if (
      payment.provider === "paystack" &&
      payment.status === "success" &&
      !payment.settledAt &&
      !markedIds.has(payment.id)
    ) {
      unsettledCount += 1;
      const amount = Number(payment.amount);
      if (Number.isFinite(amount)) unsettledAmount += amount;
    }
  }
  report.stillUnsettled = { count: unsettledCount, amount: round2(unsettledAmount) };

  return report;
}

/** True when the report holds anything a person should look at. */
export function reportNeedsAttention(report: ReconcileReport): boolean {
  return (
    report.conflicts.length > 0 ||
    report.wrongProvider.length > 0 ||
    report.notSuccessLocally.length > 0 ||
    report.amountMismatch.length > 0 ||
    report.duplicateInProvider.length > 0
  );
}
