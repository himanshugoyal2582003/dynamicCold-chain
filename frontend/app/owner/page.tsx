'use client';

import { useEffect, useState } from 'react';
import { useAuth, apiFetch } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { StatusBadge, Spinner, EmptyState, ErrorAlert, formatDate, isExpired, isExpiringSoon } from '@/components/ui/shared';

const NAV = [
  { href: '/owner', label: 'My Fleet', icon: '🚛' },
  { href: '/owner/drivers', label: 'Drivers', icon: '👤' },
];

export default function OwnerFleet() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [trucks, setTrucks] = useState<any[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    if (!loading && (!user || user.role !== 'owner')) router.replace('/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (user?.role === 'owner') {
      apiFetch('/api/owner/trucks')
        .then(setTrucks)
        .catch(e => setError(e.message))
        .finally(() => setFetching(false));
    }
  }, [user]);

  const filtered = trucks.filter(t => {
    const matchSearch = t.plate_number.toLowerCase().includes(search.toLowerCase()) ||
      t.type.toLowerCase().includes(search.toLowerCase());
    const matchStatus = !statusFilter || t.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const DocTag = ({ date, expiring }: { date: string | null; expiring?: boolean }) => {
    if (!date) return <span style={{ color: 'var(--color-hairline)' }}>—</span>;
    if (isExpired(date)) return <span className="tag-expired">{formatDate(date)}</span>;
    if (isExpiringSoon(date) || expiring) return <span className="tag-expiring">{formatDate(date)}</span>;
    return <span style={{ color: 'var(--color-slate)', fontSize: 13 }}>{formatDate(date)}</span>;
  };

  if (loading || !user) return null;

  return (
    <DashboardLayout navItems={NAV} title="My Fleet" roleLabel="Fleet Owner">
      <div className="space-y-4">
        {error && <ErrorAlert message={error} />}

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Total', value: trucks.length, color: 'var(--color-gold)' },
            { label: 'On Trip', value: trucks.filter(t => t.status === 'on_trip').length, color: 'var(--status-on-trip)' },
            { label: 'Alerts', value: trucks.filter(t => t.insurance_expiring || t.permit_expiring || t.fitness_expiring).length, color: 'var(--status-issue)' },
          ].map(s => (
            <div key={s.label} className="card text-center p-4">
              <p className="text-2xl font-semibold tabular-nums" style={{ color: s.color }}>{s.value}</p>
              <p className="text-xs uppercase tracking-wide mt-1" style={{ color: 'var(--color-slate)' }}>{s.label}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <input
            className="input-field max-w-xs"
            placeholder="Search plate or type…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select
            className="input-field w-auto"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            <option value="">All Statuses</option>
            <option value="available">Available</option>
            <option value="on_trip">On Trip</option>
            <option value="maintenance">Maintenance</option>
          </select>
        </div>

        {/* Desktop table */}
        <div className="hidden md:block card p-0 overflow-x-auto">
          {fetching ? <Spinner /> : filtered.length === 0 ? (
            <EmptyState message="No trucks found. Contact your admin to add trucks." icon="🚛" />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Plate</th>
                  <th>Type</th>
                  <th>Capacity</th>
                  <th>Status</th>
                  <th>Driver</th>
                  <th>Insurance</th>
                  <th>Permit</th>
                  <th>Fitness</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => (
                  <tr key={t.id}>
                    <td className="font-mono font-semibold text-sm">{t.plate_number}</td>
                    <td style={{ color: 'var(--color-slate)', fontSize: 13 }}>{t.type}</td>
                    <td className="tabular-nums text-sm">{t.capacity_tons}T</td>
                    <td><StatusBadge status={t.status} /></td>
                    <td style={{ color: 'var(--color-slate)', fontSize: 13 }}>{t.driver_name || '—'}</td>
                    <td><DocTag date={t.insurance_expiry} expiring={t.insurance_expiring} /></td>
                    <td><DocTag date={t.permit_expiry} expiring={t.permit_expiring} /></td>
                    <td><DocTag date={t.fitness_expiry} expiring={t.fitness_expiring} /></td>
                    <td>
                      <Link href={`/owner/trucks/${t.id}`} className="btn-ghost text-xs">
                        View →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Mobile cards */}
        <div className="md:hidden space-y-3">
          {fetching ? <Spinner /> : filtered.length === 0 ? (
            <EmptyState message="No trucks found." icon="🚛" />
          ) : filtered.map(t => (
            <Link key={t.id} href={`/owner/trucks/${t.id}`} className="block card hover:border-gold transition-colors">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="font-mono font-semibold">{t.plate_number}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-slate)' }}>{t.type}</p>
                </div>
                <StatusBadge status={t.status} />
              </div>
              <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--color-slate)' }}>
                <span>Driver: {t.driver_name || '—'}</span>
                <span>{t.target_temp_c}°C</span>
              </div>
              {(t.insurance_expiring || t.permit_expiring || t.fitness_expiring) && (
                <div className="mt-2 flex gap-1 flex-wrap">
                  {t.insurance_expiring && <span className="tag-expiring">Insurance</span>}
                  {t.permit_expiring && <span className="tag-expiring">Permit</span>}
                  {t.fitness_expiring && <span className="tag-expiring">Fitness</span>}
                </div>
              )}
            </Link>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
