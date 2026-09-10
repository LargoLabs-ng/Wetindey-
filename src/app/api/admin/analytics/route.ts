import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isPlatformAdmin } from '@/lib/authz';
import { db } from '@/db';
import { orders } from '@/db/schema';

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

    const days = parseInt(request.nextUrl.searchParams.get('days') || '30');
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const allOrders = await db.query.orders.findMany({ with: { payments: true } });

    const relevantOrders = allOrders.filter((o) => new Date(o.createdAt) >= startDate && o.payments?.some((p) => p.status === 'success'));

    const dailyData: Record<string, { revenue: number; orders: number; platformFee: number }> = {};

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0];
      dailyData[dateStr] = { revenue: 0, orders: 0, platformFee: 0 };
    }

    relevantOrders.forEach((order) => {
      const dateStr = new Date(order.createdAt).toISOString().split('T')[0];
      if (dailyData[dateStr]) {
        const totalNum = typeof order.total === 'string' ? parseFloat(order.total) : order.total;
        dailyData[dateStr].revenue += totalNum;
        dailyData[dateStr].orders += 1;
        dailyData[dateStr].platformFee += totalNum * 0.06;
      }
    });

    const revenueData = Object.entries(dailyData).map(([date, data]) => ({
      date,
      revenue: parseFloat(data.revenue.toFixed(2)),
      orders: data.orders,
      platformFee: parseFloat(data.platformFee.toFixed(2)),
    }));

    const totalRevenue = relevantOrders.reduce((sum, o) => {
      const totalNum = typeof o.total === 'string' ? parseFloat(o.total) : o.total;
      return sum + totalNum;
    }, 0);
    const totalOrders = relevantOrders.length;
    const totalPlatformFee = totalRevenue * 0.06;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    const prevPeriodStart = new Date(Date.now() - days * 2 * 24 * 60 * 60 * 1000);
    const prevPeriodEnd = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const prevOrders = allOrders.filter((o) => new Date(o.createdAt) >= prevPeriodStart && new Date(o.createdAt) < prevPeriodEnd && o.payments?.some((p) => p.status === 'success'));
    const prevRevenue = prevOrders.reduce((sum, o) => {
      const totalNum = typeof o.total === 'string' ? parseFloat(o.total) : o.total;
      return sum + totalNum;
    }, 0);
    const growthRate = prevRevenue > 0 ? (((totalRevenue - prevRevenue) / prevRevenue) * 100).toFixed(2) : '0';

    return NextResponse.json({
      period: `Last ${days} days`,
      metrics: { totalRevenue: parseFloat(totalRevenue.toFixed(2)), totalOrders, totalPlatformFee: parseFloat(totalPlatformFee.toFixed(2)), avgOrderValue: parseFloat(avgOrderValue.toFixed(2)), growthRate: parseFloat(growthRate as string) },
      dailyRevenue: revenueData,
      topMetrics: { highestDayRevenue: Math.max(...revenueData.map((d) => d.revenue)), bestDay: revenueData.reduce((prev, current) => current.revenue > prev.revenue ? current : prev) },
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 });
  }
}
