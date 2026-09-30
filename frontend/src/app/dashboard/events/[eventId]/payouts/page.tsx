'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, DollarSign, TrendingUp, Percent, Download } from 'lucide-react';
import { PLATFORM_FEE_RATE } from '@/lib/fees';

interface TicketTierBreakdown {
  tierName: string;
  price: number;
  sold: number;
  revenue: number;
  platformFee: number;
  netRevenue: number;
}

export default function PayoutsPage() {
  const routeParams = useParams();
  const eventId = routeParams.eventId as string;
  const [loading, setLoading] = useState(true);
  const [eventTitle, setEventTitle] = useState('');
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalPlatformFee, setTotalPlatformFee] = useState(0);
  const [netRevenue, setNetRevenue] = useState(0);
  const [feePercentage, setFeePercentage] = useState(PLATFORM_FEE_RATE * 100);
  const [breakdown, setBreakdown] = useState<TicketTierBreakdown[]>([]);

  // Fetch payout data
  useEffect(() => {
    const fetchPayouts = async () => {
      try {
        const response = await fetch(
          `/api/dashboard/payouts?eventId=${eventId}`
        );
        const data = await response.json();

        setEventTitle(data.eventTitle || 'Event');
        setTotalRevenue(data.totalRevenue || 0);
        setTotalPlatformFee(data.totalPlatformFee || 0);
        setNetRevenue(data.netRevenue || 0);
        setFeePercentage(data.platformFeePercentage ?? PLATFORM_FEE_RATE * 100);
        setBreakdown(data.ticketTierBreakdown || []);
      } catch (error) {
        console.error('Failed to fetch payouts:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchPayouts();
  }, [eventId]);

  const formatCurrency = (amount: number) => {
    return `₦${amount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div>
      {/* Header */}
      <header className="mb-6">
        <div className="">
          <div className="flex items-center justify-between">
            <Link
              href={`/dashboard`}
              className="flex items-center gap-2 hover:opacity-75"
            >
              <ArrowLeft className="h-5 w-5" style={{ color: 'var(--color-on-dark)' }} />
              <span className="font-semibold" style={{ color: 'var(--color-on-dark)' }}>
                Back
              </span>
            </Link>
            <h1 className="text-xl font-bold" style={{ color: 'var(--color-on-dark)' }}>
              Payouts & Financials
            </h1>
            <button
              className="flex items-center gap-2 rounded px-4 py-2 text-sm font-semibold text-canvas transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--color-gold)' }}
            >
              <Download className="h-4 w-4" />
              Export Report
            </button>
          </div>
        </div>
      </header>

      <div className="">
        {loading ? (
          <div className="rounded-lg border p-8 text-center" style={{ borderColor: 'var(--color-line-dark)', backgroundColor: 'var(--color-surface)' }}>
            <p style={{ color: 'var(--color-on-dark-2)' }}>Loading financial data...</p>
          </div>
        ) : (
          <>
            {/* Financial Summary Cards */}
            <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {/* Gross Revenue */}
              <div className="rounded-lg border p-6" style={{ borderColor: 'var(--color-line-dark)', backgroundColor: 'var(--color-surface)' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold" style={{ color: 'var(--color-on-dark-3)' }}>
                    GROSS REVENUE
                  </span>
                  <DollarSign className="h-4 w-4" style={{ color: 'var(--color-sage)' }} />
                </div>
                <p className="text-2xl font-bold" style={{ color: 'var(--color-on-dark)' }}>
                  {formatCurrency(totalRevenue)}
                </p>
              </div>

              {/* Platform Fee */}
              <div className="rounded-lg border p-6" style={{ borderColor: 'var(--color-line-dark)', backgroundColor: 'var(--color-surface)' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold" style={{ color: 'var(--color-on-dark-3)' }}>
                    PLATFORM FEE
                  </span>
                  <Percent className="h-4 w-4" style={{ color: '#f59e0b' }} />
                </div>
                <p className="text-2xl font-bold" style={{ color: '#ef4444' }}>
                  {formatCurrency(totalPlatformFee)}
                </p>
                <p className="text-xs mt-2" style={{ color: 'var(--color-on-dark-2)' }}>
                  {feePercentage}% of revenue
                </p>
              </div>

              {/* Net Revenue */}
              <div className="rounded-lg border p-6 lg:col-span-2" style={{ borderColor: 'var(--color-line-dark)', backgroundColor: 'var(--color-surface)' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold" style={{ color: 'var(--color-on-dark-3)' }}>
                    YOUR NET REVENUE
                  </span>
                  <TrendingUp className="h-4 w-4" style={{ color: 'var(--color-sage)' }} />
                </div>
                <p className="text-3xl font-bold" style={{ color: 'var(--color-sage)' }}>
                  {formatCurrency(netRevenue)}
                </p>
                <p className="text-xs mt-2" style={{ color: 'var(--color-on-dark-2)' }}>
                  After platform fees
                </p>
              </div>
            </div>

            {/* Revenue Breakdown by Ticket Tier */}
            <div className="rounded-lg border" style={{ borderColor: 'var(--color-line-dark)', backgroundColor: 'var(--color-surface)' }}>
              <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--color-line-dark)' }}>
                <h2 className="font-semibold" style={{ color: 'var(--color-on-dark)' }}>
                  Revenue by Ticket Tier
                </h2>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr style={{ backgroundColor: 'var(--color-canvas)' }}>
                      <th className="px-6 py-3 text-left text-sm font-semibold" style={{ color: 'var(--color-on-dark-2)' }}>
                        Ticket Tier
                      </th>
                      <th className="px-6 py-3 text-right text-sm font-semibold" style={{ color: 'var(--color-on-dark-2)' }}>
                        Price
                      </th>
                      <th className="px-6 py-3 text-right text-sm font-semibold" style={{ color: 'var(--color-on-dark-2)' }}>
                        Sold
                      </th>
                      <th className="px-6 py-3 text-right text-sm font-semibold" style={{ color: 'var(--color-on-dark-2)' }}>
                        Gross Revenue
                      </th>
                      <th className="px-6 py-3 text-right text-sm font-semibold" style={{ color: 'var(--color-on-dark-2)' }}>
                        Platform Fee
                      </th>
                      <th className="px-6 py-3 text-right text-sm font-semibold" style={{ color: 'var(--color-on-dark)' }}>
                        Net Revenue
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdown.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-4 text-center" style={{ color: 'var(--color-on-dark-3)' }}>
                          No sales data yet
                        </td>
                      </tr>
                    ) : (
                      breakdown.map((tier, index) => (
                        <tr
                          key={index}
                          style={{
                            borderBottom: index < breakdown.length - 1 ? `1px solid var(--color-line-dark)` : 'none',
                          }}
                        >
                          <td className="px-6 py-4 font-medium" style={{ color: 'var(--color-on-dark)' }}>
                            {tier.tierName}
                          </td>
                          <td className="px-6 py-4 text-right text-sm" style={{ color: 'var(--color-on-dark-2)' }}>
                            {formatCurrency(tier.price)}
                          </td>
                          <td className="px-6 py-4 text-right text-sm" style={{ color: 'var(--color-on-dark-2)' }}>
                            {tier.sold}
                          </td>
                          <td className="px-6 py-4 text-right text-sm" style={{ color: 'var(--color-on-dark-2)' }}>
                            {formatCurrency(tier.revenue)}
                          </td>
                          <td className="px-6 py-4 text-right text-sm" style={{ color: '#ef4444' }}>
                            -{formatCurrency(tier.platformFee)}
                          </td>
                          <td className="px-6 py-4 text-right font-semibold" style={{ color: 'var(--color-sage)' }}>
                            {formatCurrency(tier.netRevenue)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Summary Row */}
              <div className="px-6 py-4 border-t font-semibold" style={{ borderColor: 'var(--color-line-dark)', backgroundColor: 'var(--color-canvas)' }}>
                <div className="flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span style={{ color: 'var(--color-on-dark-2)' }}>TOTAL</span>
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-right sm:justify-end">
                    <div style={{ color: 'var(--color-on-dark)' }}>
                      {formatCurrency(totalRevenue)}
                    </div>
                    <div style={{ color: '#ef4444' }}>
                      -{formatCurrency(totalPlatformFee)}
                    </div>
                    <div style={{ color: 'var(--color-sage)' }}>
                      {formatCurrency(netRevenue)}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Info Box */}
            <div
              className="mt-8 rounded-lg border-l-4 p-4"
              style={{
                borderColor: 'var(--color-line-dark)',
                backgroundColor: 'rgba(18, 178, 120, 0.05)',
              }}
            >
              <p style={{ color: 'var(--color-on-dark-2)', fontSize: '14px' }}>
                <strong>About Platform Fees:</strong> Wetin Dey charges {feePercentage}% on each ticket sale to support event infrastructure, payment processing, and customer support. This fee is deducted from your gross revenue to calculate your net payout.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
