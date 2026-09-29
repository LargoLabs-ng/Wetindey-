'use client';

import { QRCodeCanvas } from 'qrcode.react';
import { useRef } from 'react';

interface QRCodeDisplayProps {
  token: string;
  attendeeName: string;
  attendeeEmail: string;
  eventTitle: string;
  ticketId: string;
}

export function QRCodeDisplay({
  token,
  attendeeName,
  attendeeEmail,
  eventTitle,
  ticketId,
}: QRCodeDisplayProps) {
  const qrRef = useRef<HTMLDivElement>(null);

  const qrValue = JSON.stringify({
    ticketId,
    token,
    attendeeName,
    attendeeEmail,
    eventTitle,
    timestamp: new Date().toISOString(),
  });

  const downloadQR = () => {
    const canvas = qrRef.current?.querySelector('canvas') as HTMLCanvasElement;
    if (!canvas) return;

    const url = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = url;
    link.download = `ticket-${ticketId}.png`;
    link.click();
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        ref={qrRef}
        className="p-4 bg-white rounded-lg"
      >
        <QRCodeCanvas
          value={qrValue}
          size={200}
          level="H"
          includeMargin={true}
          fgColor="#12372A"
          bgColor="#ffffff"
        />
      </div>

      <button
        onClick={downloadQR}
        className="text-sm font-semibold px-4 py-2 rounded transition-opacity hover:opacity-75"
        style={{ backgroundColor: 'var(--color-forest)', color: 'white' }}
      >
        Download QR Code
      </button>

      <p className="text-xs text-center" style={{ color: 'var(--color-stone-mid)' }}>
        Scan this code at the event entrance
      </p>
    </div>
  );
}
