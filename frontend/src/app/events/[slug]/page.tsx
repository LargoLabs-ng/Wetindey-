'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { EventBanner } from '@/components/event-banner';
import { safeHttpUrl, type GalleryItem, type Sponsor } from '@/lib/media';
import { WordMark } from '@/components/wordmark';
import { AccountNav } from '@/components/account-nav';
import { EventConversation } from '@/components/event-conversation';
import {
  RegistrationAnswersForm,
  missingRequired,
  type AnswerMap,
  type PublicField,
} from '@/components/registration-answers-form';
import { activeTicketPrice, formatDeadline } from "@/lib/early-bird";
import { goingLabel } from "@/lib/going-badge";
import { recallRef, refFromQuery, rememberRef } from "@/lib/referral";

interface TicketType {
  id: string;
  name: string;
  description: string | null;
  price: string;
  /**
   * Nothing left to buy. The API never sends stock numbers (see
   * lib/public-tiers.ts): visitors see "Sold out", never how many are left.
   */
  soldOut: boolean;
  maxPerOrder: number;
  status: string;
  /** People one ticket lets in. 1 is an ordinary ticket. */
  admits?: number;
  earlyBirdEnabled: boolean;
  earlyBirdPrice: string | null;
  earlyBirdEndsAt: string | null;
  /** Organiser-set sales window. The server enforces it; this only labels it. */
  salesStart?: string | null;
  salesEnd?: string | null;
}

/** The signed-in buyer, from /api/checkout/account. */
interface CheckoutAccount {
  email: string;
  fullName: string;
  phone: string | null;
  emailVerified: boolean;
}

/**
 * Can this tier be picked right now? Mirrors the server's rule
 * (backend/lib/checkout-rules.ts) closely enough to grey things out
 * honestly; the server still has the final say at checkout.
 */
function tierWindow(t: TicketType, now: number): 'open' | 'not_yet' | 'closed' {
  const start = t.salesStart ? Date.parse(t.salesStart) : NaN;
  const end = t.salesEnd ? Date.parse(t.salesEnd) : NaN;
  if (Number.isFinite(start) && now < start) return 'not_yet';
  if (Number.isFinite(end) && now >= end) return 'closed';
  return 'open';
}

function tierOnSale(t: TicketType, now: number): boolean {
  return (
    t.status === 'active' &&
    !t.soldOut &&
    tierWindow(t, now) === 'open'
  );
}

interface Event {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  coverImage: string | null;
  category: string | null;
  venueName: string | null;
  /** Provisional — see the schema. Gates every display of date and venue. */
  dateTbd?: boolean;
  venueTbd?: boolean;
  venueAddress: string | null;
  city: string | null;
  country: string | null;
  startDatetime: string;
  endDatetime: string;
  timeZone: string;
  ticketTypes: TicketType[];
  /** Public "N+ going" floor from the server, or null for no badge. */
  goingFloor?: number | null;
  organization?: { name: string } | null;
  /** The organiser's mark, as opposed to this event's flyer. */
  logoUrl?: string | null;
  gallery?: GalleryItem[] | null;
  sponsors?: Sponsor[] | null;
}

