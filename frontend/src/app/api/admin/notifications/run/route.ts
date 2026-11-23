import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isPlatformAdmin } from "@/lib/authz";
import { runNotificationTask } from "@/lib/notifications/tasks";

export const maxDuration = 60;

const schema = z.object({ task: z.enum(["worker", "daily"]) });

/**
 * POST /api/admin/notifications/run { task } — Super Admin only.
 * The same run the schedule does, on demand. Useful on Preview sites, which
 * get no schedule, and for clearing a queue without waiting.
 */
export async function POST(request: NextRequest) {
  if (!(await isPlatformAdmin())) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Pick a task to run." }, { status: 400 });
  }
  try {
    const result = await runNotificationTask(parsed.data.task, `admin-${parsed.data.task}`);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Admin notification run failed:", error);
    return NextResponse.json({ error: "The run failed. Check the logs." }, { status: 502 });
  }
}
