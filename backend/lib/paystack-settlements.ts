/**
 * The settlement sync, inside the app.
 *
 * Reads Paystack's successful settlements, matches them to our payments with
 * `reconcileSettlements`, and — only in write mode, and only when switched on —
 * stamps `payments.settled_at` / `settlement_reference`.
 *
 * Safe to run any number of times: a payment is only written while its
 * settled date is still empty, so a second run finds nothing new to do.
 *
 * Writing is OFF until SETTLEMENT_SYNC_ENABLED=true. The order of events is:
 * migration 0022, a dry run someone has read, then the switch. A missing
 * switch is a refusal, not a silent no-op, so nobody thinks it ran.
 */
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { payments } from "@/db/schema";
import { fetchSuccessfulSettlements } from "@/lib/paystack-settlements-api";
import {
  reconcileSettlements,
  type LocalPayment,
  type ReconcileReport,
} from "@/lib/settlement-reconcile";

export type SettlementSyncResult = {
  mode: "dry-run" | "write";
  from: string | null;
  unusableSettlements: number;
  /** False when migration 0022 has not been applied yet (dry run only). */
  settlementColumnsPresent: boolean;
  report: ReconcileReport;
  /** Rows actually updated. Always 0 in a dry run. */
  written: number;
};

export function settlementWritesEnabled(): boolean {
  return process.env.SETTLEMENT_SYNC_ENABLED === "true";
}

function isMissingColumn(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "42703"
  );
}

/**
 * Every Paystack payment, plus any payment whose reference Paystack listed.
 * The second set is how a reference that belongs to a non-Paystack row gets
 * reported instead of silently ignored.
 */
async function loadLocalPayments(
  references: string[]
): Promise<{ rows: LocalPayment[]; settlementColumnsPresent: boolean }> {
  const refFilter =
    references.length > 0
      ? or(eq(payments.provider, "paystack"), inArray(payments.providerReference, references))
      : eq(payments.provider, "paystack");

  try {
    const rows = await db
      .select({
        id: payments.id,
        provider: payments.provider,
        providerReference: payments.providerReference,
        status: payments.status,
        amount: payments.amount,
        settledAt: payments.settledAt,
        settlementReference: payments.settlementReference,
      })
      .from(payments)
      .where(refFilter);
    return { rows, settlementColumnsPresent: true };
  } catch (error) {
    if (!isMissingColumn(error)) throw error;
    // Before migration 0022 the columns do not exist. A dry run is still
    // useful then — it is exactly how the matching gets checked before the
    // migration — so read without them and treat everything as unsettled.
    const rows = await db
      .select({
        id: payments.id,
        provider: payments.provider,
        providerReference: payments.providerReference,
        status: payments.status,
        amount: payments.amount,
      })
      .from(payments)
      .where(refFilter);
    return {
      rows: rows.map((r) => ({ ...r, settledAt: null, settlementReference: null })),
      settlementColumnsPresent: false,
    };
  }
}

async function settlementColumnsExist(): Promise<boolean> {
  try {
    await db.select({ settledAt: payments.settledAt }).from(payments).limit(1);
    return true;
  } catch (error) {
    if (isMissingColumn(error)) return false;
    throw error;
  }
}

/**
 * Where to start reading. The first run reads all history; later runs go
 * back a week before the newest settlement already recorded, which covers
 * any batch Paystack finalised late. Re-reading is harmless.
 */
async function defaultFrom(columnsPresent: boolean): Promise<string | null> {
  if (!columnsPresent) return null;
  const [row] = await db
    .select({ latest: sql<Date | null>`max(${payments.settledAt})` })
    .from(payments)
    .where(eq(payments.provider, "paystack"));
  if (!row?.latest) return null;
  const from = new Date(row.latest);
  from.setUTCDate(from.getUTCDate() - 7);
  return from.toISOString();
}

export async function runPaystackSettlementSync(options: {
  mode: "dry-run" | "write";
  from?: string | null;
}): Promise<SettlementSyncResult> {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) throw new Error("PAYSTACK_SECRET_KEY is not set.");
  if (options.mode === "write" && !settlementWritesEnabled()) {
    throw new Error(
      "Settlement writes are switched off. Review a dry run, then set SETTLEMENT_SYNC_ENABLED=true."
    );
  }

  const columnsPresent = await settlementColumnsExist();
  if (options.mode === "write" && !columnsPresent) {
    throw new Error("Apply migration 0022_payment_settlement.sql before writing settlements.");
  }
  const from = options.from !== undefined ? options.from : await defaultFrom(columnsPresent);

  const { settlements, unusable } = await fetchSuccessfulSettlements({
    secretKey,
    from: from ?? undefined,
  });
  const references = [
    ...new Set(settlements.flatMap((s) => s.transactions.map((t) => t.reference))),
  ];
  const local = await loadLocalPayments(references);
  const report = reconcileSettlements(settlements, local.rows);

  let written = 0;
  if (options.mode === "write" && report.toMark.length > 0) {
    written = await db.transaction(async (tx) => {
      let count = 0;
      for (const mark of report.toMark) {
        const updated = await tx
          .update(payments)
          .set({
            settledAt: mark.settledAt,
            settlementReference: mark.settlementReference,
          })
          .where(
            and(
              eq(payments.id, mark.paymentId),
              eq(payments.provider, "paystack"),
              eq(payments.status, "success"),
              // The guard that makes a second run, or two runs at once,
              // harmless: only an empty settled date is ever filled.
              isNull(payments.settledAt)
            )
          )
          .returning({ id: payments.id });
        count += updated.length;
      }
      return count;
    });
  }

  return {
    mode: options.mode,
    from,
    unusableSettlements: unusable,
    settlementColumnsPresent: local.settlementColumnsPresent,
    report,
    written,
  };
}

/** A short, safe summary for logs and API responses (no full lists). */
export function summariseSync(result: SettlementSyncResult) {
  const r = result.report;
  return {
    mode: result.mode,
    from: result.from,
    written: result.written,
    settlementColumnsPresent: result.settlementColumnsPresent,
    settlementsRead: r.settlementsRead,
    settlementsSkipped: r.settlementsSkipped,
    unusableSettlements: result.unusableSettlements,
    transactionsRead: r.transactionsRead,
    toMark: r.toMark.length,
    alreadyRecorded: r.alreadyRecorded,
    notFound: r.notFound.length,
    conflicts: r.conflicts.length,
    wrongProvider: r.wrongProvider.length,
    notSuccessLocally: r.notSuccessLocally.length,
    amountMismatch: r.amountMismatch.length,
    duplicateInProvider: r.duplicateInProvider.length,
    nonSuccessTransactions: r.nonSuccessTransactions.length,
    stillUnsettled: r.stillUnsettled,
  };
}
