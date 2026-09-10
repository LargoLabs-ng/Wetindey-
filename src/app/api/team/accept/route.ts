import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { eventStaff, organizationMembers } from "@/db/schema";
import { auth } from "@/auth";
import { resolveInvite } from "@/lib/invites";

/** POST /api/team/accept — { token } */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    const userEmail = session?.user?.email?.toLowerCase();

    if (!userId || !userEmail) {
      return NextResponse.json(
        { error: "Sign in first to accept this invitation." },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const resolved = await resolveInvite(body?.token);

    if (resolved.state === "missing" || resolved.state === "unknown") {
      return NextResponse.json(
        { error: "This invitation link isn't valid." },
        { status: 404 }
      );
    }
    if (resolved.state === "used") {
      return NextResponse.json(
        { error: "This invitation has already been used." },
        { status: 409 }
      );
    }
    if (resolved.state === "expired") {
      return NextResponse.json(
        { error: "This invitation has expired. Ask for a new one." },
        { status: 410 }
      );
    }

    if (resolved.email.toLowerCase() !== userEmail) {
      return NextResponse.json(
        {
          error: `This invitation was sent to ${resolved.email}. Sign in with that address to accept it.`,
        },
        { status: 403 }
      );
    }

    if (resolved.kind === "event") {
      await db
        .update(eventStaff)
        .set({
          userId,
          status: "active",
          joinedAt: new Date(),
          inviteToken: null,
        })
        .where(eq(eventStaff.id, resolved.rowId));

      return NextResponse.json({
        success: true,
        message: "Invitation accepted",
        role: resolved.role,
      });
    }

    // Organization invite: (organization_id, user_id) is unique, so if
    // they're already a member, drop the pending row rather than collide.
    const [pending] = await db
      .select({ organizationId: organizationMembers.organizationId })
      .from(organizationMembers)
      .where(eq(organizationMembers.id, resolved.rowId))
      .limit(1);

    if (pending) {
      const [existing] = await db
        .select({ id: organizationMembers.id })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, pending.organizationId),
            eq(organizationMembers.userId, userId)
          )
        )
        .limit(1);

      if (existing) {
        await db
          .delete(organizationMembers)
          .where(eq(organizationMembers.id, resolved.rowId));
        return NextResponse.json({
          success: true,
          message: "You're already on this team.",
          role: resolved.role,
        });
      }
    }

    await db
      .update(organizationMembers)
      .set({
        userId,
        status: "active",
        joinedAt: new Date(),
        inviteToken: null,
      })
      .where(eq(organizationMembers.id, resolved.rowId));

    return NextResponse.json({
      success: true,
      message: "Invitation accepted",
      role: resolved.role,
    });
  } catch (error) {
    console.error("Error accepting invite:", error);
    return NextResponse.json(
      { error: "Failed to accept invitation" },
      { status: 500 }
    );
  }
}
