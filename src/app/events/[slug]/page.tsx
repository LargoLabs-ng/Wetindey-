'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { quoteOrder, naira } from '@/lib/fees';
import {
  ArrowLeft,
  CalendarDays,
  Check,
  Link2,
  MapPin,
  Minus,
  Plus,
  Share2,
  Ticket,
} from 'lucide-react';
import { useParams } from 'next/navigation';
import { EventImage } from '@/components/event-image';
import { WordMark } from '@/components/wordmark';

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
  feeStrategy: 'buyer_pays' | 'organizer_absorbs';
  platformFeePaidBy: 'organizer' | 'buyer';
  category: string | null;
  venueName: string | null;
  venueAddress: string | null;
  city: string | null;
  country: string | null;
  startDatetime: string;
  endDatetime: string;
  ticketTypes: TicketType[];
  organization?: { name: string } | null;
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
  // The brief's primary call to action is "I'm In". Showing a name/email form
  // to someone still deciding is what made the old page feel like a checkout
  // screen rather than an event; the form arrives once they've said yes.
  const [joining, setJoining] = useState(false);
  const [copied, setCopied] = useState(false);

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

  // Same calculation the order API uses, so the page and the payment screen
  // can never quote different numbers.
  const quote = quoteOrder(parseFloat(selectedTicketType?.price || '0') * quantity, {
    platformFeePaidBy: event?.platformFeePaidBy ?? 'organizer',
    processingFeePaidBy: event?.feeStrategy === 'organizer_absorbs' ? 'organizer' : 'buyer',
  });

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

  // ── Presentation ──────────────────────────────────────────────────────
  //
  // The event as a place, not a checkout screen. A full-bleed hero carries
  // the artwork, the facts a student actually decides on sit directly under
  // the title, and the ticket panel follows them down the page rather than
  // being something to scroll back up to.

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream">
        <p className="text-ink-3">Loading…</p>
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="min-h-screen bg-cream">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
          <WordMark />
        </div>
        <div className="mx-auto max-w-lg px-4 py-16 text-center sm:px-6">
          <p className="text-2xl font-extrabold tracking-[-0.02em] text-ink">
            This one no dey again.
          </p>
          <p className="mt-2 text-ink-2">
            The link might be wrong, or the organiser took it down.
          </p>
          <Link
            href="/discover"
            className="mt-6 inline-block rounded-xl bg-purple px-5 py-3 font-semibold text-white hover:bg-purple-deep"
          >
            See what else dey
          </Link>
        </div>
      </div>
    );
  }

  const start = new Date(event.startDatetime);
  const end = new Date(event.endDatetime);
  const daysAway = Math.ceil((start.getTime() - Date.now()) / 86400000);
  const hasStarted = start.getTime() <= Date.now();
  const isOver = end.getTime() < Date.now();
  const place = [event.venueName, event.city].filter(Boolean).join(', ');
  const soldOut =
    event.ticketTypes.length > 0 &&
    event.ticketTypes.every((t) => t.quantityTotal - t.quantitySold - t.quantityReserved <= 0);

  const countdown = isOver
    ? 'This event don happen'
    : hasStarted
      ? 'Happening now'
      : daysAway === 0
        ? 'Today'
        : daysAway === 1
          ? 'Tomorrow'
          : `In ${daysAway} days`;

  const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
  const shareText = `${event.title} — ${start.toLocaleDateString('en-NG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })}${place ? ` at ${place}` : ''}`;

  return (
    <div className="min-h-screen bg-cream">
      <header className="absolute inset-x-0 top-0 z-10">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <Link
            href="/discover"
            className="inline-flex items-center gap-1.5 rounded-full bg-black/45 px-3 py-1.5 text-sm font-semibold text-white backdrop-blur"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────────
          Edge to edge, with the title sitting on the artwork rather than
          in a card beneath it. */}
      <section className="relative">
        <div className="relative h-[54vw] max-h-[460px] min-h-[280px] w-full overflow-hidden bg-indigo">
          {event.coverImage ? (
            <EventImage src={event.coverImage} alt={event.title} priority sizes="100vw" />
          ) : (
            <div
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(140deg, var(--color-indigo-3), var(--color-indigo))',
              }}
            />
          )}
          {/* Gradient so white type stays legible on any artwork. */}
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(to top, rgba(15,11,26,0.92) 0%, rgba(15,11,26,0.45) 45%, rgba(15,11,26,0.15) 100%)',
            }}
          />

          <div className="absolute inset-x-0 bottom-0">
            <div className="mx-auto max-w-5xl px-4 pb-6 sm:px-6 sm:pb-8">
              <div className="flex flex-wrap items-center gap-2">
                {event.category && (
                  <span className="rounded-full bg-purple px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-white">
                    {event.category}
                  </span>
                )}
                <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">
                  {countdown}
                </span>
                {soldOut && !isOver && (
                  <span className="rounded-full bg-coral px-2.5 py-1 text-xs font-bold text-white">
                    Sold out
                  </span>
                )}
              </div>
              <h1 className="mt-3 text-3xl font-extrabold leading-[1.08] tracking-[-0.03em] text-white sm:text-5xl">
                {event.title}
              </h1>
              {event.organization?.name && (
                <p className="mt-2 text-sm text-white/75">
                  by {event.organization.name}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-5xl px-4 pb-20 sm:px-6">
        <div className="grid gap-10 pt-8 lg:grid-cols-[1fr_380px]">
          {/* ── The event itself ───────────────────────────────────── */}
          <div className="min-w-0">
            <dl className="grid gap-4 sm:grid-cols-2">
              <div className="flex gap-3">
                <CalendarDays className="mt-0.5 h-5 w-5 shrink-0 text-purple" />
                <div>
                  <dt className="text-sm font-semibold text-ink">
                    {start.toLocaleDateString('en-NG', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                    })}
                  </dt>
                  <dd className="text-sm text-ink-2">
                    {start.toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' })}
                    {' – '}
                    {end.toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' })}
                  </dd>
                </div>
              </div>
              {place && (
                <div className="flex gap-3">
                  <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-purple" />
                  <div className="min-w-0">
                    <dt className="text-sm font-semibold text-ink">{event.venueName}</dt>
                    <dd className="text-sm text-ink-2">
                      {event.venueAddress || event.city}
                    </dd>
                  </div>
                </div>
              )}
            </dl>

            {event.description && (
              <section className="mt-8">
                <h2 className="text-lg font-extrabold tracking-[-0.02em] text-ink">
                  What&apos;s happening
                </h2>
                <p className="mt-2 whitespace-pre-line leading-relaxed text-ink-2">
                  {event.description}
                </p>
              </section>
            )}

            {place && (
              <section className="mt-8">
                <h2 className="text-lg font-extrabold tracking-[-0.02em] text-ink">
                  Getting there
                </h2>
                <p className="mt-2 text-ink-2">
                  {[event.venueName, event.venueAddress, event.city].filter(Boolean).join(', ')}
                </p>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                    [event.venueName, event.venueAddress, event.city, event.country]
                      .filter(Boolean)
                      .join(', ')
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-sm font-semibold text-purple"
                >
                  Open in Maps →
                </a>
              </section>
            )}

            {/* Sharing is how this product spreads, so it is a real section
                and WhatsApp comes first — that is where the link goes. */}
            <section className="mt-8">
              <h2 className="text-lg font-extrabold tracking-[-0.02em] text-ink">
                Tell somebody
              </h2>
              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(`${shareText}\n${shareUrl}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:border-ink-3"
                >
                  <Share2 className="h-4 w-4" />
                  Share on WhatsApp
                </a>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(shareUrl);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    } catch {
                      setCopied(false);
                    }
                  }}
                  className="inline-flex items-center gap-2 rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:border-ink-3"
                >
                  {copied ? <Check className="h-4 w-4 text-ok" /> : <Link2 className="h-4 w-4" />}
                  {copied ? 'Link copied' : 'Copy link'}
                </button>
              </div>
            </section>
          </div>

          {/* ── Tickets ─────────────────────────────────────────────── */}
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-2xl border border-line bg-white p-5">
              {isOver ? (
                <>
                  <p className="font-extrabold text-ink">This event don happen</p>
                  <p className="mt-1 text-sm text-ink-2">
                    Check what else dey on.
                  </p>
                  <Link
                    href="/discover"
                    className="mt-4 block rounded-xl bg-purple py-3 text-center font-semibold text-white hover:bg-purple-deep"
                  >
                    See what else dey
                  </Link>
                </>
              ) : event.ticketTypes.length === 0 ? (
                <>
                  <p className="font-extrabold text-ink">Tickets not up yet</p>
                  <p className="mt-1 text-sm text-ink-2">
                    The organiser hasn&apos;t put tickets on sale. Save the link
                    and check back.
                  </p>
                </>
              ) : (
                <>
                  <h2 className="flex items-center gap-2 font-extrabold text-ink">
                    <Ticket className="h-4 w-4 text-purple" />
                    Tickets
                  </h2>

                  <div className="mt-3 space-y-2">
                    {event.ticketTypes.map((t) => {
                      const left = t.quantityTotal - t.quantitySold - t.quantityReserved;
                      const gone = left <= 0 || t.status === 'sold_out';
                      const paused = t.status === 'paused';
                      const disabled = gone || paused;
                      const selected = selectedTicket === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          disabled={disabled}
                          onClick={() => {
                            setSelectedTicket(t.id);
                            setQuantity(1);
                          }}
                          className={`w-full rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${
                            selected ? 'border-purple bg-purple-soft' : 'border-line hover:border-ink-3'
                          }`}
                        >
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="font-semibold text-ink">{t.name}</span>
                            <span className="font-bold tabular-nums text-ink">
                              {Number(t.price) === 0 ? 'Free' : naira(Number(t.price))}
                            </span>
                          </div>
                          {t.description && (
                            <span className="mt-0.5 block text-xs text-ink-2">{t.description}</span>
                          )}
                          <span className="mt-1 block text-xs text-ink-3">
                            {paused
                              ? 'Not on sale'
                              : gone
                                ? 'Sold out'
                                : left <= 10
                                  ? `Only ${left} left`
                                  : `${left} available`}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {selectedTicketType && (
                    <>
                      <div className="mt-4 flex items-center justify-between">
                        <span className="text-sm font-semibold text-ink">How many?</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            aria-label="One fewer"
                            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                            disabled={quantity <= 1}
                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink disabled:opacity-40"
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                          <span className="w-9 text-center font-bold tabular-nums text-ink">
                            {quantity}
                          </span>
                          <button
                            type="button"
                            aria-label="One more"
                            onClick={() =>
                              setQuantity((q) =>
                                Math.min(Math.min(available, selectedTicketType.maxPerOrder), q + 1)
                              )
                            }
                            disabled={quantity >= Math.min(available, selectedTicketType.maxPerOrder)}
                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink disabled:opacity-40"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      <dl className="mt-4 space-y-1.5 border-t border-line pt-4 text-sm">
                        <div className="flex justify-between">
                          <dt className="text-ink-2">
                            {quantity} {quantity === 1 ? 'ticket' : 'tickets'}
                          </dt>
                          <dd className="tabular-nums text-ink-2">{naira(quote.subtotal)}</dd>
                        </div>
                        {quote.platformFeePaidBy === 'buyer' && (
                          <div className="flex justify-between">
                            <dt className="text-ink-2">Service fee</dt>
                            <dd className="tabular-nums text-ink-2">{naira(quote.platformFee)}</dd>
                          </div>
                        )}
                        {quote.processingFeePaidBy === 'buyer' && (
                          <div className="flex justify-between">
                            <dt className="text-ink-2">Card fee</dt>
                            <dd className="tabular-nums text-ink-2">{naira(quote.processingFee)}</dd>
                          </div>
                        )}
                        <div className="flex justify-between border-t border-line pt-2 text-base font-extrabold">
                          <dt className="text-ink">Total</dt>
                          <dd className="tabular-nums text-ink">{naira(quote.buyerTotal)}</dd>
                        </div>
                      </dl>

                      {!joining ? (
                        <button
                          type="button"
                          onClick={() => setJoining(true)}
                          disabled={available === 0}
                          className="mt-4 w-full rounded-xl bg-purple py-3.5 text-base font-bold text-white transition-colors hover:bg-purple-deep disabled:opacity-50"
                        >
                          {Number(selectedTicketType.price) === 0 ? "I'm in" : `I'm in · ${naira(quote.buyerTotal)}`}
                        </button>
                      ) : (
                        <div className="mt-4 space-y-3 border-t border-line pt-4">
                          <p className="text-sm font-semibold text-ink">Who&apos;s coming?</p>
                          {formError && <p className="text-sm text-coral">{formError}</p>}

                          <input
                            value={buyerName}
                            onChange={(e) => setBuyerName(e.target.value)}
                            placeholder="Full name"
                            className="w-full rounded-lg border border-line px-3 py-2.5 text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-purple"
                          />
                          <input
                            type="email"
                            value={buyerEmail}
                            onChange={(e) => setBuyerEmail(e.target.value)}
                            placeholder="Email — your ticket goes here"
                            className="w-full rounded-lg border border-line px-3 py-2.5 text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-purple"
                          />
                          <input
                            type="tel"
                            value={buyerPhone}
                            onChange={(e) => setBuyerPhone(e.target.value)}
                            placeholder="Phone number"
                            className="w-full rounded-lg border border-line px-3 py-2.5 text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-purple"
                          />

                          {quantity > 1 && (
                            <div className="space-y-2 rounded-xl bg-cream-2 p-3">
                              <p className="text-xs font-semibold text-ink-2">
                                Names for the other {quantity - 1}{' '}
                                {quantity - 1 === 1 ? 'ticket' : 'tickets'}
                              </p>
                              {attendees.slice(1).map((a, i) => (
                                <input
                                  key={i}
                                  value={a.name}
                                  onChange={(e) => updateAttendee(i + 1, 'name', e.target.value)}
                                  placeholder={`Guest ${i + 2} name`}
                                  className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-purple"
                                />
                              ))}
                            </div>
                          )}

                          <button
                            onClick={handleCheckout}
                            disabled={processing || available === 0}
                            className="w-full rounded-xl bg-purple py-3.5 text-base font-bold text-white transition-colors hover:bg-purple-deep disabled:opacity-50"
                          >
                            {processing
                              ? 'Taking you to payment…'
                              : Number(selectedTicketType.price) === 0
                                ? 'Confirm my spot'
                                : `Pay ${naira(quote.buyerTotal)}`}
                          </button>
                          <p className="text-center text-xs text-ink-3">
                            {quote.processingFeePaidBy === 'organizer'
                              ? 'The organiser covers the card fee. '
                              : ''}
                            Secure payment by Paystack. Your QR ticket arrives by email.
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
