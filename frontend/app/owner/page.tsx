'use client';

import { useEffect, useState } from 'react';
import { useAuth, apiFetch } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { StatusBadge, Spinner, EmptyState, ErrorAlert, Modal, formatDate, isExpired, isExpiringSoon } from '@/components/ui/shared';

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

  // Add Truck / Device Modal
  const [showAddTruck, setShowAddTruck] = useState(false);
  const [newPlate, setNewPlate] = useState('');
  const [newType, setNewType] = useState('Heavy Reefer 18T');
  const [newCapacity, setNewCapacity] = useState('18.0');
  const [newTargetTemp, setNewTargetTemp] = useState('4.0');
  const [newIotConn, setNewIotConn] = useState('');
  const [savingTruck, setSavingTruck] = useState(false);

  async function handleAddTruck(e: React.FormEvent) {
    e.preventDefault();
    setSavingTruck(true);
    setError('');
    try {
      await apiFetch('/api/owner/trucks', {
        method: 'POST',
        body: JSON.stringify({
          plate_number: newPlate.trim().toUpperCase(),
          type: newType,
          capacity_tons: parseFloat(newCapacity) || 10.0,
          target_temp_c: parseFloat(newTargetTemp) || 4.0,
          iot_connection_number: newIotConn ? newIotConn.trim().toUpperCase() : undefined,
        }),
      });
      setShowAddTruck(false);
      setNewPlate('');
      setNewIotConn('');
      const data = await apiFetch('/api/owner/trucks');
      setTrucks(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingTruck(false);
    }
  }

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
      t.type.toLowerCase().includes(search.toLowerCase()) ||
      (t.iot_connection_number && t.iot_connection_number.toLowerCase().includes(search.toLowerCase()));
    const matchStatus = !statusFilter || t.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const connectedIotCount = trucks.filter(t => Boolean(t.iot_connection_number)).length;

  const DocTag = ({ date, expiring }: { date: string | null; expiring?: boolean }) => {
    if (!date) return <span style={{ color: 'var(--color-hairline)' }}>—</span>;
    if (isExpired(date)) return <span className="tag-expired">{formatDate(date)}</span>;
    if (isExpiringSoon(date) || expiring) return <span className="tag-expiring">{formatDate(date)}</span>;
    return <span style={{ color: 'var(--color-slate)', fontSize: 13 }}>{formatDate(date)}</span>;
  };

  if (loading || !user) return null;

  return (
    <DashboardLayout navItems={NAV} title="Fleet & Asset Management" roleLabel="Fleet Owner">
      <div className="space-y-6">
        {error && <ErrorAlert message={error} />}

        {/* Summary stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Fleet', value: trucks.length, icon: '🚛', color: 'var(--color-gold)' },
            { label: 'In Transit', value: trucks.filter(t => t.status === 'on_trip').length, icon: '📍', color: 'var(--status-on-trip)' },
            { label: 'Active IoT Devices', value: connectedIotCount, icon: '📡', color: '#10b981' },
            { label: 'Alerts / Expiring', value: trucks.filter(t => t.insurance_expiring || t.permit_expiring || t.fitness_expiring).length, icon: '⚠️', color: 'var(--status-issue)' },
          ].map(s => (
            <div key={s.label} className="card p-4 flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold tabular-nums" style={{ color: s.color }}>{s.value}</p>
                <p className="text-xs uppercase font-medium tracking-wide mt-1" style={{ color: 'var(--color-slate)' }}>{s.label}</p>
              </div>
              <span className="text-2xl opacity-80">{s.icon}</span>
            </div>
          ))}
        </div>

        {/* Action bar & Filters */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex gap-3 flex-1 flex-wrap">
            <input
              className="input-field max-w-xs"
              placeholder="Search plate, type, or IoT ID…"
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

          <button
            onClick={() => setShowAddTruck(true)}
            className="btn-gold flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <span>+</span>
            <span>Add Truck & Device</span>
          </button>
        </div>

        {/* Desktop table */}
        <div className="hidden md:block card p-0 overflow-x-auto">
          {fetching ? <Spinner /> : filtered.length === 0 ? (
            <EmptyState message="No trucks found matching your criteria." icon="🚛" />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Plate Number</th>
                  <th>Type & Capacity</th>
                  <th>IoT Device ID</th>
                  <th>Target Temp</th>
                  <th>Status</th>
                  <th>Driver</th>
                  <th>Insurance Premium</th>
                  <th>Compliance</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => (
                  <tr key={t.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="font-mono font-semibold text-sm">{t.plate_number}</td>
                    <td style={{ color: 'var(--color-slate)', fontSize: 13 }}>
                      <div>{t.type}</div>
                      <span className="text-xs opacity-75">{t.capacity_tons}T</span>
                    </td>
                    <td>
                      {t.iot_connection_number ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono font-semibold bg-emerald-950/40 text-emerald-400 border border-emerald-500/30">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          {t.iot_connection_number}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500 italic">None assigned</span>
                      )}
                    </td>
                    <td className="font-semibold text-sm tabular-nums">
                      {t.target_temp_c}°C
                    </td>
                    <td><StatusBadge status={t.status} /></td>
                    <td style={{ color: 'var(--color-slate)', fontSize: 13 }}>{t.driver_name || '—'}</td>
                    <td>
                      <div className="font-semibold text-sm tabular-nums text-amber-400">
                        ${t.current_insurance_price || t.monthly_insurance_premium || 450}
                        <span className="text-xs font-normal text-gray-400">/mo</span>
                      </div>
                    </td>
                    <td>
                      <div className="flex gap-1 flex-wrap">
                        {t.insurance_expiring ? <span className="tag-expiring">Ins Expiring</span> : <DocTag date={t.insurance_expiry} />}
                      </div>
                    </td>
                    <td>
                      <Link href={`/owner/trucks/${t.id}`} className="btn-ghost text-xs whitespace-nowrap">
                        View & Control →
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
                  <p className="font-mono font-semibold text-base">{t.plate_number}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-slate)' }}>{t.type} • {t.capacity_tons}T</p>
                </div>
                <StatusBadge status={t.status} />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs py-2 my-2 border-y border-slate-800 text-slate-300">
                <div>
                  <span className="text-gray-400">IoT Device: </span>
                  {t.iot_connection_number ? (
                    <span className="font-mono text-emerald-400 font-semibold">{t.iot_connection_number}</span>
                  ) : (
                    <span className="text-gray-500">Unpaired</span>
                  )}
                </div>
                <div>
                  <span className="text-gray-400">Target: </span>
                  <span className="font-semibold">{t.target_temp_c}°C</span>
                </div>
                <div>
                  <span className="text-gray-400">Driver: </span>
                  <span>{t.driver_name || 'Unassigned'}</span>
                </div>
                <div>
                  <span className="text-gray-400">Insurance: </span>
                  <span className="text-amber-400 font-semibold">${t.current_insurance_price || t.monthly_insurance_premium || 450}/mo</span>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* Add Truck & Device Modal */}
        {showAddTruck && (
          <Modal title="Add New Truck & IoT Device" onClose={() => setShowAddTruck(false)}>
            <form onSubmit={handleAddTruck} className="space-y-4">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Plate Number *</label>
                <input
                  required
                  placeholder="e.g. MH-04-BZ-9042"
                  value={newPlate}
                  onChange={e => setNewPlate(e.target.value)}
                  className="input-field uppercase font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Vehicle Type</label>
                  <select
                    value={newType}
                    onChange={e => setNewType(e.target.value)}
                    className="input-field"
                  >
                    <option value="Heavy Reefer 18T">Heavy Reefer 18T</option>
                    <option value="Refrigerated Van 3.5T">Refrigerated Van 3.5T</option>
                    <option value="Cold Express 7.5T">Cold Express 7.5T</option>
                    <option value="Pharma Safe 12T">Pharma Safe 12T</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Capacity (Tons)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    value={newCapacity}
                    onChange={e => setNewCapacity(e.target.value)}
                    className="input-field"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Target Temp (°C)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={newTargetTemp}
                    onChange={e => setNewTargetTemp(e.target.value)}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">
                    IoT Connection No. <span className="text-amber-400">(Optional)</span>
                  </label>
                  <input
                    placeholder="e.g. CONN-4821"
                    value={newIotConn}
                    onChange={e => setNewIotConn(e.target.value)}
                    className="input-field uppercase font-mono"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddTruck(false)}
                  className="btn-ghost"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingTruck}
                  className="btn-gold"
                >
                  {savingTruck ? 'Registering…' : 'Add Vehicle'}
                </button>
              </div>
            </form>
          </Modal>
        )}
      </div>
    </DashboardLayout>
  );
}
