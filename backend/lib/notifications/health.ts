/**
 * The daily health check: warn the super admins when notifications are
 * failing or piling up, at most once a day.
 *
 *   failed in the last 24 hours   >= 3   (deliveries + events), or
 *   something due has waited      > 60 minutes (the worker isn't running)
 *
 * Recorded as a `platform.health` outbox event keyed by the Lagos date, so it
 * can't be sent twice in one day however often the check runs.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { startOfLagosDay } from "./config";
import { recordEvent } from "./outbox";

export const HEALTH_FAILED_THRESHOLD = 3;
export const HEALTH_WAITING_MINUTES = 60;

export type Health = {
  failedLast24h: number;
  oldestWaitingMinutes: number;
  pending: number;
  unhealthy: boolean;
};

export async function notificationHealth(): Promise<Health> {
  const [row] = (await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM notification_deliveries
        WHERE status = 'failed' AND created_at > now() - interval '24 hours')
      + (SELECT count(*)::int FROM notification_events
        WHERE status = 'failed' AND created_at > now() - interval '24 hours') AS failed,
      (SELECT count(*)::int FROM notification_deliveries WHERE status IN ('pending', 'processing')) AS pending,
      COALESCE((
        SELECT floor(extract(epoch FROM now() - min(due)) / 60)::int FROM (
          SELECT next_attempt_at AS due FROM notification_deliveries
            WHERE status = 'pending' AND next_attempt_at <= now()
          UNION ALL
          SELECT greatest(available_at, next_attempt_at) FROM notification_events
            WHERE status = 'pending' AND available_at <= now() AND next_attempt_at <= now()
        ) waiting
      ), 0) AS oldest`)) as unknown as Array<{ failed: number; pending: number; oldest: number }>;
  const failedLast24h = row?.failed ?? 0;
  const oldestWaitingMinutes = Math.max(0, row?.oldest ?? 0);
  return {
    failedLast24h,
    oldestWaitingMinutes,
    pending: row?.pending ?? 0,
    unhealthy:
      failedLast24h >= HEALTH_FAILED_THRESHOLD || oldestWaitingMinutes > HEALTH_WAITING_MINUTES,
  };
}

export async function checkNotificationHealth(now: Date = new Date()): Promise<Health & { alerted: boolean }> {
  const health = await notificationHealth();
  if (!health.unhealthy) return { ...health, alerted: false };
  const day = new Date(startOfLagosDay(now).getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
  const result = await recordEvent(db, {
    type: "platform.health",
    key: [day],
    payload: { failedLast24h: health.failedLast24h, oldestWaitingMinutes: health.oldestWaitingMinutes },
  });
  return { ...health, alerted: result.recorded };
}
