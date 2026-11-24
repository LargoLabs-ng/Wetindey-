/**
 * What the admin delivery-health page shows, and its retry button.
 *
 * Super Admin only (the page and its API check isPlatformAdmin). Email
 * addresses are masked on the page: enough to recognise, not to harvest.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { notificationDeliveries, notificationEvents } from "@/db/schema";
import { nonEssentialEmailDailyBudget, notificationEmailEnabled, notificationsEnabled } from "./config";
import { digestsEnabled } from "./digests";
import { notificationHealth } from "./health";
import { emailsSentToday } from "./worker";

export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [name, domain] = email.split("@");
  if (!domain) return "***";
  return `${name.slice(0, 2)}***@${domain}`;
}

export async function deliveryHealth() {
  const health = await notificationHealth();
  const [counts] = (await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM notification_deliveries WHERE status = 'sent' AND sent_at > now() - interval '24 hours') AS sent24h,
      (SELECT count(*)::int FROM notification_deliveries WHERE status = 'skipped' AND created_at > now() - interval '24 hours') AS skipped24h,
      (SELECT count(*)::int FROM notification_events WHERE status = 'pending') AS events_pending,
      (SELECT count(*)::int FROM notifications WHERE created_at > now() - interval '24 hours') AS inapp24h`)) as unknown as Array<{
    sent24h: number;
    skipped24h: number;
    events_pending: number;
    inapp24h: number;
  }>;

  const failedDeliveries = await db
    .select({
      id: notificationDeliveries.id,
      channel: notificationDeliveries.channel,
      category: notificationDeliveries.category,
      email: notificationDeliveries.email,
      attempts: notificationDeliveries.attempts,
      lastError: notificationDeliveries.lastError,
      createdAt: notificationDeliveries.createdAt,
      eventType: notificationEvents.type,
    })
    .from(notificationDeliveries)
    .leftJoin(notificationEvents, eq(notificationEvents.id, notificationDeliveries.eventId))
    .where(eq(notificationDeliveries.status, "failed"))
    .orderBy(sql`${notificationDeliveries.createdAt} DESC`)
    .limit(50);

  const failedEvents = await db
    .select({
      id: notificationEvents.id,
      type: notificationEvents.type,
      attempts: notificationEvents.attempts,
      lastError: notificationEvents.lastError,
      createdAt: notificationEvents.createdAt,
    })
    .from(notificationEvents)
    .where(eq(notificationEvents.status, "failed"))
    .orderBy(sql`${notificationEvents.createdAt} DESC`)
    .limit(50);

  return {
    switches: { notifications: notificationsEnabled(), email: notificationEmailEnabled(), digests: digestsEnabled() },
    email: { sentToday: await emailsSentToday(), dailyBudget: nonEssentialEmailDailyBudget() },
    health,
    last24h: {
      inApp: counts?.inapp24h ?? 0,
      emailsSent: counts?.sent24h ?? 0,
      skipped: counts?.skipped24h ?? 0,
    },
    eventsPending: counts?.events_pending ?? 0,
    failedDeliveries: failedDeliveries.map((d) => ({ ...d, email: maskEmail(d.email), createdAt: d.createdAt.toISOString() })),
    failedEvents: failedEvents.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
  };
}

/**
 * Give a failed item a fresh set of 5 attempts, starting now. Only failed
 * items can be retried; anything else is left alone.
 */
export async function retryFailed(kind: "delivery" | "event", id: string): Promise<boolean> {
  if (kind === "delivery") {
    const rows = await db
      .update(notificationDeliveries)
      .set({
        status: "pending",
        attempts: 0,
        nextAttemptAt: new Date(),
        lockedUntil: null,
        claimedBy: null,
        lastError: "Retried by an admin.",
      })
      .where(and(eq(notificationDeliveries.id, id), eq(notificationDeliveries.status, "failed")))
      .returning({ id: notificationDeliveries.id });
    return rows.length > 0;
  }
  const rows = await db
    .update(notificationEvents)
    .set({
      status: "pending",
      attempts: 0,
      nextAttemptAt: new Date(),
      lockedUntil: null,
      claimedBy: null,
      lastError: "Retried by an admin.",
    })
    .where(and(eq(notificationEvents.id, id), eq(notificationEvents.status, "failed")))
    .returning({ id: notificationEvents.id });
  return rows.length > 0;
}
