'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Crown, Mail, Trash2, UserPlus, X } from 'lucide-react';
import {
  ASSIGNABLE_ROLES,
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
}

const roleChip: Record<string, string> = {
  owner: 'bg-gold/20 text-gold',
  event_manager: 'bg-success/25 text-sage',
  gate_staff: 'bg-info/20 text-info',
  finance: 'bg-warning/15 text-warning',
};

export default function TeamPage() {
  const routeParams = useParams();
  const eventId = routeParams.eventId as string;

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('gate_staff');
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
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not send that invitation.');
        return;
      }
      setNotice(`Invitation sent to ${inviteEmail}.`);
      setInviteEmail('');
      setShowInvite(false);
      await load();
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
                    onChange={() => setInviteRole(role)}
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
