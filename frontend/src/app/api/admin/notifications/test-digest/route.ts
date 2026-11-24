import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isPlatformAdmin } from "@/lib/authz";
import { notificationEmailEnabled, notificationsEnabled } from "@/lib/notifications/config";
import { recordTestDigests } from "@/lib/notifications/digests";
import { allowRequest } from "@/lib/notifications/rate-limit";
import { runWorker } from "@/lib/notifications/worker";

export const maxDuration = 60;

/**
 * POST /api/admin/notifications/test-digest — Super Admin only.
 * Sends the daily sales email and the admin summary, covering today so far,
 * to the admin who pressed the button and nobody else. Works while the
 * daily emails are switched off, so they can be checked first.
 */
export async function POST() {
  if (!(await isPlatformAdmin())) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!notificationsEnabled() || !notificationEmailEnabled()) {
    return NextResponse.json(
      { error: "Notifications and email sending both need to be switched on for a test." },
      { status: 409 }
    );
  }
  if (!allowRequest(`test-digest:${userId}`, 3)) {
    return NextResponse.json({ error: "Three tests a minute is plenty. Wait a moment." }, { status: 429 });
  }
  try {
    await recordTestDigests(userId);
    const run = await runWorker({ source: "admin-test-digest" });
    return NextResponse.json({ ok: true, sent: run.deliveries.sent, email: session.user?.email ?? null });
  } catch (error) {
    console.error("Test summary failed:", error);
    return NextResponse.json({ error: "The test didn't go through. Check the logs." }, { status: 502 });
  }
}