export default function EventDetailPage() {
  const params = useParams();
  const search = useSearchParams();
  const router = useRouter();
  const { status: authStatus } = useSession();
  const slug = params.slug as string;

  /**
   * Where to come back to after signing in or confirming an email: this
   * event, with the tier and quantity they'd picked, and `buy=1` so the
   * page reopens checkout. Read once, on arrival — the address bar is
   * tidied afterwards so a refresh doesn't replay it.
   */
  const arrival = useRef({
    buy: search.get('buy') === '1',
    tier: search.get('tier'),
    qty: Number(search.get('qty')) || 1,
  });
  const [resumeCheckout, setResumeCheckout] = useState(false);
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);
  const [account, setAccount] = useState<CheckoutAccount | null>(null);
  const [verifyState, setVerifyState] = useState<
    { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'error'; message: string }
  >({ kind: 'idle' });
  const [eventVersion, setEventVersion] = useState(0);
  const selectedRef = useRef<string | null>(null);

  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [buyerName, setBuyerName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [buyerEmail, setBuyerEmail] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [attendees, setAttendees] = useState<Array<{ name: string; email: string }>>([]);
  const [processing, setProcessing] = useState(false);
  // The brief's primary call to action is "I'm In". Showing a name/email form
  // to someone still deciding is what made the old page feel like a checkout
  // screen rather than an event; the form arrives once they've said yes.
  const [joining, setJoining] = useState(false);
  const [copied, setCopied] = useState(false);
  const [ref, setRef] = useState<string | null>(null);
  const [priceClock, setPriceClock] = useState(() => Date.now());
  const [serverOffset, setServerOffset] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(
      () => setPriceClock(Date.now() + serverOffset),
      1000
    );
    return () => window.clearInterval(timer);
  }, [serverOffset]);

  // The organiser's own questions. Fetched separately from the event so a
  // failure here costs the extra questions and not the whole page — an
  // organiser who asked for a matric number would rather sell a ticket
  // without one than not sell it at all.
  const [regFields, setRegFields] = useState<PublicField[]>([]);
  const [answers, setAnswers] = useState<AnswerMap>({});

  /**
   * A discount or referral code the buyer typed.
   *
   * `promoEffect` is a PREVIEW only. The order API re-resolves the code from
   * the database and recalculates the price itself, so nothing here can talk
   * the server into a discount that doesn't exist.
   */
  const [promoInput, setPromoInput] = useState('');
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoEffect, setPromoEffect] = useState<
    { code: string; discount: number; message: string } | null
  >(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const promoRequest = useRef(0);

  /**
   * Remember who sent them.
   *
   * A promoter's link is `?p=AMAKA7`, and the gap between opening it and
   * paying is long enough to lose: they read the page, sign up, confirm
   * their email from a link that opens a new tab, close WhatsApp and come
   * back tomorrow. Holding the code only in the URL means any of that loses
   * the attribution, and an unattributed sale is an argument between an
   * organiser and a student who swears they sold it.
   *
   * Kept on this phone for 7 days (lib/referral.ts), scoped per event so a
   * code from one event's link cannot follow someone to another. A newer
   * link replaces an older one: the last promoter to send them gets credit.
   */
  useEffect(() => {
    if (!slug) return;
    const now = Date.now();
    const fromUrl = refFromQuery((name) => search.get(name));

    if (fromUrl) {
      setRef(fromUrl);
      try {
        rememberRef(window.localStorage, slug, fromUrl, now);
      } catch {
        /* private browsing — the URL still works for this page view */
      }
      return;
    }

    try {
      setRef(recallRef(window.localStorage, slug, now));
    } catch {
      setRef(null);
    }
  }, [slug, search]);

  useEffect(() => {
    const fetchEvent = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/events/slug/${slug}`);
        if (!response.ok) throw new Error('Event not found');
        const data = await response.json();
        setEvent(data);
        const serverTime = Date.parse(data.serverTime);
        if (Number.isFinite(serverTime)) {
          setServerOffset(serverTime - Date.now());
          setPriceClock(serverTime);
        }
        // Pick a tier that can actually be bought: the one they had before
        // signing in (if it's still on sale), else the one already selected,
        // else the first on sale. Prices and stock come fresh from the
        // server every time, so nothing picked before sign-in is trusted.
        const clock = Number.isFinite(serverTime) ? serverTime : Date.now();
        const tiers: TicketType[] = data.ticketTypes ?? [];
        const firstLoad = selectedRef.current === null;
        const wanted = firstLoad && arrival.current.buy ? arrival.current.tier : selectedRef.current;
        const wantedTier = tiers.find((t) => t.id === wanted);
        const chosen =
          (wantedTier && tierOnSale(wantedTier, clock) ? wantedTier : null) ??
          tiers.find((t) => tierOnSale(t, clock)) ??
          tiers[0] ??
          null;
        setSelectedTicket(chosen?.id ?? null);

        if (firstLoad) {
          setAttendees(Array(1).fill({ name: '', email: '' }));
          if (arrival.current.buy) {
            if (chosen && wantedTier && chosen.id === wantedTier.id) {
              // Capped at the per-order limit only: stock isn't known here,
              // and checkout refuses more than remains.
              const cap = Math.max(1, chosen.maxPerOrder);
              setQuantity(Math.max(1, Math.min(arrival.current.qty, cap)));
            } else {
              setResumeNotice(
                "The ticket you picked isn't available any more. Please choose another one."
              );
            }
            setResumeCheckout(true);
            // Tidy the address bar so a refresh doesn't reopen checkout, but
            // keep anything else on it (a promoter's code, for one).
            const rest = new URLSearchParams(window.location.search);
            rest.delete('buy');
            rest.delete('tier');
            rest.delete('qty');
            const query = rest.toString();
            router.replace(`/events/${encodeURIComponent(slug)}${query ? `?${query}` : ''}`, {
              scroll: false,
            });
          }
        }
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load event');
      } finally {
        setLoading(false);
      }
    };

    if (slug) fetchEvent();
  }, [slug, eventVersion, router]);

  useEffect(() => {
    selectedRef.current = selectedTicket;
  }, [selectedTicket]);

  /**
   * The signed-in buyer: pre-fills name and phone, shows where tickets go,
   * and says whether the email still needs confirming. Never fills over
   * something they've already typed.
   */
  const loadAccount = useCallback(async () => {
    try {
      const res = await fetch('/api/checkout/account', { cache: 'no-store' });
      if (!res.ok) return;
      const data: CheckoutAccount = await res.json();
      setAccount(data);
      setBuyerEmail(data.email);
      setBuyerName((current) => current || data.fullName);
      setBuyerPhone((current) => current || data.phone || '');
    } catch {
      // Checkout still asks for anything missing.
    }
  }, []);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/checkout/account', { cache: 'no-store' });
        if (!res.ok) return;
        const data: CheckoutAccount = await res.json();
        if (cancelled) return;
        setAccount(data);
        setBuyerEmail(data.email);
        setBuyerName((current) => current || data.fullName);
        setBuyerPhone((current) => current || data.phone || '');
      } catch {
        // Checkout still asks for anything missing.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authStatus]);

  // Checkout is open when they tapped "I'm in", or when they've just come
  // back from signing in (or confirming their email) to finish buying.
  const checkoutOpen = joining || (resumeCheckout && authStatus === 'authenticated');

  /** This event, with the current pick, as a path to come back to. */
  const checkoutReturnPath = () => {
    const back = new URLSearchParams();
    if (selectedTicket) back.set('tier', selectedTicket);
    back.set('qty', String(quantity));
    back.set('buy', '1');
    // The promoter's code rides along too. Confirming an email opens a new
    // tab, sometimes a different browser, where nothing saved on this page
    // exists — without it here, most first-time buyers lost the credit.
    if (ref) back.set('p', ref);
    return `/events/${encodeURIComponent(slug)}?${back.toString()}`;
  };

  const sendToSignIn = () => {
    router.push(`/login?callbackUrl=${encodeURIComponent(checkoutReturnPath())}`);
  };

  /**
   * "I'm in". Browsing never needs an account; getting a ticket does. A
   * signed-out visitor goes to sign in (or sign up) and comes straight back
   * here with the same tier and quantity, and checkout reopens.
   */
  const startCheckout = () => {
    if (authStatus === 'loading') return;
    if (authStatus !== 'authenticated') {
      sendToSignIn();
      return;
    }
    setJoining(true);
  };

  const sendVerificationLink = async () => {
    setVerifyState({ kind: 'sending' });
    try {
      const res = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnTo: checkoutReturnPath() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.verified) {
        await loadAccount();
        setVerifyState({ kind: 'idle' });
        return;
      }
      if (res.ok) {
        setVerifyState({ kind: 'sent' });
        return;
      }
      setVerifyState({
        kind: 'error',
        message: data.error ?? "We couldn't send the email. Please try again.",
      });
    } catch {
      setVerifyState({ kind: 'error', message: "We couldn't send the email. Please try again." });
    }
  };

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
  // The most one order may take. The stepper stops at the organiser's
  // per-order limit, not at what's left; asking for more than remains is
  // refused at checkout with a plain message, so the count is never shown.
  const maxQuantity = selectedTicketType?.maxPerOrder || 10;

  useEffect(() => {
    if (!event?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/events/${event.id}/registration-fields`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setRegFields(data.fields ?? []);
      } catch {
        // Silent on purpose. See the state declaration above.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [event?.id]);

  /**
   * A discount is a naira figure calculated for a particular quantity and
   * tier. Change either and it is wrong — three tickets carrying a discount
   * worked out for one would quote a total the server then refuses to match.
   *
   * Cleared rather than recalculated, and said out loud rather than silently,
   * because a discount that vanishes with no explanation reads as a bug.
   */
  useEffect(() => {
    setPromoEffect((current) => {
      if (!current) return null;
      setPromoError('Quantity changed — tap Apply again.');
      return null;
    });
  }, [quantity, selectedTicket]);

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
  // The page quotes the discounted figure; the server recalculates it too.
  const selectedPrice = selectedTicketType
    ? activeTicketPrice(selectedTicketType, priceClock).price
    : 0;
  const faceValue = selectedPrice * quantity;
  const quote = quoteOrder(
    Math.max(0, faceValue - (promoEffect?.discount ?? 0))
  );

  /**
   * After the tier or quantity changes, re-check the code in the box against
   * them — whether it was applied or had just been refused. So a buyer who
   * taps Regular (code refused) and back to VIP gets the discount back
   * without having to tap Apply again.
   */
  const refreshPromo = (tier: typeof selectedTicketType, qty: number) => {
    const code = promoEffect?.code ?? (promoError ? promoInput : '');
    if (!code.trim()) return;
    setPromoEffect(null);
    void applyPromo(tier, qty, code);
  };

  const changeQuantity = (next: number) => {
    setQuantity(next);
    refreshPromo(selectedTicketType, next);
  };

  const handleQuantityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value);
    if (value > 0 && value <= maxQuantity) {
      changeQuantity(value);
    }
  };

  const updateAttendee = (index: number, field: 'name' | 'email', value: string) => {
    const newAttendees = [...attendees];
    newAttendees[index] = { ...newAttendees[index], [field]: value };
    setAttendees(newAttendees);
  };

  /**
   * Preview a code against a ticket type and quantity — the selected ones
   * unless the caller is about to change them.
   *
   * The preview's discount is a naira figure for ONE tier and quantity, so
   * it is re-checked whenever either changes (see refreshPromo). Otherwise
   * the page would keep quoting the old discount while the server charges
   * the right amount, and a code limited to VIP would look applied on a
   * Regular ticket it doesn't work on.
   */
  async function applyPromo(
    tier: typeof selectedTicketType = selectedTicketType,
    qty: number = quantity,
    typedCode: string = promoInput
  ) {
    const typed = typedCode.trim();
    if (!typed || !event || !tier) return;

    // Quick taps on + / − fire several checks; only the newest may answer.
    const mine = ++promoRequest.current;
    setPromoBusy(true);
    setPromoError(null);
    try {
      const res = await fetch(`/api/events/${event.id}/promo-codes/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: typed,
          ticketTypeId: tier.id,
          faceValue: activeTicketPrice(tier, priceClock).price * qty,
        }),
      });
      const data = await res.json();
      if (mine !== promoRequest.current) return;
      if (!data.ok) {
        setPromoEffect(null);
        setPromoError(data.reason ?? "That code didn't work.");
        return;
      }
      setPromoEffect({
        code: data.code,
        discount: Number(data.discount) || 0,
        message: data.message ?? 'Code applied.',
      });
    } catch {
      if (mine === promoRequest.current) {
        setPromoError('Could not check that code — try again.');
      }
    } finally {
      if (mine === promoRequest.current) setPromoBusy(false);
    }
  }

  const handleCheckout = async () => {
    if (!selectedTicketType || !event) return;

    setFormError(null);

    if (!buyerName.trim() || !buyerPhone.trim()) {
      setFormError('Please enter your name and phone number.');
      return;
    }

    // Ticket 1 belongs to the buyer. Every extra ticket needs its holder's
    // name; their email is optional and falls back to the buyer's, because
    // every ticket in the order is emailed to the buyer anyway. (Before, the
    // page asked guests for a name only but then demanded an email for each,
    // so no order of two or more tickets could ever go through.)
    const resolvedAttendees = Array.from({ length: quantity }, (_, i) => ({
      name: attendees[i]?.name?.trim() || (i === 0 ? buyerName.trim() : ''),
      email: attendees[i]?.email?.trim() || buyerEmail.trim(),
    }));

    if (resolvedAttendees.some((a) => !a.name)) {
      setFormError('Please enter a name for every ticket.');
      return;
    }

    // Told here rather than after the round trip to Paystack. The server
    // checks this again — that's the gate; this is the courtesy.
    const missing = missingRequired(regFields, answers);
    if (missing) {
      setFormError(`${missing} is required.`);
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
          answers: Object.entries(answers).map(([fieldId, value]) => ({
            fieldId,
            value,
          })),
          // Unverified here, like `ref` below: the server resolves it and
          // ignores anything it doesn't recognise.
          promoCode: promoEffect?.code ?? undefined,
          marketingConsent,
          // Unverified on purpose: the server resolves the code itself and
          // ignores anything it does not recognise, so a made-up value here
          // credits nobody rather than crediting the wrong person.
          ref,
        }),
      });

      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        if (response.status === 401) {
          // Signed out somewhere along the way. Back through sign-in, and
          // straight back here.
          sendToSignIn();
          return;
        }
        if (failure.code === 'email_unverified') {
          setAccount((current) => (current ? { ...current, emailVerified: false } : current));
          return;
        }
        if (response.status === 409) {
          // Stock or sales window changed while they were filling the form.
          // Reload the tiers so the page shows what's actually left.
          setEventVersion((v) => v + 1);
        }
        throw new Error(failure.error || 'Failed to create order');
      }

      const { paymentUrl } = await response.json();
      // assign() rather than `href =`: same navigation, and the React
      // compiler's lint accepts a call where it rejects the assignment.
      window.location.assign(paymentUrl);
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
      <div className="wd-night flex min-h-screen items-center justify-center bg-cream">
        <p className="text-ink-3">Loading…</p>
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="wd-night min-h-screen bg-cream">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-6 sm:px-6">
          <WordMark />
          <AccountNav />
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
  const daysAway = Math.ceil((start.getTime() - priceClock) / 86400000);

  /**
   * The provisional date exists but nobody is meant to see it.
   *
   * `dateTbd` gates every reader of `start` and `end` below — the headline
   * facts, the countdown, the share text — and also stops the page deciding
   * an event is over because a placeholder date drifted into the past.
   */
  const dateTbd = event.dateTbd === true;
  const venueTbd = event.venueTbd === true;

  const hasStarted = !dateTbd && start.getTime() <= priceClock;
  const isOver = !dateTbd && end.getTime() < priceClock;
  const place = venueTbd
    ? ''
    : [event.venueName, event.city].filter(Boolean).join(', ');
  const soldOut =
    event.ticketTypes.length > 0 && event.ticketTypes.every((t) => t.soldOut);

  // "9+ going", "20+ going" … worked out on the server from confirmed
  // tickets; this page never sees the exact count. No floor (fewer than
  // nine people) means no badge. See lib/going-badge.ts.
  const going = goingLabel(event.goingFloor);
  const organiser = event.organization?.name?.trim() || null;

  const countdown = dateTbd
    ? 'Date to be announced'
    : isOver
      ? 'This event don happen'
      : hasStarted
        ? 'Happening now'
        : daysAway === 0
          ? 'Today'
          : daysAway === 1
            ? 'Tomorrow'
            : `In ${daysAway} days`;

  const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
  const shareWhen = dateTbd
    ? 'date to be announced'
    : start.toLocaleDateString('en-NG', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      });
  const shareText = `${event.title} — ${shareWhen}${place ? ` at ${place}` : ''}`;

  return (
    <div className="wd-night min-h-screen bg-cream">
      <header className="absolute inset-x-0 top-0 z-10">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <Link
            href="/discover"
            className="inline-flex items-center gap-1.5 rounded-full bg-black/45 px-3 py-1.5 text-sm font-semibold text-white backdrop-blur"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
          <AccountNav variant="glass" />
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────────
          Edge to edge, with the title sitting on the artwork rather than
          in a card beneath it. */}
      <section className="relative">
        <div className="relative h-[54vw] max-h-[460px] min-h-[280px] w-full overflow-hidden bg-indigo">
          {/* Cover art first, then anything else the organiser added. With
              one image this renders exactly what it always did — including
              the branded fallback panel when there's no artwork at all,
              which was the single biggest reason this page felt empty. */}
          <EventBanner
            title={event.title}
            cover={event.coverImage}
            gallery={event.gallery}
          />
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
              {/* An organiser is a person students are deciding whether to
                  trust, so they get a face and a line of their own instead of
                  a grey byline underneath the title. */}
              {(organiser || going) && (
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                  {organiser && (
                    <div className="flex items-center gap-2.5">
                      {/* The real mark when they've uploaded one, the initial
                          when they haven't. White plate behind it because a
                          logo is usually drawn for paper and disappears
                          against a dark photograph otherwise. */}
                      {event.logoUrl ? (
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={event.logoUrl}
                            alt=""
                            className="h-full w-full object-contain p-0.5"
                          />
                        </span>
                      ) : (
                        <span
                          aria-hidden="true"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-extrabold"
                          style={{
                            backgroundColor: 'var(--color-purple)',
                            color: '#fff',
                          }}
                        >
                          {organiser.charAt(0).toUpperCase()}
                        </span>
                      )}
                      <span className="text-sm text-white/75">
                        by{' '}
                        <span className="font-semibold text-white">{organiser}</span>
                      </span>
                    </div>
                  )}
                  {going && (
                    <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-bold text-white backdrop-blur">
                      {going}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Extra bottom padding on a phone so the fixed bar below never sits on
          top of the last section. */}
      <main className="mx-auto max-w-5xl px-4 pb-28 sm:px-6 lg:pb-20">
        <div className="grid gap-10 pt-8 lg:grid-cols-[1fr_380px]">
          {/* ── The event itself ───────────────────────────────────── */}
          <div className="min-w-0">
            <dl className="grid gap-4 sm:grid-cols-2">
              <div className="flex gap-3">
                <CalendarDays className="mt-0.5 h-5 w-5 shrink-0 text-purple" />
                {dateTbd ? (
                  <div>
                    <dt className="text-sm font-semibold text-ink">
                      Date to be announced
                    </dt>
                    <dd className="text-sm text-ink-2">
                      You&apos;ll be emailed as soon as it&apos;s set
                    </dd>
                  </div>
                ) : (
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
                )}
              </div>
              {(place || venueTbd) && (
                <div className="flex gap-3">
                  <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-purple" />
                  <div className="min-w-0">
                    <dt className="text-sm font-semibold text-ink">
                      {venueTbd ? 'Venue to be announced' : event.venueName}
                    </dt>
                    <dd className="text-sm text-ink-2">
                      {venueTbd
                        ? event.city
                          ? `Somewhere in ${event.city} — you'll be emailed`
                          : "You'll be emailed as soon as it's set"
                        : event.venueAddress || event.city}
                    </dd>
                  </div>
                </div>
              )}
            </dl>

            {event.description && (
              <section className="mt-10">
                <h2 className="text-2xl font-extrabold tracking-[-0.03em] text-ink">
                  What&apos;s happening
                </h2>
                <p className="mt-2 whitespace-pre-line leading-relaxed text-ink-2">
                  {event.description}
                </p>
              </section>
            )}

            {place && (
              <section className="mt-10">
                <h2 className="text-2xl font-extrabold tracking-[-0.03em] text-ink">
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
            <section className="mt-10">
              <h2 className="text-2xl font-extrabold tracking-[-0.03em] text-ink">
                Tell somebody
              </h2>
              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(`${shareText}\n${shareUrl}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl border border-line bg-card px-4 py-2.5 text-sm font-semibold text-ink hover:border-ink-3"
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
                  className="inline-flex items-center gap-2 rounded-xl border border-line bg-card px-4 py-2.5 text-sm font-semibold text-ink hover:border-ink-3"
                >
                  {copied ? <Check className="h-4 w-4 text-ok" /> : <Link2 className="h-4 w-4" />}
                  {copied ? 'Link copied' : 'Copy link'}
                </button>
              </div>
            </section>

            {/* §11: the event as a place people talk in, not a page they
                read. Organiser updates and Q&A, with the moderation
                controls that have to exist the moment anyone can post. */}
            <EventConversation eventId={event.id} eventTitle={event.title} />

            {/* Below the conversation, not above it. Sponsors are a promise
                the organiser made to somebody else; the student scrolling
                this page came for the event. Quiet, and present. */}
            {event.sponsors && event.sponsors.length > 0 && (
              <section className="mt-10 border-t border-line pt-6">
                <h2 className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-3">
                  {event.sponsors.length === 1
                    ? 'In partnership with'
                    : 'Sponsors and partners'}
                </h2>
                <ul className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-5">
                  {event.sponsors.map((s, i) => {
                    const logo = (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.logoUrl}
                        alt={s.name}
                        title={s.name}
                        className="h-9 w-auto max-w-[140px] object-contain opacity-80 transition-opacity hover:opacity-100"
                      />
                    );
                    const href = safeHttpUrl(s.url);
                    return (
                      <li key={`${s.name}-${i}`}>
                        {href ? (
                          <a
                            href={href}
                            target="_blank"
                            // nofollow as well as noopener: an organiser can
                            // add any sponsor they like, and this page should
                            // not be a way to buy a link from us.
                            rel="noopener noreferrer nofollow"
                          >
                            {logo}
                          </a>
                        ) : (
                          logo
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </div>

          {/* ── Tickets ─────────────────────────────────────────────── */}
          <aside id="tickets" className="scroll-mt-6 lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-2xl border border-line bg-card p-5">
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
                  {resumeNotice && (
                    <p className="mt-2 rounded-lg bg-cream-2 px-3 py-2 text-sm text-coral">
                      {resumeNotice}
                    </p>
                  )}

                  <div className="mt-3 space-y-2">
                    {event.ticketTypes.map((t) => {
                      const gone = t.soldOut;
                      const paused = t.status === 'paused';
                      const salesWindow = tierWindow(t, priceClock);
                      const disabled = gone || paused || salesWindow !== 'open';
                      const selected = selectedTicket === t.id;
                      const currentPrice = activeTicketPrice(t, priceClock);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          disabled={disabled}
                          onClick={() => {
                            setSelectedTicket(t.id);
                            setQuantity(1);
                            if (t.id !== selectedTicket) refreshPromo(t, 1);
                          }}
                          className={`w-full rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${
                            selected ? 'border-purple bg-purple-soft' : 'border-line hover:border-ink-3'
                          }`}
                        >
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="font-semibold text-ink">{t.name}</span>
                            <span className="text-right">
                              <span className="block font-bold tabular-nums text-ink">
                                {currentPrice.price === 0 ? 'Free' : naira(currentPrice.price)}
                              </span>
                              {currentPrice.earlyBirdActive && (
                                <>
                                  <span className="block text-xs font-semibold text-purple">Early Bird</span>
                                  <span className="block text-xs text-ink-3 line-through">
                                    {naira(Number(t.price))}
                                  </span>
                                </>
                              )}
                            </span>
                          </div>
                          {t.description && (
                            <span className="mt-0.5 block text-xs text-ink-2">{t.description}</span>
                          )}
                          {currentPrice.earlyBirdActive && t.earlyBirdEndsAt && (
                            <span className="mt-1 block text-xs text-ink-3">
                              Offer ends {formatDeadline(t.earlyBirdEndsAt, event.timeZone)}
                            </span>
                          )}
                          {(t.admits ?? 1) > 1 && (
                            // Said before the price sinks in, not after. A
                            // table at ₦30,000 is a different proposition
                            // from a ticket at ₦30,000, and the buyer has to
                            // know which one they're looking at.
                            <span className="mt-1 block text-xs font-semibold text-purple">
                              Admits {t.admits} people
                            </span>
                          )}
                          {/* Only the states a buyer acts on. How many are
                              left is the organiser's to know, not the page's. */}
                          {(paused || gone || salesWindow !== 'open') && (
                            <span className="mt-1 block text-xs font-semibold text-ink-3">
                              {paused
                                ? 'Not on sale'
                                : salesWindow === 'not_yet' && t.salesStart
                                  ? `Sales open ${formatDeadline(t.salesStart, event.timeZone)}`
                                  : salesWindow === 'closed'
                                    ? 'Sales closed'
                                    : 'Sold out'}
                            </span>
                          )}
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
                            onClick={() => changeQuantity(Math.max(1, quantity - 1))}
                            disabled={quantity <= 1}
                            className="flex h-11 w-11 items-center justify-center rounded-lg border border-line text-ink disabled:opacity-40"
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
                              changeQuantity(
                                Math.min(maxQuantity, quantity + 1)
                              )
                            }
                            disabled={quantity >= maxQuantity}
                            className="flex h-11 w-11 items-center justify-center rounded-lg border border-line text-ink disabled:opacity-40"
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
                        <div className="flex justify-between border-t border-line pt-2 text-base font-extrabold">
                          <dt className="text-ink">Ticket total</dt>
                          <dd className="tabular-nums text-ink">{naira(quote.paystackAmount)}</dd>
                        </div>
                      </dl>
                      <p className="mt-2 text-center text-xs text-ink-3">
                        Paystack will show any processing fee before you complete payment.
                      </p>

                      {!checkoutOpen ? (
                        <button
                          type="button"
                          onClick={startCheckout}
                          disabled={!tierOnSale(selectedTicketType, priceClock)}
                          className="mt-4 w-full rounded-xl bg-purple py-3.5 text-base font-bold text-white transition-colors hover:bg-purple-deep disabled:opacity-50"
                        >
                          {selectedPrice === 0 ? "I'm in" : `I'm in · ${naira(quote.paystackAmount)}`}
                        </button>
                      ) : !account ? (
                        <p className="mt-4 border-t border-line pt-4 text-sm text-ink-3">
                          Loading your details…
                        </p>
                      ) : !account.emailVerified ? (
                        // Tickets go to the account's address, so it has to be
                        // proven theirs before anything is bought.
                        <div className="mt-4 space-y-3 border-t border-line pt-4">
                          <p className="text-sm font-semibold text-ink">Confirm your email first</p>
                          <p className="text-sm text-ink-2">
                            Your tickets will be sent to{' '}
                            <span className="font-semibold text-ink">{account.email}</span>. Tap
                            below and we&apos;ll email you a link to confirm it&apos;s yours. The
                            link brings you straight back here.
                          </p>
                          {verifyState.kind === 'sent' && (
                            <p className="rounded-lg bg-cream-2 px-3 py-2 text-sm text-ink">
                              Link sent. Check your inbox, and your spam folder too.
                            </p>
                          )}
                          {verifyState.kind === 'error' && (
                            <p className="text-sm text-coral">{verifyState.message}</p>
                          )}
                          <button
                            type="button"
                            onClick={() => void sendVerificationLink()}
                            disabled={verifyState.kind === 'sending'}
                            className="w-full rounded-xl bg-purple py-3.5 text-base font-bold text-white transition-colors hover:bg-purple-deep disabled:opacity-50"
                          >
                            {verifyState.kind === 'sending'
                              ? 'Sending…'
                              : verifyState.kind === 'sent'
                                ? 'Send it again'
                                : 'Send confirmation link'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void loadAccount()}
                            className="w-full rounded-xl border border-line py-3 text-sm font-semibold text-ink hover:border-ink-3"
                          >
                            I&apos;ve confirmed it
                          </button>
                        </div>
                      ) : (
                        <div className="mt-4 space-y-3 border-t border-line pt-4">
                          <p className="text-sm font-semibold text-ink">Who&apos;s coming?</p>
                          {formError && <p className="text-sm text-coral">{formError}</p>}

                          <input
                            value={buyerName}
                            onChange={(e) => setBuyerName(e.target.value)}
                            placeholder="Full name"
                            autoComplete="name"
                            className="w-full rounded-lg border border-line px-3 py-2.5 text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-purple"
                          />
                          <p className="rounded-lg bg-cream-2 px-3 py-2.5 text-sm text-ink-2">
                            Tickets go to{' '}
                            <span className="break-all font-semibold text-ink">{account.email}</span>
                          </p>
                          <input
                            type="tel"
                            value={buyerPhone}
                            onChange={(e) => setBuyerPhone(e.target.value)}
                            placeholder="Phone number"
                            className="w-full rounded-lg border border-line px-3 py-2.5 text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-purple"
                          />

                          <div className="rounded-xl bg-cream-2 p-3">
                            <label className="mb-1 block text-xs font-semibold text-ink-2">
                              Have a code?
                            </label>
                            <div className="flex gap-2">
                              <input
                                value={promoInput}
                                onChange={(e) => {
                                  setPromoInput(e.target.value.toUpperCase());
                                  setPromoError(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    void applyPromo();
                                  }
                                }}
                                placeholder="FRESHERS20"
                                className="w-full rounded-lg border border-line px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-purple"
                              />
                              <button
                                type="button"
                                onClick={() => void applyPromo()}
                                disabled={promoBusy || !promoInput.trim()}
                                className="shrink-0 rounded-lg border border-line px-4 text-sm font-semibold text-ink disabled:opacity-40"
                              >
                                {promoBusy ? '…' : 'Apply'}
                              </button>
                            </div>
                            {promoError && (
                              <p className="mt-1.5 text-xs text-coral">{promoError}</p>
                            )}
                            {promoEffect && (
                              <p className="mt-1.5 text-xs font-semibold text-ok">
                                {promoEffect.discount > 0
                                  ? `${promoEffect.code} applied — ${naira(promoEffect.discount)} off`
                                  : promoEffect.message}
                              </p>
                            )}
                          </div>

                          <RegistrationAnswersForm
                            fields={regFields}
                            values={answers}
                            onChange={(fieldId, value) =>
                              setAnswers((a) => ({ ...a, [fieldId]: value }))
                            }
                          />

                          {quantity > 1 && (
                            <div className="space-y-2 rounded-xl bg-cream-2 p-3">
                              <p className="text-xs font-semibold text-ink-2">
                                Names for the other {quantity - 1}{' '}
                                {quantity - 1 === 1 ? 'ticket' : 'tickets'}
                              </p>
                              {attendees.slice(1).map((a, i) => (
                                <div key={i} className="space-y-1.5">
                                  <input
                                    value={a.name}
                                    onChange={(e) => updateAttendee(i + 1, 'name', e.target.value)}
                                    placeholder={`Guest ${i + 2} name`}
                                    className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-purple"
                                  />
                                  <input
                                    type="email"
                                    value={a.email}
                                    onChange={(e) => updateAttendee(i + 1, 'email', e.target.value)}
                                    placeholder={`Guest ${i + 2} email (optional)`}
                                    className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-purple"
                                  />
                                </div>
                              ))}
                              <p className="text-xs text-ink-3">
                                All tickets are emailed to you to share.
                              </p>
                            </div>
                          )}

                          <label className="flex items-start gap-2 text-xs text-ink-3">
                            <input
                              type="checkbox"
                              checked={marketingConsent}
                              onChange={(e) => setMarketingConsent(e.target.checked)}
                              className="mt-0.5 accent-purple"
                            />
                            <span>
                              Email me occasional updates about this organiser&apos;s future events.
                              Optional; this does not affect your ticket.
                            </span>
                          </label>

                          <button
                            onClick={handleCheckout}
                            disabled={processing || !tierOnSale(selectedTicketType, priceClock)}
                            className="w-full rounded-xl bg-purple py-3.5 text-base font-bold text-white transition-colors hover:bg-purple-deep disabled:opacity-50"
                          >
                            {processing
                              ? 'Taking you to payment…'
                              : selectedPrice === 0
                                ? 'Confirm my spot'
                                : `Continue to Paystack · ${naira(quote.paystackAmount)}`}
                          </button>
                          <p className="text-center text-xs text-ink-3">
                            Paystack adds any processing fee shown on its payment page. Your QR ticket arrives by email.
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

      {/* ── Phone: the decision never scrolls away ─────────────────────
          On a desktop the ticket panel is sticky in the right column, so the
          price and the button are always on screen. On a phone that panel is
          at the bottom of a long page, which means the one thing the page
          exists for is the one thing you cannot see. This bar carries it. */}
      {!isOver && event.ticketTypes.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card/95 px-4 py-3 backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-3">
                {soldOut ? 'No more tickets' : 'From'}
              </p>
              <p className="truncate text-lg font-extrabold leading-tight text-ink">
                {soldOut
                  ? 'Sold out'
                  : Math.min(...event.ticketTypes.map((t) => activeTicketPrice(t, priceClock).price)) === 0
                    ? 'Free'
                    : naira(Math.min(...event.ticketTypes.map((t) => activeTicketPrice(t, priceClock).price)))}
              </p>
            </div>
            <a
              href="#tickets"
              aria-disabled={soldOut}
              className={`shrink-0 rounded-xl px-6 py-3 font-bold text-white ${
                soldOut ? 'pointer-events-none bg-ink-3' : 'bg-purple hover:bg-purple-deep'
              }`}
            >
              {soldOut ? 'Sold out' : "I'm in"}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
