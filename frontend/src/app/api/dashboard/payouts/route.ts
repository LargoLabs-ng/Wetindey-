import { NextRequest, NextResponse } from 'next/server';
import { inArray } from 'drizzle-orm';
import { db } from '@/db';
import { tickets } from '@/db/schema';
import { requireEventCapability } from '@/lib/authz';
import { PLATFORM_FEE_RATE } from '@/lib/fees';
import { computeEarnings, orderOrganizerNet } from '@/lib/earnings-compute';
import { loadEarningsOrders } from '@/lib/earnings';
import { ticketTypeOrder } from '@/lib/ticket-type-order';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * GET /api/dashboard/payouts?eventId=...
 *
 * One event's revenue report. It used to do its own arithmetic and could
 * disagree with the Finance page; it now reads the same order maths
 * (lib/earnings-compute.ts), so the event totals always add up to what the
 * Finance page shows for this event. Withdrawals stay on the Finance page:
 * they are account-wide.
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

    const orderInputs = await loadEarningsOrders([event.id]);
    const totals = computeEarnings(orderInputs, []);

    // Per tier: each live ticket carries an equal share of its order — the
    // same split the single-ticket refund uses — so the tiers add up to the
    // totals above, discounts included.
    const paidOrderIds = orderInputs.filter((o) => o.status === 'paid').map((o) => o.id);
    const [tierRows, ticketRows] = await Promise.all([
      db.query.ticketTypes.findMany({
        where: (t, { eq }) => eq(t.eventId, event.id),
        orderBy: (t) => ticketTypeOrder(t),
      }),
      paidOrderIds.length
        ? db
            .select({
              orderId: tickets.orderId,
              ticketTypeId: tickets.ticketTypeId,
              status: tickets.status,
            })
            .from(tickets)
            .where(inArray(tickets.orderId, paidOrderIds))
        : Promise.resolve([]),
    ]);
    const tierById = new Map(tierRows.map((t) => [t.id, t]));
    const orderById = new Map(orderInputs.map((o) => [o.id, o]));

    const breakdown: Record<string, {
      tierName: string;
      price: number;
      sold: number;
      revenue: number;
      platformFee: number;
      paystackFee: number;
      monnifyFee: number;
      netRevenue: number;
    }> = {};

    for (const ticket of ticketRows) {
      if (ticket.status !== 'valid' && ticket.status !== 'checked_in') continue;
      const order = orderById.get(ticket.orderId);
      const tier = tierById.get(ticket.ticketTypeId);
      if (!order || !tier || order.keptTicketCount <= 0) continue;
      const net = orderOrganizerNet(order);
      const share = 1 / order.keptTicketCount;
      const row = (breakdown[tier.id] ??= {
        tierName: tier.name,
        price: Number(tier.price),
        sold: 0,
        revenue: 0,
        platformFee: 0,
        paystackFee: 0,
        monnifyFee: 0,
        netRevenue: 0,
      });
      row.sold += 1;
      row.revenue += net.keptFace * share;
      row.platformFee += net.platformFee * share;
      row.paystackFee += net.buyerProcessingFee * share;
      row.monnifyFee += net.processingFee * share;
      row.netRevenue += net.net * share;
    }

    return NextResponse.json({
      eventTitle: event.title,
      totalRevenue: totals.grossSales,
      totalPlatformFee: totals.platformFee,
      totalPaystackFee: totals.buyerProcessingFee,
      totalMonnifyFee: totals.processingFee,
      netRevenue: totals.netEarned,
      settledNet: totals.settledNet,
      unsettledNet: totals.unsettledNet,
      refunded: totals.refunded,
      ticketsSold: totals.ticketsSold,
      ticketTierBreakdown: Object.values(breakdown).map((row) => ({
        ...row,
        revenue: round2(row.revenue),
        platformFee: round2(row.platformFee),
        paystackFee: round2(row.paystackFee),
        monnifyFee: round2(row.monnifyFee),
        netRevenue: round2(row.netRevenue),
      })),
      platformFeePercentage: PLATFORM_FEE_RATE * 100,
    });
  } catch (error) {
    console.error('Error fetching payout data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch payout data' },
      { status: 500 }
    );
  }
}
