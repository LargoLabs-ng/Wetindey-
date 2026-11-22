/**
 * Fan-out: turn one claimed outbox event into inbox rows and deliveries.
 *
 * Works one page of recipients at a time (FANOUT_PAGE_SIZE), so a big
 * audience never has to fit into one run. Every insert uses the unique keys
 * with ON CONFLICT DO NOTHING: running the same page twice — after a crash,
 * or because two runs overlapped — creates nothing new.
 *
 * Preferences are applied here, when deliveries are created. Turning email
 * off stops future emails without touching anything already sent.
 */
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { notificationDeliveries, notifications } from "@/db/schema";
import {
  FANOUT_PAGE_SIZE,
  STALE_EMAIL_HOURS,
  notificationEmailEnabled,
} from "./config";
import { emailKey, inboxKey } from "./dedupe";
import { allowed, loadOverrides } from "./preferences";
import type { EventRow, Handler } from "./registry";

export type FanOutResult = {
  nextCursor: string | null;
  inboxCreated: number;
  deliveriesCreated: number;
  deliveriesSkipped: number;
};

export async function fanOutPage(
  event: EventRow & { fanoutCursor: string | null },
  handler: Handler,
  now: Date = new Date()
): Promise<FanOutResult> {
  const { recipients, nextCursor } = await handler.resolve(
    event,
    event.fanoutCursor,
    FANOUT_PAGE_SIZE
  );

  const overrides = await loadOverrides(
    recipients.map((r) => r.userId).filter((id): id is string => Boolean(id))
  );

  // ── In-app ────────────────────────────────────────────────────────────
  const inboxRows = recipients
    .filter(
      (r) =>
        r.userId &&
        r.inApp &&
        allowed(overrides, r.userId, r.category, "in_app", { essential: r.essential })
    )
    .map((r) => ({
      userId: r.userId!,
      eventId: event.id,
      type: event.type,
      category: r.category,
      title: r.inApp!.title.slice(0, 200),
      body: r.inApp!.body ?? null,
      url: r.inApp!.url ?? null,
      data: r.inApp!.data ?? {},
      dedupeKey: inboxKey(event.dedupeKey, r.userId!),
    }));

  let inboxCreated = 0;
  const inboxIdByKey = new Map<string, string>();
  if (inboxRows.length > 0) {
    const created = await db
      .insert(notifications)
      .values(inboxRows)
      .onConflictDoNothing({ target: notifications.dedupeKey })
      .returning({ id: notifications.id, dedupeKey: notifications.dedupeKey });
    inboxCreated = created.length;
    for (const row of created) inboxIdByKey.set(row.dedupeKey, row.id);
    const missing = inboxRows.map((r) => r.dedupeKey).filter((k) => !inboxIdByKey.has(k));
    if (missing.length > 0) {
      const existing = await db
        .select({ id: notifications.id, dedupeKey: notifications.dedupeKey })
        .from(notifications)
        .where(inArray(notifications.dedupeKey, missing));
      for (const row of existing) inboxIdByKey.set(row.dedupeKey, row.id);
    }
  }

  // ── Email ─────────────────────────────────────────────────────────────
  const emailOn = notificationEmailEnabled();
  const ageHours = (now.getTime() - event.createdAt.getTime()) / 3_600_000;

  const deliveryRows = recipients
    .filter((r) => r.emailContent && (r.email ?? "").trim())
    .filter((r) =>
      allowed(overrides, r.userId ?? null, r.category, "email", { essential: r.essential })
    )
    .map((r) => {
      let skipReason: string | null = null;
      if (!emailOn) skipReason = "Email sending is switched off (NOTIFICATIONS_EMAIL_ENABLED).";
      else if (!r.essential && ageHours > STALE_EMAIL_HOURS) {
        skipReason = `Too old to email (over ${STALE_EMAIL_HOURS} hours).`;
      }
      return {
        eventId: event.id,
        notificationId: r.userId
          ? inboxIdByKey.get(inboxKey(event.dedupeKey, r.userId)) ?? null
          : null,
        userId: r.userId ?? null,
        email: r.email!.trim(),
        channel: "email",
        category: r.category,
        essential: r.essential === true,
        content: { subject: r.emailContent!.subject, html: r.emailContent!.html },
        dedupeKey: emailKey(event.dedupeKey, { userId: r.userId, email: r.email }),
        status: skipReason ? "skipped" : "pending",
        lastError: skipReason,
      };
    });

  let deliveriesCreated = 0;
  let deliveriesSkipped = 0;
  if (deliveryRows.length > 0) {
    const created = await db
      .insert(notificationDeliveries)
      .values(deliveryRows)
      .onConflictDoNothing({ target: notificationDeliveries.dedupeKey })
      .returning({ status: notificationDeliveries.status });
    deliveriesCreated = created.filter((d) => d.status === "pending").length;
    deliveriesSkipped = created.filter((d) => d.status === "skipped").length;
  }

  // Push deliveries arrive in Phase 4 (one per device, `pushKey`).

  return { nextCursor: nextCursor ?? null, inboxCreated, deliveriesCreated, deliveriesSkipped };
}
