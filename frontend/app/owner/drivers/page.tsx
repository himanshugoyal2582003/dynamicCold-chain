'use client';

import { useEffect, useState } from 'react';
import { useAuth, apiFetch } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Spinner, EmptyState, ErrorAlert } from '@/components/ui/shared';

const NAV = [
  { href: '/owner', label: 'My Fleet', icon: '🚛' },
  { href: '/owner/drivers', label: 'Drivers', icon: '👤' },
];

export default function OwnerDrivers() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [drivers, setDrivers] = useState<any[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && (!user || user.role !== 'owner')) router.replace('/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (user?.role === 'owner') {
      apiFetch('/api/owner/drivers')
        .then(setDrivers)
        .catch(e => setError(e.message))
        .finally(() => setFetching(false));
    }
  }, [user]);

  if (loading || !user) return null;

  return (
    <DashboardLayout navItems={NAV} title="My Drivers" roleLabel="Fleet Owner">
      <div className="space-y-4">
        {error && <ErrorAlert message={error} />}
        <div className="card p-0 overflow-x-auto">
          {fetching ? <Spinner /> : drivers.length === 0 ? (
            <EmptyState message="No drivers assigned to your fleet." icon="👤" />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Assigned Truck</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {drivers.map(d => (
                  <tr key={d.id}>
                    <td className="font-medium">{d.name}</td>
                    <td style={{ color: 'var(--color-slate)', fontSize: 13 }}>{d.email}</td>
                    <td className="font-mono text-sm">{d.truck_plate || '—'}</td>
                    <td>
                      <span
                        className="inline-block px-2 py-0.5 rounded text-xs font-semibold uppercase"
                        style={d.active
                          ? { background: '#DDEEE8', color: 'var(--status-available)' }
                          : { background: '#F9E0E1', color: 'var(--status-issue)' }
                        }
                      >
                        {d.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
