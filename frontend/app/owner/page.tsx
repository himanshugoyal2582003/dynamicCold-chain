'use client';

import { useEffect, useState } from 'react';
import { useAuth, apiFetch } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import DashboardLayout from '@/components/layout/DashboardLayout';
import {
  StatusBadge,
  Spinner,
  EmptyState,
  ErrorAlert,
  SuccessAlert,
  Modal,
  formatDate,
  isExpired,
  isExpiringSoon,
} from '@/components/ui/shared';

const NAV = [
  { href: '/owner', label: 'Overview', icon: '🚛' },
  { href: '/owner?tab=insurance', label: 'Insurance', icon: '🛡️' },
  { href: '/owner/drivers', label: 'Drivers', icon: '👤' },
];

type OwnerTab = 'fleet' | 'drivers' | 'insurance';

export default function OwnerDashboard() {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Active Tab
  const [activeTab, setActiveTab] = useState<OwnerTab>(() =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('tab') === 'insurance'
      ? 'insurance'
      : 'fleet',
  );

  // Fleet state
  const [trucks, setTrucks] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [lstmLogs, setLstmLogs] = useState<any[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Filters & Search
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Add Truck Modal
  const [showAddTruck, setShowAddTruck] = useState(false);
  const [newPlate, setNewPlate] = useState('');
  const [newType, setNewType] = useState('Heavy Reefer 18T');
  const [newCapacity, setNewCapacity] = useState('18.0');
  const [newTargetTemp, setNewTargetTemp] = useState('4.0');
  const [newIotConn, setNewIotConn] = useState('');
  const [savingTruck, setSavingTruck] = useState(false);

  // Add Driver Modal
  const [showAddDriver, setShowAddDriver] = useState(false);
  const [driverName, setDriverName] = useState('');
  const [driverEmail, setDriverEmail] = useState('');
  const [driverPassword, setDriverPassword] = useState('');
  const [assignedTruckId, setAssignedTruckId] = useState('');
  const [savingDriver, setSavingDriver] = useState(false);

  // Recalculating Insurance state (truckId -> boolean)
  const [recalculatingId, setRecalculatingId] = useState<string | null>(null);

  // Quick Truck Assignment state (driverId -> truckId)
  const [assigningDriverId, setAssigningDriverId] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'owner')) router.replace('/login');
  }, [user, loading, router]);

  async function loadData() {
    setFetching(true);
    try {
      const [trucksData, driversData, logsData] = await Promise.all([
        apiFetch('/api/owner/trucks').catch(() => []),
        apiFetch('/api/owner/drivers').catch(() => []),
        apiFetch('/api/owner/lstm-logs').catch(() => []),
      ]);
      setTrucks(trucksData);
      setDrivers(driversData);
      setLstmLogs(Array.isArray(logsData) ? logsData : []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setFetching(false);
    }
  }

  useEffect(() => {
    if (user?.role === 'owner') {
      loadData();
    }
  }, [user]);

  // Handle Add Truck
  async function handleAddTruck(e: React.FormEvent) {
    e.preventDefault();
    setSavingTruck(true);
    setError('');
    setSuccess('');
    try {
      const parsedCap = parseFloat(newCapacity);
      const parsedTemp = parseFloat(newTargetTemp);
      await apiFetch('/api/owner/trucks', {
        method: 'POST',
        body: JSON.stringify({
          plate_number: newPlate.trim().toUpperCase(),
          type: newType,
          capacity_tons: Number.isFinite(parsedCap) ? parsedCap : 10.0,
          target_temp_c: Number.isFinite(parsedTemp) ? parsedTemp : 4.0,
          iot_connection_number: newIotConn ? newIotConn.trim().toUpperCase() : undefined,
        }),
      });
      setSuccess(`Truck "${newPlate.trim().toUpperCase()}" registered successfully!`);
      setShowAddTruck(false);
      setNewPlate('');
      setNewIotConn('');
      loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingTruck(false);
    }
  }

  async function handleDeleteTruck(id: string, plate: string) {
    if (!confirm(`Delete truck "${plate}"? Its active trip will end and its driver will be unassigned.`)) return;
    setError('');
    try {
      await apiFetch(`/api/owner/trucks/${id}`, { method: 'DELETE' });
      setSuccess(`Truck "${plate}" deleted.`);
      await loadData();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDeleteDriver(id: string, name: string) {
    if (!confirm(`Delete driver "${name}"? The driver will be unassigned from their truck.`)) return;
    setError('');
    try {
      await apiFetch(`/api/owner/drivers/${id}`, { method: 'DELETE' });
      setSuccess(`Driver "${name}" deleted.`);
      await loadData();
    } catch (err: any) {
      setError(err.message);
    }
  }

  // Handle Add Driver
  async function handleCreateDriver(e: React.FormEvent) {
    e.preventDefault();
    setSavingDriver(true);
    setError('');
    setSuccess('');
    try {
      await apiFetch('/api/owner/drivers', {
        method: 'POST',
        body: JSON.stringify({
          name: driverName.trim(),
          email: driverEmail.trim().toLowerCase(),
          password: driverPassword || undefined,
          truckId: assignedTruckId || undefined,
        }),
      });
      setSuccess(`Driver account for "${driverName}" provisioned successfully!`);
      setShowAddDriver(false);
      setDriverName('');
      setDriverEmail('');
      setDriverPassword('');
      setAssignedTruckId('');
      loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingDriver(false);
    }
  }

  // Handle Driver Quick Assignment
  async function handleAssignDriverToTruck(truckId: string, driverId: string) {
    setAssigningDriverId(driverId);
    setError('');
    try {
      await apiFetch(`/api/owner/trucks/${truckId}/assign-driver`, {
        method: 'POST',
        body: JSON.stringify({ driverId }),
      });
      setSuccess('Driver assignment updated successfully.');
      loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAssigningDriverId(null);
    }
  }

  // Handle Insurance Recalculation
  async function handleRecalculateInsurance(truckId: string, plateNumber: string) {
    setRecalculatingId(truckId);
    setError('');
    setSuccess('');
    try {
      const res = await apiFetch(`/api/iot/insurance/${truckId}/recalculate`, {
        method: 'POST',
      });
      const ins = res.insurance;
      setSuccess(
        `Dynamic AI Insurance updated for ${plateNumber}: New rate $${ins.current_price}/mo (${ins.risk_tier || 'Recalculated'}) - ${ins.recommendation || 'Updated'}`
      );
      loadData();
    } catch (err: any) {
      setError(`Insurance calculation failed: ${err.message}`);
    } finally {
      setRecalculatingId(null);
    }
  }

  // Compliance Tag Helper
  const DocTag = ({ date, expiring }: { date: string | null; expiring?: boolean }) => {
    if (!date) return <span style={{ color: 'var(--color-hairline)' }}>—</span>;
    if (isExpired(date)) return <span className="tag-expired">{formatDate(date)}</span>;
    if (isExpiringSoon(date) || expiring) return <span className="tag-expiring">{formatDate(date)}</span>;
    return <span style={{ color: 'var(--color-slate)', fontSize: 13 }}>{formatDate(date)}</span>;
  };

  // Filter trucks
  const filteredTrucks = trucks.filter(t => {
    const matchSearch =
      t.plate_number.toLowerCase().includes(search.toLowerCase()) ||
      t.type.toLowerCase().includes(search.toLowerCase()) ||
      (t.iot_connection_number && t.iot_connection_number.toLowerCase().includes(search.toLowerCase())) ||
      (t.driver_name && t.driver_name.toLowerCase().includes(search.toLowerCase()));
    const matchStatus = !statusFilter || t.status === statusFilter;
    return matchSearch && matchStatus;
  });

  // Filter drivers
  const filteredDrivers = drivers.filter(d => {
    return (
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.email.toLowerCase().includes(search.toLowerCase()) ||
      (d.truck_plate && d.truck_plate.toLowerCase().includes(search.toLowerCase()))
    );
  });

  const connectedIotCount = trucks.filter(t => Boolean(t.iot_connection_number)).length;
  const expiringCount = trucks.filter(t => t.insurance_expiring || t.permit_expiring || t.fitness_expiring).length;
  const discountedCount = trucks.filter(t => t.insurance_status === 'discounted' || Number(t.current_insurance_price) < Number(t.base_insurance_price)).length;
  const surchargedCount = trucks.filter(t => t.insurance_status === 'surcharged' || Number(t.current_insurance_price) > Number(t.base_insurance_price)).length;
  const avgPremium = trucks.length > 0
    ? (trucks.reduce((acc, t) => acc + (Number(t.current_insurance_price) || 450), 0) / trucks.length).toFixed(0)
    : '450';

  if (loading || !user) return null;

  return (
    <DashboardLayout navItems={NAV} title="Fleet Management Portal" roleLabel="Fleet Owner">
      <div className="space-y-6">
        {error && <ErrorAlert message={error} />}
        {success && <SuccessAlert message={success} />}

        {/* Tab Navigation Controls */}
        <div className="flex flex-wrap gap-2 border-b pb-3" style={{ borderColor: 'var(--color-hairline)' }}>
          <button
            onClick={() => { setActiveTab('fleet'); setSearch(''); router.replace('/owner'); }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'fleet'
                ? 'bg-amber-100 text-amber-900 border border-amber-300 shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-transparent'
            }`}
          >
            <span>🚛</span>
            <span>My Fleet</span>
            <span className="ml-1 text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
              {trucks.length}
            </span>
          </button>

          <button
            onClick={() => { setActiveTab('drivers'); setSearch(''); }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'drivers'
                ? 'bg-amber-100 text-amber-900 border border-amber-300 shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-transparent'
            }`}
          >
            <span>👤</span>
            <span>Drivers</span>
            <span className="ml-1 text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
              {drivers.length}
            </span>
          </button>

        </div>

        {/* ============================================================== */}
        {/* TAB 1: MY FLEET                                                */}
        {/* ============================================================== */}
        {activeTab === 'fleet' && (
          <div className="space-y-6">
            {/* Fleet Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Total Fleet', value: trucks.length, icon: '🚛', color: 'var(--color-gold)' },
                { label: 'In Transit', value: trucks.filter(t => t.status === 'on_trip').length, icon: '📍', color: 'var(--status-on-trip)' },
                { label: 'Active IoT Devices', value: connectedIotCount, icon: '📡', color: '#10b981' },
                { label: 'Compliance Alerts', value: expiringCount, icon: '⚠️', color: 'var(--status-issue)' },
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

            {/* Filter and Action Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="flex gap-3 flex-1 flex-wrap">
                <input
                  className="input-field min-w-0 flex-1 sm:max-w-xs"
                  placeholder="Search plate, type, driver or IoT ID…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                <select
                  className="input-field w-full sm:w-auto sm:min-w-40"
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

            {/* Fleet Desktop Table */}
            <div className="hidden min-w-0 md:block card p-0 overflow-x-auto">
              {fetching ? <Spinner /> : filteredTrucks.length === 0 ? (
                <EmptyState message="No trucks found matching your criteria." icon="🚛" />
              ) : (
                <table className="data-table min-w-[1040px]">
                  <thead>
                    <tr>
                      <th>Plate Number</th>
                      <th>Type & Capacity</th>
                      <th>IoT Device ID</th>
                      <th>Target Temp</th>
                      <th>Status</th>
                      <th>Driver</th>
                      <th>Compliance</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTrucks.map(t => (
                      <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                        <td className="whitespace-nowrap font-mono font-semibold text-sm text-slate-900">{t.plate_number}</td>
                        <td style={{ color: 'var(--color-slate)', fontSize: 13 }}>
                          <div className="font-medium text-slate-800">{t.type}</div>
                          <span className="text-xs text-slate-500">{t.capacity_tons}T</span>
                        </td>
                        <td>
                          {t.iot_connection_number ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              {t.iot_connection_number}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400 italic">None assigned</span>
                          )}
                        </td>
                        <td className="font-semibold text-sm tabular-nums">
                          {t.target_temp_c}°C
                        </td>
                        <td><StatusBadge status={t.status} /></td>
                        <td style={{ color: 'var(--color-slate)', fontSize: 13 }}>{t.driver_name || '—'}</td>
                        <td>
                          <div className="flex gap-1 flex-wrap">
                            {t.insurance_expiring ? <span className="tag-expiring">Ins Expiring</span> : <DocTag date={t.insurance_expiry} />}
                          </div>
                        </td>
                        <td>
                          <div className="flex min-w-[180px] items-center gap-2">
                          <button className="btn-danger text-xs" onClick={() => handleDeleteTruck(t.id, t.plate_number)}>Delete</button>
                          <Link href={`/owner/trucks/${t.id}`} className="btn-ghost text-xs whitespace-nowrap">
                            View & Control →
                          </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Fleet Mobile Cards */}
            <div className="md:hidden space-y-3">
              {fetching ? <Spinner /> : filteredTrucks.length === 0 ? (
                <EmptyState message="No trucks found." icon="🚛" />
              ) : filteredTrucks.map(t => (
                <div key={t.id} className="card">
                  <Link href={`/owner/trucks/${t.id}`} className="block hover:border-gold transition-colors">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                  <p className="font-mono font-semibold text-base text-slate-900">{t.plate_number}</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--color-slate)' }}>{t.type} • {t.capacity_tons}T</p>
                    </div>
                    <StatusBadge status={t.status} />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs py-2 my-2 border-y border-slate-200 text-slate-700">
                    <div>
                      <span className="text-slate-500">IoT Device: </span>
                      {t.iot_connection_number ? (
                        <span className="font-mono text-emerald-400 font-semibold">{t.iot_connection_number}</span>
                      ) : (
                        <span className="text-gray-500">Unpaired</span>
                      )}
                    </div>
                    <div>
                      <span className="text-slate-500">Target: </span>
                      <span className="font-semibold">{t.target_temp_c}°C</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Driver: </span>
                      <span>{t.driver_name || 'Unassigned'}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Premium: </span>
                      <span className="text-amber-400 font-semibold">${t.current_insurance_price || 450}/mo</span>
                    </div>
                  </div>
                  </Link>
                  <button className="btn-danger text-xs w-full mt-2" onClick={() => handleDeleteTruck(t.id, t.plate_number)}>Delete Truck</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 2: DRIVERS                                                 */}
        {/* ============================================================== */}
        {activeTab === 'drivers' && (
          <div className="space-y-6">
            {/* Drivers Stats */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="card p-4 flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold tabular-nums text-slate-900">{drivers.length}</p>
                  <p className="text-xs uppercase font-medium tracking-wide mt-1 text-slate-500">Total Fleet Drivers</p>
                </div>
                <span className="text-2xl opacity-80">👤</span>
              </div>
              <div className="card p-4 flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold tabular-nums text-emerald-700">
                    {drivers.filter(d => Boolean(d.truck_plate)).length}
                  </p>
                  <p className="text-xs uppercase font-medium tracking-wide mt-1 text-slate-500">Assigned To Truck</p>
                </div>
                <span className="text-2xl opacity-80">🚚</span>
              </div>
              <div className="card p-4 flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold tabular-nums text-amber-700">
                    {drivers.filter(d => !d.truck_plate).length}
                  </p>
                  <p className="text-xs uppercase font-medium tracking-wide mt-1 text-slate-500">Unassigned Drivers</p>
                </div>
                <span className="text-2xl opacity-80">📋</span>
              </div>
            </div>

            {/* Drivers Action & Search */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <input
                className="input-field min-w-0 flex-1 sm:max-w-xs"
                placeholder="Search drivers by name, email, or truck…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <button
                onClick={() => setShowAddDriver(true)}
                className="btn-gold flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <span>+</span>
                <span>Provision Driver</span>
              </button>
            </div>

            {/* Drivers Table */}
            <div className="card p-0 overflow-x-auto">
              {fetching ? <Spinner /> : filteredDrivers.length === 0 ? (
                <EmptyState message="No drivers found matching your search. Click '+ Provision Driver' to add one." icon="👤" />
              ) : (
                <table className="data-table min-w-[900px]">
                  <thead>
                    <tr>
                      <th>Driver Name</th>
                      <th>Email Credentials</th>
                      <th>Assigned Vehicle</th>
                      <th>Account Status</th>
                      <th>Quick Reassign Truck</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDrivers.map(d => (
                      <tr key={d.id} className="hover:bg-slate-50">
                        <td className="font-semibold text-slate-900">{d.name}</td>
                        <td className="font-mono text-xs text-slate-600">{d.email}</td>
                        <td>
                          {d.truck_plate ? (
                            <span className="font-mono text-xs font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                              {d.truck_plate}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400 italic">Unassigned</span>
                          )}
                        </td>
                        <td>
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs font-bold uppercase ${
                              d.active
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-red-50 text-red-700 border border-red-200'
                            }`}
                          >
                            {d.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td>
                          <select
                            disabled={assigningDriverId === d.id}
                            value={d.truck_id || ''}
                            onChange={e => {
                              if (e.target.value) {
                                handleAssignDriverToTruck(e.target.value, d.id);
                              }
                            }}
                            className="input-field text-xs py-1 px-2 w-auto"
                          >
                            <option value="">{d.truck_plate ? 'Change Truck…' : 'Assign to Truck…'}</option>
                            {trucks.map(tr => (
                              <option key={tr.id} value={tr.id}>
                                {tr.plate_number} ({tr.type})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          {d.active && <button className="btn-danger text-xs" onClick={() => handleDeleteDriver(d.id, d.name)}>Delete</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* 1-Minute Neon DB LSTM Spoilage & Insurance Ledger */}
            <div className="card p-0 overflow-x-auto">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">1-Minute LSTM Spoilage & Insurance History (Neon DB)</h3>
                  <p className="text-xs text-slate-500">
                    Per-minute SpoilageLSTM (Good vs. Bad environment shelf-life) and InsuranceLSTM premium predictions.
                  </p>
                </div>
                <span className="text-xs font-mono text-slate-500">{lstmLogs.length} records</span>
              </div>
              {lstmLogs.length === 0 ? (
                <EmptyState message="No 1-minute LSTM logs recorded yet." icon="📊" />
              ) : (
                <table className="data-table min-w-[1040px]">
                  <thead>
                    <tr>
                      <th>Recorded At</th>
                      <th>Truck</th>
                      <th>Temp / Target</th>
                      <th>Humidity</th>
                      <th>Spoilage Risk</th>
                      <th>Good Env RSL</th>
                      <th>Bad Env RSL</th>
                      <th>LSTM Insurance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lstmLogs.slice(0, 50).map((row) => (
                      <tr key={row.id} className="text-xs">
                        <td className="font-mono whitespace-nowrap">{new Date(row.recorded_at).toLocaleString()}</td>
                        <td className="font-mono font-semibold">{row.plate_number}</td>
                        <td className="tabular-nums">{row.temperature}°C / {row.target_temp}°C</td>
                        <td className="tabular-nums">{row.humidity}%</td>
                        <td>
                          <span className="font-semibold">{row.spoilage_risk_level}</span> ({row.spoilage_risk})
                        </td>
                        <td className="tabular-nums text-emerald-700 font-semibold">
                          {row.good_env_rsl_hours ?? row.rsl_hours ?? '—'} hrs
                        </td>
                        <td className="tabular-nums text-red-700 font-semibold">
                          {row.bad_env_rsl_hours ?? '—'} hrs
                        </td>
                        <td className="font-mono font-semibold tabular-nums">
                          ${Number(row.predicted_insurance_price ?? row.truck_current_price ?? 450).toFixed(2)}/mo
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 3: INSURANCE FOR EACH TRUCK                                */}
        {/* ============================================================== */}
        {activeTab === 'insurance' && (
          <div className="space-y-6">
            {/* Insurance Overview Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="card p-4">
                <p className="text-2xl font-bold tabular-nums text-amber-700">${avgPremium}<span className="text-xs text-slate-500 font-normal">/mo</span></p>
                <p className="text-xs uppercase font-medium tracking-wide mt-1 text-slate-500">Average Premium / Truck</p>
              </div>

              <div className="card p-4">
                <p className="text-2xl font-bold tabular-nums text-emerald-700">{discountedCount}</p>
                <p className="text-xs uppercase font-medium tracking-wide mt-1 text-slate-500">Discounted Fleet (Safe Temp)</p>
              </div>

              <div className="card p-4">
                <p className="text-2xl font-bold tabular-nums text-red-700">{surchargedCount}</p>
                <p className="text-xs uppercase font-medium tracking-wide mt-1 text-slate-500">Surcharged (Thermal Excursion)</p>
              </div>

              <div className="card p-4">
                <p className="text-2xl font-bold tabular-nums text-amber-600">{expiringCount}</p>
                <p className="text-xs uppercase font-medium tracking-wide mt-1 text-slate-500">Policies Expiring ≤ 7 Days</p>
              </div>
            </div>

            {/* Insurance Notice Banner */}
            <div className="card p-4 border border-amber-200 bg-amber-50/60 text-xs text-slate-700 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">⚡</span>
                <div>
                  <span className="font-bold text-amber-800">Dual-LSTM Underwriting Active:</span>
                  <span className="text-slate-600 ml-1">
                    Insurance premiums automatically adjust via InsuranceLSTM using Admin base rates, SpoilageLSTM predictions, and 1-minute Neon DB logs.
                  </span>
                </div>
              </div>
              <div className="no-print flex items-center gap-2 w-full md:w-auto">
                <input
                  className="input-field text-xs max-w-xs"
                  placeholder="Filter trucks by plate or driver…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                <button
                  onClick={() => window.print()}
                  className="btn-primary text-xs whitespace-nowrap"
                >
                  🖨️ Print / Export PDF
                </button>
              </div>
            </div>

            {/* Insurance Table for Each Truck */}
            <div className="card p-0 overflow-x-auto">
              {fetching ? <Spinner /> : filteredTrucks.length === 0 ? (
                <EmptyState message="No vehicles found in fleet." icon="🛡️" />
              ) : (
                <table className="data-table min-w-[1120px]">
                  <thead>
                    <tr>
                      <th>Truck & Specs</th>
                      <th>Driver & IoT</th>
                      <th>Dynamic Status</th>
                      <th>Base Rate</th>
                      <th>Dynamic Monthly Premium</th>
                      <th>Risk Score</th>
                      <th>Policy Expiry</th>
                      <th>AI Underwriting</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTrucks.map(t => {
                      const basePrice = Number(t.base_insurance_price) || 450;
                      const currentPrice = Number(t.current_insurance_price) || 450;
                      const diff = currentPrice - basePrice;
                      const isDiscounted = diff < 0 || t.insurance_status === 'discounted';
                      const isSurcharged = diff > 0 || t.insurance_status === 'surcharged';
                      const isCalculating = recalculatingId === t.id;

                      return (
                        <tr key={t.id} className="hover:bg-slate-800/40 transition-colors">
                          <td>
                            <div className="whitespace-nowrap font-mono font-semibold text-slate-900 text-sm">{t.plate_number}</div>
                            <div className="text-xs text-gray-400">{t.type} • {t.capacity_tons}T</div>
                          </td>

                          <td className="text-xs">
                            <div className="text-slate-200 font-medium">{t.driver_name || 'Unassigned'}</div>
                            {t.iot_connection_number ? (
                              <span className="font-mono text-emerald-400 font-semibold">{t.iot_connection_number}</span>
                            ) : (
                              <span className="text-gray-500 italic">No IoT paired</span>
                            )}
                          </td>

                          <td>
                            {isDiscounted ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-bold bg-emerald-950/60 text-emerald-300 border border-emerald-500/40">
                                <span>🟢</span> Discounted (-10%)
                              </span>
                            ) : isSurcharged ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-bold bg-red-950/60 text-red-300 border border-red-500/40">
                                <span>🔴</span> Surcharged (+10%)
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">
                                Standard Rate
                              </span>
                            )}
                          </td>

                          <td className="font-mono text-xs text-gray-400 tabular-nums">
                            ${basePrice.toFixed(2)}/mo
                          </td>

                          <td>
                            <div className="font-bold text-base tabular-nums text-amber-300">
                              ${currentPrice.toFixed(2)}
                              <span className="text-xs font-normal text-gray-400">/mo</span>
                            </div>
                            <div className="text-[11px] font-mono">
                              {diff < 0 ? (
                                <span className="text-emerald-400">Saved ${Math.abs(diff).toFixed(2)}/mo</span>
                              ) : diff > 0 ? (
                                <span className="text-red-400">+${diff.toFixed(2)} excursion fee</span>
                              ) : (
                                <span className="text-gray-500">Standard tier</span>
                              )}
                            </div>
                          </td>

                          <td>
                            <div className="font-mono text-xs font-semibold tabular-nums text-white">
                              {Number(t.insurance_risk_score || 15).toFixed(1)} / 100
                            </div>
                            <div className="text-[10px] text-gray-400">
                              {Number(t.insurance_risk_score || 15) < 30
                                ? 'Low Thermal Risk'
                                : Number(t.insurance_risk_score || 15) < 60
                                ? 'Moderate Risk'
                                : 'High Excursion Risk'}
                            </div>
                          </td>

                          <td>
                            {t.insurance_expiring ? (
                              <span className="tag-expiring font-semibold">Expiring Soon!</span>
                            ) : (
                              <DocTag date={t.insurance_expiry} />
                            )}
                          </td>

                          <td>
                            <div className="flex items-center gap-2">
                              <button
                                disabled={isCalculating}
                                onClick={() => handleRecalculateInsurance(t.id, t.plate_number)}
                                className="px-2.5 py-1 rounded text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 transition-all flex items-center gap-1 whitespace-nowrap"
                                title="Run real-time IoT AI dynamic insurance calculation"
                              >
                                {isCalculating ? (
                                  <>
                                    <span className="w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                                    <span>Calculating…</span>
                                  </>
                                ) : (
                                  <>
                                    <span>⚡</span>
                                    <span>Recalculate AI</span>
                                  </>
                                )}
                              </button>
                              <Link
                                href={`/owner/trucks/${t.id}`}
                                className="btn-ghost text-xs whitespace-nowrap py-1 px-2"
                              >
                                Telemetry →
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* 1-Minute Neon DB LSTM Spoilage & Insurance Ledger */}
            <div className="card p-0 overflow-x-auto">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">1-Minute LSTM Spoilage & Insurance History (Neon DB)</h3>
                  <p className="text-xs text-slate-500">
                    Per-minute SpoilageLSTM (Good vs. Bad environment shelf-life) and InsuranceLSTM premium predictions.
                  </p>
                </div>
                <span className="text-xs font-mono text-slate-500">{lstmLogs.length} records</span>
              </div>
              {lstmLogs.length === 0 ? (
                <EmptyState message="No 1-minute LSTM logs recorded yet." icon="📊" />
              ) : (
                <table className="data-table min-w-[1040px]">
                  <thead>
                    <tr>
                      <th>Recorded At</th>
                      <th>Truck</th>
                      <th>Temp / Target</th>
                      <th>Humidity</th>
                      <th>Spoilage Risk</th>
                      <th>Good Env RSL</th>
                      <th>Bad Env RSL</th>
                      <th>LSTM Insurance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lstmLogs.slice(0, 50).map((row) => (
                      <tr key={row.id} className="text-xs">
                        <td className="font-mono whitespace-nowrap">{new Date(row.recorded_at).toLocaleString()}</td>
                        <td className="font-mono font-semibold">{row.plate_number}</td>
                        <td className="tabular-nums">{row.temperature}°C / {row.target_temp}°C</td>
                        <td className="tabular-nums">{row.humidity}%</td>
                        <td>
                          <span className="font-semibold">{row.spoilage_risk_level}</span> ({row.spoilage_risk})
                        </td>
                        <td className="tabular-nums text-emerald-700 font-semibold">
                          {row.good_env_rsl_hours ?? row.rsl_hours ?? '—'} hrs
                        </td>
                        <td className="tabular-nums text-red-700 font-semibold">
                          {row.bad_env_rsl_hours ?? '—'} hrs
                        </td>
                        <td className="font-mono font-semibold tabular-nums">
                          ${Number(row.predicted_insurance_price ?? row.truck_current_price ?? 450).toFixed(2)}/mo
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* MODAL: ADD TRUCK & IOT DEVICE                                  */}
        {/* ============================================================== */}
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

        {/* ============================================================== */}
        {/* MODAL: PROVISION DRIVER                                        */}
        {/* ============================================================== */}
        {showAddDriver && (
          <Modal title="Provision New Fleet Driver" onClose={() => setShowAddDriver(false)}>
            <form onSubmit={handleCreateDriver} className="space-y-4">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Full Name *</label>
                <input
                  required
                  placeholder="e.g. Vikram Sharma"
                  value={driverName}
                  onChange={e => setDriverName(e.target.value)}
                  className="input-field"
                />
              </div>

              <div>
                <label className="text-xs text-gray-400 block mb-1">Email (Login Username) *</label>
                <input
                  required
                  type="email"
                  placeholder="driver@elitecold.com"
                  value={driverEmail}
                  onChange={e => setDriverEmail(e.target.value)}
                  className="input-field"
                />
              </div>

              <div>
                <label className="text-xs text-gray-400 block mb-1">Temporary Password (Optional)</label>
                <input
                  type="password"
                  placeholder="Defaults to password123"
                  value={driverPassword}
                  onChange={e => setDriverPassword(e.target.value)}
                  className="input-field"
                />
              </div>

              <div>
                <label className="text-xs text-gray-400 block mb-1">Assign to Vehicle (Optional)</label>
                <select
                  value={assignedTruckId}
                  onChange={e => setAssignedTruckId(e.target.value)}
                  className="input-field"
                >
                  <option value="">Unassigned</option>
                  {trucks.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.plate_number} — {t.type}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddDriver(false)}
                  className="btn-ghost"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingDriver}
                  className="btn-gold"
                >
                  {savingDriver ? 'Creating Account…' : 'Provision Account'}
                </button>
              </div>
            </form>
          </Modal>
        )}
      </div>
    </DashboardLayout>
  );
}
