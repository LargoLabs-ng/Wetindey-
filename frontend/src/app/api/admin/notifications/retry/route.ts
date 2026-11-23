import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isPlatformAdmin } from "@/lib/authz";
import { retryFailed } from "@/lib/notifications/admin-health";
import { kickNotificationWorker } from "@/lib/notifications/kick";

const schema = z.object({ kind: z.enum(["delivery", "event"]), id: z.string().uuid() });

/** POST /api/admin/notifications/retry { kind, id } — Super Admin only. */
export async function POST(request: NextRequest) {
  if (!(await isPlatformAdmin())) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Pick something to retry." }, { status: 400 });
  }
  const retried = await retryFailed(parsed.data.kind, parsed.data.id);
  if (!retried) {
    return NextResponse.json({ error: "That isn't failed any more." }, { status: 409 });
  }
  kickNotificationWorker();
  return NextResponse.json({ ok: true });
}
