'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Search, Filter, Eye, MoreVertical } from 'lucide-react';

interface EventData {
  id: string;
  title: string;
  organizer: string;
  organizerEmail: string;
  status: string;
  startDatetime: string;
  endDatetime: string;
  venue: string;
  metrics: {
    ticketsSold: number;
    checkedIn: number;
    totalRevenue: number;
    ticketTypes: number;
  };
}

export default function AdminEventsPage() {
  const [events, setEvents] = useState<EventData[]>([]);
  const [filteredEvents, setFilteredEvents] = useState<EventData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedEvent, setSelectedEvent] = useState<EventData | null>(null);

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const response = await fetch('/api/admin/events');
        const data = await response.json();
        setEvents(data.events || []);
        setFilteredEvents(data.events || []);
      } catch (error) {
        console.error('Failed to fetch events:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
  }, []);

  useEffect(() => {
    let filtered = events;

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter((e) => e.status === statusFilter);
    }

    // Search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.title.toLowerCase().includes(query) ||
          e.organizer.toLowerCase().includes(query) ||
          e.organizerEmail.toLowerCase().includes(query)
      );
    }

    setFilteredEvents(filtered);
  }, [searchQuery, statusFilter, events]);

  const formatCurrency = (amount: number) => {
    return `₦${amount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-NG');
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-ivory)' }}>
      {/* Header */}
      <header className="border-b" style={{ borderColor: 'var(--color-stone-mid)' }}>
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <Link
              href="/admin"
              className="flex items-center gap-2 hover:opacity-75"
            >
              <ArrowLeft className="h-5 w-5" style={{ color: 'var(--color-forest)' }} />
              <span className="font-semibold" style={{ color: 'var(--color-forest)' }}>
                Back
              </span>
            </Link>
            <h1 className="text-xl font-bold" style={{ color: 'var(--color-forest)' }}>
              Event Management
            </h1>
            <div style={{ width: '120px' }}></div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Search & Filter */}
        <div className="mb-8 grid gap-4 sm:grid-cols-2">
          <div className="relative">
            <Search
              className="absolute left-3 top-3 h-5 w-5"
              style={{ color: 'var(--color-stone-mid)' }}
            />
            <input
              type="text"
              placeholder="Search by event, organizer, or email"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded border pl-10 pr-4 py-2"
              style={{ borderColor: 'var(--color-stone-mid)' }}
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter
              className="h-5 w-5"
              style={{ color: 'var(--color-stone-mid)' }}
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="flex-1 rounded border px-3 py-2"
              style={{ borderColor: 'var(--color-stone-mid)' }}
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        {/* Results Count */}
        <p className="mb-4 text-sm" style={{ color: 'var(--color-stone-mid)' }}>
          Showing {filteredEvents.length} of {events.length} events
        </p>

        {/* Events Table */}
        {loading ? (
          <div
            className="rounded-lg border p-8 text-center"
            style={{ borderColor: 'var(--color-stone-mid)', backgroundColor: 'white' }}
          >
            <p style={{ color: 'var(--color-stone)' }}>Loading events...</p>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div
            className="rounded-lg border p-8 text-center"
            style={{ borderColor: 'var(--color-stone-mid)', backgroundColor: 'white' }}
          >
            <p style={{ color: 'var(--color-stone)' }}>No events found</p>
          </div>
        ) : (
          <div
            className="rounded-lg border overflow-hidden"
            style={{ borderColor: 'var(--color-stone-mid)', backgroundColor: 'white' }}
          >
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ backgroundColor: 'var(--color-ivory)' }}>
                    <th
                      className="px-6 py-3 text-left text-sm font-semibold"
                      style={{ color: 'var(--color-stone)' }}
                    >
                      Event
                    </th>
                    <th
                      className="px-6 py-3 text-left text-sm font-semibold"
                      style={{ color: 'var(--color-stone)' }}
                    >
                      Organizer
                    </th>
                    <th
                      className="px-6 py-3 text-center text-sm font-semibold"
                      style={{ color: 'var(--color-stone)' }}
                    >
                      Status
                    </th>
                    <th
                      className="px-6 py-3 text-right text-sm font-semibold"
                      style={{ color: 'var(--color-stone)' }}
                    >
                      Tickets Sold
                    </th>
                    <th
                      className="px-6 py-3 text-right text-sm font-semibold"
                      style={{ color: 'var(--color-stone)' }}
                    >
                      Revenue
                    </th>
                    <th
                      className="px-6 py-3 text-center text-sm font-semibold"
                      style={{ color: 'var(--color-stone)' }}
                    >
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map((event, index) => (
                    <tr
                      key={event.id}
                      style={{
                        borderBottom:
                          index < filteredEvents.length - 1
                            ? `1px solid var(--color-stone-mid)`
                            : 'none',
                      }}
                    >
                      <td className="px-6 py-4">
                        <div>
                          <p
                            className="font-medium"
                            style={{ color: 'var(--color-forest)' }}
                          >
                            {event.title}
                          </p>
                          <p
                            className="text-xs mt-1"
                            style={{ color: 'var(--color-stone-mid)' }}
                          >
                            {formatDate(event.startDatetime)}
                          </p>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm" style={{ color: 'var(--color-stone)' }}>
                        <div>{event.organizer}</div>
                        <div
                          className="text-xs mt-1"
                          style={{ color: 'var(--color-stone-mid)' }}
                        >
                          {event.organizerEmail}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span
                          className="text-xs font-semibold px-2 py-1 rounded"
                          style={{
                            backgroundColor:
                              event.status === 'active'
                                ? 'rgba(18, 178, 120, 0.1)'
                                : 'rgba(156, 163, 175, 0.1)',
                            color:
                              event.status === 'active'
                                ? 'var(--color-sage)'
                                : 'var(--color-stone)',
                          }}
                        >
                          {event.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right text-sm" style={{ color: 'var(--color-stone)' }}>
                        {event.metrics.ticketsSold}
                      </td>
                      <td
                        className="px-6 py-4 text-right font-semibold"
                        style={{ color: 'var(--color-sage)' }}
                      >
                        {formatCurrency(event.metrics.totalRevenue)}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <button
                          onClick={() => setSelectedEvent(event)}
                          className="p-2 rounded hover:opacity-75 transition-opacity"
                          style={{ color: 'var(--color-forest)' }}
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Detail Modal */}
      {selectedEvent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
        >
          <div
            className="rounded-lg p-6 max-w-2xl w-full max-h-96 overflow-y-auto"
            style={{ backgroundColor: 'white' }}
          >
            <h2 className="text-xl font-bold mb-4" style={{ color: 'var(--color-forest)' }}>
              {selectedEvent.title}
            </h2>

            <div className="space-y-4 mb-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold" style={{ color: 'var(--color-stone-mid)' }}>
                    ORGANIZER
                  </p>
                  <p style={{ color: 'var(--color-stone)' }}>{selectedEvent.organizer}</p>
                  <p className="text-sm" style={{ color: 'var(--color-stone-mid)' }}>
                    {selectedEvent.organizerEmail}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold" style={{ color: 'var(--color-stone-mid)' }}>
                    STATUS
                  </p>
                  <span
                    className="text-sm px-2 py-1 rounded inline-block"
                    style={{
                      backgroundColor:
                        selectedEvent.status === 'active'
                          ? 'rgba(18, 178, 120, 0.1)'
                          : 'rgba(156, 163, 175, 0.1)',
                      color:
                        selectedEvent.status === 'active'
                          ? 'var(--color-sage)'
                          : 'var(--color-stone)',
                    }}
                  >
                    {selectedEvent.status}
                  </span>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold" style={{ color: 'var(--color-stone-mid)' }}>
                  VENUE
                </p>
                <p style={{ color: 'var(--color-stone)' }}>{selectedEvent.venue}</p>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xs font-semibold" style={{ color: 'var(--color-stone-mid)' }}>
                    TICKETS SOLD
                  </p>
                  <p className="text-2xl font-bold" style={{ color: 'var(--color-forest)' }}>
                    {selectedEvent.metrics.ticketsSold}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold" style={{ color: 'var(--color-stone-mid)' }}>
                    CHECKED IN
                  </p>
                  <p className="text-2xl font-bold" style={{ color: 'var(--color-sage)' }}>
                    {selectedEvent.metrics.checkedIn}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold" style={{ color: 'var(--color-stone-mid)' }}>
                    REVENUE
                  </p>
                  <p className="text-xl font-bold" style={{ color: 'var(--color-sage)' }}>
                    {formatCurrency(selectedEvent.metrics.totalRevenue)}
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={() => setSelectedEvent(null)}
              className="w-full rounded px-4 py-2 font-semibold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--color-forest)' }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
