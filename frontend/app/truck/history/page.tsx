'use client';

import { useEffect, useState } from 'react';
import { useAuth, apiFetch } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Spinner, EmptyState, ErrorAlert, formatDateTime } from '@/components/ui/shared';

const NAV = [
  { href: '/truck', label: 'My Truck', icon: '🚛' },
  { href: '/truck/history', label: 'Trip History', icon: '🛣️' },
  { href: '/truck/issues', label: 'Issues', icon: '⚠️' },
];

export default function TripHistory() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [trips, setTrips] = useState<any[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && (!user || user.role !== 'truckUser')) router.replace('/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (user?.role === 'truckUser') {
      apiFetch('/api/truck/trip-history')
        .then(setTrips)
        .catch(e => setError(e.message))
        .finally(() => setFetching(false));
    }
  }, [user]);

  if (loading || !user) return null;

  return (
    <DashboardLayout navItems={NAV} title="Trip History" roleLabel="Truck User">
      <div className="space-y-4">
        {error && <ErrorAlert message={error} />}
        {fetching ? <Spinner /> : trips.length === 0 ? (
          <EmptyState message="No trips recorded yet. Start your first trip." icon="🛣️" />
        ) : (
          <div className="space-y-3">
            {trips.map(tr => (
              <div key={tr.id} className="card">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-sm font-semibold">{tr.origin} → {tr.destination}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--color-slate)' }}>{tr.cargo_type}</p>
                  </div>
                  {tr.ended_at ? (
                    <span className="badge-resolved inline-block px-2 py-0.5 rounded text-xs font-semibold">Completed</span>
                  ) : (
                    <span className="badge-on-trip inline-block px-2 py-0.5 rounded text-xs font-semibold">Active</span>
                  )}
                </div>
                <div className="flex gap-4 text-xs" style={{ color: 'var(--color-slate)' }}>
                  <span>Started: {formatDateTime(tr.started_at)}</span>
                  {tr.ended_at && <span>Ended: {formatDateTime(tr.ended_at)}</span>}
                </div>
                {tr.notes && (
                  <p className="text-xs mt-2 p-2 rounded" style={{ background: 'var(--color-ivory)', color: 'var(--color-slate)' }}>
                    {tr.notes}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
