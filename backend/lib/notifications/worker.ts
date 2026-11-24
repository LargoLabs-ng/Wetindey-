/**
 * The worker: the only thing that sends notifications.
 *
 * Each run, in order:
 *   1. Gives up on claims that expired on their last attempt.
 *   2. Claims due outbox events (FOR UPDATE SKIP LOCKED, so two runs can
 *      never take the same row while a claim is valid) and fans them out.
 *   3. Claims due deliveries — essential ones first, non-essential emails
 *      only while the daily budget lasts — and sends them.
 *   4. Stops taking new work after its time budget, whatever is left.
 *
 * The attempt counter goes up when a row is CLAIMED, so a run that crashes
 * still uses up an attempt, and a row that keeps crashing stops after 5.
 * Every result is saved with `AND claimed_by = <this run>`: a run that lost
 * its claim can't overwrite the result of the run that took over.
 *
 * Delivery model: creating and processing notifications is idempotent. Email
 * is at-least-once with duplicates minimised (Resend idempotency key = the
 * delivery id); exactly-once delivery through outside providers is not
 * promised.
 */
import { randomUUID } from "node:crypto";
import { and, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { notificationDeliveryAttempts } from "@/db/schema";
import { sendEmailWithResult } from "@/lib/email-service";
import { withUnsubscribe } from "./unsubscribe";
import {
  CLAIM_SECONDS,
  DELIVERY_BATCH,
  EVENT_BATCH,
  RUN_TIME_BUDGET_MS,
  STALE_EMAIL_HOURS,
  nonEssentialEmailDailyBudget,
  notificationEmailEnabled,
  startOfLagosDay,
} from "./config";
import { fanOutPage } from "./fanout";
import { registerBuiltInHandlers } from "./handlers";
import { getHandler, type EventRow } from "./registry";
import { afterTemporaryFailure, classifyFailure, trimError } from "./retry";

export type WorkerSummary = {
  runId: string;
  source: string;
  events: { claimed: number; done: number; continued: number; retried: number; failed: number };
  deliveries: { claimed: number; sent: number; retried: number; failed: number; skipped: number };
  exhaustedClaims: { events: number; deliveries: number };
  emailBudgetLeft: number;
  stoppedOnTime: boolean;
  ms: number;
};

type ClaimedEvent = EventRow & {
  fanoutCursor: string | null;
  attempts: number;
  maxAttempts: number;
};

type ClaimedDelivery = {
  id: string;
  channel: string;
  email: string | null;
  essential: boolean;
  userId: string | null;
  category: string;
  content: { subject?: string; html?: string };
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
};

const rowsOf = <T>(result: unknown): T[] => result as T[];

// ── Step 1 ──────────────────────────────────────────────────────────────

/** Claims that expired on their final attempt can't be retried: fail them. */
async function failExhaustedClaims(): Promise<{ events: number; deliveries: number }> {
  const events = rowsOf<{ id: string }>(
    await db.execute(sql`
      UPDATE notification_events
      SET status = 'failed', locked_until = NULL,
          last_error = 'The last attempt was cut off before it finished.'
      WHERE status = 'processing' AND locked_until < now() AND attempts >= max_attempts
      RETURNING id`)
  );
  const deliveries = rowsOf<{ id: string }>(
    await db.execute(sql`
      UPDATE notification_deliveries
      SET status = 'failed', locked_until = NULL,
          last_error = 'The last attempt was cut off before it finished.'
      WHERE status = 'processing' AND locked_until < now() AND attempts >= max_attempts
      RETURNING id`)
  );
  // Any attempt left unfinished for longer than a claim lasts was cut off.
  await db.execute(sql`
    UPDATE notification_delivery_attempts
    SET outcome = 'abandoned', finished_at = now()
    WHERE finished_at IS NULL
      AND started_at < now() - make_interval(secs => ${CLAIM_SECONDS})`);
  return { events: events.length, deliveries: deliveries.length };
}

// ── Step 2 ──────────────────────────────────────────────────────────────

async function claimEvents(runId: string, limit: number): Promise<ClaimedEvent[]> {
  const rows = rowsOf<{
    id: string;
    type: string;
    dedupe_key: string;
    payload: Record<string, unknown>;
    created_at: Date | string;
    fanout_cursor: string | null;
    attempts: number;
    max_attempts: number;
  }>(
    await db.execute(sql`
      UPDATE notification_events e
      SET status = 'processing',
          attempts = e.attempts + 1,
          locked_until = now() + make_interval(secs => ${CLAIM_SECONDS}),
          claimed_by = ${runId}
      WHERE e.id IN (
        SELECT id FROM notification_events
        WHERE attempts < max_attempts
          AND available_at <= now()
          AND (
            (status = 'pending' AND next_attempt_at <= now())
            OR (status = 'processing' AND locked_until < now())
          )
        ORDER BY available_at, created_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      RETURNING e.id, e.type, e.dedupe_key, e.payload, e.created_at,
                e.fanout_cursor, e.attempts, e.max_attempts`)
  );
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    dedupeKey: r.dedupe_key,
    payload: r.payload ?? {},
    createdAt: new Date(r.created_at),
    fanoutCursor: r.fanout_cursor,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
  }));
}

