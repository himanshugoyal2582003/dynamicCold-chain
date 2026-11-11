'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth, apiFetch } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { StatusBadge, Spinner, EmptyState, ErrorAlert, SuccessAlert, Modal, formatDate, formatDateTime, isExpiringSoon, isExpired } from '@/components/ui/shared';

const NAV = [
  { href: '/truck', label: 'My Truck', icon: '🚛' },
  { href: '/truck/history', label: 'Trip History', icon: '🛣️' },
  { href: '/truck/issues', label: 'Issues', icon: '⚠️' },
];

export default function TruckPanel() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [truck, setTruck] = useState<any>(null);
  const [activeTrip, setActiveTrip] = useState<any>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Trip modals
  const [showStartTrip, setShowStartTrip] = useState(false);
  const [tripForm, setTripForm] = useState({ origin: '', destination: '', cargo_type: '', notes: '' });
  const [saving, setSaving] = useState(false);

  // Temperature control
  const [tempInput, setTempInput] = useState('');
  const [showTempForm, setShowTempForm] = useState(false);

  // Issue reporting
  const [showIssue, setShowIssue] = useState(false);
  const [issueDesc, setIssueDesc] = useState('');

  // IoT Hardware Connection & Telemetry
  const [telemetryData, setTelemetryData] = useState<any>(null);
  const [connInput, setConnInput] = useState('');
  const [activeIotDevices, setActiveIotDevices] = useState<any[]>([]);
  const [connectingIot, setConnectingIot] = useState(false);
  const [showPairModal, setShowPairModal] = useState(false);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'truckUser')) router.replace('/login');
  }, [user, loading, router]);

  const fetchTelemetry = useCallback(async () => {
    try {
      const data = await apiFetch('/api/truck/telemetry');
      setTelemetryData(data);
    } catch {
      // Ignore background polling errors
    }
  }, []);

  const fetchAvailableIotDevices = useCallback(async () => {
    try {
      const data = await apiFetch('/api/iot/devices');
      if (data.devices) {
        setActiveIotDevices(data.devices);
      }
    } catch {
      // Fallback
    }
  }, []);

  const fetchAll = useCallback(async () => {
    setFetching(true);
    try {
      const [t, at] = await Promise.all([
        apiFetch('/api/truck/my-truck'),
        apiFetch('/api/truck/active-trip'),
      ]);
      setTruck(t);
      setActiveTrip(at);
      if (t) setTempInput(String(t.target_temp_c));
      await fetchTelemetry();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setFetching(false);
    }
  }, [fetchTelemetry]);

  useEffect(() => {
    if (user?.role === 'truckUser') {
      fetchAll();
      // Real-time telemetry polling every 3.5 seconds
      const timer = setInterval(() => {
        fetchTelemetry();
      }, 3500);
      return () => clearInterval(timer);
    }
  }, [user, fetchAll, fetchTelemetry]);

  async function handleConnectIot(codeToConnect?: string) {
    const code = (codeToConnect || connInput).trim().toUpperCase();
    if (!code) return;
    setConnectingIot(true);
    setError('');
    try {
      await apiFetch('/api/truck/connect-iot', {
        method: 'POST',
        body: JSON.stringify({ connectionNumber: code }),
      });
      setSuccess(`Connected to IoT Sensor [${code}]`);
      setShowPairModal(false);
      setConnInput('');
      await fetchTelemetry();
      await fetchAll();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setConnectingIot(false);
    }
  }

  async function handleDisconnectIot() {
    setConnectingIot(true);
    setError('');
    try {
      await apiFetch('/api/truck/disconnect-iot', { method: 'POST' });
      setSuccess('IoT Sensor disconnected.');
      await fetchTelemetry();
      await fetchAll();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setConnectingIot(false);
    }
  }

  async function handleStartTrip(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiFetch('/api/truck/start-trip', { method: 'POST', body: JSON.stringify(tripForm) });
      setSuccess('Trip started successfully!');
      setShowStartTrip(false);
      setTripForm({ origin: '', destination: '', cargo_type: '', notes: '' });
      fetchAll();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleEndTrip() {
    if (!activeTrip || !confirm('End current trip?')) return;
    setSaving(true);
    try {
      await apiFetch(`/api/truck/end-trip/${activeTrip.id}`, { method: 'POST' });
      setSuccess('Trip ended. Safe arrival!');
      fetchAll();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSetTemp(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiFetch('/api/truck/target-temp', {
        method: 'PATCH',
        body: JSON.stringify({ targetTempC: parseFloat(tempInput) }),
      });
      setSuccess(`Target temperature set to ${tempInput}°C`);
      setShowTempForm(false);
      fetchAll();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleReportIssue(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiFetch('/api/truck/report-issue', { method: 'POST', body: JSON.stringify({ description: issueDesc }) });
      setSuccess('Issue reported to fleet manager.');
      setShowIssue(false);
      setIssueDesc('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading || !user) return null;

  return (
    <DashboardLayout navItems={NAV} title="Driver Control Panel" roleLabel="Truck User">
      {fetching ? <Spinner /> : !truck ? (
        <div className="text-center py-20">
          <div className="text-4xl mb-3">🚛</div>
          <p className="text-sm" style={{ color: 'var(--color-slate)' }}>
            No truck assigned to your account. Contact your fleet manager.
          </p>
        </div>
      ) : (
        <div className="space-y-5 max-w-lg mx-auto">
          {error && <ErrorAlert message={error} />}
          {success && <SuccessAlert message={success} />}

          {/* Truck info */}
          <div className="card">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="font-mono font-bold text-xl" style={{ color: 'var(--color-ink)' }}>{truck.plate_number}</p>
                <p className="text-sm mt-0.5" style={{ color: 'var(--color-slate)' }}>{truck.type}</p>
              </div>
              <StatusBadge status={truck.status} />
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-3 rounded" style={{ background: 'var(--color-ivory)' }}>
                <p className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--color-slate)' }}>Capacity</p>
                <p className="font-semibold tabular-nums">{truck.capacity_tons}T</p>
              </div>
              <div
                className="p-3 rounded cursor-pointer"
                style={{ background: 'var(--color-ivory)' }}
                onClick={() => setShowTempForm(true)}
              >
                <p className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--color-slate)' }}>Target Temp</p>
                <p className="font-semibold tabular-nums" style={{ color: 'var(--color-gold)' }}>
                  {truck.target_temp_c}°C
                  <span className="text-xs ml-1" style={{ color: 'var(--color-slate)' }}>✏️</span>
                </p>
              </div>
            </div>

            {/* Document alerts */}
            {(truck.insurance_expiring || truck.permit_expiring || truck.fitness_expiring) && (
              <div className="mt-3 p-3 rounded" style={{ background: '#FBF0D9' }}>
                <p className="text-xs font-semibold mb-1" style={{ color: 'var(--status-maintenance)' }}>⚠️ Document Expiry Alerts</p>
                <div className="flex gap-2 flex-wrap">
                  {truck.insurance_expiring && <span className="tag-expiring">Insurance: {formatDate(truck.insurance_expiry)}</span>}
                  {truck.permit_expiring && <span className="tag-expiring">Permit: {formatDate(truck.permit_expiry)}</span>}
                  {truck.fitness_expiring && <span className="tag-expiring">Fitness: {formatDate(truck.fitness_expiry)}</span>}
                </div>
              </div>
            )}
          </div>

          {/* IoT Sensor & AI/ML Telemetry Section */}
          <div className="card" style={{ border: '1px solid var(--color-hairline)' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">📡</span>
                <div>
                  <p className="font-semibold text-sm" style={{ color: 'var(--color-ink)' }}>IoT Sensor Gateway</p>
                  <p className="text-xs" style={{ color: 'var(--color-slate)' }}>ESP32 Multi-Device Telemetry & AI Prediction</p>
                </div>
              </div>

              {telemetryData?.isIotConnected ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                    {telemetryData.connectionNumber || truck.iot_connection_number}
                  </span>
                  <button
                    onClick={handleDisconnectIot}
                    disabled={connectingIot}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    fetchAvailableIotDevices();
                    setShowPairModal(true);
                  }}
                  className="btn-primary text-xs px-3 py-1.5"
                >
                  + Connect Sensor
                </button>
              )}
            </div>

            {telemetryData?.isIotConnected && telemetryData.latest ? (
              <div className="space-y-3">
                {/* Real-Time Sensor Metrics */}
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div
                    className="p-3 rounded"
                    style={{
                      background:
                        telemetryData.latest.temperature > Number(truck.target_temp_c) + 3
                          ? '#FCE8E6'
                          : telemetryData.latest.temperature > Number(truck.target_temp_c) + 1
                          ? '#FEF3D6'
                          : '#E6F4EA',
                    }}
                  >
                    <p className="text-xs uppercase tracking-wide text-slate-500 mb-0.5">Live Sensor Temp</p>
                    <p className="text-2xl font-bold tabular-nums">
                      {telemetryData.latest.temperature}°C
                    </p>
                    <p className="text-xs text-slate-500">Target: {truck.target_temp_c}°C</p>
                  </div>

                  <div className="p-3 rounded bg-slate-50">
                    <p className="text-xs uppercase tracking-wide text-slate-500 mb-0.5">Humidity & Battery</p>
                    <p className="text-xl font-bold tabular-nums">{telemetryData.latest.humidity}%</p>
                    <p className="text-xs text-slate-500">🔋 {telemetryData.latest.battery || 95}%</p>
                  </div>

                  <div className="p-2.5 rounded bg-slate-50 flex items-center justify-between">
                    <span className="text-xs text-slate-500">Cargo Door</span>
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded ${
                        telemetryData.latest.door_open
                          ? 'bg-red-100 text-red-700'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {telemetryData.latest.door_open ? '🚨 OPEN' : '🔒 Closed'}
                    </span>
                  </div>

                  <div className="p-2.5 rounded bg-slate-50 flex items-center justify-between">
                    <span className="text-xs text-slate-500">Vehicle Speed</span>
                    <span className="text-xs font-semibold tabular-nums">
                      {telemetryData.latest.gps?.speed_kmh || 48} km/h
                    </span>
                  </div>
                </div>

                {/* AI Predictive Spoilage & Route Panel */}
                <div
                  className="p-3 rounded border"
                  style={{
                    background:
                      telemetryData.latest.spoilage_risk_level === 'CRITICAL'
                        ? '#FEF2F2'
                        : telemetryData.latest.spoilage_risk_level === 'HIGH'
                        ? '#FFFBEB'
                        : '#F0FDF4',
                    borderColor:
                      telemetryData.latest.spoilage_risk_level === 'CRITICAL'
                        ? '#F87171'
                        : telemetryData.latest.spoilage_risk_level === 'HIGH'
                        ? '#FBBF24'
                        : '#86EFAC',
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                      <span>🤖</span> AI Spoilage & Shelf-Life Model
                    </span>
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded ${
                        telemetryData.latest.spoilage_risk_level === 'CRITICAL'
                          ? 'bg-red-600 text-white'
                          : telemetryData.latest.spoilage_risk_level === 'HIGH'
                          ? 'bg-amber-500 text-white'
                          : 'bg-emerald-600 text-white'
                      }`}
                    >
                      RISK: {telemetryData.latest.spoilage_risk_level || 'LOW'} ({telemetryData.latest.spoilage_risk || 0.05})
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                    <div>
                      <span className="text-slate-500">Remaining Shelf Life:</span>{' '}
                      <strong className="font-semibold text-slate-800">
                        {telemetryData.latest.shelf_life_remaining_hours || 72} hrs
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500">Quality Retention:</span>{' '}
                      <strong className="font-semibold text-slate-800">
                        {telemetryData.latest.quality_retention_pct || 96}%
                      </strong>
                    </div>
                  </div>

                  {telemetryData.latest.route_recommendation && (
                    <div
                      className="text-xs p-2 rounded"
                      style={{
                        background: telemetryData.latest.reroute_suggested ? '#FEE2E2' : '#DCFCE7',
                        color: telemetryData.latest.reroute_suggested ? '#991B1B' : '#166534',
                      }}
                    >
                      {telemetryData.latest.route_recommendation}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-4 px-2">
                <p className="text-xs text-slate-500 mb-3">
                  No IoT device currently transmitting to this truck. Pair with an active sensor in the IoT Simulator (:3001) using its Connection Number.
                </p>
                <button
                  onClick={() => {
                    fetchAvailableIotDevices();
                    setShowPairModal(true);
                  }}
                  className="btn-ghost text-xs px-4 py-2 border border-slate-300"
                >
                  🔌 Pair Connection Number
                </button>
              </div>
            )}
          </div>

          {/* Active trip or start trip */}
          {activeTrip ? (
            <div className="card" style={{ border: '1px solid var(--status-on-trip)', background: '#D8E5F210' }}>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--status-on-trip)' }} />
                <p className="text-sm font-semibold" style={{ color: 'var(--status-on-trip)' }}>Active Trip</p>
              </div>
              <div className="space-y-2 text-sm mb-4">
                <div className="flex justify-between">
                  <span style={{ color: 'var(--color-slate)' }}>From</span>
                  <span className="font-medium text-right max-w-[60%]">{activeTrip.origin}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--color-slate)' }}>To</span>
                  <span className="font-medium text-right max-w-[60%]">{activeTrip.destination}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--color-slate)' }}>Cargo</span>
                  <span className="font-medium">{activeTrip.cargo_type}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: 'var(--color-slate)' }}>Started</span>
                  <span className="tabular-nums text-xs">{formatDateTime(activeTrip.started_at)}</span>
                </div>
                {activeTrip.notes && (
                  <div className="p-2 rounded text-xs" style={{ background: 'var(--color-ivory)', color: 'var(--color-slate)' }}>
                    {activeTrip.notes}
                  </div>
                )}
              </div>
              <button
                className="w-full py-3 rounded text-sm font-semibold transition-colors"
                style={{ background: 'var(--status-issue)', color: 'white' }}
                onClick={handleEndTrip}
                disabled={saving}
              >
                {saving ? 'Ending Trip…' : '🏁 End Trip'}
              </button>
            </div>
          ) : (
            <div className="card text-center py-6">
              <p className="text-sm mb-4" style={{ color: 'var(--color-slate)' }}>No active trip. Ready to go?</p>
              <button
                className="btn-primary px-8 py-3 text-sm"
                onClick={() => setShowStartTrip(true)}
              >
                🚀 Start Trip
              </button>
            </div>
          )}

          {/* Quick actions */}
          <div className="grid grid-cols-2 gap-3">
            <button
              className="card text-center py-5 cursor-pointer transition-colors"
              style={{ border: '1px solid var(--color-hairline)' }}
              onClick={() => setShowTempForm(true)}
            >
              <div className="text-2xl mb-2">🌡️</div>
              <p className="text-sm font-medium">Set Temperature</p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-slate)' }}>Current: {truck.target_temp_c}°C</p>
            </button>
            <button
              className="card text-center py-5 cursor-pointer transition-colors"
              style={{ border: '1px solid var(--color-hairline)' }}
              onClick={() => setShowIssue(true)}
            >
              <div className="text-2xl mb-2">⚠️</div>
              <p className="text-sm font-medium">Report Issue</p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-slate)' }}>Notify fleet manager</p>
            </button>
          </div>
        </div>
      )}

      {/* Start Trip Modal */}
      {showStartTrip && (
        <Modal title="Start New Trip" onClose={() => setShowStartTrip(false)}>
          <form onSubmit={handleStartTrip} className="space-y-4">
            {[
              { label: 'Origin', key: 'origin', placeholder: 'Mumbai Port Terminal 3' },
              { label: 'Destination', key: 'destination', placeholder: 'Delhi Northern Hub' },
              { label: 'Cargo Type', key: 'cargo_type', placeholder: 'Frozen Seafood' },
            ].map(f => (
              <div key={f.key} className="space-y-1">
                <label className="block text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--color-slate)' }}>
                  {f.label} <span style={{ color: 'var(--status-issue)' }}>*</span>
                </label>
                <input
                  type="text"
                  value={tripForm[f.key as keyof typeof tripForm]}
                  onChange={e => setTripForm(p => ({ ...p, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  required
                  className="input-field"
                />
              </div>
            ))}
            <div className="space-y-1">
              <label className="block text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--color-slate)' }}>
                Notes
              </label>
              <textarea
                value={tripForm.notes}
                onChange={e => setTripForm(p => ({ ...p, notes: e.target.value }))}
                placeholder="Any special handling instructions…"
                rows={3}
                className="input-field"
                style={{ resize: 'vertical' }}
              />
            </div>
            {error && <ErrorAlert message={error} />}
            <div className="flex gap-3">
              <button type="submit" className="btn-primary flex-1" disabled={saving}>
                {saving ? 'Starting…' : '🚀 Start Trip'}
              </button>
              <button type="button" className="btn-ghost flex-1" onClick={() => setShowStartTrip(false)}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Temperature Modal */}
      {showTempForm && (
        <Modal title="Set Target Temperature" onClose={() => setShowTempForm(false)}>
          <form onSubmit={handleSetTemp} className="space-y-4">
            <p className="text-sm" style={{ color: 'var(--color-slate)' }}>
              Set the target cargo temperature for this truck. Range: −30°C to +25°C.
            </p>
            <div className="space-y-1">
              <label className="block text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--color-slate)' }}>
                Target Temperature (°C)
              </label>
              <input
                type="number"
                step="0.5"
                min="-30"
                max="25"
                value={tempInput}
                onChange={e => setTempInput(e.target.value)}
                required
                className="input-field text-xl font-semibold"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              {[-25, -18, -10, 2, 4, 8].map(t => (
                <button
                  key={t}
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => setTempInput(String(t))}
                >
                  {t}°C
                </button>
              ))}
            </div>
            {error && <ErrorAlert message={error} />}
            <div className="flex gap-3">
              <button type="submit" className="btn-primary flex-1" disabled={saving}>
                {saving ? 'Setting…' : 'Set Temperature'}
              </button>
              <button type="button" className="btn-ghost flex-1" onClick={() => setShowTempForm(false)}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Issue Report Modal */}
      {showIssue && (
        <Modal title="Report Issue" onClose={() => setShowIssue(false)}>
          <form onSubmit={handleReportIssue} className="space-y-4">
            <p className="text-sm" style={{ color: 'var(--color-slate)' }}>
              Describe the issue. Your fleet manager will be notified immediately.
            </p>
            <div className="space-y-1">
              <label className="block text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--color-slate)' }}>
                Issue Description <span style={{ color: 'var(--status-issue)' }}>*</span>
              </label>
              <textarea
                value={issueDesc}
                onChange={e => setIssueDesc(e.target.value)}
                placeholder="Describe the problem in detail…"
                rows={4}
                required
                className="input-field"
                style={{ resize: 'vertical' }}
              />
            </div>
            {error && <ErrorAlert message={error} />}
            <div className="flex gap-3">
              <button type="submit" className="btn-primary flex-1" disabled={saving || !issueDesc.trim()}>
                {saving ? 'Reporting…' : '⚠️ Report Issue'}
              </button>
              <button type="button" className="btn-ghost flex-1" onClick={() => setShowIssue(false)}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}
      {/* Pair IoT Device Modal */}
      {showPairModal && (
        <Modal title="Connect IoT Sensor Device" onClose={() => setShowPairModal(false)}>
          <div className="space-y-4">
            <p className="text-sm" style={{ color: 'var(--color-slate)' }}>
              Enter the unique <strong>Connection Number</strong> (e.g. <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">CONN-4821</code>) generated by your ESP32 device in the IoT Simulator portal (:3001).
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleConnectIot();
              }}
              className="space-y-3"
            >
              <div>
                <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">
                  Connection Number
                </label>
                <input
                  type="text"
                  placeholder="CONN-4821"
                  value={connInput}
                  onChange={(e) => setConnInput(e.target.value)}
                  className="input-field uppercase font-mono font-bold text-lg"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={connectingIot || !connInput.trim()}
                className="btn-primary w-full py-2.5"
              >
                {connectingIot ? 'Connecting…' : 'Connect Device'}
              </button>
            </form>

            {activeIotDevices.length > 0 && (
              <div className="pt-3 border-t border-slate-200">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  Active Broadcasting Devices (Click to Pair):
                </p>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {activeIotDevices.map((dev) => (
                    <div
                      key={dev.connection_number || dev.id}
                      onClick={() => handleConnectIot(dev.connection_number)}
                      className="p-2.5 rounded border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50/50 cursor-pointer transition-all flex items-center justify-between text-xs"
                    >
                      <div>
                        <span className="font-mono font-bold text-emerald-700 mr-2">
                          {dev.connection_number}
                        </span>
                        <span className="text-slate-700">{dev.device_name}</span>
                      </div>
                      <span className="tabular-nums font-semibold text-slate-600">
                        {dev.temperature}°C · {dev.spoilage_risk_level || 'OK'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </DashboardLayout>
  );
}
