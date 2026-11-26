import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { getSessionUserId } from "@/lib/authz";
import {
  cleanLogoUrl,
  cleanOrganizationName,
  completeOrganiserSetup,
  getOwnedOrganizations,
  isHostingOrganization,
  pickSetupTarget,
} from "@/lib/organiser-setup";

/**
 * /api/organization — the organisation this person OWNS.
 *
 *   GET    name, logo, and whether setup is still needed
 *   POST   first-time setup: create it, or confirm an old one. Never a
 *          duplicate (see completeOrganiserSetup).
 *   PATCH  settings: change the name or the logo.
 *
 * Payout details are deliberately not handled here. They already have a
 * home — /api/finance, which also sends the "your payout account changed"
 * alert — and a second way to write them would be a second place to forget
 * that alert.
 */

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const owned = await getOwnedOrganizations(userId);
  const target = pickSetupTarget(owned);
  return NextResponse.json({
    needsSetup: !target || !isHostingOrganization(target),
    organization: target
      ? { id: target.id, name: target.name, logoUrl: target.logoUrl }
      : null,
  });
}

export async function POST(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const name = cleanOrganizationName(body?.name);
  if (!name.ok) return NextResponse.json({ error: name.error }, { status: 400 });

  const logoUrl = cleanLogoUrl(body?.logoUrl);
  if (body?.logoUrl && logoUrl === undefined) {
    return NextResponse.json({ error: "That logo link isn't valid." }, { status: 400 });
  }

  try {
    const result = await completeOrganiserSetup(userId, { name: name.name, logoUrl });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Organiser setup failed:", error);
    return NextResponse.json(
      { error: "Couldn't save that. Try again in a moment." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const owned = await getOwnedOrganizations(userId);
  const target = pickSetupTarget(owned);
  if (!target) {
    return NextResponse.json(
      { error: "Set up your organisation first." },
      { status: 404 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const changes: { name?: string; logoUrl?: string | null } = {};

  if (body?.name !== undefined) {
    const name = cleanOrganizationName(body.name);
    if (!name.ok) return NextResponse.json({ error: name.error }, { status: 400 });
    changes.name = name.name;
  }

  if (body?.logoUrl !== undefined) {
    const logoUrl = cleanLogoUrl(body.logoUrl);
    if (logoUrl === undefined) {
      return NextResponse.json({ error: "That logo link isn't valid." }, { status: 400 });
    }
    changes.logoUrl = logoUrl;
  }

  if (Object.keys(changes).length === 0) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  const [saved] = await db
    .update(organizations)
    .set(changes)
    .where(eq(organizations.id, target.id))
    .returning({ name: organizations.name, logoUrl: organizations.logoUrl });

  return NextResponse.json({ organization: saved });
}
