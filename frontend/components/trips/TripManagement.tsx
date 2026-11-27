'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { io } from 'socket.io-client';
import { apiFetch, useAuth } from '@/lib/auth';
import DashboardLayout from '@/components/layout/DashboardLayout';
import RescuePanel from './RescuePanel';
import { EmptyState, ErrorAlert, Modal, Spinner, StatusBadge, SuccessAlert, formatDateTime } from '@/components/ui/shared';

type Role = 'admin' | 'owner';
const STATUSES = ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
const CARGO_TYPES = ['Dairy', 'Vaccines', 'Frozen Seafood', 'Fresh Produce', 'Pharmaceuticals', 'Other'];
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const adminNav = [
  { href: '/admin', label: 'Overview', icon: '◈' },
  { href: '/admin/tracking', label: 'Global Map', icon: '📍' },
  { href: '/admin/trips', label: 'Trips', icon: '🛣️' },
  { href: '/admin/owners', label: 'Owners', icon: '🏢' },
  { href: '/admin/trucks', label: 'Trucks', icon: '🚛' },
  { href: '/admin/users', label: 'Drivers', icon: '👤' },
  { href: '/admin/activity', label: 'Activity Log', icon: '📋' },
];
const ownerNav = [
  { href: '/owner', label: 'My Fleet', icon: '🚛' },
  { href: '/owner/trips', label: 'Trip Management', icon: '🛣️' },
  { href: '/owner/drivers', label: 'Drivers', icon: '👤' },
];

