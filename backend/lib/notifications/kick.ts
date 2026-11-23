/**
 * The optional "start now" nudge.
 *
 * Call kickNotificationWorker() right after recording an event. Once the
 * response has gone out, Next.js runs one short worker pass, so most
 * notifications arrive within seconds instead of waiting for the next
 * scheduled run.
 *
 * Nothing depends on it. If it doesn't run — the function is recycled, the
 * call is outside a request, anything — the next scheduled run does the same
 * work, because the database is the source of truth.
 */
import { after } from "next/server";
import { NUDGE_TIME_BUDGET_MS, notificationsEnabled } from "./config";
import { runWorker } from "./worker";

export function kickNotificationWorker(): void {
  if (!notificationsEnabled()) return;
  try {
    after(async () => {
      try {
        await runWorker({ timeBudgetMs: NUDGE_TIME_BUDGET_MS, source: "nudge" });
      } catch (error) {
        console.error("Notification nudge failed (the schedule will retry):", error);
      }
    });
  } catch {
    // Not inside a request (a script, a test): the schedule covers it.
  }
}
