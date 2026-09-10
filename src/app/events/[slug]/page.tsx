'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft, Calendar, MapPin, Users, Clock, QrCode } from 'lucide-react';
import { useParams } from 'next/navigation';

interface TicketType {
  id: string;
  name: string;
  description: string | null;
  price: string;
  quantityTotal: number;
  quantitySold: number;
  quantityReserved: number;
  maxPerOrder: number;
  status: string;
}

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
  country: string | null;
  startDatetime: string;
  endDatetime: string;
  ticketTypes: TicketType[];
}

export default function EventDetailPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [buyerName, setBuyerName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [buyerEmail, setBuyerEmail] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [attendees, setAttendees] = useState<Array<{ name: string; email: string }>>([]);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    const fetchEvent = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/events/slug/${slug}`);
        if (!response.ok) throw new Error('Event not found');
        const data = await response.json();
        setEvent(data);
        if (data.ticketTypes.length > 0) {
          setSelectedTicket(data.ticketTypes[0].id);
        }
        setAttendees(Array(1).fill({ name: '', email: '' }));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load event');
      } finally {
        setLoading(false);
      }
    };

    if (slug) fetchEvent();
  }, [slug]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-NG', {
      weekday: 'long',
      month: 'long',
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

  const selectedTicketType = event?.ticketTypes.find((t) => t.id === selectedTicket);
  const available = selectedTicketType
    ? Math.max(0, selectedTicketType.quantityTotal - selectedTicketType.quantitySold - selectedTicketType.quantityReserved)
    : 0;

  // The <select> shows the first tier from the start, so the state has to
  // agree with it — otherwise nothing is really selected and checkout is
  // dead on arrival.
  useEffect(() => {
    if (!selectedTicket && event?.ticketTypes.length) {
      setSelectedTicket(event.ticketTypes[0].id);
    }
  }, [event, selectedTicket]);

  // attendees must always be exactly `quantity` long: the API rejects the
  // order otherwise, and previously buying a single ticket sent an empty
  // array because only the quantity input ever populated it.
  useEffect(() => {
    setAttendees((current) => {
      const next = [...current];
      while (next.length < quantity) next.push({ name: '', email: '' });
      return next.slice(0, quantity);
    });
  }, [quantity]);

  const handleQuantityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value);
    if (value > 0 && value <= Math.min(available, selectedTicketType?.maxPerOrder || 10)) {
      setQuantity(value);
    }
  };

  const updateAttendee = (index: number, field: 'name' | 'email', value: string) => {
    const newAttendees = [...attendees];
    newAttendees[index] = { ...newAttendees[index], [field]: value };
    setAttendees(newAttendees);
  };

  const handleCheckout = async () => {
    if (!selectedTicketType || !event) return;

    setFormError(null);

    if (!buyerName.trim() || !buyerEmail.trim() || !buyerPhone.trim()) {
      setFormError('Please enter your name, email and phone number.');
      return;
    }

    // Ticket 1 belongs to the buyer unless they said otherwise; any extra
    // tickets need their own holder.
    const resolvedAttendees = Array.from({ length: quantity }, (_, i) => ({
      name: attendees[i]?.name?.trim() || (i === 0 ? buyerName.trim() : ''),
      email: attendees[i]?.email?.trim() || (i === 0 ? buyerEmail.trim() : ''),
    }));

    if (resolvedAttendees.some((a) => !a.name || !a.email)) {
      setFormError('Please enter a name and email for every attendee.');
      return;
    }

    try {
      setProcessing(true);

      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: event.id,
          ticketTypeId: selectedTicketType.id,
          quantity,
          buyerEmail,
          buyerPhone,
          attendees: resolvedAttendees,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create order');
      }

      const { paymentUrl } = await response.json();
      window.location.href = paymentUrl;
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Failed to process checkout'
      );
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ backgroundColor: 'var(--color-ivory)' }}>
        <div className="text-center">
          <div
            className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-gray-200"
            style={{ borderTopColor: 'var(--color-forest)' }}
          />
          <p className="mt-4" style={{ color: 'var(--color-stone)' }}>
            Loading event details...
          </p>
        </div>
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: 'var(--color-ivory)' }}>
        <div className="mx-auto max-w-4xl px-4 py-12">
          <Link href="/events" className="inline-flex items-center gap-2" style={{ color: 'var(--color-forest)' }}>
            <ArrowLeft className="h-5 w-5" />
            Back to Events
          </Link>
          <div className="mt-8 rounded-lg border border-red-300 bg-red-50 p-6 text-red-800">
            <p className="font-semibold">Event not found</p>
            <p className="text-sm">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-ivory)' }}>
      <header className="border-b" style={{ borderColor: 'var(--color-stone-mid)' }}>
        <div className="mx-auto max-w-4xl px-4 py-4 sm:px-6">
          <Link href="/events" className="inline-flex items-center gap-2" style={{ color: 'var(--color-forest)' }}>
            <ArrowLeft className="h-5 w-5" />
            Back to Events
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="overflow-hidden rounded-lg border" style={{ borderColor: 'var(--color-stone-mid)' }}>
          <div className="relative h-96 w-full bg-gray-200">
            {event.coverImage ? (
              <Image src={event.coverImage} alt={event.title} fill className="object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center" style={{ backgroundColor: 'var(--color-sage-light)' }}>
                <QrCode className="h-16 w-16 opacity-20" />
              </div>
            )}
          </div>
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-3">
          <div className="lg:col-span-2">
            {event.category && (
              <span
                className="inline-block text-xs font-semibold uppercase tracking-wider"
                style={{ color: 'var(--color-sage)' }}
              >
                {event.category}
              </span>
            )}

            <h1 className="mt-2 text-4xl font-bold" style={{ color: 'var(--color-forest)' }}>
              {event.title}
            </h1>

            {event.description && (
              <p className="mt-4 text-lg" style={{ color: 'var(--color-stone)' }}>
                {event.description}
              </p>
            )}

            <div className="mt-8 space-y-4 border-t pt-8" style={{ borderColor: 'var(--color-stone-mid)' }}>
              <div className="flex gap-4">
                <Calendar className="h-5 w-5 flex-shrink-0" style={{ color: 'var(--color-forest)' }} />
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-stone)' }}>
                    Date & Time
                  </p>
                  <p className="mt-1" style={{ color: 'var(--color-stone)' }}>
                    {formatDate(event.startDatetime)}
                  </p>
                </div>
              </div>

              {event.venueName && (
                <div className="flex gap-4">
                  <MapPin className="h-5 w-5 flex-shrink-0" style={{ color: 'var(--color-forest)' }} />
                  <div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--color-stone)' }}>
                      Venue
                    </p>
                    <p className="mt-1" style={{ color: 'var(--color-stone)' }}>
                      {event.venueName}
                    </p>
                    {event.venueAddress && (
                      <p className="mt-1 text-sm" style={{ color: 'var(--color-stone-mid)' }}>
                        {event.venueAddress}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {event.ticketTypes.length > 0 && (
                <div className="flex gap-4">
                  <Users className="h-5 w-5 flex-shrink-0" style={{ color: 'var(--color-forest)' }} />
                  <div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--color-stone)' }}>
                      Ticket Types
                    </p>
                    <p className="mt-1" style={{ color: 'var(--color-stone)' }}>
                      {event.ticketTypes.length} type{event.ticketTypes.length !== 1 ? 's' : ''} available
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border p-6" style={{ borderColor: 'var(--color-stone-mid)', backgroundColor: 'white' }}>
            <h2 className="text-2xl font-bold" style={{ color: 'var(--color-forest)' }}>
              Get Tickets
            </h2>

            {event.ticketTypes.length === 0 ? (
              <p className="mt-4" style={{ color: 'var(--color-stone)' }}>
                No tickets available yet
              </p>
            ) : (
              <div className="mt-6 space-y-4">
                <div>
                  <label className="block text-sm font-semibold" style={{ color: 'var(--color-forest)' }}>
                    Ticket Type
                  </label>
                  <select
                    value={selectedTicket || ''}
                    onChange={(e) => setSelectedTicket(e.target.value)}
                    className="mt-2 w-full rounded border px-3 py-2"
                    style={{ borderColor: 'var(--color-stone-mid)' }}
                  >
                    {event.ticketTypes.map((type) => {
                      const available = Math.max(0, type.quantityTotal - type.quantitySold - type.quantityReserved);
                      return (
                        <option key={type.id} value={type.id}>
                          {type.name} - {formatPrice(type.price)} ({available} available)
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold" style={{ color: 'var(--color-forest)' }}>
                    Quantity
                  </label>
                  <input
                    type="number"
                    min="1"
                    max={Math.min(available, selectedTicketType?.maxPerOrder || 10)}
                    value={quantity}
                    onChange={handleQuantityChange}
                    className="mt-2 w-full rounded border px-3 py-2"
                    style={{ borderColor: 'var(--color-stone-mid)' }}
                  />
                  <p className="mt-1 text-xs" style={{ color: 'var(--color-stone-mid)' }}>
                    {available} tickets available
                  </p>
                </div>

                <div className="border-t pt-4" style={{ borderColor: 'var(--color-stone-mid)' }}>
                  <div className="flex justify-between text-sm">
                    <span style={{ color: 'var(--color-stone)' }}>Subtotal</span>
                    <span style={{ color: 'var(--color-stone)' }}>
                      {formatPrice((parseFloat(selectedTicketType?.price || '0') * quantity).toString())}
                    </span>
                  </div>
                  <div className="mt-2 flex justify-between text-sm">
                    <span style={{ color: 'var(--color-stone)' }}>Processing Fee</span>
                    <span style={{ color: 'var(--color-stone)' }}>Calculated at checkout</span>
                  </div>
                  <div className="mt-4 border-t pt-4 flex justify-between font-bold" style={{ borderColor: 'var(--color-stone-mid)' }}>
                    <span style={{ color: 'var(--color-forest)' }}>Total</span>
                    <span style={{ color: 'var(--color-forest)' }}>
                      {formatPrice((parseFloat(selectedTicketType?.price || '0') * quantity).toString())}*
                    </span>
                  </div>
                  <p className="mt-2 text-xs" style={{ color: 'var(--color-stone-mid)' }}>
                    *Final total shown at payment
                  </p>
                </div>
              </div>
            )}

            <button
              onClick={handleCheckout}
              disabled={!selectedTicket || processing || available === 0 || event.ticketTypes.length === 0}
              className="mt-6 w-full rounded py-2 font-semibold text-white transition-opacity disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-forest)' }}
            >
              {processing ? 'Processing...' : 'Proceed to Payment'}
            </button>

            {formError && (
              <p className="mt-3 text-sm" style={{ color: 'var(--color-danger)' }}>
                {formError}
              </p>
            )}

            <p className="mt-3 text-xs text-center" style={{ color: 'var(--color-stone-mid)' }}>
              Secure payments powered by Paystack
            </p>
          </div>
        </div>

        {selectedTicket && event.ticketTypes.length > 0 && (
          <div className="mt-12 rounded-lg border p-6" style={{ borderColor: 'var(--color-stone-mid)', backgroundColor: 'white' }}>
            <h3 className="text-xl font-bold" style={{ color: 'var(--color-forest)' }}>
              Buyer Information
            </h3>

            <div className="mt-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold" style={{ color: 'var(--color-forest)' }}>
                  Full Name
                </label>
                <input
                  type="text"
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value)}
                  placeholder="Your name"
                  className="mt-2 w-full rounded border px-3 py-2"
                  style={{ borderColor: 'var(--color-stone-mid)' }}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold" style={{ color: 'var(--color-forest)' }}>
                  Email Address
                </label>
                <input
                  type="email"
                  value={buyerEmail}
                  onChange={(e) => setBuyerEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="mt-2 w-full rounded border px-3 py-2"
                  style={{ borderColor: 'var(--color-stone-mid)' }}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold" style={{ color: 'var(--color-forest)' }}>
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={buyerPhone}
                  onChange={(e) => setBuyerPhone(e.target.value)}
                  placeholder="+234..."
                  className="mt-2 w-full rounded border px-3 py-2"
                  style={{ borderColor: 'var(--color-stone-mid)' }}
                />
              </div>
            </div>

            {quantity > 1 && (
              <div className="mt-8">
                <h4 className="text-lg font-semibold" style={{ color: 'var(--color-forest)' }}>
                  Attendee Details
                </h4>
                <p className="mt-1 text-sm" style={{ color: 'var(--color-stone)' }}>
                  Leave the first one blank to use your own details.
                </p>

                <div className="mt-4 space-y-6">
                  {attendees.map((_, index) => (
                    <div key={index} className="border-t pt-4" style={{ borderColor: 'var(--color-stone-mid)' }}>
                      <p className="text-sm font-semibold" style={{ color: 'var(--color-stone)' }}>
                        Attendee {index + 1}
                      </p>
                      <div className="mt-3 space-y-3">
                        <input
                          type="text"
                          value={attendees[index]?.name || ''}
                          onChange={(e) => updateAttendee(index, 'name', e.target.value)}
                          placeholder="Full Name"
                          className="w-full rounded border px-3 py-2"
                          style={{ borderColor: 'var(--color-stone-mid)' }}
                        />
                        <input
                          type="email"
                          value={attendees[index]?.email || ''}
                          onChange={(e) => updateAttendee(index, 'email', e.target.value)}
                          placeholder="Email Address"
                          className="w-full rounded border px-3 py-2"
                          style={{ borderColor: 'var(--color-stone-mid)' }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
