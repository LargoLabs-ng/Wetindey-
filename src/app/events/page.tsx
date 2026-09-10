'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ChevronDown, Calendar, MapPin, Ticket } from 'lucide-react';

interface Event {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  coverImage: string | null;
  category: string | null;
  venueName: string | null;
  venueAddress: string | null;
  city: string | null;
  startDatetime: string;
  endDatetime: string;
  status: string;
  ticketTypes: Array<{
    id: string;
    price: string;
    quantityTotal: number;
    quantitySold: number;
    quantityReserved: number;
  }>;
}

export default function EventsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'upcoming' | 'past'>('upcoming');

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        setLoading(true);
        const response = await fetch('/api/events');
        if (!response.ok) throw new Error('Failed to fetch events');
        const data = await response.json();
        setEvents(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load events');
        setEvents([]);
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
  }, []);

  const filteredEvents = events.filter((event) => {
    const eventDate = new Date(event.startDatetime);
    const now = new Date();

    if (filter === 'upcoming') return eventDate > now;
    if (filter === 'past') return eventDate <= now;
    return true;
  });

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-NG', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatPrice = (price: string) => {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      minimumFractionDigits: 0,
    }).format(parseFloat(price));
  };

  const getTicketStatus = (ticketType: Event['ticketTypes'][0]) => {
    const available = Math.max(0, ticketType.quantityTotal - ticketType.quantitySold - ticketType.quantityReserved);
    if (available === 0) return { text: 'Sold Out', color: 'bg-red-500' };
    if (available < 10) return { text: `${available} left`, color: 'bg-yellow-500' };
    return { text: 'Available', color: 'bg-green-500' };
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-ivory)' }}>
      {/* Header */}
      <header className="sticky top-0 z-40 border-b" style={{ borderColor: 'var(--color-stone-mid)' }}>
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <Image src="/logo.png" alt="Ticket Buddy" width={40} height={40} className="h-10 w-10" />
              <span className="font-bold" style={{ color: 'var(--color-forest)' }}>
                Ticket Buddy
              </span>
            </Link>
            <nav className="flex items-center gap-6">
              <Link href="/" className="text-sm hover:opacity-75">
                Home
              </Link>
              <Link href="/events" className="text-sm font-semibold" style={{ color: 'var(--color-forest)' }}>
                Browse Events
              </Link>
              <Link
                href="/signup"
                className="rounded px-4 py-2 text-sm font-semibold text-white"
                style={{ backgroundColor: 'var(--color-forest)' }}
              >
                Create Event
              </Link>
            </nav>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="border-b" style={{ borderColor: 'var(--color-stone-mid)' }}>
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="text-center">
            <h1 className="text-4xl font-bold" style={{ color: 'var(--color-forest)' }}>
              Discover Events
            </h1>
            <p className="mt-2 text-lg" style={{ color: 'var(--color-stone)' }}>
              Find and book tickets to amazing events near you
            </p>
          </div>

          {/* Filter Tabs */}
          <div className="mt-8 flex justify-center gap-4">
            {(['all', 'upcoming', 'past'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setFilter(tab)}
                className={`rounded-full px-6 py-2 font-medium transition-all ${
                  filter === tab
                    ? 'text-white'
                    : 'border text-gray-700 hover:bg-opacity-5'
                }`}
                style={
                  filter === tab
                    ? { backgroundColor: 'var(--color-forest)' }
                    : { borderColor: 'var(--color-stone-mid)' }
                }
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Events Grid */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        {loading && (
          <div className="flex justify-center py-12">
            <div className="text-center">
              <div
                className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-gray-200"
                style={{ borderTopColor: 'var(--color-forest)' }}
              />
              <p className="mt-4" style={{ color: 'var(--color-stone)' }}>
                Loading events...
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-800">
            <p className="font-semibold">Failed to load events</p>
            <p className="text-sm">{error}</p>
          </div>
        )}

        {!loading && filteredEvents.length === 0 && !error && (
          <div className="text-center py-12">
            <Ticket className="mx-auto h-12 w-12 opacity-30" />
            <p className="mt-4 text-lg" style={{ color: 'var(--color-stone)' }}>
              No events found
            </p>
          </div>
        )}

        {!loading && filteredEvents.length > 0 && (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {filteredEvents.map((event) => {
              const minPrice =
                event.ticketTypes.length > 0
                  ? Math.min(...event.ticketTypes.map((t) => parseFloat(t.price)))
                  : 0;
              const minTicket = event.ticketTypes[0];
              const ticketStatus = minTicket ? getTicketStatus(minTicket) : null;

              return (
                <Link key={event.id} href={`/events/${event.slug}`}>
                  <div className="group flex flex-col overflow-hidden rounded-lg border transition-all hover:shadow-lg" style={{ borderColor: 'var(--color-stone-mid)' }}>
                    {/* Image */}
                    <div className="relative h-48 overflow-hidden bg-gray-200">
                      {event.coverImage ? (
                        <Image
                          src={event.coverImage}
                          alt={event.title}
                          fill
                          className="object-cover transition-transform group-hover:scale-105"
                        />
                      ) : (
                        <div
                          className="flex h-full items-center justify-center"
                          style={{ backgroundColor: 'var(--color-sage-light)' }}
                        >
                          <Ticket className="h-12 w-12 opacity-20" />
                        </div>
                      )}

                      {/* Ticket Status Badge */}
                      {ticketStatus && (
                        <div
                          className={`absolute right-3 top-3 rounded-full px-3 py-1 text-xs font-semibold text-white ${ticketStatus.color}`}
                        >
                          {ticketStatus.text}
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex flex-1 flex-col p-4">
                      {event.category && (
                        <span
                          className="text-xs font-semibold uppercase tracking-wider"
                          style={{ color: 'var(--color-sage)' }}
                        >
                          {event.category}
                        </span>
                      )}

                      <h3 className="mt-2 line-clamp-2 text-lg font-bold" style={{ color: 'var(--color-forest)' }}>
                        {event.title}
                      </h3>

                      {event.description && (
                        <p className="mt-1 line-clamp-2 text-sm" style={{ color: 'var(--color-stone)' }}>
                          {event.description}
                        </p>
                      )}

                      <div className="mt-3 space-y-2 text-sm" style={{ color: 'var(--color-stone-mid)' }}>
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4" />
                          <span>{formatDate(event.startDatetime)}</span>
                        </div>
                        {event.venueName && (
                          <div className="flex items-center gap-2">
                            <MapPin className="h-4 w-4" />
                            <span className="truncate">{event.venueName}</span>
                          </div>
                        )}
                      </div>

                      <div className="mt-auto flex items-end justify-between border-t pt-3" style={{ borderColor: 'var(--color-stone-mid)' }}>
                        <div>
                          <p className="text-xs" style={{ color: 'var(--color-stone)' }}>
                            Starting from
                          </p>
                          <p className="text-lg font-bold" style={{ color: 'var(--color-forest)' }}>
                            {formatPrice(minPrice.toString())}
                          </p>
                        </div>
                        <ChevronDown className="h-5 w-5 rotate-90" style={{ color: 'var(--color-sage)' }} />
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Footer */}
      <footer
        className="border-t"
        style={{
          borderColor: 'var(--color-stone-mid)',
          backgroundColor: 'var(--color-forest)',
        }}
      >
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between text-white">
            <div className="flex items-center gap-2">
              <Image src="/logo-reversed.png" alt="Ticket Buddy" width={40} height={40} className="h-10 w-10" />
              <span className="font-bold">Ticket Buddy</span>
            </div>
            <p className="text-sm opacity-75">© 2026 Ticket Buddy. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
