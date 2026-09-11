import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isPlatformAdmin } from '@/lib/authz';
import { db } from '@/db';
import { events, orders, tickets } from '@/db/schema';

import { PLATFORM_FEE_RATE } from '@/lib/fees';

const PLATFORM_FEE = PLATFORM_FEE_RATE;

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
    const totalRevenue = paidOrders.reduce((sum, o) => {
      const totalNum = typeof o.total === 'string' ? parseFloat(o.total) : o.total;
      return sum + totalNum;
    }, 0);
    const platformEarnings = totalRevenue * PLATFORM_FEE;
    const organizerPayouts = totalRevenue * (1 - PLATFORM_FEE);

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
      financial: { totalRevenue, platformEarnings, organizerPayouts, recentRevenue, averageDailyRevenue: (recentRevenue / 7).toFixed(2) },
      engagement: { checkedInAttendees, checkInRate, totalAttendees },
    });
  } catch (error) {
    console.error('Error fetching metrics:', error);
    return NextResponse.json({ error: 'Failed to fetch metrics' }, { status: 500 });
  }
}
