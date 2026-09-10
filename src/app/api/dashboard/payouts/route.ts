import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { ticketTypes, orders } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireEventCapability } from '@/lib/authz';

const PLATFORM_FEE_PERCENTAGE = 0.06; // 6% platform fee

/**
 * GET /api/dashboard/payouts?eventId=...
 * Get financial data for an event
 */
export async function GET(request: NextRequest) {
  try {
    const access = await requireEventCapability(
      request.nextUrl.searchParams.get('eventId'),
      'finance:view'
    );
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { event } = access;
    const eventId = event.id;

    // Fetch ticket types for event
    const ticketTypesData = await db.query.ticketTypes.findMany({
      where: eq(ticketTypes.eventId, eventId),
    });

    // Fetch paid orders for event
    const paidOrders = await db.query.orders.findMany({
      where: eq(orders.eventId, eventId),
      with: {
        tickets: true,
        payments: true,
      },
    });

    // Calculate financials
    let totalRevenue = 0;
    const ticketTierBreakdown: Record<string, {
      tierName: string;
      price: number;
      sold: number;
      revenue: number;
      platformFee: number;
      netRevenue: number;
    }> = {};

    paidOrders.forEach((order) => {
      const hasSuccessPayment = order.payments?.some((p) => p.status === 'success');
      if (hasSuccessPayment) {
        const orderTotal = typeof order.total === 'string' ? parseFloat(order.total) : order.total;
        totalRevenue += orderTotal;

        // Group by ticket tier
        order.tickets.forEach((ticket) => {
          const ticketType = ticketTypesData.find((t) => t.id === ticket.ticketTypeId);
          if (ticketType) {
            const priceNum = typeof ticketType.price === 'string' ? parseFloat(ticketType.price) : ticketType.price;
            if (!ticketTierBreakdown[ticketType.id]) {
              ticketTierBreakdown[ticketType.id] = {
                tierName: ticketType.name,
                price: priceNum,
                sold: 0,
                revenue: 0,
                platformFee: 0,
                netRevenue: 0,
              };
            }
            ticketTierBreakdown[ticketType.id].sold += 1;
            ticketTierBreakdown[ticketType.id].revenue += priceNum;
          }
        });
      }
    });

    // Calculate fees
    const totalPlatformFee = totalRevenue * PLATFORM_FEE_PERCENTAGE;
    const netRevenue = totalRevenue - totalPlatformFee;

    // Add fees to breakdown
    Object.keys(ticketTierBreakdown).forEach((key) => {
      const tier = ticketTierBreakdown[key];
      tier.platformFee = tier.revenue * PLATFORM_FEE_PERCENTAGE;
      tier.netRevenue = tier.revenue - tier.platformFee;
    });

    return NextResponse.json({
      eventTitle: event.title,
      totalRevenue,
      totalPlatformFee,
      netRevenue,
      ticketTierBreakdown: Object.values(ticketTierBreakdown),
      platformFeePercentage: PLATFORM_FEE_PERCENTAGE * 100,
    });
  } catch (error) {
    console.error('Error fetching payout data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch payout data' },
      { status: 500 }
    );
  }
}
