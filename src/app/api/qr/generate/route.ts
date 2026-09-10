import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { getSessionUserId } from '@/lib/authz';

export async function GET(request: NextRequest) {
  try {
    // Nothing in the app calls this today, and it did CPU work for any
    // anonymous caller. Signed-in only until it has a real consumer.
    if (!(await getSessionUserId())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = request.nextUrl.searchParams.get('token');
    const ticketId = request.nextUrl.searchParams.get('ticketId');
    const attendeeName = request.nextUrl.searchParams.get('attendeeName');
    const eventTitle = request.nextUrl.searchParams.get('eventTitle');

    if (!token || !ticketId) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    const qrValue = JSON.stringify({
      ticketId,
      token,
      attendeeName: attendeeName || 'Attendee',
      eventTitle: eventTitle || 'Event',
      timestamp: new Date().toISOString(),
    });

    // Generate QR code as PNG
    const qrImage = await QRCode.toDataURL(qrValue, {
      errorCorrectionLevel: 'H',
      type: 'image/png',
      margin: 1,
      color: {
        dark: '#12372A', // Forest green
        light: '#ffffff',
      },
    });

    // Return as data URL that can be embedded in emails or downloaded
    return NextResponse.json({
      qrCode: qrImage,
      ticketId,
      token,
    });
  } catch (error) {
    console.error('Error generating QR code:', error);
    return NextResponse.json(
      { error: 'Failed to generate QR code' },
      { status: 500 }
    );
  }
}
