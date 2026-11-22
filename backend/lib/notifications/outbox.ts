/**
 * The outbox: record that something happened, in the same transaction as
 * the change itself.
 *
 *   await db.transaction(async (tx) => {
 *     ...mark the order paid...
 *     await recordEvent(tx, { type: "order.paid", key: [orderId], payload: { orderId } });
 *   });
 *
 * Either both are saved or neither is. The worker turns the row into inbox
 * entries and emails later; nothing is ever sent from here.
 *
 * Idempotent: the dedupe key is unique, so recording the same happening
 * twice (a webhook retry, the buyer's return page, a double click) is a
 * no-op that returns `recorded: false`.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { notificationEvents } from "@/db/schema";
import { eventKey } from "./dedupe";

/** Either the shared client or the `tx` handed to a db.transaction callback. */
export type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type RecordInput = {
  /** e.g. "order.paid", "payout.requested". */
  type: string;
  /** Parts after the type that make the happening unique, e.g. [orderId]. */
  key: Array<string | number>;
  /** Ids only. Content is read fresh when the notification is built. */
  payload?: Record<string, unknown>;
  /** For scheduled events (reminders): not processed before this time. */
  availableAt?: Date;
};

export type RecordResult = { recorded: boolean; dedupeKey: string; skipped?: "table_missing" };

/** Postgres "undefined_table": migration 0025 hasn't been applied here. */
function isMissingTable(error: unknown): boolean {
  const code =
    (error as { code?: string })?.code ??
    (error as { cause?: { code?: string } })?.cause?.code;
  return code === "42P01";
}

export async function recordEvent(executor: Executor, input: RecordInput): Promise<RecordResult> {
  const dedupeKey = eventKey(input.type, ...input.key);
  try {
    // A savepoint, so that one specific failure — the table not existing
    // yet because the migration hasn't run — can't abort the business
    // transaction around it. Any other error still propagates and rolls the
    // whole thing back. A missing row is later recreated by the
    // reconciliation sweep.
    const inserted = await executor.transaction(async (sp) =>
      sp
        .insert(notificationEvents)
        .values({
          type: input.type,
          dedupeKey,
          payload: input.payload ?? {},
          ...(input.availableAt ? { availableAt: input.availableAt } : {}),
        })
        .onConflictDoNothing({ target: notificationEvents.dedupeKey })
        .returning({ id: notificationEvents.id })
    );
    return { recorded: inserted.length > 0, dedupeKey };
  } catch (error) {
    if (isMissingTable(error)) {
      console.error("notification_events is missing; run migration 0025. Skipped:", dedupeKey);
      return { recorded: false, dedupeKey, skipped: "table_missing" };
    }
    throw error;
  }
}

/** Has this happening been recorded? Used by the reconciliation sweep. */
export async function hasEvent(executor: Executor, dedupeKey: string): Promise<boolean> {
  const rows = await executor.execute(
    sql`SELECT 1 FROM notification_events WHERE dedupe_key = ${dedupeKey} LIMIT 1`
  );
  return (rows as unknown as unknown[]).length > 0;
}
