'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth, apiFetch } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { io } from 'socket.io-client';
import DashboardLayout from '@/components/layout/DashboardLayout';
import RescuePanel from '@/components/trips/RescuePanel';
import { Spinner, EmptyState, ErrorAlert, formatDateTime, StatusBadge } from '@/components/ui/shared';

const NAV = [
  { href: '/truck', label: 'My Truck', icon: '🚛' },
  { href: '/truck/history', label: 'Trip History', icon: '🛣️' },
  { href: '/truck/issues', label: 'Issues', icon: '⚠️' },
];
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function TripHistory() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [trips, setTrips] = useState<any[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [rescueTripId, setRescueTripId] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'truckUser')) router.replace('/login');
  }, [user, loading, router]);

  const fetchTrips = useCallback(async (showLoading = false) => {
    if (showLoading) setFetching(true);
    setError('');
    try {
      const rows = await apiFetch('/api/truck/trip-history');
      if (!Array.isArray(rows)) throw new Error('The trip history service returned an invalid response.');
      setTrips(rows);
    } catch (e: any) {
      setError(e?.message || 'Could not load your trip history.');
    } finally {
      if (showLoading) setFetching(false);
    }
  }, []);

  useEffect(() => {
    if (user?.role !== 'truckUser') return;
    fetchTrips(true);
    const socket = io(`${API_URL}/tracking`, { withCredentials: true, transports: ['websocket', 'polling'] });
    ['trip:assigned', 'trip:started', 'trip:completed', 'trip:update'].forEach((event) => socket.on(event, () => fetchTrips(false)));
    const timer = setInterval(() => fetchTrips(false), 30000);
    return () => { clearInterval(timer); socket.disconnect(); };
  }, [user, fetchTrips]);

  const visible = trips.filter((trip) => filter === 'ALL' || trip.status === filter);
  if (loading || !user) return null;

  return (
    <DashboardLayout navItems={NAV} title="My Trip History" roleLabel="Truck User">
      <div className="space-y-4">
        {error && <ErrorAlert message={error} />}
        {error && <button className="btn-ghost" onClick={() => fetchTrips(true)} disabled={fetching}>Retry</button>}
        <div className="card flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">Your assigned and completed shipments, newest first.</p>
          <select className="input-field w-auto" value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="ALL">All</option>
            <option value="ASSIGNED">Assigned</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
        {fetching ? <Spinner /> : visible.length === 0 ? (
          <EmptyState message={trips.length ? 'No trips match this status.' : 'No trips assigned to your account yet.'} icon="🛣️" />
        ) : (
          <div className="space-y-3">
            {visible.map((trip) => (
              <article key={trip.id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="text-sm font-semibold">{trip.origin} <span className="text-slate-400">→</span> {trip.destination}</p>
                    <p className="text-xs mt-1 text-slate-500">{trip.plate_number} · {trip.cargo_type} · Trip {trip.id.slice(0, 8).toUpperCase()}</p>
                  </div>
                  <StatusBadge status={trip.status} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-slate-600">
                  <span>Assigned: {formatDateTime(trip.assigned_at)}</span>
                  <span>Started: {formatDateTime(trip.started_at)}</span>
                  <span>Completed: {formatDateTime(trip.ended_at)}</span>
                </div>
                {trip.notes && <p className="text-xs mt-3 p-2 rounded bg-neutral-50 text-slate-600">{trip.notes}</p>}
                <button type="button" className="btn-ghost mt-2 text-xs" aria-expanded={rescueTripId === trip.id} onClick={() => setRescueTripId(rescueTripId === trip.id ? null : trip.id)}>Cargo rescue history</button>
                {rescueTripId === trip.id && <RescuePanel tripId={trip.id} tripStatus={trip.status} role="truckUser" />}
              </article>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
