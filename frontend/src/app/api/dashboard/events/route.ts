import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getEventsForUser, getSessionUserId } from "@/lib/authz";

/**
 * GET /api/dashboard/events
 * Events belonging to the signed-in organizer's organization(s).
 */
export async function GET() {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userEvents = await getEventsForUser(userId);

    userEvents.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return NextResponse.json({
      events: userEvents.map((event) => ({
        id: event.id,
        title: event.title,
        slug: event.slug,
        startDatetime: event.startDatetime,
        status: event.status,
      })),
    });
  } catch (error) {
    console.error("Error fetching events:", error);
    return NextResponse.json(
      { error: "Failed to fetch events" },
      { status: 500 }
    );
  }
}
