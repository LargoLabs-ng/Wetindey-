'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { CheckCircle, XCircle, AlertCircle, Camera, Smartphone, Search, ArrowLeft } from 'lucide-react';

interface ScanResult {
  status: 'valid' | 'invalid' | 'already_checked_in';
  message: string;
  attendeeName?: string;
  ticketType?: string;
  checkedInAt?: string;
}

export function CheckInConsole({
  eventId,
  eventTitle,
  backHref,
}: {
  eventId: string;
  eventTitle?: string;
  backHref?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Start camera
  useEffect(() => {
    if (!scanning || manualMode) return;

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        // Simple QR code detection simulation
        // In production, use jsQR or similar library
        const interval = setInterval(() => {
          // Placeholder for QR detection
          // This would integrate with a QR library like jsQR
        }, 100);

        return () => {
          clearInterval(interval);
          stream.getTracks().forEach((track) => track.stop());
        };
      } catch (error) {
        setCameraError('Unable to access camera. Try manual search.');
        console.error('Camera error:', error);
      }
    };

    startCamera();
  }, [scanning, manualMode]);

  // Handle manual ticket search
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setSearching(true);
    try {
      const response = await fetch(
        `/api/check-in/search?eventId=${eventId}&query=${encodeURIComponent(searchQuery)}`
      );
      const data = await response.json();
      setSearchResults(data.results || []);
    } catch (error) {
      console.error('Search error:', error);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  // Handle manual check-in
  const handleManualCheckIn = async (ticketId: string) => {
    try {
      const response = await fetch('/api/check-in/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId, eventId: eventId }),
      });

      const data = await response.json();
      setResult(data);
      setSearchResults([]);
    } catch (error) {
      console.error('Check-in error:', error);
    }
  };

  // Simulate QR scan (in production, use jsQR library)
  const simulateScan = async (qrData: string) => {
    try {
      const response = await fetch('/api/check-in/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: qrData, eventId: eventId }),
      });

      const data = await response.json();
      setResult(data);
    } catch (error) {
      console.error('Scan error:', error);
      setResult({
        status: 'invalid',
        message: 'Failed to verify ticket. Please try again.',
      });
    }
  };

  return (
    <div>
      {/* Header */}
      <header className="mb-6">
        {backHref && (
          <Link
            href={backHref}
            className="inline-flex items-center gap-2 text-sm text-on-dark-2 transition-colors hover:text-on-dark"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to event
          </Link>
        )}
        {eventTitle && (
          <p className="mt-2 text-sm text-on-dark-2">
            Checking in for{" "}
            <span className="font-semibold text-on-dark">{eventTitle}</span>
          </p>
        )}
      </header>

      <div>
        {/* Result Display */}
        {result && (
          <div
            className="mb-8 rounded-lg border p-8 text-center"
            style={{
              borderColor: 'var(--color-line-dark)',
              backgroundColor:
                result.status === 'valid'
                  ? 'rgba(18, 178, 120, 0.05)'
                  : result.status === 'already_checked_in'
                    ? 'rgba(251, 191, 36, 0.05)'
                    : 'rgba(239, 68, 68, 0.05)',
            }}
          >
            {result.status === 'valid' && (
              <CheckCircle className="mx-auto mb-4 h-16 w-16" style={{ color: 'var(--color-sage)' }} />
            )}
            {result.status === 'already_checked_in' && (
              <AlertCircle className="mx-auto mb-4 h-16 w-16" style={{ color: '#f59e0b' }} />
            )}
            {result.status === 'invalid' && <XCircle className="mx-auto mb-4 h-16 w-16 text-red-500" />}

            <h2
              className="text-2xl font-bold mb-2"
              style={{
                color:
                  result.status === 'valid'
                    ? 'var(--color-sage)'
                    : result.status === 'already_checked_in'
                      ? '#d97706'
                      : '#dc2626',
              }}
            >
              {result.status === 'valid' && '✓ VALID TICKET'}
              {result.status === 'already_checked_in' && '⚠ ALREADY CHECKED IN'}
              {result.status === 'invalid' && '✗ INVALID TICKET'}
            </h2>

            <p className="text-lg mb-4" style={{ color: 'var(--color-on-dark-2)' }}>
              {result.message}
            </p>

            {result.attendeeName && (
              <div className="rounded bg-surface-2 p-4 mb-4">
                <p className="text-sm" style={{ color: 'var(--color-on-dark-3)' }}>
                  Attendee
                </p>
                <p className="font-semibold" style={{ color: 'var(--color-on-dark)' }}>
                  {result.attendeeName}
                </p>
                {result.ticketType && (
                  <p className="text-sm mt-2" style={{ color: 'var(--color-on-dark-2)' }}>
                    {result.ticketType}
                  </p>
                )}
              </div>
            )}

            <button
              onClick={() => {
                setResult(null);
                setManualMode(false);
                setSearchQuery('');
                setSearchResults([]);
              }}
              className="rounded px-6 py-2 font-semibold text-canvas transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--color-gold)' }}
            >
              Scan Next
            </button>
          </div>
        )}

        {!result && !manualMode && (
          <div className="rounded-lg border p-8 text-center" style={{ borderColor: 'var(--color-line-dark)', backgroundColor: 'var(--color-surface)' }}>
            <Camera className="mx-auto mb-4 h-16 w-16" style={{ color: 'var(--color-sage)' }} />

            <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--color-on-dark)' }}>
              Event Check-In
            </h1>
            <p className="mb-6" style={{ color: 'var(--color-on-dark-2)' }}>
              Scan attendee QR codes to verify entry
            </p>

            {cameraError && (
              <div
                className="mb-6 rounded p-4"
                style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', borderLeft: '4px solid #ef4444' }}
              >
                <p className="text-sm text-red-700">{cameraError}</p>
              </div>
            )}

            {scanning ? (
              <div className="mb-6 rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--color-canvas)' }}>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  className="w-full aspect-square object-cover"
                />
              </div>
            ) : (
              <div
                className="mb-6 flex items-center justify-center rounded-lg"
                style={{ backgroundColor: 'var(--color-canvas)', aspectRatio: '1' }}
              >
                <Smartphone className="h-12 w-12" style={{ color: 'var(--color-on-dark-3)' }} />
              </div>
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button
                onClick={() => setScanning(!scanning)}
                className="rounded px-6 py-3 font-semibold text-canvas transition-opacity hover:opacity-90"
                style={{ backgroundColor: 'var(--color-gold)' }}
              >
                {scanning ? 'Stop Scanner' : 'Start Scanner'}
              </button>

              <button
                onClick={() => setManualMode(true)}
                className="rounded border px-6 py-3 font-semibold transition-opacity hover:opacity-75"
                style={{ borderColor: 'var(--color-line-dark)', color: 'var(--color-on-dark)' }}
              >
                Manual Lookup
              </button>
            </div>
          </div>
        )}

        {!result && manualMode && (
          <div className="rounded-lg border p-8" style={{ borderColor: 'var(--color-line-dark)', backgroundColor: 'var(--color-surface)' }}>
            <h1 className="text-2xl font-bold mb-6" style={{ color: 'var(--color-on-dark)' }}>
              Manual Attendee Lookup
            </h1>

            <div className="mb-6">
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-on-dark-2)' }}>
                Search by name, email, ticket ID, or phone
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="Enter search query"
                  className="flex-1 rounded border px-4 py-2"
                  style={{ borderColor: 'var(--color-line-dark)' }}
                />
                <button
                  onClick={handleSearch}
                  disabled={searching}
                  className="rounded px-6 py-2 font-semibold text-canvas transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: 'var(--color-gold)' }}
                >
                  <Search className="h-5 w-5" />
                </button>
              </div>
            </div>

            {searchResults.length > 0 && (
              <div className="mb-6 space-y-3">
                {searchResults.map((ticket) => (
                  <div
                    key={ticket.id}
                    className="flex items-center justify-between rounded-lg border p-4"
                    style={{ borderColor: 'var(--color-line-dark)' }}
                  >
                    <div>
                      <p className="font-semibold" style={{ color: 'var(--color-on-dark)' }}>
                        {ticket.attendeeName}
                      </p>
                      <p className="text-sm" style={{ color: 'var(--color-on-dark-3)' }}>
                        {ticket.ticketType} • {ticket.attendeeEmail}
                      </p>
                    </div>
                    <button
                      onClick={() => handleManualCheckIn(ticket.id)}
                      className="rounded px-4 py-2 text-sm font-semibold text-canvas transition-opacity hover:opacity-90"
                      style={{ backgroundColor: 'var(--color-gold)' }}
                    >
                      Check In
                    </button>
                  </div>
                ))}
              </div>
            )}

            {searchQuery && searchResults.length === 0 && !searching && (
              <p className="text-center text-sm" style={{ color: 'var(--color-on-dark-3)' }}>
                No results found
              </p>
            )}

            <button
              onClick={() => setManualMode(false)}
              className="w-full rounded border px-6 py-3 font-semibold transition-opacity hover:opacity-75"
              style={{ borderColor: 'var(--color-line-dark)', color: 'var(--color-on-dark)' }}
            >
              Back to Scanner
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
