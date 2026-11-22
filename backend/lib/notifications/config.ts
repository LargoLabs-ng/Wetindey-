/**
 * Switches and limits for the notification system, in one place.
 *
 * Everything here is read at call time (not at import), so a test or a
 * redeploy with new environment values takes effect without restarting.
 */

/**
 * The worker only runs (claims, fans out, sends) when this is "true".
 * Outbox rows are written regardless, so nothing is lost while it is off.
 */
export function notificationsEnabled(): boolean {
  return process.env.NOTIFICATIONS_ENABLED === "true";
}

/**
 * Emails are only sent when this is "true". While it is off, email
 * deliveries are recorded as "skipped" rather than piling up, so switching
 * it on later doesn't unleash a backlog of stale emails.
 */
export function notificationEmailEnabled(): boolean {
  return process.env.NOTIFICATIONS_EMAIL_ENABLED === "true";
}

/**
 * How many NON-essential notification emails may go out per Lagos day.
 *
 * Resend's free plan allows 100 emails a day, and the existing ticket emails
 * count against that too, so the default leaves room for them. Essential
 * emails (tickets, money, account security, cancellations) are never held
 * back by this; summaries and digests wait for the next day instead.
 */
export function nonEssentialEmailDailyBudget(): number {
  const raw = Number(process.env.NOTIFICATIONS_EMAIL_DAILY_BUDGET);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 70;
}

/** A claim lasts this long. Always longer than a function may run (60 s). */
export const CLAIM_SECONDS = 120;

/** A scheduled run stops taking new work after this long. */
export const RUN_TIME_BUDGET_MS = 20_000;

/** The optional after() nudge gets a shorter budget. */
export const NUDGE_TIME_BUDGET_MS = 8_000;

/** Per run. */
export const EVENT_BATCH = 50;
export const DELIVERY_BATCH = 100;

/** Recipients handled per fan-out page; big audiences continue next run. */
export const FANOUT_PAGE_SIZE = 500;

/**
 * A non-essential email for something older than this is skipped instead of
 * sent: "3 new sales" from two days ago is noise, not news.
 */
export const STALE_EMAIL_HOURS = 24;

/** Retention for the daily clean-up. */
export const RETENTION = {
  readNotificationsDays: 180,
  deliveryLogsDays: 90,
  finishedEventsDays: 30,
} as const;

/** Lagos is UTC+1 all year (no daylight saving). */
export const LAGOS_OFFSET_MS = 60 * 60 * 1000;

/** Midnight in Lagos at the start of the day containing `now`, as a UTC instant. */
export function startOfLagosDay(now: Date = new Date()): Date {
  const day = 24 * 60 * 60 * 1000;
  const lagos = now.getTime() + LAGOS_OFFSET_MS;
  return new Date(Math.floor(lagos / day) * day - LAGOS_OFFSET_MS);
}