export default function TripManagement({ role }: { role: Role }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [trips, setTrips] = useState<any[]>([]);
  const [trucks, setTrucks] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [owners, setOwners] = useState<any[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showAssign, setShowAssign] = useState(false);
  const [selectedTrip, setSelectedTrip] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState({ truck_id: '', user_id: '', origin: '', destination: '', cargo_type: '', notes: '' });
  const [otherCargo, setOtherCargo] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [ownerFilter, setOwnerFilter] = useState('ALL');
  const [truckFilter, setTruckFilter] = useState('ALL');
  const [driverFilter, setDriverFilter] = useState('ALL');

  useEffect(() => {
    if (!loading && (!user || user.role !== role)) router.replace('/login');
  }, [loading, role, router, user]);

  const fetchData = useCallback(async (showSpinner = false) => {
    if (showSpinner) setFetching(true);
    setError('');
    try {
      const [tripResponse, resources, ownerResponse] = await Promise.all([
        apiFetch('/api/trips'),
        apiFetch('/api/trips/resources'),
        role === 'admin' ? apiFetch('/api/admin/owners') : Promise.resolve([]),
      ]);
      if (!Array.isArray(tripResponse?.trips) || !Array.isArray(resources?.trucks) || !Array.isArray(resources?.drivers)) {
        throw new Error('Trip service returned an invalid response.');
      }
      setTrips(tripResponse.trips);
      setTrucks(resources.trucks);
      setDrivers(resources.drivers);
      setOwners(Array.isArray(ownerResponse) ? ownerResponse : []);
    } catch (e: any) {
      setError(e?.message || 'Could not load trip management data.');
    } finally {
      if (showSpinner) setFetching(false);
    }
  }, [role]);

  useEffect(() => {
    if (user?.role !== role) return;
    fetchData(true);
    const socket = io(`${API_URL}/tracking`, { withCredentials: true, transports: ['websocket', 'polling'] });
    const refresh = () => fetchData(false);
    ['trip:assigned', 'trip:started', 'trip:completed', 'trip:update'].forEach((event) => socket.on(event, refresh));
    const poll = setInterval(refresh, 30000);
    return () => { clearInterval(poll); socket.disconnect(); };
  }, [fetchData, role, user]);

  const selectedTruck = trucks.find((truck) => truck.id === form.truck_id) || null;
  const eligibleDrivers = drivers.filter((driver) => driver.truck_id === form.truck_id && driver.eligible);
  const selectedDriver = eligibleDrivers.find((driver) => driver.id === form.user_id) || null;
  const stats = useMemo(() => ({
    total: trips.length,
    assigned: trips.filter((trip) => trip.status === 'ASSIGNED').length,
    active: trips.filter((trip) => trip.status === 'IN_PROGRESS').length,
    completed: trips.filter((trip) => trip.status === 'COMPLETED').length,
  }), [trips]);
  const visibleTrips = trips.filter((trip) => {
    if (statusFilter !== 'ALL' && trip.status !== statusFilter) return false;
    if (role === 'admin' && ownerFilter !== 'ALL' && trip.owner_id !== ownerFilter) return false;
    if (truckFilter !== 'ALL' && trip.truck_id !== truckFilter) return false;
    if (driverFilter !== 'ALL' && trip.user_id !== driverFilter) return false;
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return [trip.plate_number, trip.driver_name, trip.origin, trip.destination, trip.cargo_type, trip.id]
      .some((value) => String(value || '').toLowerCase().includes(needle));
  });

  function openAssign() {
    setForm({ truck_id: '', user_id: '', origin: '', destination: '', cargo_type: '', notes: '' });
    setOtherCargo('');
    setFormError('');
    setShowAssign(true);
  }

  async function submitTrip(event: FormEvent) {
    event.preventDefault();
    if (!selectedTruck?.eligible || !selectedDriver?.eligible || saving) return;
    setSaving(true);
    setFormError('');
    try {
      const response = await apiFetch('/api/trips', {
        method: 'POST',
        body: JSON.stringify({ ...form, cargo_type: form.cargo_type === 'Other' ? otherCargo.trim() : form.cargo_type }),
      });
      if (!response?.success || !response?.trip?.id) throw new Error('The trip was not confirmed by the server.');
      setSuccess(`Trip assigned to ${selectedTruck.plate_number}.`);
      setShowAssign(false);
      await fetchData(false);
    } catch (e: any) {
      setFormError(e?.message || 'Trip assignment failed.');
    } finally {
      setSaving(false);
    }
  }

  if (loading || !user || user.role !== role) return null;

  return (
    <DashboardLayout navItems={role === 'admin' ? adminNav : ownerNav} title={role === 'admin' ? 'Global Trip Management' : 'Fleet Trip Management'} roleLabel={role === 'admin' ? 'Administrator' : 'Fleet Owner'}>
      <div className="space-y-4">
        {error && <ErrorAlert message={error} />}
        {success && <SuccessAlert message={success} />}
        {error && <button type="button" className="btn-ghost" onClick={() => fetchData(true)} disabled={fetching}>Retry</button>}

        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {[
            ['Total Trips', stats.total], ['Assigned', stats.assigned], ['Active Trips', stats.active], ['Completed', stats.completed],
          ].map(([label, count]) => <div key={label} className="card p-4"><p className="text-xs uppercase text-slate-500">{label}</p><p className="text-2xl font-bold mt-1">{count}</p></div>)}
        </div>

        <div className="card space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <input className="input-field min-w-[220px] flex-1" placeholder="Search truck, driver, origin, destination…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <select className="input-field w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="ALL">All Statuses</option>{STATUSES.map((status) => <option key={status}>{status}</option>)}
            </select>
            {role === 'admin' && <select className="input-field w-auto" value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
              <option value="ALL">All Owners</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
            </select>}
            <select className="input-field w-auto" value={truckFilter} onChange={(e) => setTruckFilter(e.target.value)}>
              <option value="ALL">All Trucks</option>{trucks.map((truck) => <option key={truck.id} value={truck.id}>{truck.plate_number}</option>)}
            </select>
            <select className="input-field w-auto" value={driverFilter} onChange={(e) => setDriverFilter(e.target.value)}>
              <option value="ALL">All Drivers</option>{drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
            </select>
            <button type="button" className="btn-primary ml-auto" onClick={openAssign}>+ Assign New Trip</button>
          </div>
        </div>

        <div className="card p-0 overflow-x-auto">
          {fetching ? <Spinner /> : visibleTrips.length === 0 ? <EmptyState message="No trips match these filters." icon="🛣️" /> : (
            <table className="data-table min-w-[900px]">
              <thead><tr><th>Trip</th><th>Truck / Owner</th><th>Driver</th><th>Route</th><th>Cargo</th><th>Status</th><th>Started</th><th>Completed</th></tr></thead>
              <tbody>{visibleTrips.map((trip) => (
                <tr key={trip.id}>
                  <td><button type="button" className="font-mono text-xs text-blue-700 hover:underline" onClick={() => setSelectedTrip(trip)}>{trip.id.slice(0, 8).toUpperCase()}</button></td>
                  <td><span className="font-mono font-semibold">{trip.plate_number}</span>{role === 'admin' && <span className="block text-xs text-slate-500">{trip.owner_name}</span>}</td>
                  <td>{trip.driver_name || '—'}<span className="block text-xs text-slate-500">{trip.driver_email}</span></td>
                  <td>{trip.origin} <span className="text-slate-400">→</span> {trip.destination}</td>
                  <td>{trip.cargo_type}</td>
                  <td><StatusBadge status={trip.status} /></td>
                  <td className="text-xs">{formatDateTime(trip.started_at)}</td>
                  <td className="text-xs">{formatDateTime(trip.ended_at)}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>

      {showAssign && <Modal title="Assign New Trip" onClose={() => setShowAssign(false)}>
        <form className="space-y-3" onSubmit={submitTrip}>
          <label className="block text-xs font-semibold uppercase text-slate-500">Truck</label>
          <select required className="input-field w-full" value={form.truck_id} onChange={(e) => setForm((old) => ({ ...old, truck_id: e.target.value, user_id: '' }))}>
            <option value="">Select an available truck…</option>
            {trucks.map((truck) => <option key={truck.id} value={truck.id} disabled={!truck.eligible}>
              {truck.plate_number} · {truck.owner_name || 'Fleet'} · {truck.status} · {truck.iot_status}
            </option>)}
          </select>
          {selectedTruck && <div className="rounded border p-3 text-xs" style={{ borderColor: 'var(--color-hairline)' }}>
            <p><strong>{selectedTruck.plate_number}</strong> · {selectedTruck.owner_name} · {selectedTruck.status}</p>
            <p className="mt-1">IoT: {selectedTruck.iot_status || 'NO DEVICE PAIRED'} {selectedTruck.iot_connection_number ? `(${selectedTruck.iot_connection_number})` : ''}</p>
          </div>}

          <label className="block text-xs font-semibold uppercase text-slate-500">Driver</label>
          <select required className="input-field w-full" value={form.user_id} onChange={(e) => setForm((old) => ({ ...old, user_id: e.target.value }))} disabled={!form.truck_id}>
            <option value="">{form.truck_id ? eligibleDrivers.length ? 'Select assigned eligible driver…' : 'No eligible driver assigned to this truck' : 'Select a truck first'}</option>
            {eligibleDrivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name} ({driver.email})</option>)}
          </select>
          {selectedDriver && <p className="text-xs text-slate-500">{selectedDriver.name} · {selectedDriver.email} · active on {selectedTruck?.plate_number}</p>}

          {[['Origin', 'origin'], ['Destination', 'destination']].map(([label, key]) => <div key={key}>
            <label className="block text-xs font-semibold uppercase text-slate-500 mb-1">{label}</label>
            <input required maxLength={255} className="input-field w-full" value={form[key as 'origin' | 'destination']} onChange={(e) => setForm((old) => ({ ...old, [key]: e.target.value }))} />
          </div>)}
          <label className="block text-xs font-semibold uppercase text-slate-500">Cargo Type</label>
          <select required className="input-field w-full" value={form.cargo_type} onChange={(e) => setForm((old) => ({ ...old, cargo_type: e.target.value }))}>
            <option value="">Select cargo type…</option>{CARGO_TYPES.map((cargo) => <option key={cargo}>{cargo}</option>)}
          </select>
          {form.cargo_type === 'Other' && <input required maxLength={100} className="input-field w-full" placeholder="Specify cargo type" value={otherCargo} onChange={(e) => setOtherCargo(e.target.value)} />}
          <label className="block text-xs font-semibold uppercase text-slate-500">Shipment Notes</label>
          <textarea rows={3} maxLength={4000} className="input-field w-full" value={form.notes} onChange={(e) => setForm((old) => ({ ...old, notes: e.target.value }))} />
          {formError && <ErrorAlert message={formError} />}
          <button className="btn-primary w-full" type="submit" disabled={saving || !selectedTruck?.eligible || !selectedDriver?.eligible || (form.cargo_type === 'Other' && !otherCargo.trim())}>
            {saving ? 'Assigning…' : 'Assign Trip'}
          </button>
        </form>
      </Modal>}
      {selectedTrip && <Modal title={`Trip ${selectedTrip.id.slice(0, 8).toUpperCase()}`} onClose={() => setSelectedTrip(null)}>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between"><span className="text-slate-500">Status</span><StatusBadge status={selectedTrip.status} /></div>
          <div className="flex justify-between"><span className="text-slate-500">Truck / Driver</span><span>{selectedTrip.plate_number} · {selectedTrip.driver_name}</span></div>
          <div><span className="text-slate-500">Route</span><p>{selectedTrip.origin} → {selectedTrip.destination}</p></div>
          <div className="flex justify-between"><span className="text-slate-500">Cargo</span><span>{selectedTrip.cargo_type}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Assigned</span><span>{formatDateTime(selectedTrip.assigned_at)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Started</span><span>{formatDateTime(selectedTrip.started_at)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Completed</span><span>{formatDateTime(selectedTrip.ended_at)}</span></div>
          {selectedTrip.notes && <div><span className="text-slate-500">Notes</span><p className="whitespace-pre-wrap">{selectedTrip.notes}</p></div>}
          <RescuePanel key={selectedTrip.id} tripId={selectedTrip.id} tripStatus={trips.find(trip => trip.id === selectedTrip.id)?.status ?? selectedTrip.status} role={role} />
        </div>
      </Modal>}
    </DashboardLayout>
  );
}
