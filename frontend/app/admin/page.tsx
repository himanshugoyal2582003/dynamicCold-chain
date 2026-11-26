'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { MetricCard, Spinner, ErrorAlert } from '@/components/ui/shared';
import { apiFetch } from '@/lib/auth';

const NAV = [
  { href: '/admin', label: 'Overview', icon: '◈' },
  { href: '/admin/tracking', label: 'Global Map', icon: '📍' },
  { href: '/admin/trips', label: 'Trips', icon: '🛣️' },
  { href: '/admin/owners', label: 'Owners', icon: '🏢' },
  { href: '/admin/trucks', label: 'Trucks', icon: '🚛' },
  { href: '/admin/insurance', label: 'LSTM Insurance', icon: '🛡️' },
  { href: '/admin/users', label: 'Drivers', icon: '👤' },
  { href: '/admin/activity', label: 'Activity Log', icon: '📋' },
];

export default function AdminDashboard() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [metrics, setMetrics] = useState<any>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) router.replace('/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (user?.role === 'admin') {
      apiFetch('/api/admin/metrics')
        .then(setMetrics)
        .catch(e => setError(e.message))
        .finally(() => setMetricsLoading(false));
    }
  }, [user]);

  if (loading || !user) return null;

  return (
    <DashboardLayout navItems={NAV} title="Fleet Overview" roleLabel="Administrator">
      {error && <ErrorAlert message={error} />}

      {metricsLoading ? (
        <Spinner />
      ) : metrics ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard label="Total Owners" value={metrics.total_owners} icon="🏢" accent="var(--color-gold)" />
            <MetricCard label="Total Trucks" value={metrics.total_trucks} icon="🚛" accent="var(--status-on-trip)" />
            <MetricCard label="Active Drivers" value={metrics.active_drivers} icon="👤" accent="var(--status-available)" />
            <MetricCard label="Trucks on Trip" value={metrics.trucks_on_trip} icon="🛣️" accent="var(--status-maintenance)" />
          </div>

          <div className="card">
            <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-ink)' }}>
              Quick Navigation
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {NAV.slice(1).map(item => (
                <a
                  key={item.href}
                  href={item.href}
                  className="flex flex-col items-center gap-2 p-4 rounded border text-center text-sm transition-colors"
                  style={{ borderColor: 'var(--color-hairline)', color: 'var(--color-ink)' }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-gold)';
                    (e.currentTarget as HTMLElement).style.color = 'var(--color-gold)';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-hairline)';
                    (e.currentTarget as HTMLElement).style.color = 'var(--color-ink)';
                  }}
                >
                  <span className="text-2xl">{item.icon}</span>
                  <span className="font-medium">{item.label}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </DashboardLayout>
  );
}
