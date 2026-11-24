/**
 * One place that runs a notification task, shared by the schedule endpoint
 * (QStash / Vercel cron) and the admin "Process now" buttons.
 */
import { notificationsEnabled } from "./config";
import { checkNotificationHealth } from "./health";
import { cleanUpOldNotifications } from "./maintenance";
import { runReconciliationSweep } from "./sweep";
import { runWorker } from "./worker";
import { digestsEnabled, recordDailyDigests } from "./digests";

export const TASKS = ["worker", "daily", "discovery-daily", "discovery-weekly"] as const;
export type Task = (typeof TASKS)[number];

export type TaskResult =
  | { skipped: string }
  | {
      task: Task;
      sweep?: Awaited<ReturnType<typeof runReconciliationSweep>>;
      cleanup?: Awaited<ReturnType<typeof cleanUpOldNotifications>>;
      health?: Awaited<ReturnType<typeof checkNotificationHealth>>;
      digests?: Awaited<ReturnType<typeof recordDailyDigests>> | "off";
      worker: Awaited<ReturnType<typeof runWorker>>;
    };

/** Throws if the run genuinely couldn't happen (the caller turns that into an error status). */
export async function runNotificationTask(task: Task, source: string = task): Promise<TaskResult> {
  if (!notificationsEnabled()) {
    return { skipped: "Notifications are switched off (NOTIFICATIONS_ENABLED)." };
  }
  if (task === "discovery-daily" || task === "discovery-weekly") {
    return { skipped: `${task} arrives in Phase 3.` };
  }
  const sweep = task === "daily" ? await runReconciliationSweep() : undefined;
  const cleanup = task === "daily" ? await cleanUpOldNotifications() : undefined;
  const health = task === "daily" ? await checkNotificationHealth() : undefined;
  // Yesterday's summary emails, once per Lagos date (the backup run later in
  // the morning finds them already recorded). The worker below sends them.
  const digests = task === "daily" ? (digestsEnabled() ? await recordDailyDigests() : ("off" as const)) : undefined;
  const worker = await runWorker({ source });
  const summary = { task, sweep, cleanup, health, digests, worker };
  console.log("Notification run:", JSON.stringify(summary));
  return summary;
}
