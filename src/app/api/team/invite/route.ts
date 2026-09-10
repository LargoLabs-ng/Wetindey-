import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db } from '@/db';
import { organizationMembers } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { sendEmail } from '@/lib/email-service';
import { requireOrgAccess } from '@/lib/authz';

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { inviteeEmail, role } = body;
    if (!inviteeEmail || !role) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // The team screen is event-scoped, so it sends eventId; accept either.
    // Without this gate anyone signed in could invite themselves into
    // someone else's organization as owner.
    const access = await requireOrgAccess({
      eventId: body.eventId,
      organizationId: body.organizationId,
    });
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    if (access.role !== 'owner') {
      return NextResponse.json(
        { error: 'Only the organization owner can invite team members.' },
        { status: 403 }
      );
    }
    const organizationId = access.organizationId;

    const validRoles = ['owner', 'event_manager', 'gate_staff', 'finance'];
    if (!validRoles.includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    const existing = await db.query.organizationMembers.findFirst({
      where: and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userEmail, inviteeEmail)
      ),
    });

    if (existing) {
      return NextResponse.json({ error: 'User already invited' }, { status: 400 });
    }

    const randomBytes = crypto.getRandomValues(new Uint8Array(32));
    const inviteToken = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');

    await db.insert(organizationMembers).values({
      id: crypto.randomUUID(),
      organizationId,
      userEmail: inviteeEmail,
      role,
      status: 'pending',
      inviteToken,
      invitedAt: new Date(),
      invitedBy: session.user.email,
    });

    const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/team/accept-invite?token=${inviteToken}`;

    await sendEmail({
      to: inviteeEmail,
      subject: 'You have been invited to join a team',
      html: `
        <h2>Team Invitation</h2>
        <p>You've been invited to join a team!</p>
        <p>Role: <strong>${role.replace(/_/g, ' ').toUpperCase()}</strong></p>
        <p>
          <a href="${inviteUrl}" style="background-color: #12372A; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">
            Accept Invitation
          </a>
        </p>
        <p>This link expires in 7 days.</p>
      `,
    });

    return NextResponse.json({ success: true, message: 'Invitation sent' });
  } catch (error) {
    console.error('Error inviting member:', error);
    return NextResponse.json({ error: 'Failed to invite member' }, { status: 500 });
  }
}