async function processEvent(
  event: ClaimedEvent,
  runId: string,
  summary: WorkerSummary
): Promise<void> {
  const handler = getHandler(event.type);
  if (!handler) {
    await db.execute(sql`
      UPDATE notification_events
      SET status = 'failed', locked_until = NULL,
          last_error = ${`No handler is registered for "${event.type}".`}
      WHERE id = ${event.id} AND claimed_by = ${runId}`);
    summary.events.failed += 1;
    return;
  }

  try {
    const result = await fanOutPage(event, handler);
    if (result.nextCursor) {
      // Progress, not failure: save the place and reset the counter, so a
      // big audience spread over many runs doesn't use up its attempts.
      await db.execute(sql`
        UPDATE notification_events
        SET status = 'pending', fanout_cursor = ${result.nextCursor}, attempts = 0,
            next_attempt_at = now(), locked_until = NULL, last_error = NULL
        WHERE id = ${event.id} AND claimed_by = ${runId}`);
      summary.events.continued += 1;
    } else {
      await db.execute(sql`
        UPDATE notification_events
        SET status = 'done', processed_at = now(), fanout_cursor = NULL,
            locked_until = NULL, last_error = NULL
        WHERE id = ${event.id} AND claimed_by = ${runId}`);
      summary.events.done += 1;
    }
  } catch (error) {
    const decision = afterTemporaryFailure(event.attempts, event.maxAttempts);
    if (decision.kind === "retry") {
      await db.execute(sql`
        UPDATE notification_events
        SET status = 'pending', locked_until = NULL, last_error = ${trimError(error)},
            next_attempt_at = now() + make_interval(secs => ${decision.delaySeconds})
        WHERE id = ${event.id} AND claimed_by = ${runId}`);
      summary.events.retried += 1;
    } else {
      await db.execute(sql`
        UPDATE notification_events
        SET status = 'failed', locked_until = NULL, last_error = ${trimError(error)}
        WHERE id = ${event.id} AND claimed_by = ${runId}`);
      summary.events.failed += 1;
    }
    console.error(`Notification event ${event.id} (${event.type}) failed:`, trimError(error));
  }
}

// ── Step 3 ──────────────────────────────────────────────────────────────

/** Notification emails sent so far today (Lagos day), essential or not. */
export async function emailsSentToday(now: Date = new Date()): Promise<number> {
  const [row] = rowsOf<{ count: number }>(
    await db.execute(sql`
      SELECT count(*)::int AS count FROM notification_deliveries
      WHERE channel = 'email' AND status = 'sent' AND sent_at >= ${startOfLagosDay(now).toISOString()}::timestamptz`)
  );
  return row?.count ?? 0;
}

