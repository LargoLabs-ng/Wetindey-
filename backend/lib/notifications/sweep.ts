/**
 * The reconciliation sweep — the safety net behind the outbox.
 *
 * Every trigger records its outbox event in the same transaction as its own
 * change, so normally there is nothing to find. This daily check exists in
 * case a future code path forgets to: it looks for confirmed business
 * records with no matching outbox event and creates the missing ones.
 *
 *   paid orders              → order.paid (or order.confirmed for free RSVPs)
 *   payout requests          → payout.requested
 *   payout status changes    → payout.status_changed
 *
 * Only records created since notifications went live on this database
 * (`notification_settings.sweep_since`, set by migration 0025) are
 * considered, so nobody is notified about an order from before the system
 * existed. Events are inserted with ON CONFLICT DO NOTHING: running the sweep
 * twice — or racing a late commit of the real trigger — creates nothing extra.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

export type SweepSummary = {
  since: string | null;
  ordersRecovered: number;
  payoutRequestsRecovered: number;
  payoutUpdatesRecovered: number;
};

const SWEEP_LIMIT = 500;

export async function sweepSince(): Promise<string | null> {
  const rows = (await db.execute(
    sql`SELECT value FROM notification_settings WHERE key = 'sweep_since'`
  )) as unknown as Array<{ value: string }>;
  return rows[0]?.value ?? null;
}

export async function runReconciliationSweep(): Promise<SweepSummary> {
  const since = await sweepSince();
  // No go-live time means the migration's settings row is missing; doing
  // nothing is safer than guessing and notifying about old orders.
  if (!since) {
    return { since: null, ordersRecovered: 0, payoutRequestsRecovered: 0, payoutUpdatesRecovered: 0 };
  }

  const recovered = (await db.execute(sql`
    INSERT INTO notification_events (type, dedupe_key, payload)
    SELECT
      CASE WHEN o.total::numeric = 0 THEN 'order.confirmed' ELSE 'order.paid' END,
      CASE WHEN o.total::numeric = 0 THEN 'order.confirmed:' ELSE 'order.paid:' END || o.id::text,
      jsonb_build_object('orderId', o.id, 'eventId', o.event_id, 'recoveredBySweep', true)
    FROM orders o
    WHERE o.status = 'paid'
      AND o.created_at >= ${since}::timestamptz
      AND NOT EXISTS (
        SELECT 1 FROM notification_events e
        WHERE e.dedupe_key IN ('order.paid:' || o.id::text, 'order.confirmed:' || o.id::text)
      )
    ORDER BY o.created_at
    LIMIT ${SWEEP_LIMIT}
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id`)) as unknown as unknown[];

  const requests = (await db.execute(sql`
    INSERT INTO notification_events (type, dedupe_key, payload)
    SELECT 'payout.requested', 'payout.requested:' || p.id::text,
           jsonb_build_object('payoutId', p.id, 'organizationId', p.organization_id, 'recoveredBySweep', true)
    FROM payouts p
    WHERE p.requested_at >= ${since}::timestamptz
      AND NOT EXISTS (
        SELECT 1 FROM notification_events e WHERE e.dedupe_key = 'payout.requested:' || p.id::text
      )
    ORDER BY p.requested_at
    LIMIT ${SWEEP_LIMIT}
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id`)) as unknown as unknown[];

  // Every status change after the request itself (from_status is set).
  const updates = (await db.execute(sql`
    INSERT INTO notification_events (type, dedupe_key, payload)
    SELECT 'payout.status_changed', 'payout.status_changed:' || h.id::text,
           jsonb_build_object('payoutId', h.payout_id, 'from', h.from_status, 'to', h.to_status,
                              'recoveredBySweep', true)
    FROM payout_events h
    WHERE h.from_status IS NOT NULL
      AND h.created_at >= ${since}::timestamptz
      AND NOT EXISTS (
        SELECT 1 FROM notification_events e WHERE e.dedupe_key = 'payout.status_changed:' || h.id::text
      )
    ORDER BY h.created_at
    LIMIT ${SWEEP_LIMIT}
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id`)) as unknown as unknown[];

  const total = recovered.length + requests.length + updates.length;
  if (total > 0) {
    console.warn(
      `Reconciliation sweep recovered ${total} missing notification event(s) ` +
        `(orders ${recovered.length}, payout requests ${requests.length}, payout updates ${updates.length}). ` +
        "Every trigger should record its own event; check recent code changes."
    );
  }
  return {
    since,
    ordersRecovered: recovered.length,
    payoutRequestsRecovered: requests.length,
    payoutUpdatesRecovered: updates.length,
  };
}
