import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId, isUuid } from "@/lib/authz";
import { notificationsEnabled } from "@/lib/notifications/config";
import { listInbox, unreadCount } from "@/lib/notifications/inbox";
import { allowRequest } from "@/lib/notifications/rate-limit";

/**
 * GET /api/notifications                 → { enabled, unread, items, nextCursor }
 * GET /api/notifications?countOnly=1     → { enabled, unread }
 * GET /api/notifications?cursor=…        → the next page
 *
 * Only ever the signed-in person's own notifications.
 */
export async function GET(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId || !isUuid(userId)) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  if (!allowRequest(`inbox:${userId}`)) {
    return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  }
  // Switched off: the bell hides itself.
  if (!notificationsEnabled()) {
    return NextResponse.json({ enabled: false, unread: 0, items: [], nextCursor: null });
  }

  const params = request.nextUrl.searchParams;
  const unread = await unreadCount(userId);
  if (params.get("countOnly") === "1") {
    return NextResponse.json({ enabled: true, unread });
  }
  const limit = Number(params.get("limit") ?? "") || undefined;
  const page = await listInbox(userId, { cursor: params.get("cursor"), limit });
  return NextResponse.json({ enabled: true, unread, ...page });
}
