'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle, XCircle, Clock, QrCode } from 'lucide-react';
import dynamic from 'next/dynamic';
import { SUPPORT_EMAIL } from '@/lib/app-url';
import { WordMark } from '@/components/wordmark';

const QRCodeDisplay = dynamic(
  () => import('@/components/qr-code-display').then((mod) => mod.QRCodeDisplay),
  { ssr: false }
);

interface Ticket {
  id: string;
  qrToken: string;
  attendeeName: string;
  attendeeEmail: string;
}

interface PaymentStatus {
  status: 'success' | 'failed' | 'pending' | 'loading';
  message: string;
  orderId?: string;
  eventTitle?: string;
  tickets?: Ticket[];
}

export default function PaymentCallbackClient() {
  const searchParams = useSearchParams();
  const reference = searchParams.get('reference');

  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>({
    status: 'loading',
    message: 'Verifying your payment...',
  });

  useEffect(() => {
    const verifyPayment = async () => {
      if (!reference) {
        setPaymentStatus({
          status: 'failed',
          message: 'No payment reference found',
        });
        return;
      }

      try {
        const response = await fetch(`/api/payment/verify?reference=${encodeURIComponent(reference)}`);
        const data = await response.json();

        if (data.status === 'success') {
          setPaymentStatus({
            status: 'success',
            message: 'Payment successful! Your tickets are ready.',
            orderId: data.orderId,
            eventTitle: data.eventTitle,
            tickets: data.tickets,
          });
        } else if (data.status === 'pending') {
          setPaymentStatus({
            status: 'pending',
            message: 'Payment is being processed. Check your email shortly.',
            orderId: data.orderId,
          });
        } else {
          setPaymentStatus({
            status: 'failed',
            message: data.message || 'Payment verification failed',
          });
        }
      } catch (error) {
        setPaymentStatus({
          status: 'failed',
          message: 'Failed to verify payment. Please contact support.',
        });
      }
    };

    verifyPayment();
  }, [reference]);

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-ivory)' }}>
      <header className="border-b" style={{ borderColor: 'var(--color-stone-mid)' }}>
        <div className="mx-auto max-w-4xl px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <WordMark />
            <span className="font-bold" style={{ color: 'var(--color-forest)' }}>
              Ticket Buddy
            </span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <div className="rounded-lg border p-8 text-center" style={{ borderColor: 'var(--color-stone-mid)', backgroundColor: 'white' }}>
          {paymentStatus.status === 'success' && (
            <CheckCircle className="mx-auto h-16 w-16" style={{ color: 'var(--color-sage)' }} />
          )}
          {paymentStatus.status === 'failed' && (
            <XCircle className="mx-auto h-16 w-16 text-red-500" />
          )}
          {(paymentStatus.status === 'pending' || paymentStatus.status === 'loading') && (
            <Clock className="mx-auto h-16 w-16 animate-spin" style={{ color: 'var(--color-forest)' }} />
          )}

          <h1 className="mt-6 text-3xl font-bold" style={{ color: 'var(--color-forest)' }}>
            {paymentStatus.status === 'success' && 'Payment Confirmed! 🎉'}
            {paymentStatus.status === 'failed' && 'Payment Failed'}
            {paymentStatus.status === 'pending' && 'Processing Payment'}
            {paymentStatus.status === 'loading' && 'Verifying Payment'}
          </h1>

          <p className="mt-4 text-lg" style={{ color: 'var(--color-stone)' }}>
            {paymentStatus.message}
          </p>

          {paymentStatus.status === 'success' && paymentStatus.tickets && paymentStatus.tickets.length > 0 && (
            <div className="mt-8 space-y-8">
              <h2 className="text-2xl font-bold" style={{ color: 'var(--color-forest)' }}>
                Your Tickets
              </h2>

              <div className="grid gap-8 sm:grid-cols-2">
                {paymentStatus.tickets.map((ticket, index) => (
                  <div
                    key={ticket.id}
                    className="rounded-lg border p-6"
                    style={{ borderColor: 'var(--color-stone-mid)' }}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <p className="text-sm font-semibold" style={{ color: 'var(--color-stone)' }}>
                          Ticket {index + 1}
                        </p>
                        <p className="mt-2 font-bold text-lg" style={{ color: 'var(--color-forest)' }}>
                          {ticket.attendeeName}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--color-stone-mid)' }}>
                          {ticket.attendeeEmail}
                        </p>
                      </div>
                      <QrCode className="h-6 w-6 flex-shrink-0" style={{ color: 'var(--color-sage)' }} />
                    </div>

                    {/* QR Code Component */}
                    <div className="mt-6 flex justify-center">
                      <QRCodeDisplay
                        token={ticket.qrToken}
                        ticketId={ticket.id}
                        attendeeName={ticket.attendeeName}
                        attendeeEmail={ticket.attendeeEmail}
                        eventTitle={paymentStatus.eventTitle || 'Event'}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div
                className="rounded-lg p-4 text-sm"
                style={{
                  backgroundColor: 'var(--color-sage-pale)',
                  borderLeft: '4px solid var(--color-sage)',
                  color: 'var(--color-forest)',
                }}
              >
                <p className="font-semibold">✓ Tickets confirmed</p>
                <p className="mt-2">Check your email for confirmations and QR codes. Present your QR code at the event entrance.</p>
              </div>
            </div>
          )}

          <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/events"
              className="rounded px-6 py-3 font-semibold transition-opacity text-white"
              style={{ backgroundColor: 'var(--color-forest)' }}
            >
              Browse More Events
            </Link>

            {paymentStatus.status === 'failed' && (
              <Link
                href="/events"
                className="rounded border px-6 py-3 font-semibold transition-opacity"
                style={{ borderColor: 'var(--color-stone-mid)', color: 'var(--color-forest)' }}
              >
                Try Again
              </Link>
            )}
          </div>

          {reference && (
            <p className="mt-8 text-xs" style={{ color: 'var(--color-stone-mid)' }}>
              Reference: <code className="font-mono">{reference}</code>
            </p>
          )}
        </div>

        <div className="mt-8 text-center">
          <p style={{ color: 'var(--color-stone)' }}>
            Questions? Contact{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold" style={{ color: 'var(--color-forest)' }}>
              {SUPPORT_EMAIL}
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
