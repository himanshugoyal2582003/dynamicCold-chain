'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth, apiFetch } from '@/lib/auth';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { StatusBadge, Spinner, EmptyState, ErrorAlert, SuccessAlert, Modal, formatDate, formatDateTime, isExpired, isExpiringSoon } from '@/components/ui/shared';

const NAV = [
  { href: '/owner', label: 'My Fleet', icon: '🚛' },
  { href: '/owner/drivers', label: 'Drivers', icon: '👤' },
];

export default function TruckDetail() {
  const { id } = useParams();
  const { user, loading } = useAuth();
  const router = useRouter();
  const [truck, setTruck] = useState<any>(null);
  const [trips, setTrips] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showAssign, setShowAssign] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState('');
  const [saving, setSaving] = useState(false);
  const [iotTelemetry, setIotTelemetry] = useState<any>(null);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'owner')) router.replace('/login');
  }, [user, loading, router]);

  async function fetchAll() {
    setFetching(true);
    try {
      const [t, tr, d, iot] = await Promise.all([
        apiFetch(`/api/owner/trucks/${id}`),
        apiFetch(`/api/owner/trucks/${id}/trips`),
        apiFetch('/api/owner/drivers'),
        apiFetch(`/api/iot/telemetry/${id}`).catch(() => null),
      ]);
      setTruck(t);
      setTrips(tr);
      setDrivers(d.filter((dr: any) => dr.active));
      if (iot?.telemetry) setIotTelemetry(iot.telemetry);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setFetching(false);
    }
  }

  useEffect(() => {
    if (user?.role === 'owner' && id) {
      fetchAll();
      const timer = setInterval(async () => {
        try {
          const res = await apiFetch(`/api/iot/telemetry/${id}`);
          if (res?.telemetry) setIotTelemetry(res.telemetry);
        } catch {}
      }, 4000);
      return () => clearInterval(timer);
    }
  }, [user, id]);

  async function handleStatusChange(status: string) {
    try {
      await apiFetch(`/api/owner/trucks/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setSuccess(`Status updated to "${status}".`);
      fetchAll();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleAssignDriver(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiFetch(`/api/owner/trucks/${id}/assign-driver`, {
        method: 'POST',
        body: JSON.stringify({ driverId: selectedDriver }),
      });
      setSuccess('Driver assigned successfully.');
      setShowAssign(false);
      fetchAll();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading || !user) return null;

  const DocRow = ({ label, date, expiring }: { label: string; date: string | null; expiring?: boolean }) => {
    const expired = isExpired(date);
    const soon = isExpiringSoon(date) || expiring;
    return (
      <div className="flex items-center justify-between py-2 border-b" style={{ borderColor: 'var(--color-hairline)' }}>
        <span className="text-xs uppercase tracking-wide font-medium" style={{ color: 'var(--color-slate)' }}>{label}</span>
        <span>
          {expired ? <span className="tag-expired">{formatDate(date)}</span>
            : soon ? <span className="tag-expiring">{formatDate(date)}</span>
            : <span className="text-sm" style={{ color: 'var(--color-ink)' }}>{formatDate(date)}</span>}
        </span>
      </div>
    );
  };

  return (
    <DashboardLayout navItems={NAV} title={truck ? `Truck — ${truck.plate_number}` : 'Loading…'} roleLabel="Fleet Owner">
      {fetching ? <Spinner /> : !truck ? (
        <ErrorAlert message="Truck not found or access denied." />
      ) : (
        <div className="space-y-5">
          {error && <ErrorAlert message={error} />}
          {success && <SuccessAlert message={success} />}

          {/* Back */}
          <button onClick={() => router.back()} className="btn-ghost text-xs">← Back to Fleet</button>

          <div className="grid md:grid-cols-2 gap-5">
            {/* Details */}
            <div className="card space-y-1">
              <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-ink)' }}>Truck Details</h2>
              {[
                { label: 'Plate', value: truck.plate_number },
                { label: 'Type', value: truck.type },
                { label: 'Capacity', value: `${truck.capacity_tons} tonnes` },
                { label: 'Target Temp', value: `${truck.target_temp_c}°C` },
                { label: 'Assigned Driver', value: truck.driver_name || '—' },
              ].map(f => (
                <div key={f.label} className="flex justify-between py-2 border-b" style={{ borderColor: 'var(--color-hairline)' }}>
                  <span className="text-xs uppercase tracking-wide font-medium" style={{ color: 'var(--color-slate)' }}>{f.label}</span>
                  <span className="text-sm font-medium">{f.value}</span>
                </div>
              ))}
              <div className="pt-2 flex items-center gap-2">
                <StatusBadge status={truck.status} />
                {truck.status !== 'on_trip' && (
                  <div className="flex gap-2">
                    {truck.status !== 'available' && (
                      <button className="btn-ghost text-xs" onClick={() => handleStatusChange('available')}>
                        Set Available
                      </button>
                    )}
                    {truck.status !== 'maintenance' && (
                      <button className="btn-ghost text-xs" onClick={() => handleStatusChange('maintenance')}>
                        Set Maintenance
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Compliance docs */}
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>Compliance Documents</h2>
              </div>
              <DocRow label="Insurance Expiry" date={truck.insurance_expiry} expiring={truck.insurance_expiring} />
              <DocRow label="Permit Expiry" date={truck.permit_expiry} expiring={truck.permit_expiring} />
              <DocRow label="Fitness Expiry" date={truck.fitness_expiry} expiring={truck.fitness_expiring} />

              <button
                className="btn-primary w-full mt-4 text-xs"
                onClick={() => setShowAssign(true)}
              >
                Reassign Driver
              </button>
            </div>
          </div>

          {/* Real-time IoT & AI Spoilage Status */}
          <div className="card" style={{ border: '1px solid var(--color-hairline)' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">📡</span>
                <div>
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>Live IoT Telemetry & AI Spoilage Monitor</h3>
                  <p className="text-xs text-slate-500">Real-time sensor stream routed via AI/ML prediction engine</p>
                </div>
              </div>
              {iotTelemetry ? (
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                  {iotTelemetry.connection_number || 'CONNECTED'}
                </span>
              ) : (
                <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                  No IoT Sensor Paired
                </span>
              )}
            </div>

            {iotTelemetry ? (
              <div className="grid sm:grid-cols-4 gap-3 text-sm">
                <div className="p-3 rounded bg-slate-50">
                  <span className="text-xs text-slate-500 block mb-1">Live Temp</span>
                  <span className="text-xl font-bold tabular-nums">{iotTelemetry.temperature}°C</span>
                  <span className="text-xs text-slate-500 block">Target: {truck.target_temp_c}°C</span>
                </div>
                <div className="p-3 rounded bg-slate-50">
                  <span className="text-xs text-slate-500 block mb-1">Humidity & Battery</span>
                  <span className="text-xl font-bold tabular-nums">{iotTelemetry.humidity}%</span>
                  <span className="text-xs text-slate-500 block">🔋 {iotTelemetry.battery}%</span>
                </div>
                <div className="p-3 rounded bg-slate-50">
                  <span className="text-xs text-slate-500 block mb-1">AI Spoilage Risk</span>
                  <span className={`text-sm font-bold px-2 py-0.5 rounded inline-block ${
                    iotTelemetry.spoilage_risk_level === 'CRITICAL' ? 'bg-red-600 text-white'
                    : iotTelemetry.spoilage_risk_level === 'HIGH' ? 'bg-amber-500 text-white'
                    : 'bg-emerald-600 text-white'
                  }`}>
                    {iotTelemetry.spoilage_risk_level} ({iotTelemetry.spoilage_risk})
                  </span>
                  <span className="text-xs text-slate-500 block mt-1">RSL: {iotTelemetry.shelf_life_remaining_hours}h</span>
                </div>
                <div className="p-3 rounded bg-slate-50">
                  <span className="text-xs text-slate-500 block mb-1">Route Advisory</span>
                  <span className="text-xs font-medium text-slate-700 block">
                    {iotTelemetry.route_recommendation || 'Proceed on route'}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500 py-2">
                This truck has no paired IoT sensor device. The driver can pair a sensor via the Driver Control Panel (:3000/truck) or using connection numbers from the IoT Simulator (:3001).
              </p>
            )}
          </div>

          {/* Trip History */}
          <div className="card p-0 overflow-x-auto">
            <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--color-hairline)' }}>
              <h2 className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>Trip History</h2>
            </div>
            {trips.length === 0 ? (
              <EmptyState message="No trips recorded for this truck." icon="🛣️" />
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Ended</th>
                    <th>Driver</th>
                    <th>Origin</th>
                    <th>Destination</th>
                    <th>Cargo</th>
                  </tr>
                </thead>
                <tbody>
                  {trips.map(tr => (
                    <tr key={tr.id}>
                      <td className="tabular-nums text-xs">{formatDateTime(tr.started_at)}</td>
                      <td className="tabular-nums text-xs">
                        {tr.ended_at ? formatDateTime(tr.ended_at) : (
                          <span className="badge-on-trip inline-block px-2 py-0.5 rounded text-xs font-semibold">Active</span>
                        )}
                      </td>
                      <td className="text-sm">{tr.driver_name}</td>
                      <td className="text-sm" style={{ color: 'var(--color-slate)' }}>{tr.origin}</td>
                      <td className="text-sm" style={{ color: 'var(--color-slate)' }}>{tr.destination}</td>
                      <td className="text-sm">{tr.cargo_type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {showAssign && (
        <Modal title="Reassign Driver" onClose={() => setShowAssign(false)}>
          <form onSubmit={handleAssignDriver} className="space-y-4">
            <div className="space-y-1">
              <label className="block text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--color-slate)' }}>
                Select Driver
              </label>
              <select
                value={selectedDriver}
                onChange={e => setSelectedDriver(e.target.value)}
                required
                className="input-field"
              >
                <option value="">Select a driver…</option>
                {drivers.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name} {d.truck_plate ? `(currently on ${d.truck_plate})` : '(unassigned)'}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-3">
              <button type="submit" className="btn-primary flex-1" disabled={saving}>
                {saving ? 'Assigning…' : 'Assign Driver'}
              </button>
              <button type="button" className="btn-ghost flex-1" onClick={() => setShowAssign(false)}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}
    </DashboardLayout>
  );
}
