import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { organizationMembers, organizations } from '@/db/schema';
import { requireOrgAccess } from '@/lib/authz';

/** GET /api/team/members?eventId=... (or ?organizationId=...) */
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const access = await requireOrgAccess({
      eventId: sp.get('eventId'),
      organizationId: sp.get('organizationId'),
    });
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const members = await db.query.organizationMembers.findMany({
      where: eq(organizationMembers.organizationId, access.organizationId),
    });

    return NextResponse.json({
      organizationId: access.organizationId,
      yourRole: access.role,
      members: members.map((m) => ({
        id: m.id,
        userEmail: m.userEmail,
        role: m.role,
        status: m.status,
        invitedAt: m.invitedAt,
        joinedAt: m.joinedAt,
        invitedBy: m.invitedBy,
      })),
    });
  } catch (error) {
    console.error('Error fetching members:', error);
    return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 });
  }
}

/**
 * DELETE /api/team/members?memberId=...
 * Owner only. Previously this deleted any membership row by id with no
 * ownership check at all — including an organization's own owner.
 */
export async function DELETE(request: NextRequest) {
  try {
    const memberId = request.nextUrl.searchParams.get('memberId');
    if (!memberId) {
      return NextResponse.json({ error: 'Missing memberId' }, { status: 400 });
    }

    const [member] = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.id, memberId))
      .limit(1);

    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    const access = await requireOrgAccess({
      organizationId: member.organizationId,
    });
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    if (access.role !== 'owner') {
      return NextResponse.json(
        { error: 'Only the organization owner can remove team members.' },
        { status: 403 }
      );
    }

    const [org] = await db
      .select({ ownerId: organizations.ownerId })
      .from(organizations)
      .where(eq(organizations.id, member.organizationId))
      .limit(1);

    if (org && org.ownerId === member.userId) {
      return NextResponse.json(
        { error: "You can't remove the organization owner." },
        { status: 409 }
      );
    }

    await db.delete(organizationMembers).where(eq(organizationMembers.id, memberId));
    return NextResponse.json({ success: true, message: 'Member removed' });
  } catch (error) {
    console.error('Error removing member:', error);
    return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 });
  }
}
