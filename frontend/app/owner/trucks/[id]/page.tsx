'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth, apiFetch } from '@/lib/auth';
import DashboardLayout from '@/components/layout/DashboardLayout';
import {
  StatusBadge,
  Spinner,
  EmptyState,
  ErrorAlert,
  SuccessAlert,
  Modal,
  formatDate,
  formatDateTime,
  isExpired,
  isExpiringSoon,
} from '@/components/ui/shared';

const NAV = [
  { href: '/owner/trips', label: 'Trip Management', icon: '🛣️' },
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
  const [loadingDrivers, setLoadingDrivers] = useState(false);
  const [driverLoadError, setDriverLoadError] = useState('');
  const [telemetryHistory, setTelemetryHistory] = useState<any[]>([]);
  const [telemetryError, setTelemetryError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Driver Assignment Modal
  const [showAssign, setShowAssign] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState('');
  const [savingDriver, setSavingDriver] = useState(false);

  // Set Target Temp Modal (Owner privilege)
  const [showEditTemp, setShowEditTemp] = useState(false);
  const [newTargetTemp, setNewTargetTemp] = useState('4.0');
  const [savingTemp, setSavingTemp] = useState(false);

  // AI Insurance Recalculation
  const [recalculatingInsurance, setRecalculatingInsurance] = useState(false);

  // Live IoT telemetry
  const [iotTelemetry, setIotTelemetry] = useState<any>(null);
  const [showIotManager, setShowIotManager] = useState(false);
  const [iotDevices, setIotDevices] = useState<any[]>([]);
  const [selectedIotCode, setSelectedIotCode] = useState('');
  const [iotSaving, setIotSaving] = useState(false);
  const [iotManagerError, setIotManagerError] = useState('');

  useEffect(() => {
    if (!showIotManager) return;
    let active = true;
    setIotManagerError('');
    setIotDevices([]);
    apiFetch('/api/iot/devices')
      .then((response) => {
        if (!Array.isArray(response?.devices)) throw new Error('The device registry returned an invalid response.');
        if (active) setIotDevices(response.devices);
      })
      .catch((e: any) => { if (active) setIotManagerError(e?.message || 'Could not load registered IoT devices.'); });
    return () => { active = false; };
  }, [showIotManager]);

  async function saveIotPairing(action: 'pair' | 'unpair') {
    if (!truck || iotSaving) return;
    setIotSaving(true);
    setIotManagerError('');
    try {
      if (action === 'pair') {
        if (!iotDevices.some((device) => device.connection_number === selectedIotCode && !device.isPaired)) {
          throw new Error('Select an available registered device.');
        }
        await apiFetch('/api/iot/connect', { method: 'POST', body: JSON.stringify({ truckId: truck.id, connectionNumber: selectedIotCode }) });
        setSuccess(`IoT device ${selectedIotCode} paired successfully.`);
      } else {
        await apiFetch('/api/iot/disconnect', { method: 'POST', body: JSON.stringify({ truckId: truck.id }) });
        setSuccess('IoT device unpaired successfully.');
      }
      setShowIotManager(false);
      await fetchAll();
    } catch (e: any) {
      setIotManagerError(e?.message || 'IoT pairing update failed.');
    } finally {
      setIotSaving(false);
    }
  }

  useEffect(() => {
    if (!loading && (!user || user.role !== 'owner')) router.replace('/login');
  }, [user, loading, router]);

  async function fetchAll() {
    setFetching(true);
    setError('');
    try {
      const [t, tr] = await Promise.all([
        apiFetch(`/api/owner/trucks/${id}`),
        apiFetch(`/api/owner/trucks/${id}/trips`),
      ]);
      setTruck(t);
      if (t?.target_temp_c) setNewTargetTemp(String(t.target_temp_c));
      setTrips(tr);
      const [iotResult, historyResult] = await Promise.allSettled([
        apiFetch(`/api/iot/telemetry/${id}`),
        apiFetch(`/api/iot/history/${id}`),
      ]);
      if (iotResult.status === 'fulfilled') {
        setIotTelemetry(iotResult.value?.telemetry || null);
        setTelemetryError('');
      } else {
        setTelemetryError(iotResult.reason?.message || 'Could not load live IoT telemetry.');
      }
      if (historyResult.status === 'fulfilled') {
        if (!Array.isArray(historyResult.value?.history)) throw new Error(`GET /api/iot/history/${id} returned an invalid telemetry history response.`);
        setTelemetryHistory(historyResult.value.history);
        setHistoryError('');
      } else {
        setHistoryError(historyResult.reason?.message || 'Could not load telemetry history.');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setFetching(false);
    }
  }

  useEffect(() => {
    if (user?.role === 'owner' && id) {
      fetchAll();
      // Poll live telemetry every 4s
      const timer = setInterval(async () => {
        try {
          const res = await apiFetch(`/api/iot/telemetry/${id}`);
          if (res?.telemetry) setIotTelemetry(res.telemetry);
          setTelemetryError('');
        } catch (e: any) {
          setTelemetryError(e?.message || 'Could not refresh live IoT telemetry.');
        }
      }, 4000);
      return () => clearInterval(timer);
    }
  }, [user, id]);

  // Fetch eligible drivers every time the assignment modal opens. This request
  // is independent of truck/trip/IoT page loading so one failed request cannot
  // leave the dropdown silently empty.
  useEffect(() => {
    if (!showAssign || !id) return;
    let active = true;
    setLoadingDrivers(true);
    setDriverLoadError('');
    setDrivers([]);
    setSelectedDriver('');
    apiFetch(`/api/owner/trucks/${id}/available-drivers`)
      .then((rows) => {
        if (!active) return;
        if (!Array.isArray(rows)) throw new Error('The driver service returned an invalid response.');
        setDrivers(rows);
      })
      .catch((e: any) => {
        if (!active) return;
        setDriverLoadError(e?.message || 'Could not load available drivers.');
      })
      .finally(() => { if (active) setLoadingDrivers(false); });
    return () => { active = false; };
  }, [showAssign, id]);

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
    if (!selectedDriver || loadingDrivers || savingDriver) return;
    setSavingDriver(true);
    setError('');
    try {
      await apiFetch(`/api/owner/trucks/${id}/assign-driver`, {
        method: 'POST',
        body: JSON.stringify({ driverId: selectedDriver }),
      });
      setSuccess('Driver assigned successfully.');
      setShowAssign(false);
      setSelectedDriver('');
      await fetchAll();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingDriver(false);
    }
  }

  async function handleSaveTargetTemp(e: React.FormEvent) {
    e.preventDefault();
    setSavingTemp(true);
    setError('');
    try {
      const val = parseFloat(newTargetTemp);
      if (isNaN(val)) throw new Error('Invalid temperature');
      await apiFetch(`/api/owner/trucks/${id}/target-temp`, {
        method: 'PATCH',
        body: JSON.stringify({ targetTemp: val }),
      });
      setSuccess(`Target temperature updated to ${val}°C.`);
      setShowEditTemp(false);
      fetchAll();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingTemp(false);
    }
  }

  async function handleRecalculateInsurance() {
    setRecalculatingInsurance(true);
    setError('');
    try {
      const res = await apiFetch(`/api/iot/insurance/${id}/recalculate`, {
        method: 'POST',
      });
      const price = res.current_price || res.new_monthly_premium || 450;
      const pct = res.price_change_pct !== undefined ? res.price_change_pct : (res.change_percentage || 0);
      setSuccess(`AI Insurance recalculated: $${price}/mo (${pct >= 0 ? '+' : ''}${pct}% based on telemetry compliance).`);
      fetchAll();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRecalculatingInsurance(false);
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
            : <span className="text-sm font-medium" style={{ color: 'var(--color-ink)' }}>{formatDate(date)}</span>}
        </span>
      </div>
    );
  };

  const premium = truck?.current_insurance_price || truck?.monthly_insurance_premium || 450;
  const basePrice = truck?.base_insurance_price || 450;
  const premiumDiff = premium - basePrice;
  const isDiscount = premiumDiff < 0;
  const isSurcharge = premiumDiff > 0;

  return (
    <DashboardLayout navItems={NAV} title={truck ? `Asset Details — ${truck.plate_number}` : 'Loading…'} roleLabel="Fleet Owner">
      {fetching ? <Spinner /> : !truck ? (
        <ErrorAlert message="Truck not found or access denied." />
      ) : (
        <div className="space-y-6">
          {error && <ErrorAlert message={error} />}
          {success && <SuccessAlert message={success} />}

          {/* Top navigation header */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <button onClick={() => router.push('/owner')} className="btn-ghost text-xs flex items-center gap-1">
              <span>←</span>
              <span>Back to Fleet Overview</span>
            </button>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Status:</span>
              <StatusBadge status={truck.status} />
            </div>
          </div>

          {/* 3-Column Top Grid: Truck Specs, AI Insurance Pricing, Compliance */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* 1. Truck & Temperature Control */}
            <div className="card space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-wider text-amber-500">Vehicle Specifications</h2>
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/30">
                  {truck.plate_number}
                </span>
              </div>

              <div className="divide-y divide-slate-800 text-sm">
                <div className="py-2 flex justify-between">
                  <span className="text-xs text-gray-400">Chassis & Body</span>
                  <span className="font-medium text-slate-200">{truck.type}</span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="text-xs text-gray-400">Payload Capacity</span>
                  <span className="font-medium text-slate-200">{truck.capacity_tons} Tonnes</span>
                </div>
                <div className="py-2 flex justify-between items-center">
                  <span className="text-xs text-gray-400">Target Temp</span>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-amber-400 text-base">{truck.target_temp_c}°C</span>
                    <button
                      onClick={() => setShowEditTemp(true)}
                      className="text-xs px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30"
                    >
                      ✎ Edit
                    </button>
                  </div>
                </div>
                <div className="py-2 flex justify-between items-center">
                  <span className="text-xs text-gray-400">Assigned Driver</span>
                  <span className="font-medium text-slate-200">{truck.driver_name || 'Unassigned'}</span>
                </div>
                <div className="py-2 flex justify-between items-center">
                  <span className="text-xs text-gray-400">Paired IoT Sensor</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-emerald-400">
                      {truck.iot_connection_number || 'NO DEVICE PAIRED'}
                    </span>
                    <button type="button" className="btn-ghost text-xs" onClick={() => setShowIotManager(true)}>Manage</button>
                  </div>
                </div>
              </div>

              <div className="pt-2 flex gap-2">
                {truck.status !== 'on_trip' && (
                  <>
                    {truck.status !== 'available' && (
                      <button className="btn-ghost text-xs flex-1" onClick={() => handleStatusChange('available')}>
                        Set Available
                      </button>
                    )}
                    {truck.status !== 'maintenance' && (
                      <button className="btn-ghost text-xs flex-1" onClick={() => handleStatusChange('maintenance')}>
                        Set Maintenance
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* 2. Dynamic AI Insurance Pricing Model */}
            <div className="card space-y-3 bg-gradient-to-br from-slate-900 to-slate-900/90 border border-amber-500/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🛡️</span>
                  <h2 className="text-sm font-bold uppercase tracking-wider text-amber-400">AI Insurance Pricing</h2>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded font-bold uppercase ${
                  isDiscount ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/40'
                  : isSurcharge ? 'bg-red-950/60 text-red-400 border border-red-500/40'
                  : 'bg-slate-800 text-slate-300'
                }`}>
                  {isDiscount ? 'Safe Driver Discount' : isSurcharge ? 'High Risk Surcharge' : 'Standard Baseline'}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-black/40 border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="text-xs text-gray-400 block">Monthly Premium</span>
                  <span className="text-3xl font-extrabold text-white tabular-nums">${premium}</span>
                  <span className="text-xs text-gray-500"> / month</span>
                </div>
                <div className="text-right">
                  <span className="text-xs text-gray-400 block">Baseline: $450/mo</span>
                  <span className={`text-sm font-bold tabular-nums ${isDiscount ? 'text-emerald-400' : isSurcharge ? 'text-red-400' : 'text-gray-400'}`}>
                    {isDiscount ? `-$${Math.abs(premiumDiff)}/mo` : isSurcharge ? `+$${premiumDiff}/mo` : 'No adjustment'}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5 text-xs text-gray-300">
                <div className="flex justify-between">
                  <span className="text-gray-400">Risk Score:</span>
                  <span className="font-mono font-semibold text-amber-300">
                    {truck.insurance_risk_score !== null && truck.insurance_risk_score !== undefined
                      ? (truck.insurance_risk_score * 100).toFixed(0) + ' / 100'
                      : '15 / 100'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Last Evaluated:</span>
                  <span className="text-gray-300">
                    {truck.insurance_last_evaluated_at ? formatDateTime(truck.insurance_last_evaluated_at) : 'Active Evaluation'}
                  </span>
                </div>
                <div className="p-2 rounded bg-slate-950/60 text-[11px] text-gray-400 border border-slate-800">
                  <span className="text-amber-400 font-semibold">AI Assessment: </span>
                  {truck.insurance_pricing_notes || 'Stable telemetry with compliant temperatures. Continued optimal cold-chain performance will lower monthly premium gradually.'}
                </div>
              </div>

              <button
                onClick={handleRecalculateInsurance}
                disabled={recalculatingInsurance}
                className="btn-gold w-full text-xs py-2 flex items-center justify-center gap-1.5"
              >
                <span>⚡</span>
                <span>{recalculatingInsurance ? 'Analyzing 15-Min Logs…' : 'Recalculate AI Insurance'}</span>
              </button>
            </div>

            {/* 3. Compliance Docs & Driver Management */}
            <div className="card space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300">Compliance & Regulatory</h2>
              <DocRow label="Insurance Expiry" date={truck.insurance_expiry} expiring={truck.insurance_expiring} />
              <DocRow label="Permit Expiry" date={truck.permit_expiry} expiring={truck.permit_expiring} />
              <DocRow label="Fitness Expiry" date={truck.fitness_expiry} expiring={truck.fitness_expiring} />

              <div className="pt-2">
                <button
                  className="btn-ghost w-full text-xs py-2 border border-slate-700"
                  onClick={() => setShowAssign(true)}
                >
                  👤 Reassign Assigned Driver
                </button>
              </div>
            </div>
          </div>

          {/* Live IoT Sensor Gateway & AI Spoilage Monitor */}
          <div className="card p-5 border border-slate-700/80 bg-slate-900/60">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-4 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-950/60 border border-emerald-500/40 flex items-center justify-center text-xl">
                  📡
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Live IoT Telemetry & Spoilage Predictor</h3>
                  <p className="text-xs text-gray-400">Streamed from ESP32 DHT22 sensor gateway via AI/ML inference</p>
                </div>
              </div>
              <div>
                {iotTelemetry ? (
                  <span className="inline-flex items-center gap-2 text-xs font-mono font-bold px-3 py-1 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-500/40">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    ONLINE: {iotTelemetry.connection_number || 'CONNECTED'}
                  </span>
                ) : (
                  <span className="text-xs font-medium text-gray-400 bg-slate-800 px-3 py-1 rounded border border-slate-700">
                    No IoT Device Paired
                  </span>
                )}
              </div>
            </div>

            {iotTelemetry ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-3 rounded-lg bg-black/40 border border-slate-800">
                  <span className="text-xs text-gray-400 block mb-1">Cargo Temp</span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold tabular-nums text-white">{iotTelemetry.temperature}°C</span>
                    <span className="text-xs text-gray-400">Target: {truck.target_temp_c}°C</span>
                  </div>
                  <span className={`text-[11px] block mt-1 font-medium ${
                    Math.abs(iotTelemetry.temperature - truck.target_temp_c) <= 1 ? 'text-emerald-400' : 'text-amber-400'
                  }`}>
                    {Math.abs(iotTelemetry.temperature - truck.target_temp_c) <= 1 ? '✓ Within Safe Threshold' : '⚠️ Excursion Detected'}
                  </span>
                </div>

                <div className="p-3 rounded-lg bg-black/40 border border-slate-800">
                  <span className="text-xs text-gray-400 block mb-1">Humidity & Battery</span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold tabular-nums text-white">{iotTelemetry.humidity}%</span>
                    <span className="text-xs text-gray-400 font-mono">🔋 {iotTelemetry.battery}%</span>
                  </div>
                  <span className="text-[11px] text-gray-400 block mt-1">Sensor: ESP32 + DHT22</span>
                </div>

                <div className="p-3 rounded-lg bg-black/40 border border-slate-800">
                  <span className="text-xs text-gray-400 block mb-1">AI Spoilage Risk</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                      iotTelemetry.spoilage_risk_level === 'CRITICAL' ? 'bg-red-600 text-white'
                      : iotTelemetry.spoilage_risk_level === 'HIGH' ? 'bg-amber-500 text-black'
                      : 'bg-emerald-600 text-white'
                    }`}>
                      {iotTelemetry.spoilage_risk_level} ({(iotTelemetry.spoilage_risk * 100).toFixed(0)}%)
                    </span>
                    <span className="text-xs text-gray-300">RSL: {iotTelemetry.shelf_life_remaining_hours}h</span>
                  </div>
                  <span className="text-[11px] text-gray-400 block mt-1">Quality: {iotTelemetry.quality_retention_pct}%</span>
                </div>

                <div className="p-3 rounded-lg bg-black/40 border border-slate-800">
                  <span className="text-xs text-gray-400 block mb-1">Route & AI Advisory</span>
                  <p className="text-xs font-medium text-slate-200 line-clamp-2">
                    {iotTelemetry.route_recommendation || 'Proceed on route. Cold chain fully preserved.'}
                  </p>
                  <span className="text-[11px] text-gray-400 block mt-1">Speed: {iotTelemetry.vehicle_speed || 50} km/h</span>
                </div>
              </div>
            ) : (
              <div className="text-center py-6 text-gray-400 text-sm">
                <p>No active IoT sensor telemetry streaming for this vehicle.</p>
                <p className="text-xs text-gray-500 mt-1">
                  Connect device with connection ID from IoT Simulator (:3001) or assign an active device ID.
                </p>
              </div>
            )}
            {telemetryError && <ErrorAlert message={telemetryError} />}
          </div>

          {/* 15-Minute Telemetry History Log (Neon DB) */}
          <div className="card p-0 overflow-x-auto">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-white">15-Minute Telemetry & AI Prediction Log (Neon Database)</h2>
                <p className="text-xs text-gray-400">
                  Historical cold-chain records captured every 15 minutes during active trips. Used by AI model for insurance rating.
                </p>
              </div>
              <span className="text-xs font-mono text-gray-400 px-2.5 py-1 rounded bg-slate-800 border border-slate-700">
                {telemetryHistory.length} checkpoints logged
              </span>
            </div>

            {historyError && <div className="p-4"><ErrorAlert message={historyError} /></div>}
            {telemetryHistory.length === 0 && !historyError ? (
              <div className="p-8 text-center text-gray-400 text-sm">
                <p>No 15-minute telemetry checkpoints recorded yet for this vehicle.</p>
                <p className="text-xs text-gray-500 mt-1">
                  As the truck moves on an active trip with a paired IoT device, sensor readings are auto-logged here every 15 minutes.
                </p>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Device ID</th>
                    <th>Temp (°C)</th>
                    <th>Target (°C)</th>
                    <th>Humidity</th>
                    <th>Door</th>
                    <th>Spoilage Risk</th>
                    <th>RSL</th>
                    <th>Route Advisory</th>
                  </tr>
                </thead>
                <tbody>
                  {telemetryHistory.map(row => (
                    <tr key={row.id} className="hover:bg-slate-800/40 text-xs">
                      <td className="font-mono text-gray-300">{formatDateTime(row.created_at)}</td>
                      <td className="font-mono font-semibold text-emerald-400">{row.connection_number || 'ESP32'}</td>
                      <td className="font-bold tabular-nums text-white">{row.temperature}°C</td>
                      <td className="tabular-nums text-gray-400">{row.target_temp}°C</td>
                      <td className="tabular-nums text-gray-300">{row.humidity}%</td>
                      <td>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          row.door_open ? 'bg-red-950 text-red-400 border border-red-500/30' : 'bg-emerald-950 text-emerald-400 border border-emerald-500/30'
                        }`}>
                          {row.door_open ? 'Open' : 'Closed'}
                        </span>
                      </td>
                      <td>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          row.spoilage_risk_level === 'CRITICAL' ? 'bg-red-600 text-white'
                          : row.spoilage_risk_level === 'HIGH' ? 'bg-amber-500 text-black'
                          : 'bg-emerald-600 text-white'
                        }`}>
                          {row.spoilage_risk_level || 'LOW'}
                        </span>
                      </td>
                      <td className="tabular-nums font-medium text-slate-200">{row.rsl_hours || row.shelf_life_remaining_hours || 168} hrs</td>
                      <td className="text-gray-400 max-w-xs truncate">{row.route_recommendation || 'Route optimal'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Trip History Table */}
          <div className="card p-0 overflow-x-auto">
            <div className="px-6 py-4 border-b border-slate-800">
              <h2 className="text-sm font-bold text-white">Trip History</h2>
            </div>
            {trips.length === 0 ? (
              <EmptyState message="No trips recorded for this truck." icon="🛣️" />
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Assigned</th>
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
                      <td><StatusBadge status={tr.status} /></td>
                      <td className="tabular-nums text-xs">{formatDateTime(tr.assigned_at)}</td>
                      <td className="tabular-nums text-xs">{formatDateTime(tr.started_at)}</td>
                      <td className="tabular-nums text-xs">
                        {formatDateTime(tr.ended_at)}
                      </td>
                      <td className="text-sm font-medium">{tr.driver_name}</td>
                      <td className="text-sm text-gray-400">{tr.origin}</td>
                      <td className="text-sm text-gray-400">{tr.destination}</td>
                      <td className="text-sm font-medium text-amber-300">{tr.cargo_type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Reassign Driver Modal */}
      {showAssign && (
        <Modal title="Reassign Driver to Truck" onClose={() => { setShowAssign(false); setSelectedDriver(''); }}>
          <form onSubmit={handleAssignDriver} className="space-y-4">
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-gray-400 mb-1">
                Select Fleet Driver
              </label>
              <select
                value={selectedDriver}
                onChange={e => setSelectedDriver(e.target.value)}
                required disabled={loadingDrivers || !!driverLoadError || drivers.length === 0}
                className="input-field"
              >
                <option value="">{loadingDrivers ? 'Loading drivers…' : driverLoadError ? 'Drivers could not be loaded' : drivers.length ? 'Select a driver…' : 'No available drivers'}</option>
                {drivers.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.email}){d.truck_id && d.truck_id !== truck?.id ? ` — transfer from ${d.truck_plate || 'another truck'}` : d.truck_id ? ' — currently assigned here' : ' — unassigned'}
                  </option>
                ))}
              </select>
              {loadingDrivers && <p className="text-xs text-gray-400" role="status">Loading eligible fleet drivers…</p>}
              {driverLoadError && <p className="text-xs text-red-400" role="alert">{driverLoadError}</p>}
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" className="btn-ghost" onClick={() => { setShowAssign(false); setSelectedDriver(''); }}>Cancel</button>
              <button type="submit" className="btn-gold" disabled={savingDriver || loadingDrivers || !!driverLoadError || !selectedDriver}>
                {savingDriver ? 'Assigning…' : 'Confirm Assignment'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showIotManager && (
        <Modal title={`IoT Device · ${truck?.plate_number || 'Truck'}`} onClose={() => setShowIotManager(false)}>
          <div className="space-y-4">
            <p className="text-xs text-gray-400">Pairing is stored in PostgreSQL. Device online status depends on recent telemetry.</p>
            {iotManagerError && <ErrorAlert message={iotManagerError} />}
            {truck?.iot_connection_number ? (
              <div className="flex items-center justify-between rounded border border-slate-700 p-3">
                <span className="font-mono font-semibold">{truck.iot_connection_number}</span>
                <button type="button" className="btn-ghost" disabled={iotSaving} onClick={() => saveIotPairing('unpair')}>{iotSaving ? 'Saving…' : 'Unpair'}</button>
              </div>
            ) : (
              <>
                <select className="input-field w-full" value={selectedIotCode} onChange={(e) => setSelectedIotCode(e.target.value)} disabled={!!iotManagerError}>
                  <option value="">{iotManagerError ? 'Devices unavailable' : iotDevices.filter((d) => !d.isPaired).length ? 'Select registered device…' : 'No available devices'}</option>
                  {iotDevices.filter((device) => !device.isPaired).map((device) => (
                    <option key={device.device_id} value={device.connection_number}>{device.name} ({device.connection_number}) · {device.status}</option>
                  ))}
                </select>
                <button type="button" className="btn-gold w-full" disabled={iotSaving || !selectedIotCode} onClick={() => saveIotPairing('pair')}>{iotSaving ? 'Saving…' : 'Pair Device'}</button>
              </>
            )}
            <button type="button" className="btn-ghost w-full" onClick={() => setShowIotManager(false)}>Close</button>
          </div>
        </Modal>
      )}

      {/* Edit Target Temp Modal (Owner Privilege) */}
      {showEditTemp && (
        <Modal title="Set Cargo Target Temperature" onClose={() => setShowEditTemp(false)}>
          <form onSubmit={handleSaveTargetTemp} className="space-y-4">
            <p className="text-xs text-gray-400">
              Both fleet owners and assigned drivers can calibrate the refrigerated reefer target temperature.
            </p>
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-gray-400 mb-1">
                Target Temperature (°C)
              </label>
              <input
                type="number"
                step="0.5"
                required
                value={newTargetTemp}
                onChange={e => setNewTargetTemp(e.target.value)}
                className="input-field text-lg font-bold font-mono"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" className="btn-ghost" onClick={() => setShowEditTemp(false)}>Cancel</button>
              <button type="submit" className="btn-gold" disabled={savingTemp}>
                {savingTemp ? 'Saving…' : 'Update Target Temp'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </DashboardLayout>
  );
}
