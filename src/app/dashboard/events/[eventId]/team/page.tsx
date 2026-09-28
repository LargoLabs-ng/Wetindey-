'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Crown, Mail, Trash2, UserPlus, X } from 'lucide-react';
import {
  ASSIGNABLE_ROLES,
  supportsFinanceSwitch,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
} from '@/lib/permissions';
import type { OrgRole } from '@/lib/authz';

interface StaffMember {
  id: string;
  email: string;
  role: OrgRole;
  status: string;
  name: string | null;
  invitedAt: string | null;
  joinedAt: string | null;
  /** Promoters only — the code on the end of their share link. */
  refCode: string | null;
  canSeeFinances: boolean;
}

const roleChip: Record<string, string> = {
  owner: 'bg-gold/20 text-gold',
  event_manager: 'bg-success/25 text-sage',
  gate_staff: 'bg-info/20 text-info',
  finance: 'bg-warning/15 text-warning',
  viewer: 'bg-surface-2 text-on-dark-2',
  promoter: 'bg-gold-soft text-gold',
};

export default function TeamPage() {
  const routeParams = useParams();
  const eventId = routeParams.eventId as string;

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [manualLink, setManualLink] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('gate_staff');
  // Off by default and reset whenever the role changes, so it can never be
  // left ticked from a previous selection and quietly carried onto someone
  // the organiser did not mean to put on the money.
  const [inviteFinances, setInviteFinances] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${eventId}/staff`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not load the team.');
        return;
      }
      setStaff(data.staff ?? []);
      setError(null);
    } catch {
      setError('Could not load the team.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  async function invite(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/events/${eventId}/staff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail,
          role: inviteRole,
          canSeeFinances: inviteFinances,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not send that invitation.');
        return;
      }
      setInviteEmail('');
      setShowInvite(false);
      await load();

      if (data.emailSent) {
        setNotice(`Invitation sent to ${inviteEmail}.`);
        setManualLink(null);
      } else {
        setNotice(null);
        setManualLink(data.inviteUrl ?? null);
        setError(
          `${inviteEmail} was added, but the invitation email couldn't be sent` +
            (data.emailError ? ` (${data.emailError})` : '') +
            '. Share the link below with them instead.'
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(staffId: string, role: OrgRole) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/staff/${staffId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not change that role.');
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(staffId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/staff/${staffId}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Could not remove that person.');
        return;
      }
      setConfirmRemoveId(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <Link
        href={`/dashboard/events/${eventId}`}
        className="inline-flex items-center gap-2 text-sm text-on-dark-2 transition-colors hover:text-on-dark"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to event
      </Link>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-on-dark">
            Event team
          </h1>
          <p className="mt-1 text-on-dark-2">
            Who can work this event, and what they can see.
          </p>
        </div>
        {!showInvite && (
          <button
            onClick={() => setShowInvite(true)}
            className="inline-flex shrink-0 items-center gap-2 self-start rounded-lg bg-gold px-4 py-2.5 font-semibold text-canvas transition-colors hover:bg-gold-deep"
          >
            <UserPlus className="h-4 w-4" />
            Invite someone
          </button>
        )}
      </header>

      {notice && (
        <p className="rounded-lg border border-line-dark bg-surface px-4 py-3 text-sm text-sage">
          {notice}
        </p>
      )}
      {error && (
        <p className="rounded-lg border border-error/40 bg-error/10 px-4 py-3 text-sm text-error">
          {error}
        </p>
      )}
      {manualLink && (
        <div className="rounded-lg border border-line-dark bg-surface px-4 py-3">
          <p className="mb-2 text-sm text-on-dark-2">Invitation link</p>
          <code className="block overflow-x-auto whitespace-nowrap rounded bg-canvas px-3 py-2 text-sm text-gold">
            {manualLink}
          </code>
        </div>
      )}

      {showInvite && (
        <form
          onSubmit={invite}
          className="space-y-4 rounded-2xl border border-line-dark bg-surface p-6"
        >
          <div>
            <label className="mb-1 block text-sm font-medium text-on-dark-2">
              Email address
            </label>
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="them@example.com"
              className="w-full rounded-lg border border-line-dark bg-canvas px-3 py-2 text-on-dark placeholder:text-on-dark-3 focus:outline-none focus:ring-2 focus:ring-gold"
            />
          </div>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-on-dark-2">
              What can they do?
            </legend>
            <div className="space-y-2">
              {ASSIGNABLE_ROLES.map((role) => (
                <label
                  key={role}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                    inviteRole === role
                      ? 'border-gold bg-surface-2'
                      : 'border-line-dark hover:border-on-dark-3'
                  }`}
                >
                  <input
                    type="radio"
                    name="role"
                    value={role}
                    checked={inviteRole === role}
                    onChange={() => {
                      setInviteRole(role);
                      setInviteFinances(false);
                    }}
                    className="mt-1 accent-[#E3B341]"
                  />
                  <span>
                    <span className="block font-semibold text-on-dark">
                      {ROLE_LABELS[role]}
                    </span>
                    <span className="block text-sm text-on-dark-2">
                      {ROLE_DESCRIPTIONS[role]}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* The second question, asked separately because it is a separate
              question. Only offered for roles it means anything on — a
              scanner or a promoter can never hold it. */}
          {supportsFinanceSwitch(inviteRole) && (
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line-dark p-3">
              <input
                type="checkbox"
                checked={inviteFinances}
                onChange={(e) => setInviteFinances(e.target.checked)}
                className="mt-1 accent-[#E3B341]"
              />
              <span>
                <span className="block font-semibold text-on-dark">
                  Can see finances
                </span>
                <span className="block text-sm text-on-dark-2">
                  Revenue and payouts. Off means counts only — tickets sold,
                  people checked in. Doesn&apos;t let them issue refunds.
                </span>
              </span>
            </label>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-gold px-4 py-2 font-semibold text-canvas transition-colors hover:bg-gold-deep disabled:opacity-60"
            >
              {busy ? 'Sending…' : 'Send invitation'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowInvite(false);
                setError(null);
              }}
              className="rounded-lg px-3 py-2 text-sm font-medium text-on-dark-2 transition-colors hover:text-on-dark"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <section className="rounded-2xl border border-line-dark bg-surface">
        <div className="flex items-center gap-3 border-b border-line-dark px-6 py-4">
          <Crown className="h-4 w-4 text-gold" />
          <p className="text-sm text-on-dark-2">
            As the organization owner you always have full access to this
            event — you don&apos;t appear in the list below.
          </p>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="space-y-3">
              {[0, 1].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-xl bg-canvas" />
              ))}
            </div>
          ) : staff.length === 0 ? (
            <div className="py-8 text-center">
              <Mail className="mx-auto mb-3 h-8 w-8 text-on-dark-3" />
              <p className="font-medium text-on-dark">No one else yet</p>
              <p className="mt-1 text-sm text-on-dark-2">
                Invite the people working the gate, or handling the money.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {staff.map((member) => (
                <li
                  key={member.id}
                  className="rounded-xl border border-line-dark bg-canvas p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-on-dark">
                          {member.name || member.email}
                        </p>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            roleChip[member.role] ?? roleChip.gate_staff
                          }`}
                        >
                          {ROLE_LABELS[member.role]}
                        </span>
                        {member.status === 'pending' && (
                          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-on-dark-2">
                            Invite pending
                          </span>
                        )}
                        {/* Shown here so the organiser can read a code back
                            to someone who has lost their link, without
                            having to sign in as them. */}
                        {member.canSeeFinances && (
                          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
                            Sees finances
                          </span>
                        )}
                        {member.refCode && (
                          <span className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-xs text-on-dark-2">
                            {member.refCode}
                          </span>
                        )}
                      </div>
                      {member.name && (
                        <p className="mt-0.5 truncate text-sm text-on-dark-2">
                          {member.email}
                        </p>
                      )}
                      <p className="mt-1 text-sm text-on-dark-3">
                        {ROLE_DESCRIPTIONS[member.role]}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <select
                        value={member.role}
                        disabled={busy}
                        onChange={(e) =>
                          changeRole(member.id, e.target.value as OrgRole)
                        }
                        className="rounded-lg border border-line-dark bg-surface px-2.5 py-1.5 text-sm text-on-dark focus:outline-none focus:ring-2 focus:ring-gold"
                      >
                        {ASSIGNABLE_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => setConfirmRemoveId(member.id)}
                        title="Remove from event"
                        className="rounded-lg p-2 text-on-dark-2 transition-colors hover:bg-error/15 hover:text-error"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {confirmRemoveId === member.id && (
                    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-error/40 bg-error/10 px-4 py-3">
                      <p className="text-sm text-on-dark">
                        Remove <strong>{member.name || member.email}</strong>{' '}
                        from this event?
                      </p>
                      <div className="ml-auto flex items-center gap-2">
                        <button
                          onClick={() => remove(member.id)}
                          disabled={busy}
                          className="rounded-lg bg-error px-3 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                        >
                          {busy ? 'Removing…' : 'Remove'}
                        </button>
                        <button
                          onClick={() => setConfirmRemoveId(null)}
                          className="rounded-lg p-1.5 text-on-dark-2 transition-colors hover:text-on-dark"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
