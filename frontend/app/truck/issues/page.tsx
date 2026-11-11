'use client';

import { useEffect, useState } from 'react';
import { useAuth, apiFetch } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { StatusBadge, Spinner, EmptyState, ErrorAlert, formatDateTime } from '@/components/ui/shared';

const NAV = [
  { href: '/truck', label: 'My Truck', icon: '🚛' },
  { href: '/truck/history', label: 'Trip History', icon: '🛣️' },
  { href: '/truck/issues', label: 'Issues', icon: '⚠️' },
];

export default function IssuesPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [issues, setIssues] = useState<any[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && (!user || user.role !== 'truckUser')) router.replace('/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (user?.role === 'truckUser') {
      apiFetch('/api/truck/issues')
        .then(setIssues)
        .catch(e => setError(e.message))
        .finally(() => setFetching(false));
    }
  }, [user]);

  if (loading || !user) return null;

  return (
    <DashboardLayout navItems={NAV} title="Reported Issues" roleLabel="Truck User">
      <div className="space-y-4">
        {error && <ErrorAlert message={error} />}
        {fetching ? <Spinner /> : issues.length === 0 ? (
          <EmptyState message="No issues reported. Your truck is running smoothly." icon="✅" />
        ) : (
          <div className="space-y-3">
            {issues.map(issue => (
              <div key={issue.id} className="card">
                <div className="flex items-start justify-between mb-2">
                  <p className="text-sm font-medium flex-1 pr-3">{issue.description}</p>
                  <StatusBadge status={issue.status} />
                </div>
                <p className="text-xs" style={{ color: 'var(--color-slate)' }}>
                  Reported {formatDateTime(issue.created_at)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
