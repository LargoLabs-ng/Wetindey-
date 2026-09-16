import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isPlatformAdmin } from '@/lib/authz';
import { db } from '@/db';
import { events, orders, tickets } from '@/db/schema';


export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    // Platform-admin only. Previously any signed-in organizer could read
    // every organization's revenue through these endpoints.
    if (!(await isPlatformAdmin())) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const allEvents = await db.query.events.findMany();
    const totalEvents = allEvents.length;
    const activeEvents = allEvents.filter((e) => e.status === 'published').length;
    const totalOrganizers = new Set(allEvents.map((e) => e.organizationId)).size;

    const allOrders = await db.query.orders.findMany({
      with: { payments: true },
    });

    const paidOrders = allOrders.filter((o) => o.payments?.some((p) => p.status === 'success'));
    const num = (v: string | number) => (typeof v === 'string' ? parseFloat(v) : v);

    // What buyers actually paid, fees included.
    const totalRevenue = paidOrders.reduce((sum, o) => sum + num(o.total), 0);
    // Ticket face value — the organizer's side, and the base our cut is taken
    // from. Multiplying totalRevenue by the rate counts Paystack's fee as our
    // revenue, which overstated platform earnings on every buyer-pays sale.
    const ticketValue = paidOrders.reduce((sum, o) => sum + num(o.subtotal), 0);
    // Our cut was worked out per order at checkout and stored; summing the
    // stored figure is exact, and survives any future rate change.
    const platformEarnings = paidOrders.reduce((sum, o) => sum + num(o.fees), 0);
    const organizerPayouts = ticketValue - platformEarnings;

    const allTickets = await db.query.tickets.findMany();
    const totalAttendees = allTickets.length;
    const checkedInAttendees = allTickets.filter((t) => t.status === 'checked_in').length;
    const checkInRate = totalAttendees > 0 ? ((checkedInAttendees / totalAttendees) * 100).toFixed(2) : '0';

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentOrders = paidOrders.filter((o) => new Date(o.createdAt) > sevenDaysAgo);
    const recentRevenue = recentOrders.reduce((sum, o) => {
      const totalNum = typeof o.total === 'string' ? parseFloat(o.total) : o.total;
      return sum + totalNum;
    }, 0);

    return NextResponse.json({
      overview: { totalEvents, activeEvents, totalOrganizers, totalAttendees },
      financial: {
        // Every naira that has moved through the platform on a paid order.
        totalRevenue,
        paidOrders: paidOrders.length,
        ticketValue,
        platformEarnings,
        organizerPayouts,
        recentRevenue,
        averageDailyRevenue: (recentRevenue / 7).toFixed(2),
      },
      engagement: { checkedInAttendees, checkInRate, totalAttendees },
    });
  } catch (error) {
    console.error('Error fetching metrics:', error);
    return NextResponse.json({ error: 'Failed to fetch metrics' }, { status: 500 });
  }
}
