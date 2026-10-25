import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { ticketTypes, orders } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireEventCapability } from '@/lib/authz';

import { PLATFORM_FEE_RATE, quoteOrder } from '@/lib/fees';
import { monnifyFeeFromStoredResponse } from "@/lib/monnify";
import { paystackFeeFromStoredResponse } from "@/lib/paystack";

const PLATFORM_FEE_PERCENTAGE = PLATFORM_FEE_RATE;

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
      where: and(eq(orders.eventId, eventId), eq(orders.status, "paid")),
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
      paystackFee: number;
      monnifyFee: number;
      netRevenue: number;
    }> = {};
    let totalPaystackFee = 0;
    let totalMonnifyFee = 0;
    let totalPlatformFee = 0;

    paidOrders.forEach((order) => {
      const successfulPayment = order.payments?.find((p) => p.status === 'success');
      if (successfulPayment) {
        const faceValue =
          typeof order.subtotal === 'string' ? parseFloat(order.subtotal) : order.subtotal;
        totalRevenue += faceValue;
        const paymentFee =
          successfulPayment.provider === "monnify"
            ? monnifyFeeFromStoredResponse(successfulPayment.rawProviderResponse) ?? 0
            : successfulPayment.provider === "paystack"
              ? paystackFeeFromStoredResponse(successfulPayment.rawProviderResponse) ?? 0
              : 0;
        const paystackFee =
          successfulPayment.provider === "paystack" ? paymentFee : 0;
        const monnifyFee =
          successfulPayment.provider === "monnify" ? paymentFee : 0;
        totalPaystackFee += paystackFee;
        totalMonnifyFee += monnifyFee;
        const quote = quoteOrder(faceValue, {
          platformFeePaidBy: order.platformFeePaidBy,
        });
        if (quote.platformFeePaidBy === "organizer") {
          totalPlatformFee += quote.platformFee;
        }

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
                paystackFee: 0,
                monnifyFee: 0,
                netRevenue: 0,
              };
            }
            ticketTierBreakdown[ticketType.id].sold += 1;
            ticketTierBreakdown[ticketType.id].revenue += priceNum;
            ticketTierBreakdown[ticketType.id].paystackFee +=
              order.tickets.length > 0
                ? paystackFee / order.tickets.length
                : 0;
            ticketTierBreakdown[ticketType.id].monnifyFee +=
              order.tickets.length > 0
                ? monnifyFee / order.tickets.length
                : 0;
            if (quote.platformFeePaidBy === "organizer") {
              ticketTierBreakdown[ticketType.id].platformFee +=
                order.tickets.length > 0
                  ? quote.platformFee / order.tickets.length
                  : 0;
            }
          }
        });
      }
    });

    const netRevenue = totalRevenue - totalPlatformFee - totalMonnifyFee;

    // Calculate net per ticket tier. Paystack fees are paid by buyers; only
    // legacy Monnify fees reduce organiser proceeds.
    Object.keys(ticketTierBreakdown).forEach((key) => {
      const tier = ticketTierBreakdown[key];
      tier.netRevenue = tier.revenue - tier.platformFee - tier.monnifyFee;
    });

    return NextResponse.json({
      eventTitle: event.title,
      totalRevenue,
      totalPlatformFee,
      totalPaystackFee,
      totalMonnifyFee,
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
