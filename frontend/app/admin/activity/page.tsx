'use client';

import { useEffect, useState } from 'react';
import { useAuth, apiFetch } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Spinner, EmptyState, ErrorAlert, formatDateTime } from '@/components/ui/shared';

const NAV = [
  { href: '/admin', label: 'Overview', icon: '◈' },
  { href: '/admin/owners', label: 'Owners', icon: '🏢' },
  { href: '/admin/trucks', label: 'Trucks', icon: '🚛' },
  { href: '/admin/users', label: 'Drivers', icon: '👤' },
  { href: '/admin/activity', label: 'Activity Log', icon: '📋' },
];

const ACTION_COLORS: Record<string, string> = {
  CREATE_OWNER: '#2F5D8A',
  CREATE_TRUCK: '#2E7D5B',
  CREATE_TRUCK_USER: '#2E7D5B',
  DEACTIVATE_OWNER: '#A3262A',
  DEACTIVATE_TRUCK: '#A3262A',
  DEACTIVATE_USER: '#A3262A',
  START_TRIP: '#B08D3C',
  ASSIGN_DRIVER: '#5B6470',
  INITIALIZE_SYSTEM: '#B08D3C',
  ADD_TRUCK: '#2E7D5B',
};

export default function AdminActivity() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [logs, setLogs] = useState<any[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) router.replace('/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (user?.role === 'admin') {
      apiFetch('/api/admin/activity-log')
        .then(setLogs)
        .catch(e => setError(e.message))
        .finally(() => setFetching(false));
    }
  }, [user]);

  if (loading || !user) return null;

  return (
    <DashboardLayout navItems={NAV} title="Activity Log" roleLabel="Administrator">
      <div className="space-y-4">
        {error && <ErrorAlert message={error} />}
        <div className="card p-0 overflow-x-auto">
          {fetching ? <Spinner /> : logs.length === 0 ? (
            <EmptyState message="No activity recorded yet." icon="📋" />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Actor</th>
                  <th>Role</th>
                  <th>Action</th>
                  <th>Entity</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id}>
                    <td className="tabular-nums text-xs" style={{ color: 'var(--color-slate)', whiteSpace: 'nowrap' }}>
                      {formatDateTime(log.created_at)}
                    </td>
                    <td className="text-sm font-medium">{log.actor_name || 'System'}</td>
                    <td>
                      <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--color-ivory)', color: 'var(--color-slate)' }}>
                        {log.actor_role || '—'}
                      </span>
                    </td>
                    <td>
                      <span
                        className="text-xs font-mono font-semibold"
                        style={{ color: ACTION_COLORS[log.action] || 'var(--color-ink)' }}
                      >
                        {log.action}
                      </span>
                    </td>
                    <td className="text-xs" style={{ color: 'var(--color-slate)' }}>
                      <span>{log.entity}</span>
                      {log.details && Object.keys(log.details).length > 0 && (
                        <span className="ml-2" style={{ color: 'var(--color-hairline)' }}>
                          {JSON.stringify(log.details)}
                        </span>
                      )}
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
