'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth, apiFetch } from '@/lib/auth';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { openColdChainPdfReport } from '@/lib/pdf-report';
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
  { href: '/owner', label: 'Overview', icon: '🚛' },
  { href: '/owner?tab=insurance', label: 'Insurance', icon: '🛡️' },
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
      const [t, tr, d, iot, hist] = await Promise.all([
        apiFetch(`/api/owner/trucks/${id}`),
        apiFetch(`/api/owner/trucks/${id}/trips`),
        apiFetch('/api/owner/drivers').catch(() => []),
        apiFetch(`/api/iot/telemetry/${id}`).catch(() => null),
        apiFetch(`/api/iot/history/${id}`).catch(() => []),
      ]);
      setTruck(t);
      if (t?.target_temp_c !== undefined && t?.target_temp_c !== null) {
        setNewTargetTemp(String(t.target_temp_c));
      }
      setTrips(tr);
      setDrivers(d.filter((dr: any) => dr.active));
      if (iot?.telemetry) setIotTelemetry(iot.telemetry);
      if (Array.isArray(hist?.history)) setTelemetryHistory(hist.history);
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
      const historyTimer = setInterval(async () => {
        try {
          const res = await apiFetch(`/api/iot/history/${id}`);
          if (Array.isArray(res?.history)) setTelemetryHistory(res.history);
        } catch {}
      }, 60000);
      return () => {
        clearInterval(timer);
        clearInterval(historyTimer);
      };
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
        body: JSON.stringify({ targetTempC: val }),
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
      const ins = res.insurance || res;
      const price = ins.current_price ?? ins.new_monthly_premium ?? 450;
      const pct = ins.price_change_pct !== undefined ? ins.price_change_pct : (ins.change_percentage || 0);
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
      <div className="flex flex-wrap items-center justify-between gap-2 py-2 border-b" style={{ borderColor: 'var(--color-hairline)' }}>
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
  const configuredTarget = Number(truck?.target_temp_c);
  const telemetryDeviation = iotTelemetry && Number.isFinite(configuredTarget)
    ? Math.abs(Number(iotTelemetry.temperature) - configuredTarget)
    : 0;
  const excursionRiskLevel = telemetryDeviation > 3
    ? 'CRITICAL'
    : telemetryDeviation > 1.5
      ? 'HIGH'
      : telemetryDeviation > 1
        ? 'MODERATE'
        : 'LOW';
  const riskRanks: Record<string, number> = { LOW: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 };
  const sourceRiskLevel = Number(iotTelemetry?.spoilage_risk) >= 0.75
    ? 'CRITICAL'
    : Number(iotTelemetry?.spoilage_risk) >= 0.45
      ? 'HIGH'
      : Number(iotTelemetry?.spoilage_risk) >= 0.25
        ? 'MODERATE'
      : iotTelemetry?.spoilage_risk_level || 'LOW';
  const displayedRiskLevel = (riskRanks[excursionRiskLevel] || 0) > (riskRanks[sourceRiskLevel] || 0)
    ? excursionRiskLevel
    : sourceRiskLevel;
  const displayedRisk = Math.max(Number(iotTelemetry?.spoilage_risk) || 0, telemetryDeviation > 3 ? 0.9 : telemetryDeviation > 1.5 ? 0.6 : telemetryDeviation > 1 ? 0.35 : 0);
  const telemetryAgeMs = iotTelemetry
    ? Date.now() - Date.parse(iotTelemetry.received_at || iotTelemetry.timestamp)
    : Number.POSITIVE_INFINITY;
  const telemetryFresh = telemetryAgeMs >= 0 && telemetryAgeMs < 30000;
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button onClick={() => router.push('/owner')} className="no-print btn-ghost text-xs flex items-center gap-1">
              <span>←</span>
              <span>Back to Fleet Overview</span>
            </button>
            <div className="flex items-center gap-3">
              <button
                onClick={() =>
                  openColdChainPdfReport({
                    title: `Truck LSTM Report — ${truck.plate_number}`,
                    subtitle: `Company: ${user?.name || 'Fleet Owner'} · ${truck.type || 'Cold Reefer'}`,
                    trucks: [{ ...truck, owner_name: user?.name }],
                    logs: telemetryHistory.map((r) => ({ ...r, plate_number: truck.plate_number })),
                    groupByCompany: false,
                  })
                }
                className="no-print btn-primary text-xs"
              >
                🖨️ Truck PDF Report
              </button>
              <span className="text-xs text-gray-400">Status:</span>
              <StatusBadge status={truck.status} />
            </div>
          </div>

          {/* 3-Column Top Grid: Truck Specs, AI Insurance Pricing, Compliance */}
          <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-3">
            {/* 1. Truck & Temperature Control */}
            <div className="card space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold uppercase tracking-wider text-amber-500">Vehicle Specifications</h2>
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/30">
                  {truck.plate_number}
                </span>
              </div>

              <div className="divide-y divide-slate-200 text-sm">
                <div className="py-2 flex justify-between">
                  <span className="text-xs text-slate-600">Chassis & Body</span>
                  <span className="font-medium text-slate-800">{truck.type}</span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="text-xs text-slate-600">Payload Capacity</span>
                  <span className="font-medium text-slate-800">{truck.capacity_tons} Tonnes</span>
                </div>
                <div className="py-2 flex justify-between items-center">
                  <span className="text-xs text-slate-600">Target Temp</span>
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
                  <span className="text-xs text-slate-600">Assigned Driver</span>
                  <span className="font-medium text-slate-800">{truck.driver_name || 'Unassigned'}</span>
                </div>
                <div className="py-2 flex justify-between items-center">
                  <span className="text-xs text-slate-600">Paired IoT Sensor</span>
                  <div className="flex items-center gap-2">
                    {truck.iot_connection_number ? (
                      <span className="font-mono text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        {truck.iot_connection_number}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">None</span>
                    )}
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
            <div className="card min-w-0 space-y-3 bg-gradient-to-br from-slate-900 to-slate-900/90 border border-amber-500/20">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🛡️</span>
                  <h2 className="text-sm font-bold uppercase tracking-wider text-amber-400">AI Insurance Pricing</h2>
                </div>
                <span className={`max-w-full whitespace-normal text-xs px-2 py-0.5 rounded font-bold uppercase ${
                  isDiscount ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/40'
                  : isSurcharge ? 'bg-red-950/60 text-red-400 border border-red-500/40'
                  : 'bg-slate-800 text-slate-300'
                }`}>
                  {isDiscount ? 'Safe Driver Discount' : isSurcharge ? 'High Risk Surcharge' : 'Standard Baseline'}
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-black/40 p-3">
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
                      ? Number(truck.insurance_risk_score).toFixed(1) + ' / 100'
                      : '15.0 / 100'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Last Evaluated:</span>
                  <span className="text-gray-300">
                    {truck.insurance_last_evaluated_at ? formatDateTime(truck.insurance_last_evaluated_at) : 'Active Evaluation'}
                  </span>
                </div>
                <div className="break-words rounded border border-slate-800 bg-slate-950/60 p-2 text-[11px] text-gray-300">
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
          <div className="card p-5 border border-slate-200 bg-white">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-4 pb-3 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-xl">
                  📡
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Live IoT Telemetry & SpoilageLSTM Predictor</h3>
                  <p className="text-xs text-slate-500">Streamed from ESP32 DHT22 sensor gateway via PyTorch LSTM inference</p>
                </div>
              </div>
              <div>
                {iotTelemetry ? (
                  <span className={`inline-flex items-center gap-2 text-xs font-mono font-bold px-3 py-1 rounded border ${
                    iotTelemetry.source === 'fallback'
                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                      : telemetryFresh
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-red-50 text-red-700 border-red-200'
                  }`}>
                    <span className={`w-2 h-2 rounded-full ${iotTelemetry.source === 'fallback' ? 'bg-amber-500' : telemetryFresh ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                    {iotTelemetry.source === 'fallback'
                      ? 'SIMULATED FALLBACK'
                      : telemetryFresh
                        ? `LIVE SENSOR: ${iotTelemetry.connection_number || 'CONNECTED'}`
                        : `STALE SENSOR: ${iotTelemetry.connection_number || 'CONNECTED'}`}
                  </span>
                ) : (
                  <span className="text-xs font-medium text-slate-500 bg-slate-100 px-3 py-1 rounded border border-slate-200">
                    {truck?.iot_connection_number ? 'Paired device has no recent reading' : 'No IoT device paired'}
                  </span>
                )}
              </div>
            </div>

            {iotTelemetry ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-3 rounded-lg bg-emerald-50/70 border border-emerald-200">
                  <span className="text-xs font-semibold text-emerald-800 block mb-1">Cargo Temp</span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold tabular-nums text-slate-900">{iotTelemetry.temperature}°C</span>
                    <span className="text-xs text-slate-500">Target: {truck.target_temp_c}°C</span>
                  </div>
                  <span className={`text-[11px] block mt-1 font-medium ${
                    telemetryDeviation <= 1 ? 'text-emerald-700' : 'text-red-700'
                  }`}>
                    {Math.abs(iotTelemetry.temperature - truck.target_temp_c) <= 1 ? '✓ Within Safe Threshold' : '⚠️ Excursion Detected'}
                  </span>
                  {Number.isFinite(Number(iotTelemetry.device_target_temp)) && Math.abs(Number(iotTelemetry.device_target_temp) - configuredTarget) > 0.1 && (
                    <span className="text-[10px] text-amber-800 block mt-1">Device setpoint {iotTelemetry.device_target_temp}°C; truck setpoint {configuredTarget}°C is used for safety checks.</span>
                  )}
                </div>

                <div className="p-3 rounded-lg bg-cyan-50/70 border border-cyan-200">
                  <span className="text-xs font-semibold text-cyan-800 block mb-1">Humidity & Battery</span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold tabular-nums text-slate-900">{iotTelemetry.humidity}%</span>
                    <span className="text-xs text-slate-600 font-mono">🔋 {iotTelemetry.battery}%</span>
                  </div>
                  <span className="text-[11px] text-slate-500 block mt-1">Sensor: ESP32 + DHT22</span>
                </div>

                <div className={`p-3 rounded-lg border ${
                  displayedRiskLevel === 'CRITICAL' || displayedRiskLevel === 'HIGH'
                    ? 'bg-red-50/70 border-red-200'
                    : 'bg-amber-50/70 border-amber-200'
                }`}>
                  <span className="text-xs font-semibold text-amber-900 block mb-1">LSTM Spoilage Risk</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                      displayedRiskLevel === 'CRITICAL' ? 'bg-red-600 text-white'
                      : displayedRiskLevel === 'HIGH' ? 'bg-amber-500 text-black'
                      : 'bg-emerald-600 text-white'
                    }`}>
                      {displayedRiskLevel} ({(displayedRisk * 100).toFixed(0)}%)
                    </span>
                    <span className="text-xs font-semibold text-slate-700">RSL: {iotTelemetry.shelf_life_remaining_hours}h</span>
                  </div>
                  <span className="text-[11px] text-slate-600 block mt-1">
                    Quality: {iotTelemetry.quality_retention_pct}%
                    {iotTelemetry.good_env_rsl_hours ? ` · Good/Bad: ${iotTelemetry.good_env_rsl_hours}h / ${iotTelemetry.bad_env_rsl_hours}h` : ''}
                  </span>
                </div>

                <div className="p-3 rounded-lg bg-blue-50/70 border border-blue-200">
                  <span className="text-xs font-semibold text-blue-800 block mb-1">Route & AI Advisory</span>
                  <p className="text-xs font-medium text-slate-700 line-clamp-2">
                    {iotTelemetry.route_recommendation || 'Proceed on route. Cold chain fully preserved.'}
                  </p>
                  <span className="text-[11px] text-slate-500 block mt-1">Speed: {iotTelemetry.gps?.speed_kmh ?? iotTelemetry.vehicle_speed ?? 0} km/h</span>
                </div>
              </div>
            ) : (
              <div className="text-center py-6 text-slate-500 text-sm">
                <p>No active IoT sensor telemetry streaming for this vehicle.</p>
                <p className="text-xs text-slate-400 mt-1">
                  Connect device with connection ID from IoT Simulator (:3001) or assign an active device ID.
                </p>
              </div>
            )}
            {telemetryError && <ErrorAlert message={telemetryError} />}
          </div>

          {/* 1-Minute Telemetry History Log (Neon DB) */}
          <div className="card p-0 overflow-x-auto">
            <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-slate-900">1-Minute LSTM Telemetry & Insurance Log (Neon Database)</h2>
                <p className="text-xs text-slate-500">
                  Historical cold-chain records captured every minute during active trips. Used by InsuranceLSTM for dynamic pricing.
                </p>
              </div>
              <span className="text-xs font-mono text-slate-600 px-2.5 py-1 rounded bg-slate-100 border border-slate-200">
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
                    <th>Good / Bad Env RSL</th>
                    <th>LSTM Insurance</th>
                    <th>Route Advisory</th>
                  </tr>
                </thead>
                <tbody>
                  {telemetryHistory.map(row => (
                    <tr key={row.id} className="hover:bg-slate-800/40 text-xs">
                      <td className="font-mono text-gray-300">{formatDateTime(row.recorded_at || row.created_at)}</td>
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
                      <td className="tabular-nums font-medium text-slate-200">
                        <span className="text-emerald-600">{row.good_env_rsl_hours ?? row.rsl_hours ?? '—'}h</span>
                        {' / '}
                        <span className="text-red-600">{row.bad_env_rsl_hours ?? '—'}h</span>
                      </td>
                      <td className="font-mono tabular-nums font-semibold">
                        ${Number(row.predicted_insurance_price ?? truck?.current_insurance_price ?? 450).toFixed(2)}/mo
                      </td>
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