async function claimDeliveryBatch(
  runId: string,
  limit: number,
  which: "priority" | "budgeted"
): Promise<ClaimedDelivery[]> {
  if (limit <= 0) return [];
  const emailOn = notificationEmailEnabled();
  // priority: essential emails and every non-email channel.
  // budgeted: non-essential emails, only as many as the budget allows.
  const filter =
    which === "priority"
      ? emailOn
        ? sql`(essential OR channel <> 'email')`
        : sql`channel <> 'email'`
      : emailOn
        ? sql`(channel = 'email' AND NOT essential)`
        : sql`false`;
  const rows = rowsOf<{
    id: string;
    channel: string;
    email: string | null;
    essential: boolean;
    user_id: string | null;
    category: string;
    content: { subject?: string; html?: string };
    attempts: number;
    max_attempts: number;
    created_at: Date | string;
  }>(
    await db.execute(sql`
      UPDATE notification_deliveries d
      SET status = 'processing',
          attempts = d.attempts + 1,
          locked_until = now() + make_interval(secs => ${CLAIM_SECONDS}),
          claimed_by = ${runId}
      WHERE d.id IN (
        SELECT id FROM notification_deliveries
        WHERE attempts < max_attempts
          AND ${filter}
          AND (
            (status = 'pending' AND next_attempt_at <= now())
            OR (status = 'processing' AND locked_until < now())
          )
        ORDER BY essential DESC, next_attempt_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      RETURNING d.id, d.channel, d.email, d.essential, d.content, d.user_id, d.category,
                d.attempts, d.max_attempts, d.created_at`)
  );
  const claimed = rows.map((r) => ({
    id: r.id,
    channel: r.channel,
    email: r.email,
    essential: r.essential,
    userId: r.user_id ?? null,
    category: r.category,
    content: r.content ?? {},
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    createdAt: new Date(r.created_at),
  }));
  if (claimed.length > 0) {
    const ids = claimed.map((d) => d.id);
    // An earlier attempt on any of these that never finished was cut off.
    await db
      .update(notificationDeliveryAttempts)
      .set({ outcome: "abandoned", finishedAt: new Date() })
      .where(
        and(
          isNull(notificationDeliveryAttempts.finishedAt),
          inArray(notificationDeliveryAttempts.deliveryId, ids)
        )
      );
    await db
      .insert(notificationDeliveryAttempts)
      .values(claimed.map((d) => ({ deliveryId: d.id, attemptNumber: d.attempts })));
  }
  return claimed;
}

async function finishAttempt(
  deliveryId: string,
  attemptNumber: number,
  outcome: string,
  extra: { providerStatus?: string | null; error?: string | null; providerMessageId?: string | null } = {}
): Promise<void> {
  await db.execute(sql`
    UPDATE notification_delivery_attempts
    SET finished_at = now(), outcome = ${outcome},
        provider_status = ${extra.providerStatus ?? null},
        error = ${extra.error ?? null},
        provider_message_id = ${extra.providerMessageId ?? null}
    WHERE delivery_id = ${deliveryId} AND attempt_number = ${attemptNumber}
      AND finished_at IS NULL`);
}

