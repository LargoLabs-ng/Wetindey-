/**
 * The attempt rule — identical in the database, the worker and the plan.
 *
 *   MAX_ATTEMPTS = 5 is the TOTAL number of tries, including the first.
 *   After a temporary failure on try n (n < 5), wait RETRY_DELAYS[n - 1]:
 *     after try 1 → 1 minute
 *     after try 2 → 10 minutes
 *     after try 3 → 1 hour
 *     after try 4 → 6 hours
 *   A temporary failure on try 5 is final: the row becomes "failed".
 *
 * So the fifth and last try happens about 7 hours after the first — well
 * inside Resend's 24-hour idempotency window, so a repeated email is dropped.
 */

export const MAX_ATTEMPTS = 5;

/** Seconds to wait after a temporary failure on try 1, 2, 3 and 4. */
export const RETRY_DELAYS_SECONDS = [60, 10 * 60, 60 * 60, 6 * 60 * 60] as const;

/** Up to ±10% randomness, so a burst of failures doesn't retry in lockstep. */
export const JITTER = 0.1;

export type RetryDecision =
  | { kind: "retry"; delaySeconds: number }
  | { kind: "give_up" };

/**
 * What to do after a temporary failure on `attemptNumber` (1-based).
 * `random` is injectable for tests; it must return a number in [0, 1).
 */
export function afterTemporaryFailure(
  attemptNumber: number,
  maxAttempts: number = MAX_ATTEMPTS,
  random: () => number = Math.random
): RetryDecision {
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) {
    throw new Error(`attemptNumber must be a positive integer, got ${attemptNumber}`);
  }
  if (attemptNumber >= maxAttempts) return { kind: "give_up" };
  const base =
    RETRY_DELAYS_SECONDS[Math.min(attemptNumber, RETRY_DELAYS_SECONDS.length) - 1];
  const factor = 1 + (random() * 2 - 1) * JITTER;
  return { kind: "retry", delaySeconds: Math.max(1, Math.round(base * factor)) };
}

export type FailureKind = "temporary" | "permanent";

/**
 * Sort a failed send into "try again later" or "never going to work".
 *
 * Permanent: the request itself is wrong (400, 422 — e.g. an invalid
 * address) or the destination is gone (404, 410 — a push device that was
 * unsubscribed). Everything else — timeouts, 429 rate limits, 5xx, network
 * errors, and 401/403 (usually a configuration problem someone will fix) —
 * is temporary and retried.
 */
export function classifyFailure(input: { status?: number; error?: string }): FailureKind {
  const status = input.status;
  if (status === 400 || status === 404 || status === 410 || status === 422) {
    return "permanent";
  }
  return "temporary";
}

/** Error text trimmed before it's stored: enough to diagnose, no more. */
export function trimError(error: unknown, max = 500): string {
  const text = error instanceof Error ? error.message : String(error ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
