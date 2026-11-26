import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { getSessionUserId, getStaffedEvents, hasDashboardAccess } from "@/lib/authz";

/**
 * GET /api/account/nav — what the shared account menu needs to know.
 *
 * `organises` decides one link: "Organiser mode" for someone who owns an
 * organisation or is on the team of any event, "Host an event" for
 * everyone else. Both go to /organiser, which already routes a signed-in
 * person to the dashboard (or the door scanner, for gate crew).
 *
 * Unlike /api/organising this counts past events too: an organiser between
 * events is still an organiser.
 *
 * `doorOnly` marks gate crew with no dashboard of their own. /organiser
 * sends them to the scanner, which is right for their job but left them no
 * way to host an event themselves; the menu shows them a separate "Host an
 * event" link to the setup screen.
 *
 * Signed out → { signedIn: false }, not a 401, so pages can call it freely.
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ signedIn: false, organises: false, doorOnly: false });

  const [owned] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.ownerId, userId))
    .limit(1);

  const staffed = await getStaffedEvents(userId);
  const organises = Boolean(owned) || staffed.length > 0;
  const doorOnly = staffed.length > 0 && !(await hasDashboardAccess(userId));

  return NextResponse.json({ signedIn: true, organises, doorOnly });
}