async function sendDelivery(
  d: ClaimedDelivery,
  runId: string,
  summary: WorkerSummary,
  now: Date
): Promise<void> {
  const skip = async (reason: string) => {
    await db.execute(sql`
      UPDATE notification_deliveries
      SET status = 'skipped', locked_until = NULL, last_error = ${reason}
      WHERE id = ${d.id} AND claimed_by = ${runId}`);
    await finishAttempt(d.id, d.attempts, "skipped", { error: reason });
    summary.deliveries.skipped += 1;
  };

  if (d.channel !== "email") {
    await skip("Push notifications arrive in Phase 4.");
    return;
  }
  if (!d.email || !d.content.subject || !d.content.html) {
    await skip("Nothing to send: missing address or content.");
    return;
  }
  const ageHours = (now.getTime() - d.createdAt.getTime()) / 3_600_000;
  if (!d.essential && ageHours > STALE_EMAIL_HOURS) {
    await skip(`Too old to email (over ${STALE_EMAIL_HOURS} hours).`);
    return;
  }

  let result: Awaited<ReturnType<typeof sendEmailWithResult>>;
  try {
    // The unsubscribe line and headers are added here, per person, so
    // every notification email gets them without each handler remembering.
    const finished = withUnsubscribe(d.content.html, {
      userId: d.userId,
      category: d.category,
      essential: d.essential,
    });
    result = await sendEmailWithResult({
      to: d.email,
      subject: d.content.subject,
      html: finished.html,
      headers: finished.headers,
      idempotencyKey: d.id,
    });
  } catch (error) {
    result = { ok: false, error: trimError(error) };
  }

  if (result.ok) {
    await db.execute(sql`
      UPDATE notification_deliveries
      SET status = 'sent', sent_at = now(), locked_until = NULL, last_error = NULL,
          provider_message_id = ${result.id ?? null}
      WHERE id = ${d.id} AND claimed_by = ${runId}`);
    await finishAttempt(d.id, d.attempts, "sent", {
      providerStatus: result.status ? String(result.status) : null,
      providerMessageId: result.id ?? null,
    });
    summary.deliveries.sent += 1;
    return;
  }

  const error = trimError(result.error ?? "Unknown error");
  const kind = classifyFailure(result);
  const decision =
    kind === "permanent" ? { kind: "give_up" as const } : afterTemporaryFailure(d.attempts, d.maxAttempts);

  if (decision.kind === "retry") {
    await db.execute(sql`
      UPDATE notification_deliveries
      SET status = 'pending', locked_until = NULL, last_error = ${error},
          next_attempt_at = now() + make_interval(secs => ${decision.delaySeconds})
      WHERE id = ${d.id} AND claimed_by = ${runId}`);
    summary.deliveries.retried += 1;
  } else {
    await db.execute(sql`
      UPDATE notification_deliveries
      SET status = 'failed', locked_until = NULL, last_error = ${error}
      WHERE id = ${d.id} AND claimed_by = ${runId}`);
    summary.deliveries.failed += 1;
  }
  await finishAttempt(
    d.id,
    d.attempts,
    kind === "permanent" ? "permanent_failure" : "temporary_failure",
    { providerStatus: result.status ? String(result.status) : null, error }
  );
}

// ── The run ─────────────────────────────────────────────────────────────

export async function runWorker(
  options: { timeBudgetMs?: number; source?: string } = {}
): Promise<WorkerSummary> {
  const started = Date.now();
  const deadline = started + (options.timeBudgetMs ?? RUN_TIME_BUDGET_MS);
  const runId = randomUUID();
  const summary: WorkerSummary = {
    runId,
    source: options.source ?? "schedule",
    events: { claimed: 0, done: 0, continued: 0, retried: 0, failed: 0 },
    deliveries: { claimed: 0, sent: 0, retried: 0, failed: 0, skipped: 0 },
    exhaustedClaims: { events: 0, deliveries: 0 },
    emailBudgetLeft: 0,
    stoppedOnTime: false,
    ms: 0,
  };
  const timeLeft = () => Date.now() < deadline;

  registerBuiltInHandlers();
  summary.exhaustedClaims = await failExhaustedClaims();

  while (timeLeft()) {
    const claimed = await claimEvents(runId, EVENT_BATCH);
    summary.events.claimed += claimed.length;
    for (const event of claimed) {
      await processEvent(event, runId, summary);
    }
    if (claimed.length < EVENT_BATCH) break;
  }

  while (timeLeft()) {
    const priority = await claimDeliveryBatch(runId, DELIVERY_BATCH, "priority");
    // Essential emails always go, but they count against the day's total
    // like any other email, so they come off the budget first.
    const essentialEmails = priority.filter((d) => d.channel === "email").length;
    const budgetLeft = Math.max(
      0,
      nonEssentialEmailDailyBudget() - (await emailsSentToday()) - essentialEmails
    );
    summary.emailBudgetLeft = budgetLeft;
    const budgeted = await claimDeliveryBatch(
      runId,
      Math.min(budgetLeft, DELIVERY_BATCH - priority.length),
      "budgeted"
    );
    const claimed = [...priority, ...budgeted];
    summary.deliveries.claimed += claimed.length;
    const now = new Date();
    for (const d of claimed) {
      // Already-claimed rows are finished even past the deadline: leaving
      // them would only make the next run wait out the claim.
      await sendDelivery(d, runId, summary, now);
    }
    if (claimed.length < DELIVERY_BATCH) break;
  }

  summary.stoppedOnTime = !timeLeft();
  summary.ms = Date.now() - started;
  return summary;
}
