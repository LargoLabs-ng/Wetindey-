import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUserId, isUuid } from "@/lib/authz";
import { markAllRead, markRead, unreadCount } from "@/lib/notifications/inbox";
import { allowRequest } from "@/lib/notifications/rate-limit";

const schema = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }),
]);

/**
 * POST /api/notifications/read   { ids: [...] }  or  { all: true }
 * Marks the signed-in person's own notifications read. Ids belonging to
 * anyone else are silently ignored.
 */
export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId || !isUuid(userId)) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  if (!allowRequest(`inbox-write:${userId}`, 30)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Nothing to mark." }, { status: 400 });
  }
  const changed = "all" in parsed.data
    ? await markAllRead(userId)
    : await markRead(userId, parsed.data.ids);
  return NextResponse.json({ ok: true, changed, unread: await unreadCount(userId) });
}
