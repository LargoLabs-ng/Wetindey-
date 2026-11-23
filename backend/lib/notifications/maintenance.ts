/**
 * The daily clean-up. Keeps the notification tables small.
 *
 *   read notifications        older than 180 days → deleted
 *   delivery logs             older than 90 days  → deleted (finished ones only)
 *   finished outbox events    older than 30 days  → deleted
 *
 * Unread notifications are kept. Nothing that is still pending or being
 * worked on is ever touched.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { RETENTION } from "./config";

export type CleanupSummary = {
  readNotifications: number;
  attempts: number;
  deliveries: number;
  events: number;
};

const count = (rows: unknown) => (rows as unknown[]).length;

export async function cleanUpOldNotifications(): Promise<CleanupSummary> {
  const readNotifications = count(
    await db.execute(sql`
      DELETE FROM notifications
      WHERE read_at IS NOT NULL
        AND read_at < now() - make_interval(days => ${RETENTION.readNotificationsDays})
      RETURNING id`)
  );
  const attempts = count(
    await db.execute(sql`
      DELETE FROM notification_delivery_attempts
      WHERE started_at < now() - make_interval(days => ${RETENTION.deliveryLogsDays})
      RETURNING id`)
  );
  const deliveries = count(
    await db.execute(sql`
      DELETE FROM notification_deliveries
      WHERE status IN ('sent', 'failed', 'skipped')
        AND created_at < now() - make_interval(days => ${RETENTION.deliveryLogsDays})
      RETURNING id`)
  );
  const events = count(
    await db.execute(sql`
      DELETE FROM notification_events
      WHERE status IN ('done', 'failed')
        AND created_at < now() - make_interval(days => ${RETENTION.finishedEventsDays})
      RETURNING id`)
  );
  return { readNotifications, attempts, deliveries, events };
}
