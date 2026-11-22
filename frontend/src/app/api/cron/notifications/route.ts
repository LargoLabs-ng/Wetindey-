import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { appUrl } from "@/lib/app-url";
import { notificationsEnabled } from "@/lib/notifications/config";
import { cleanUpOldNotifications } from "@/lib/notifications/maintenance";
import { verifyQStashRequest } from "@/lib/notifications/qstash";
import { runWorker } from "@/lib/notifications/worker";

// A claim lasts 120 seconds; the host stops this function long before that.
export const maxDuration = 60;

/**
 * /api/cron/notifications — the notification worker.
 *
 * Exactly two callers are accepted:
 *   POST from the QStash schedules, proven by QStash's signature.
 *   GET  from the daily Vercel cron backstop, proven by CRON_SECRET.
 * (A POST with the CRON_SECRET header is also accepted, for a manual run.)
 * Anything else gets a 401.
 *
 * ?task=worker            claim and send whatever is due (the default)
 * ?task=daily             clean-up (+ the reconciliation sweep, Stage 2),
 *                         then a worker pass
 * ?task=discovery-daily   Phase 3
 * ?task=discovery-weekly  Phase 3
 *
 * Answers 200 whenever it ran, even with nothing to do, so QStash doesn't
 * retry a healthy call. An error status means it genuinely couldn't run, so
 * QStash logs it and (for timed tasks) retries.
 */

const TASKS = ["worker", "daily", "discovery-daily", "discovery-weekly"] as const;
type Task = (typeof TASKS)[number];

function hasCronSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const received = Buffer.from(request.headers.get("authorization") ?? "", "utf8");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function taskOf(request: NextRequest): Task | null {
  const raw = request.nextUrl.searchParams.get("task") ?? "worker";
  return (TASKS as readonly string[]).includes(raw) ? (raw as Task) : null;
}

async function run(task: Task) {
  if (!notificationsEnabled()) {
    return NextResponse.json({ skipped: "Notifications are switched off (NOTIFICATIONS_ENABLED)." });
  }
  try {
    if (task === "discovery-daily" || task === "discovery-weekly") {
      return NextResponse.json({ skipped: `${task} arrives in Phase 3.` });
    }
    const cleanup = task === "daily" ? await cleanUpOldNotifications() : undefined;
    const worker = await runWorker({ source: task });
    const summary = { task, cleanup, worker };
    console.log("Notification run:", JSON.stringify(summary));
    return NextResponse.json(summary);
  } catch (error) {
    console.error(`Notification ${task} run failed:`, error);
    return NextResponse.json({ error: "The notification run failed." }, { status: 502 });
  }
}

export async function GET(request: NextRequest) {
  if (!hasCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const task = taskOf(request);
  if (!task) return NextResponse.json({ error: "Unknown task." }, { status: 400 });
  return run(task);
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const fromQStash = await verifyQStashRequest({
    signature: request.headers.get("upstash-signature"),
    body,
    urls: [request.url, `${appUrl("/api/cron/notifications")}${request.nextUrl.search}`],
  });
  if (!fromQStash && !hasCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const task = taskOf(request);
  if (!task) return NextResponse.json({ error: "Unknown task." }, { status: 400 });
  return run(task);
}
