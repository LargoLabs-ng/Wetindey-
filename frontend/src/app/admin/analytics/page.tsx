'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, TrendingUp, Download, BarChart3 } from 'lucide-react';

interface DailyMetrics {
  date: string;
  revenue: number;
  orders: number;
  platformFee: number;
}

interface Analytics {
  period: string;
  metrics: {
    totalRevenue: number;
    totalOrders: number;
    totalPlatformFee: number;
    avgOrderValue: number;
    growthRate: number;
  };
  dailyRevenue: DailyMetrics[];
  topMetrics: {
    highestDayRevenue: number;
    bestDay: DailyMetrics;
  };
}

export default function AdminAnalyticsPage() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    const fetchAnalytics = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/admin/analytics?days=${days}`);
        const data = await response.json();
        setAnalytics(data);
      } catch (error) {
        console.error('Failed to fetch analytics:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, [days]);

  const formatCurrency = (amount: number) => {
    return `₦${amount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  if (loading || !analytics) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: 'var(--color-ivory)' }}
      >
        <p style={{ color: 'var(--color-stone)' }}>Loading analytics...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-ivory)' }}>
      {/* Header */}
      <header className="border-b" style={{ borderColor: 'var(--color-stone-mid)' }}>
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <Link
              href="/admin"
              className="flex items-center gap-2 hover:opacity-75"
            >
              <ArrowLeft className="h-5 w-5" style={{ color: 'var(--color-forest)' }} />
              <span className="font-semibold" style={{ color: 'var(--color-forest)' }}>
                Back
              </span>
            </Link>
            <h1 className="text-xl font-bold" style={{ color: 'var(--color-forest)' }}>
              Analytics & Reporting
            </h1>
            <button
              className="flex items-center gap-2 rounded px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--color-sage)' }}
            >
              <Download className="h-4 w-4" />
              Export PDF
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Period Selector */}
        <div className="mb-8 flex gap-2">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-4 py-2 rounded font-semibold text-sm transition-colors ${
                days === d
                  ? 'text-white'
                  : 'border'
              }`}
              style={{
                backgroundColor: days === d ? 'var(--color-sage)' : 'transparent',
                borderColor: days === d ? 'transparent' : 'var(--color-stone-mid)',
                color: days === d ? 'white' : 'var(--color-stone)',
              }}
            >
              Last {d} Days
            </button>
          ))}
        </div>

        {/* Key Metrics */}
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div
            className="rounded-lg border p-6"
            style={{ borderColor: 'var(--color-stone-mid)', backgroundColor: 'white' }}
          >
            <p className="text-xs font-semibold" style={{ color: 'var(--color-stone-mid)' }}>
              TOTAL REVENUE
            </p>
            <p className="text-2xl font-bold mt-2" style={{ color: 'var(--color-sage)' }}>
              {formatCurrency(analytics.metrics.totalRevenue)}
            </p>
          </div>

          <div
            className="rounded-lg border p-6"
            style={{ borderColor: 'var(--color-stone-mid)', backgroundColor: 'white' }}
          >
            <p className="text-xs font-semibold" style={{ color: 'var(--color-stone-mid)' }}>
              TOTAL ORDERS
            </p>
            <p className="text-2xl font-bold mt-2" style={{ color: 'var(--color-forest)' }}>
              {analytics.metrics.totalOrders}
            </p>
          </div>

          <div
            className="rounded-lg border p-6"
            style={{ borderColor: 'var(--color-stone-mid)', backgroundColor: 'white' }}
          >
            <p className="text-xs font-semibold" style={{ color: 'var(--color-stone-mid)' }}>
              AVG ORDER VALUE
            </p>
            <p className="text-2xl font-bold mt-2" style={{ color: '#3b82f6' }}>
              {formatCurrency(analytics.metrics.avgOrderValue)}
            </p>
          </div>

          <div
            className="rounded-lg border p-6"
            style={{ borderColor: 'var(--color-stone-mid)', backgroundColor: 'white' }}
          >
            <p className="text-xs font-semibold" style={{ color: 'var(--color-stone-mid)' }}>
              GROWTH RATE
            </p>
            <p
              className="text-2xl font-bold mt-2"
              style={{ color: analytics.metrics.growthRate > 0 ? 'var(--color-sage)' : '#ef4444' }}
            >
              {analytics.metrics.growthRate > 0 ? '+' : ''}
              {analytics.metrics.growthRate.toFixed(2)}%
            </p>
          </div>
        </div>

        {/* Revenue Breakdown */}
        <div
          className="mb-8 rounded-lg border p-6"
          style={{ borderColor: 'var(--color-stone-mid)', backgroundColor: 'white' }}
        >
          <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-forest)' }}>
            Revenue Breakdown
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-sm font-semibold mb-2" style={{ color: 'var(--color-stone-mid)' }}>
                Gross Revenue
              </p>
              <p className="text-2xl font-bold" style={{ color: 'var(--color-forest)' }}>
                {formatCurrency(analytics.metrics.totalRevenue)}
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold mb-2" style={{ color: 'var(--color-stone-mid)' }}>
                Platform Fee (3%)
              </p>
              <p className="text-2xl font-bold" style={{ color: 'var(--color-sage)' }}>
                {formatCurrency(analytics.metrics.totalPlatformFee)}
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold mb-2" style={{ color: 'var(--color-stone-mid)' }}>
                Organizer Payouts
              </p>
              <p className="text-2xl font-bold" style={{ color: '#3b82f6' }}>
                {formatCurrency(
                  analytics.metrics.totalRevenue - analytics.metrics.totalPlatformFee
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Daily Revenue Table */}
        <div
          className="rounded-lg border"
          style={{ borderColor: 'var(--color-stone-mid)', backgroundColor: 'white' }}
        >
          <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--color-stone-mid)' }}>
            <h2 className="font-semibold flex items-center gap-2" style={{ color: 'var(--color-forest)' }}>
              <BarChart3 className="h-5 w-5" />
              Daily Revenue Trend
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ backgroundColor: 'var(--color-ivory)' }}>
                  <th
                    className="px-6 py-3 text-left text-sm font-semibold"
                    style={{ color: 'var(--color-stone)' }}
                  >
                    Date
                  </th>
                  <th
                    className="px-6 py-3 text-right text-sm font-semibold"
                    style={{ color: 'var(--color-stone)' }}
                  >
                    Revenue
                  </th>
                  <th
                    className="px-6 py-3 text-right text-sm font-semibold"
                    style={{ color: 'var(--color-stone)' }}
                  >
                    Orders
                  </th>
                  <th
                    className="px-6 py-3 text-right text-sm font-semibold"
                    style={{ color: 'var(--color-stone)' }}
                  >
                    Platform Fee
                  </th>
                </tr>
              </thead>
              <tbody>
                {analytics.dailyRevenue.map((day, index) => (
                  <tr
                    key={index}
                    style={{
                      borderBottom:
                        index < analytics.dailyRevenue.length - 1
                          ? `1px solid var(--color-stone-mid)`
                          : 'none',
                      backgroundColor:
                        day.revenue === analytics.topMetrics.highestDayRevenue
                          ? 'rgba(18, 178, 120, 0.05)'
                          : 'transparent',
                    }}
                  >
                    <td className="px-6 py-4 text-sm" style={{ color: 'var(--color-stone)' }}>
                      {new Date(day.date).toLocaleDateString('en-NG')}
                      {day.revenue === analytics.topMetrics.highestDayRevenue && (
                        <span
                          className="ml-2 text-xs px-2 py-1 rounded"
                          style={{
                            backgroundColor: 'rgba(18, 178, 120, 0.1)',
                            color: 'var(--color-sage)',
                          }}
                        >
                          Top Day
                        </span>
                      )}
                    </td>
                    <td
                      className="px-6 py-4 text-right font-semibold"
                      style={{ color: 'var(--color-sage)' }}
                    >
                      {formatCurrency(day.revenue)}
                    </td>
                    <td className="px-6 py-4 text-right text-sm" style={{ color: 'var(--color-stone)' }}>
                      {day.orders}
                    </td>
                    <td className="px-6 py-4 text-right text-sm" style={{ color: 'var(--color-stone)' }}>
                      {formatCurrency(day.platformFee)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
