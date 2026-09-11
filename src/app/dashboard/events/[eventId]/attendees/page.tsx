'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Download, Search, Filter, Eye, ArrowLeft, Undo2, X } from 'lucide-react';

interface Attendee {
  id: string;
  name: string;
  email: string;
  ticketType: string;
  status: 'valid' | 'checked_in' | 'pending' | 'cancelled';
  purchaseTime: string;
  checkedInAt?: string;
  ticketId: string;
}

export default function AttendeesPage() {
  const routeParams = useParams();
  const eventId = routeParams.eventId as string;
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [filteredAttendees, setFilteredAttendees] = useState<Attendee[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedAttendee, setSelectedAttendee] = useState<Attendee | null>(null);
  const [exporting, setExporting] = useState(false);
  const [eventTitle, setEventTitle] = useState('');
  const [canRefund, setCanRefund] = useState(false);
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const [refundBusy, setRefundBusy] = useState(false);
  const [refundNote, setRefundNote] = useState<string | null>(null);

  // Fetch attendees
  useEffect(() => {
    const fetchAttendees = async () => {
      try {
        const response = await fetch(
          `/api/dashboard/attendees?eventId=${eventId}`
        );
        const data = await response.json();

        setAttendees(data.attendees || []);
        setEventTitle(data.eventTitle || 'Event');
        setCanRefund(Boolean(data.canRefund));
        setFilteredAttendees(data.attendees || []);
      } catch (error) {
        console.error('Failed to fetch attendees:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAttendees();
  }, [eventId]);

  const issueRefund = async (ticketId: string) => {
    setRefundBusy(true);
    setRefundNote(null);
    try {
      const response = await fetch(`/api/tickets/${ticketId}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: refundReason.trim() || undefined }),
      });
      const data = await response.json();
      if (!response.ok) {
        setRefundNote(data.error || 'The refund could not be completed.');
        return;
      }
      setRefundNote(
        `Refunded \u20a6${Number(data.amount).toLocaleString('en-NG')}.` +
          (data.emailSent
            ? ' The attendee has been emailed.'
            : " We couldn't email the attendee — tell them yourself.")
      );
      setRefundingId(null);
      setRefundReason('');
      // Re-read so the status badge and the seat count are truthful.
      const refreshed = await fetch(
        `/api/dashboard/attendees?eventId=${eventId}`
      ).then((r) => r.json());
      setAttendees(refreshed.attendees || []);
      setFilteredAttendees(refreshed.attendees || []);
    } catch {
      setRefundNote('Network error — try again.');
    } finally {
      setRefundBusy(false);
    }
  };

  // Filter and search
  useEffect(() => {
    let filtered = attendees;

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter((a) => a.status === statusFilter);
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (a) =>
          a.name.toLowerCase().includes(query) ||
          a.email.toLowerCase().includes(query) ||
          a.ticketId.toLowerCase().includes(query)
      );
    }

    setFilteredAttendees(filtered);
  }, [searchQuery, statusFilter, attendees]);

  // Export CSV
  const handleExportCSV = async () => {
    setExporting(true);
    try {
      const response = await fetch(
        `/api/dashboard/attendees/export?eventId=${eventId}`
      );
      const blob = await response.blob();

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attendees-${eventTitle.replace(/\s+/g, '-')}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export:', error);
    } finally {
      setExporting(false);
    }
  };

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'checked_in':
        return { bg: 'rgba(18, 178, 120, 0.1)', text: 'var(--color-sage)' };
      case 'valid':
        return { bg: 'rgba(59, 130, 246, 0.1)', text: '#3b82f6' };
      case 'pending':
        return { bg: 'rgba(251, 191, 36, 0.1)', text: '#f59e0b' };
      case 'cancelled':
        return { bg: 'rgba(239, 68, 68, 0.1)', text: '#ef4444' };
      default:
        return { bg: 'var(--color-surface-2)', text: 'var(--color-on-dark-2)' };
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'checked_in':
        return '✓ Checked In';
      case 'valid':
        return 'Valid';
      case 'pending':
        return 'Pending';
      case 'cancelled':
        return 'Cancelled';
      default:
        return status;
    }
  };

  return (
    <div>
      {/* Header */}
      <header className="mb-6">
        <div className="">
          <div className="flex items-center justify-between">
            <Link
              href={`/dashboard`}
              className="flex items-center gap-2 hover:opacity-75"
            >
              <ArrowLeft className="h-5 w-5" style={{ color: 'var(--color-on-dark)' }} />
              <span className="font-semibold" style={{ color: 'var(--color-on-dark)' }}>
                Back
              </span>
            </Link>
            <h1 className="text-xl font-bold" style={{ color: 'var(--color-on-dark)' }}>
              Attendees
            </h1>
            <button
              onClick={handleExportCSV}
              disabled={exporting}
              className="flex items-center gap-2 rounded px-4 py-2 text-sm font-semibold text-canvas transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-gold)' }}
            >
              <Download className="h-4 w-4" />
              {exporting ? 'Exporting...' : 'Export CSV'}
            </button>
          </div>
        </div>
      </header>

      <div className="">
        {/* Search & Filter */}
        <div className="mb-8 grid gap-4 sm:grid-cols-2">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-5 w-5" style={{ color: 'var(--color-on-dark-3)' }} />
            <input
              type="text"
              placeholder="Search by name, email, or ticket ID"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded border pl-10 pr-4 py-2"
              style={{ borderColor: 'var(--color-line-dark)' }}
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="h-5 w-5" style={{ color: 'var(--color-on-dark-3)' }} />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="flex-1 rounded border px-3 py-2"
              style={{ borderColor: 'var(--color-line-dark)' }}
            >
              <option value="all">All Status</option>
              <option value="checked_in">Checked In</option>
              <option value="valid">Valid</option>
              <option value="pending">Pending</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        {/* Results Count */}
        <p className="mb-4 text-sm" style={{ color: 'var(--color-on-dark-3)' }}>
          Showing {filteredAttendees.length} of {attendees.length} attendees
        </p>
        {refundNote && (
          <p
            className="mb-4 rounded-lg px-4 py-3 text-sm"
            style={{
              border: '1px solid var(--color-line-dark)',
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-on-dark)',
            }}
          >
            {refundNote}
          </p>
        )}

        {refundingId && (() => {
          const target = attendees.find((a) => a.id === refundingId);
          if (!target) return null;
          return (
            <div
              className="mb-4 rounded-lg p-5"
              style={{
                border: '1px solid rgba(239, 68, 68, 0.4)',
                backgroundColor: 'rgba(239, 68, 68, 0.08)',
              }}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-semibold" style={{ color: 'var(--color-on-dark)' }}>
                    Refund {target.name}&apos;s ticket?
                  </p>
                  <p className="mt-1 text-sm" style={{ color: 'var(--color-on-dark-2)' }}>
                    The ticket price goes back to the card they paid with and
                    the ticket stops working at the door. Your 3% service fee
                    is kept. Paystack does not return its processing fee on a
                    refund, so that part is a cost to you. This cannot be
                    undone.
                  </p>
                </div>
                <button
                  onClick={() => setRefundingId(null)}
                  style={{ color: 'var(--color-on-dark-2)' }}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <input
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder="Reason (optional) — shown to the attendee"
                className="mt-4 w-full rounded px-3 py-2 text-sm"
                style={{
                  border: '1px solid var(--color-line-dark)',
                  backgroundColor: 'var(--color-canvas)',
                  color: 'var(--color-on-dark)',
                }}
              />

              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={() => issueRefund(refundingId)}
                  disabled={refundBusy}
                  className="rounded px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                  style={{ backgroundColor: 'var(--color-error)' }}
                >
                  {refundBusy ? 'Refunding\u2026' : 'Refund this ticket'}
                </button>
                <button
                  onClick={() => setRefundingId(null)}
                  className="text-sm"
                  style={{ color: 'var(--color-on-dark-2)' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          );
        })()}


        {loading ? (
          <div className="rounded-lg border p-8 text-center" style={{ borderColor: 'var(--color-line-dark)', backgroundColor: 'var(--color-surface)' }}>
            <p style={{ color: 'var(--color-on-dark-2)' }}>Loading attendees...</p>
          </div>
        ) : filteredAttendees.length === 0 ? (
          <div className="rounded-lg border p-8 text-center" style={{ borderColor: 'var(--color-line-dark)', backgroundColor: 'var(--color-surface)' }}>
            <p style={{ color: 'var(--color-on-dark-2)' }}>No attendees found</p>
          </div>
        ) : (
          <div className="rounded-lg border" style={{ borderColor: 'var(--color-line-dark)', backgroundColor: 'var(--color-surface)' }}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ backgroundColor: 'var(--color-canvas)' }}>
                    <th className="px-6 py-3 text-left text-sm font-semibold" style={{ color: 'var(--color-on-dark-2)' }}>
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold" style={{ color: 'var(--color-on-dark-2)' }}>
                      Email
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold" style={{ color: 'var(--color-on-dark-2)' }}>
                      Ticket Type
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold" style={{ color: 'var(--color-on-dark-2)' }}>
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-sm font-semibold" style={{ color: 'var(--color-on-dark-2)' }}>
                      Purchased
                    </th>
                    <th className="px-6 py-3 text-center text-sm font-semibold" style={{ color: 'var(--color-on-dark-2)' }}>
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAttendees.map((attendee, index) => {
                    const statusColor = getStatusBadgeColor(attendee.status);
                    return (
                      <tr
                        key={attendee.id}
                        style={{
                          borderBottom: index < filteredAttendees.length - 1 ? `1px solid var(--color-line-dark)` : 'none',
                        }}
                      >
                        <td className="px-6 py-4 font-medium" style={{ color: 'var(--color-on-dark)' }}>
                          {attendee.name}
                        </td>
                        <td className="px-6 py-4 text-sm" style={{ color: 'var(--color-on-dark-2)' }}>
                          {attendee.email}
                        </td>
                        <td className="px-6 py-4 text-sm" style={{ color: 'var(--color-on-dark-2)' }}>
                          {attendee.ticketType}
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className="inline-block rounded px-3 py-1 text-xs font-semibold"
                            style={{ backgroundColor: statusColor.bg, color: statusColor.text }}
                          >
                            {getStatusLabel(attendee.status)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm" style={{ color: 'var(--color-on-dark-2)' }}>
                          {new Date(attendee.purchaseTime).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 text-center whitespace-nowrap">
                          <button
                            onClick={() => setSelectedAttendee(attendee)}
                            title="View details"
                            className="inline-flex items-center gap-1 rounded px-3 py-1 text-sm transition-opacity hover:opacity-75"
                            style={{ color: 'var(--color-on-dark)' }}
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          {canRefund &&
                            (attendee.status === 'valid' ||
                              attendee.status === 'checked_in') && (
                              <button
                                onClick={() => {
                                  setRefundingId(attendee.id);
                                  setRefundReason('');
                                  setRefundNote(null);
                                }}
                                title="Refund this ticket"
                                className="inline-flex items-center gap-1 rounded px-3 py-1 text-sm transition-opacity hover:opacity-75"
                                style={{ color: 'var(--color-gold)' }}
                              >
                                <Undo2 className="h-4 w-4" />
                              </button>
                            )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedAttendee && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
        >
          <div
            className="rounded-lg p-6 max-w-md w-full"
            style={{ backgroundColor: 'var(--color-surface)' }}
          >
            <h2 className="text-xl font-bold mb-4" style={{ color: 'var(--color-on-dark)' }}>
              {selectedAttendee.name}
            </h2>

            <div className="space-y-3 mb-6">
              <div>
                <p className="text-xs font-semibold" style={{ color: 'var(--color-on-dark-3)' }}>
                  EMAIL
                </p>
                <p style={{ color: 'var(--color-on-dark-2)' }}>{selectedAttendee.email}</p>
              </div>

              <div>
                <p className="text-xs font-semibold" style={{ color: 'var(--color-on-dark-3)' }}>
                  TICKET TYPE
                </p>
                <p style={{ color: 'var(--color-on-dark-2)' }}>{selectedAttendee.ticketType}</p>
              </div>

              <div>
                <p className="text-xs font-semibold" style={{ color: 'var(--color-on-dark-3)' }}>
                  STATUS
                </p>
                <span
                  className="inline-block rounded px-3 py-1 text-xs font-semibold"
                  style={{
                    backgroundColor: getStatusBadgeColor(selectedAttendee.status).bg,
                    color: getStatusBadgeColor(selectedAttendee.status).text,
                  }}
                >
                  {getStatusLabel(selectedAttendee.status)}
                </span>
              </div>

              <div>
                <p className="text-xs font-semibold" style={{ color: 'var(--color-on-dark-3)' }}>
                  PURCHASED
                </p>
                <p style={{ color: 'var(--color-on-dark-2)' }}>
                  {new Date(selectedAttendee.purchaseTime).toLocaleString()}
                </p>
              </div>

              {selectedAttendee.checkedInAt && (
                <div>
                  <p className="text-xs font-semibold" style={{ color: 'var(--color-on-dark-3)' }}>
                    CHECKED IN
                  </p>
                  <p style={{ color: 'var(--color-on-dark-2)' }}>
                    {new Date(selectedAttendee.checkedInAt).toLocaleString()}
                  </p>
                </div>
              )}

              <div>
                <p className="text-xs font-semibold" style={{ color: 'var(--color-on-dark-3)' }}>
                  TICKET ID
                </p>
                <p className="font-mono text-xs" style={{ color: 'var(--color-on-dark-2)' }}>
                  {selectedAttendee.ticketId.slice(0, 8)}...
                </p>
              </div>
            </div>

            <button
              onClick={() => setSelectedAttendee(null)}
              className="w-full rounded px-4 py-2 font-semibold text-canvas transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--color-gold)' }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
