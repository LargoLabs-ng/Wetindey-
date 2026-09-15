'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  BarChart3,
  Users,
  TrendingUp,
  DollarSign,
  CheckCircle,
  Download,
  ArrowRight,
} from 'lucide-react';
import { PLATFORM_FEE_RATE } from '@/lib/fees';

interface Metrics {
  overview: {
    totalEvents: number;
    activeEvents: number;
    totalOrganizers: number;
    totalAttendees: number;
  };
  financial: {
    totalRevenue: number;
    platformEarnings: number;
    organizerPayouts: number;
    recentRevenue: number;
    averageDailyRevenue: string;
  };
  engagement: {
    checkedInAttendees: number;
    checkInRate: string;
    totalAttendees: number;
  };
}

export default function AdminDashboard() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const response = await fetch('/api/admin/metrics');
        const data = await response.json();
        setMetrics(data);
      } catch (error) {
        console.error('Failed to fetch metrics:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
    // Auto-refresh every 30 seconds for real-time updates
    const interval = setInterval(fetchMetrics, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleExport = async (type: 'events' | 'financials' | 'attendees') => {
    setExporting(true);
    try {
      const response = await fetch(
        `/api/admin/export?format=csv&type=${type}`
      );
      const blob = await response.blob();

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${type}-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setExporting(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return `₦${amount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: 'var(--color-ivory)' }}
      >
        <p style={{ color: 'var(--color-stone)' }}>Loading dashboard...</p>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: 'var(--color-ivory)' }}
      >
        <p style={{ color: '#ef4444' }}>Failed to load dashboard</p>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: 'var(--color-ivory)' }}
    >
      {/* Header */}
      <header
        className="border-b sticky top-0 z-50"
        style={{ borderColor: 'var(--color-stone-mid)' }}
      >
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div>
              <h1
                className="text-2xl font-bold"
                style={{ color: 'var(--color-forest)' }}
              >
                Wetin Dey Admin
              </h1>
              <p
                className="text-sm mt-1"
                style={{ color: 'var(--color-stone-mid)' }}
              >
                Platform Dashboard • Real-time Analytics
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleExport('events')}
                disabled={exporting}
                className="flex items-center gap-2 rounded px-3 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-sage)' }}
              >
                <Download className="h-4 w-4" />
                Export
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Key Metrics */}
        <div className="mb-8">
          <h2
            className="text-lg font-semibold mb-4"
            style={{ color: 'var(--color-forest)' }}
          >
            Platform Overview
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Total Events */}
            <div
              className="rounded-lg border p-6"
              style={{
                borderColor: 'var(--color-stone-mid)',
                backgroundColor: 'white',
              }}
            >
              <div className="flex items-center justify-between mb-3">
                <span
                  className="text-xs font-semibold"
                  style={{ color: 'var(--color-stone-mid)' }}
                >
                  TOTAL EVENTS
                </span>
                <BarChart3
                  className="h-4 w-4"
                  style={{ color: 'var(--color-sage)' }}
                />
              </div>
              <p
                className="text-3xl font-bold"
                style={{ color: 'var(--color-forest)' }}
              >
                {metrics.overview.totalEvents}
              </p>
              <p className="text-xs mt-2" style={{ color: 'var(--color-stone)' }}>
                {metrics.overview.activeEvents} active
              </p>
            </div>

            {/* Total Organizers */}
            <div
              className="rounded-lg border p-6"
              style={{
                borderColor: 'var(--color-stone-mid)',
                backgroundColor: 'white',
              }}
            >
              <div className="flex items-center justify-between mb-3">
                <span
                  className="text-xs font-semibold"
                  style={{ color: 'var(--color-stone-mid)' }}
                >
                  ORGANIZERS
                </span>
                <Users
                  className="h-4 w-4"
                  style={{ color: '#3b82f6' }}
                />
              </div>
              <p
                className="text-3xl font-bold"
                style={{ color: 'var(--color-forest)' }}
              >
                {metrics.overview.totalOrganizers}
              </p>
            </div>

            {/* Platform Earnings */}
            <div
              className="rounded-lg border p-6"
              style={{
                borderColor: 'var(--color-stone-mid)',
                backgroundColor: 'white',
              }}
            >
              <div className="flex items-center justify-between mb-3">
                <span
                  className="text-xs font-semibold"
                  style={{ color: 'var(--color-stone-mid)' }}
                >
                  PLATFORM EARNINGS
                </span>
                <DollarSign
                  className="h-4 w-4"
                  style={{ color: 'var(--color-sage)' }}
                />
              </div>
              <p
                className="text-2xl font-bold"
                style={{ color: 'var(--color-sage)' }}
              >
                {formatCurrency(metrics.financial.platformEarnings)}
              </p>
              <p className="text-xs mt-2" style={{ color: 'var(--color-stone)' }}>
                {PLATFORM_FEE_RATE * 100}% of revenue
              </p>
            </div>

            {/* Check-in Rate */}
            <div
              className="rounded-lg border p-6"
              style={{
                borderColor: 'var(--color-stone-mid)',
                backgroundColor: 'white',
              }}
            >
              <div className="flex items-center justify-between mb-3">
                <span
                  className="text-xs font-semibold"
                  style={{ color: 'var(--color-stone-mid)' }}
                >
                  CHECK-IN RATE
                </span>
                <CheckCircle
                  className="h-4 w-4"
                  style={{ color: 'var(--color-sage)' }}
                />
              </div>
              <p
                className="text-3xl font-bold"
                style={{ color: 'var(--color-forest)' }}
              >
                {metrics.engagement.checkInRate}%
              </p>
              <p className="text-xs mt-2" style={{ color: 'var(--color-stone)' }}>
                {metrics.engagement.checkedInAttendees} /
                {metrics.engagement.totalAttendees}
              </p>
            </div>
          </div>
        </div>

        {/* Financial Summary */}
        <div
          className="mb-8 rounded-lg border p-6"
          style={{
            borderColor: 'var(--color-stone-mid)',
            backgroundColor: 'white',
          }}
        >
          <h2
            className="text-lg font-semibold mb-4"
            style={{ color: 'var(--color-forest)' }}
          >
            Financial Summary
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p
                className="text-sm font-semibold mb-2"
                style={{ color: 'var(--color-stone-mid)' }}
              >
                Total Revenue (Gross)
              </p>
              <p
                className="text-2xl font-bold"
                style={{ color: 'var(--color-forest)' }}
              >
                {formatCurrency(metrics.financial.totalRevenue)}
              </p>
            </div>
            <div>
              <p
                className="text-sm font-semibold mb-2"
                style={{ color: 'var(--color-stone-mid)' }}
              >
                Organizer Payouts
              </p>
              <p
                className="text-2xl font-bold"
                style={{ color: '#3b82f6' }}
              >
                {formatCurrency(metrics.financial.organizerPayouts)}
              </p>
            </div>
            <div>
              <p
                className="text-sm font-semibold mb-2"
                style={{ color: 'var(--color-stone-mid)' }}
              >
                Avg Daily Revenue (Last 7 Days)
              </p>
              <p
                className="text-2xl font-bold"
                style={{ color: 'var(--color-sage)' }}
              >
                {formatCurrency(parseFloat(metrics.financial.averageDailyRevenue))}
              </p>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="mb-8">
          <h2
            className="text-lg font-semibold mb-4"
            style={{ color: 'var(--color-forest)' }}
          >
            Quick Actions
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Link
              href="/admin/events"
              className="rounded-lg border p-4 hover:border-sage transition-colors flex items-center justify-between"
              style={{ borderColor: 'var(--color-stone-mid)' }}
            >
              <div>
                <p
                  className="font-semibold"
                  style={{ color: 'var(--color-forest)' }}
                >
                  Manage Events
                </p>
                <p
                  className="text-sm mt-1"
                  style={{ color: 'var(--color-stone)' }}
                >
                  View and manage all events
                </p>
              </div>
              <ArrowRight
                className="h-5 w-5"
                style={{ color: 'var(--color-sage)' }}
              />
            </Link>

            <Link
              href="/admin/analytics"
              className="rounded-lg border p-4 hover:border-sage transition-colors flex items-center justify-between"
              style={{ borderColor: 'var(--color-stone-mid)' }}
            >
              <div>
                <p
                  className="font-semibold"
                  style={{ color: 'var(--color-forest)' }}
                >
                  Analytics
                </p>
                <p
                  className="text-sm mt-1"
                  style={{ color: 'var(--color-stone)' }}
                >
                  Revenue trends & reports
                </p>
              </div>
              <ArrowRight
                className="h-5 w-5"
                style={{ color: 'var(--color-sage)' }}
              />
            </Link>

            <button
              onClick={() => handleExport('financials')}
              className="rounded-lg border p-4 hover:border-sage transition-colors flex items-center justify-between text-left"
              style={{ borderColor: 'var(--color-stone-mid)' }}
            >
              <div>
                <p
                  className="font-semibold"
                  style={{ color: 'var(--color-forest)' }}
                >
                  Export Data
                </p>
                <p
                  className="text-sm mt-1"
                  style={{ color: 'var(--color-stone)' }}
                >
                  CSV & PDF reports
                </p>
              </div>
              <Download
                className="h-5 w-5"
                style={{ color: 'var(--color-sage)' }}
              />
            </button>
          </div>
        </div>

        {/* Real-time Status */}
        <div
          className="rounded-lg border-l-4 p-4"
          style={{
            borderColor: 'var(--color-sage)',
            backgroundColor: 'rgba(18, 178, 120, 0.05)',
          }}
        >
          <p style={{ color: 'var(--color-stone)', fontSize: '14px' }}>
            <strong>✓ Real-time Dashboard:</strong> Metrics refresh every 30
            seconds. Last updated:{' '}
            {new Date().toLocaleTimeString()}
          </p>
        </div>
      </main>
    </div>
  );
}
