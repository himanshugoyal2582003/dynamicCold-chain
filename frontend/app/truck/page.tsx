'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth, apiFetch } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import {
  StatusBadge,
  Spinner,
  ErrorAlert,
  SuccessAlert,
  Modal,
  formatDate,
  formatDateTime,
} from '@/components/ui/shared';
import dynamic from 'next/dynamic';
const FleetMap = dynamic(() => import('@/components/tracking/FleetMap'), { ssr: false });

const NAV = [
  { href: '/truck', label: 'My Truck', icon: '🚛' },
  { href: '/truck/history', label: 'Trip History', icon: '🛣️' },
  { href: '/truck/issues', label: 'Issues', icon: '⚠️' },
];

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// ─── GPS types ────────────────────────────────────────────────────────────────
type GpsStatus = 'idle' | 'acquiring' | 'active' | 'no_signal' | 'denied';

interface GpsPosition {
  latitude: number;
  longitude: number;
  accuracy_m: number;
  speed_kmh: number;
  heading: number | null;
  timestamp: string;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function SkeletonCard({ rows = 3 }: { rows?: number }) {
  return (
    <div className="card animate-pulse space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-4 rounded" style={{ background: 'var(--color-hairline)', width: i === 0 ? '60%' : '90%' }} />
      ))}
    </div>
  );
}

// ─── Temperature Gauge ────────────────────────────────────────────────────────
function TempGauge({ current, target }: { current: number; target: number }) {
  const MIN = -30, MAX = 30;
  const pct = Math.max(0, Math.min(100, ((current - MIN) / (MAX - MIN)) * 100));
  const delta = current - target;
  const color = delta > 2 ? '#A3262A' : delta > 0 ? '#C9962B' : '#2E7D5B';
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs" style={{ color: 'var(--color-slate)' }}>
        <span>{MIN}°C</span>
        <span className="font-bold tabular-nums text-sm" style={{ color }}>{current}°C</span>
        <span>{MAX}°C</span>
      </div>
      <div className="w-full h-3 rounded-full overflow-hidden" style={{ background: 'var(--color-hairline)' }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <p className="text-xs text-center tabular-nums" style={{ color: 'var(--color-slate)' }}>
        Target: {target}°C &nbsp;·&nbsp;
        <span style={{ color }}>{delta > 0 ? '+' : ''}{delta.toFixed(1)}°C</span>
      </p>
    </div>
  );
}

// ─── Battery Bar ──────────────────────────────────────────────────────────────
function BatteryBar({ level }: { level: number }) {
  const color = level < 20 ? '#A3262A' : level < 50 ? '#C9962B' : '#2E7D5B';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--color-hairline)' }}>
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${level}%`, background: color }} />
      </div>
      <span className="text-xs tabular-nums font-semibold w-9 text-right" style={{ color }}>{level}%</span>
    </div>
  );
}

// ─── GPS Status pill ──────────────────────────────────────────────────────────
function GpsPill({ status }: { status: GpsStatus }) {
  const map: Record<GpsStatus, { label: string; color: string; bg: string; dot?: boolean }> = {
    idle:       { label: 'GPS Off',          color: '#5B6470', bg: '#F7F6F3' },
    acquiring:  { label: 'Acquiring…',       color: '#C9962B', bg: '#FBF0D9', dot: true },
    active:     { label: 'GPS Active',       color: '#2E7D5B', bg: '#DDEEE8', dot: true },
    no_signal:  { label: 'No Signal',        color: '#C9962B', bg: '#FBF0D9' },
    denied:     { label: 'Permission Denied', color: '#A3262A', bg: '#F9E0E1' },
  };
  const s = map[status];
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold"
      style={{ background: s.bg, color: s.color }}>
      {s.dot && (
        <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: s.color }} />
      )}
      {s.label}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function TruckPanel() {
  const { user, loading } = useAuth();
  const router = useRouter();

  // ── Core state ──
  const [truck, setTruck] = useState<any>(null);
  const [activeTrip, setActiveTrip] = useState<any>(null);
  const [issuesList, setIssuesList] = useState<any[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // ── Trip modals ──
  const [showStartTrip, setShowStartTrip] = useState(false);
  const [tripForm, setTripForm] = useState({ origin: '', destination: '', cargo_type: '', notes: '' });
  const [saving, setSaving] = useState(false);

  // ── Temp control ──
  const [tempInput, setTempInput] = useState('');
  const [showTempForm, setShowTempForm] = useState(false);

  // ── Issue reporting ──
  const [showIssue, setShowIssue] = useState(false);
  const [issueDesc, setIssueDesc] = useState('');

  // ── IoT / Telemetry ──
  const [telemetryData, setTelemetryData] = useState<any>(null);
  const [connInput, setConnInput] = useState('');
  const [activeIotDevices, setActiveIotDevices] = useState<any[]>([]);
  const [connectingIot, setConnectingIot] = useState(false);
  const [showPairModal, setShowPairModal] = useState(false);
  const [telemetryLoading, setTelemetryLoading] = useState(false);
  // Track when door first opened
  const doorOpenSinceRef = useRef<number | null>(null);

  // ── GPS state ──
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>('idle');
  const [gpsPosition, setGpsPosition] = useState<GpsPosition | null>(null);
  const [gpsLastUpdate, setGpsLastUpdate] = useState<Date | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const locationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Route state ──
  const [calculatedRoute, setCalculatedRoute] = useState<[number, number][] | null>(null);
  const [routeInfo, setRouteInfo] = useState<{ distanceKm: number; durationText: string } | null>(null);

  // ── Offline GPS queue ──
  const offlineQueueRef = useRef<GpsPosition[]>([]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Auth guard
  useEffect(() => {
    if (!loading && (!user || user.role !== 'truckUser')) router.replace('/login');
  }, [user, loading, router]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Telemetry fetch
  const fetchTelemetry = useCallback(async () => {
    setTelemetryLoading(true);
    try {
      const data = await apiFetch('/api/truck/telemetry');
      setTelemetryData(data);
      // Track door open time
      if (data?.latest?.door_open) {
        if (doorOpenSinceRef.current === null) doorOpenSinceRef.current = Date.now();
      } else {
        doorOpenSinceRef.current = null;
      }
    } catch {
      // silent
    } finally {
      setTelemetryLoading(false);
    }
  }, []);

  const fetchAvailableIotDevices = useCallback(async () => {
    try {
      const data = await apiFetch('/api/iot/devices');
      if (data.devices) setActiveIotDevices(data.devices);
    } catch { /* ignore */ }
  }, []);

  const fetchAll = useCallback(async () => {
    setFetching(true);
    try {
      const [t, at, iss] = await Promise.all([
        apiFetch('/api/truck/my-truck'),
        apiFetch('/api/truck/active-trip'),
        apiFetch('/api/truck/issues').catch(() => []),
      ]);
      setTruck(t);
      setActiveTrip(at);
      setIssuesList(Array.isArray(iss) ? iss : []);
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
      // Telemetry: refresh every 30 seconds
      const timer = setInterval(() => fetchTelemetry(), 30000);
      return () => clearInterval(timer);
    }
  }, [user, fetchAll, fetchTelemetry]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Route calculation: geocode destination + OSRM when active trip + GPS available
  useEffect(() => {
    if (!activeTrip || !gpsPosition) {
      setCalculatedRoute(null);
      setRouteInfo(null);
      return;
    }

    let cancelled = false;

    async function calcRoute() {
      try {
        const { geocodeAddress } = await import('@/lib/geocoding');
        const { getRoute } = await import('@/lib/routing');

        const dest = await geocodeAddress(activeTrip.destination);
        if (cancelled || !dest) return;

        const result = await getRoute(
          [gpsPosition!.latitude, gpsPosition!.longitude],
          [dest.latitude, dest.longitude]
        );
        if (cancelled || !result) return;

        setCalculatedRoute(result.coordinates);
        setRouteInfo({ distanceKm: result.distanceKm, durationText: result.durationText });
      } catch {
        // Graceful: route just won't display
      }
    }

    calcRoute();
    return () => { cancelled = true; };
  }, [activeTrip, gpsPosition]);

  // ─────────────────────────────────────────────────────────────────────────────
  // GPS tracking
  const sendLocationToServer = useCallback(async (pos: GpsPosition) => {
    try {
      await apiFetch('/api/tracking/location', {
        method: 'POST',
        body: JSON.stringify({
          latitude: pos.latitude,
          longitude: pos.longitude,
          accuracy_m: pos.accuracy_m,
          speed_kmh: pos.speed_kmh,
          heading: pos.heading,
          timestamp: pos.timestamp,
        }),
      });
    } catch {
      // Push to offline queue (max 50 items) if fetch fails
      offlineQueueRef.current.push(pos);
      if (offlineQueueRef.current.length > 50) {
        offlineQueueRef.current = offlineQueueRef.current.slice(-50);
      }
    }
  }, []);

  // Drain offline queue every 30 seconds when online
  useEffect(() => {
    const drainInterval = setInterval(async () => {
      if (!navigator.onLine || offlineQueueRef.current.length === 0) return;
      const queue = [...offlineQueueRef.current];
      offlineQueueRef.current = [];
      for (const pos of queue) {
        try {
          await apiFetch('/api/tracking/location', {
            method: 'POST',
            body: JSON.stringify({
              latitude: pos.latitude,
              longitude: pos.longitude,
              accuracy_m: pos.accuracy_m,
              speed_kmh: pos.speed_kmh,
              heading: pos.heading,
              timestamp: pos.timestamp,
            }),
          });
        } catch {
          // Re-queue failed items (best-effort)
          offlineQueueRef.current.unshift(pos);
        }
      }
    }, 30000);

    return () => clearInterval(drainInterval);
  }, []);

  const stopGps = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (locationIntervalRef.current !== null) {
      clearInterval(locationIntervalRef.current);
      locationIntervalRef.current = null;
    }
    setGpsStatus('idle');
  }, []);

  const startGps = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setGpsStatus('no_signal');
      return;
    }
    setGpsStatus('acquiring');

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const p: GpsPosition = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy_m: pos.coords.accuracy,
          speed_kmh: pos.coords.speed ? pos.coords.speed * 3.6 : 0,
          heading: pos.coords.heading,
          timestamp: new Date().toISOString(),
        };
        setGpsPosition(p);
        setGpsLastUpdate(new Date());
        setGpsStatus('active');

        // Keep latest pos for interval sends
        gpsPositionRef.current = p;
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setGpsStatus('denied');
        else setGpsStatus('no_signal');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );

    // Send every 15 seconds
    locationIntervalRef.current = setInterval(() => {
      if (gpsPositionRef.current) sendLocationToServer(gpsPositionRef.current);
    }, 15000);
  }, [sendLocationToServer]);

  // Mutable ref for latest GPS position (avoids stale closure in interval)
  const gpsPositionRef = useRef<GpsPosition | null>(null);
  useEffect(() => { gpsPositionRef.current = gpsPosition; }, [gpsPosition]);

  // Stop GPS on unmount
  useEffect(() => () => stopGps(), [stopGps]);

  // Stop GPS when trip ends
  useEffect(() => {
    if (!activeTrip && gpsStatus === 'active') stopGps();
  }, [activeTrip, gpsStatus, stopGps]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Alert computation
  const tempAlertActive = (() => {
    if (!telemetryData?.latest || !truck) return false;
    return telemetryData.latest.temperature > Number(truck.target_temp_c) + 2;
  })();

  const gpsOfflineAlert = (() => {
    if (gpsStatus !== 'active' || !gpsLastUpdate) return false;
    return Date.now() - gpsLastUpdate.getTime() > 2 * 60 * 1000;
  })();

  const doorOpenAlert = (() => {
    if (!telemetryData?.latest?.door_open || doorOpenSinceRef.current === null) return false;
    return Date.now() - doorOpenSinceRef.current > 5 * 60 * 1000;
  })();

  const alertCount = [tempAlertActive, gpsOfflineAlert, doorOpenAlert].filter(Boolean).length;

  // ─────────────────────────────────────────────────────────────────────────────
  // Existing handlers (preserved)
  async function handleConnectIot(codeToConnect?: string) {
    const code = (codeToConnect || connInput).trim().toUpperCase();
    if (!code) return;
    setConnectingIot(true); setError('');
    try {
      await apiFetch('/api/truck/connect-iot', { method: 'POST', body: JSON.stringify({ connectionNumber: code }) });
      setSuccess(`Connected to IoT Sensor [${code}]`);
      setShowPairModal(false); setConnInput('');
      await fetchTelemetry(); await fetchAll();
    } catch (e: any) { setError(e.message); }
    finally { setConnectingIot(false); }
  }

  async function handleDisconnectIot() {
    setConnectingIot(true); setError('');
    try {
      await apiFetch('/api/truck/disconnect-iot', { method: 'POST' });
      setSuccess('IoT Sensor disconnected.');
      await fetchTelemetry(); await fetchAll();
    } catch (e: any) { setError(e.message); }
    finally { setConnectingIot(false); }
  }

  async function handleStartTrip(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('');
    try {
      await apiFetch('/api/truck/start-trip', { method: 'POST', body: JSON.stringify(tripForm) });
      setSuccess('Trip started successfully!');
      setShowStartTrip(false);
      setTripForm({ origin: '', destination: '', cargo_type: '', notes: '' });
      fetchAll();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function handleEndTrip() {
    if (!activeTrip || !confirm('End current trip?')) return;
    setSaving(true);
    try {
      await apiFetch(`/api/truck/end-trip/${activeTrip.id}`, { method: 'POST' });
      setSuccess('Trip ended. Safe arrival!');
      stopGps();
      fetchAll();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function handleSetTemp(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('');
    try {
      await apiFetch('/api/truck/target-temp', { method: 'PATCH', body: JSON.stringify({ targetTempC: parseFloat(tempInput) }) });
      setSuccess(`Target temperature set to ${tempInput}°C`);
      setShowTempForm(false); fetchAll();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function handleReportIssue(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('');
    try {
      await apiFetch('/api/truck/report-issue', { method: 'POST', body: JSON.stringify({ description: issueDesc }) });
      setSuccess('Issue reported to fleet manager.');
      setShowIssue(false); setIssueDesc('');
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Navigation helpers — OpenStreetMap directions
  function getOpenMapsUrl(): string {
    if (!activeTrip) return '#';
    const o = encodeURIComponent(activeTrip.origin || '');
    const d = encodeURIComponent(activeTrip.destination || '');
    return `https://www.openstreetmap.org/directions?from=${o}&to=${d}`;
  }

  // ─────────────────────────────────────────────────────────────────────────────
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
        <div className="max-w-2xl mx-auto space-y-4 pb-24">
          {/* ── Alerts banner ─────────────────────────────────────────────── */}
          {alertCount > 0 && (
            <div className="rounded p-4 space-y-2" style={{ background: '#F9E0E1', border: '1px solid #e8c5c6' }}>
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--status-issue)' }}>
                🚨 {alertCount} Active Alert{alertCount > 1 ? 's' : ''}
              </p>
              {tempAlertActive && (
                <p className="text-sm" style={{ color: 'var(--status-issue)' }}>
                  🌡️ <strong>Temperature Alert:</strong> Cargo temp{' '}
                  {telemetryData.latest.temperature}°C exceeds target {truck.target_temp_c}°C + 2°C threshold
                </p>
              )}
              {gpsOfflineAlert && (
                <p className="text-sm" style={{ color: 'var(--status-issue)' }}>
                  📡 <strong>GPS Offline:</strong> No location update for over 2 minutes
                </p>
              )}
              {doorOpenAlert && (
                <p className="text-sm" style={{ color: 'var(--status-issue)' }}>
                  🚪 <strong>Door Open:</strong> Cargo door has been open for more than 5 minutes
                </p>
              )}
            </div>
          )}

          {error && <ErrorAlert message={error} />}
          {success && <SuccessAlert message={success} />}

          {/* ── 1. TRUCK STATUS ─────────────────────────────────────────── */}
          <div className="card">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="font-mono font-bold text-2xl" style={{ color: 'var(--color-ink)' }}>{truck.plate_number}</p>
                <p className="text-sm mt-0.5" style={{ color: 'var(--color-slate)' }}>{truck.type}</p>
              </div>
              <StatusBadge status={truck.status} />
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm mb-4">
              <div className="p-3 rounded" style={{ background: 'var(--color-ivory)' }}>
                <p className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--color-slate)' }}>Capacity</p>
                <p className="font-semibold tabular-nums text-lg">{truck.capacity_tons}T</p>
              </div>
              <div className="p-3 rounded cursor-pointer" style={{ background: 'var(--color-ivory)' }} onClick={() => setShowTempForm(true)}>
                <p className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--color-slate)' }}>Target Temp</p>
                <p className="font-semibold tabular-nums text-lg" style={{ color: 'var(--color-gold)' }}>
                  {truck.target_temp_c}°C <span className="text-xs" style={{ color: 'var(--color-slate)' }}>✏️</span>
                </p>
              </div>
            </div>

            {/* Document alerts */}
            {(truck.insurance_expiring || truck.permit_expiring || truck.fitness_expiring) && (
              <div className="p-3 rounded" style={{ background: '#FBF0D9' }}>
                <p className="text-xs font-semibold mb-1" style={{ color: 'var(--status-maintenance)' }}>⚠️ Document Expiry Alerts</p>
                <div className="flex gap-2 flex-wrap">
                  {truck.insurance_expiring && <span className="tag-expiring">Insurance: {formatDate(truck.insurance_expiry)}</span>}
                  {truck.permit_expiring && <span className="tag-expiring">Permit: {formatDate(truck.permit_expiry)}</span>}
                  {truck.fitness_expiring && <span className="tag-expiring">Fitness: {formatDate(truck.fitness_expiry)}</span>}
                </div>
              </div>
            )}

            {/* Quick actions */}
            <div className="grid grid-cols-2 gap-3 mt-4">
              <button
                className="py-4 rounded text-center cursor-pointer border"
                style={{ background: 'var(--color-ivory)', borderColor: 'var(--color-hairline)' }}
                onClick={() => setShowTempForm(true)}
              >
                <div className="text-2xl mb-1">🌡️</div>
                <p className="text-sm font-medium">Set Temperature</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-slate)' }}>Current: {truck.target_temp_c}°C</p>
              </button>
              <button
                className="py-4 rounded text-center cursor-pointer border"
                style={{ background: 'var(--color-ivory)', borderColor: 'var(--color-hairline)' }}
                onClick={() => setShowIssue(true)}
              >
                <div className="text-2xl mb-1">⚠️</div>
                <p className="text-sm font-medium">Flag Issue</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-slate)' }}>Notify fleet manager</p>
              </button>
            </div>
          </div>

          {/* ── 2. ACTIVE TRIP / START TRIP ─────────────────────────────── */}
          {activeTrip ? (
            <div className="card" style={{ border: '1px solid var(--status-on-trip)', background: '#D8E5F210' }}>
              <div className="flex items-center gap-2 mb-4">
                <span className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: 'var(--status-on-trip)' }} />
                <p className="text-sm font-semibold" style={{ color: 'var(--status-on-trip)' }}>Active Trip</p>
              </div>

              {/* Origin → Destination */}
              <div className="flex items-center gap-2 mb-4 p-3 rounded" style={{ background: 'var(--color-ivory)' }}>
                <div className="text-center min-w-0 flex-1">
                  <p className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--color-slate)' }}>From</p>
                  <p className="font-semibold text-sm truncate">{activeTrip.origin}</p>
                </div>
                <div className="text-xl flex-shrink-0" style={{ color: 'var(--color-gold)' }}>→</div>
                <div className="text-center min-w-0 flex-1">
                  <p className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--color-slate)' }}>To</p>
                  <p className="font-semibold text-sm truncate">{activeTrip.destination}</p>
                </div>
              </div>

              <div className="space-y-2 text-sm mb-4">
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

              {/* Open in OSM button */}
              <a
                href={getOpenMapsUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-ghost w-full text-center block mb-3 py-2.5 text-sm"
              >
                🗺️ Open Navigation (OSM)
              </a>

              <button
                className="w-full py-4 rounded text-sm font-bold transition-colors"
                style={{ background: 'var(--status-issue)', color: 'white' }}
                onClick={handleEndTrip}
                disabled={saving}
              >
                {saving ? 'Ending Trip…' : '🏁 End Trip'}
              </button>
            </div>
          ) : (
            <div className="card text-center py-8">
              <p className="text-sm mb-5" style={{ color: 'var(--color-slate)' }}>No active trip. Ready to go?</p>
              <button className="btn-primary px-10 py-4 text-base font-semibold" onClick={() => setShowStartTrip(true)}>
                🚀 Start Trip
              </button>
            </div>
          )}

          {/* ── 3. LIVE ROUTE & NAVIGATION MAP ────────────────────────────── */}
          {activeTrip && (
            <div className="card overflow-hidden" style={{ padding: 0 }}>
              <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-hairline)' }}>
                <p className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>📍 Live Route Navigation</p>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded uppercase"
                  style={{
                    background: gpsStatus === 'active' ? '#DDEEE8' : '#F7F6F3',
                    color: gpsStatus === 'active' ? '#2E7D5B' : '#5B6470',
                  }}>
                  {gpsStatus === 'active' ? '● GPS Online' : '○ GPS Inactive'}
                </span>
              </div>
              <div className="w-full h-[280px]">
                <FleetMap
                  trucks={
                    truck
                      ? [
                          {
                            truck_id: truck.id,
                            plate_number: truck.plate_number,
                            status: truck.status,
                            gps_status: gpsStatus === 'active' ? 'live' : 'no_data',
                            location: gpsPosition
                              ? {
                                  latitude: gpsPosition.latitude,
                                  longitude: gpsPosition.longitude,
                                  speed_kmh: gpsPosition.speed_kmh,
                                  heading: gpsPosition.heading ?? 0,
                                }
                              : null,
                            active_trip: activeTrip,
                          },
                        ]
                      : []
                  }
                  routeCoordinates={calculatedRoute || []}
                  height="280px"
                />
              </div>
              {/* Route info bar */}
              {routeInfo && (
                <div
                  style={{ background: 'var(--color-ivory)', borderColor: 'var(--color-hairline)' }}
                  className="flex gap-4 px-4 py-2 text-xs border-t"
                >
                  <span>📏 {routeInfo.distanceKm.toFixed(1)} km remaining</span>
                  <span>⏱ {routeInfo.durationText}</span>
                </div>
              )}
            </div>
          )}

          {/* ── 4. GPS LOCATION TRACKING ────────────────────────────────── */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-lg">📡</span>
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>GPS Location Sharing</p>
                  <p className="text-xs" style={{ color: 'var(--color-slate)' }}>Location updates sent while this tab is open</p>
                </div>
              </div>
              <GpsPill status={gpsStatus} />
            </div>

            {gpsStatus === 'denied' ? (
              <div className="p-3 rounded mb-4" style={{ background: '#F9E0E1', border: '1px solid #e8c5c6' }}>
                <p className="text-sm font-semibold mb-1" style={{ color: 'var(--status-issue)' }}>Permission Denied</p>
                <p className="text-xs" style={{ color: 'var(--status-issue)' }}>
                  To enable location sharing, go to your browser settings → Site permissions → Location → Allow for this site, then refresh.
                </p>
              </div>
            ) : gpsPosition ? (
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="p-3 rounded" style={{ background: 'var(--color-ivory)' }}>
                  <p className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--color-slate)' }}>Latitude</p>
                  <p className="font-mono font-semibold tabular-nums text-sm">{gpsPosition.latitude.toFixed(6)}</p>
                </div>
                <div className="p-3 rounded" style={{ background: 'var(--color-ivory)' }}>
                  <p className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--color-slate)' }}>Longitude</p>
                  <p className="font-mono font-semibold tabular-nums text-sm">{gpsPosition.longitude.toFixed(6)}</p>
                </div>
                <div className="p-3 rounded" style={{ background: 'var(--color-ivory)' }}>
                  <p className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--color-slate)' }}>Speed</p>
                  <p className="font-semibold tabular-nums text-lg">{gpsPosition.speed_kmh.toFixed(1)} <span className="text-xs font-normal">km/h</span></p>
                </div>
                <div className="p-3 rounded" style={{ background: 'var(--color-ivory)' }}>
                  <p className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--color-slate)' }}>Accuracy</p>
                  <p className="font-semibold tabular-nums text-lg">±{Math.round(gpsPosition.accuracy_m)} <span className="text-xs font-normal">m</span></p>
                </div>
                {gpsLastUpdate && (
                  <div className="col-span-2 p-2 rounded text-xs text-center" style={{ background: 'var(--color-ivory)', color: 'var(--color-slate)' }}>
                    Last update: {gpsLastUpdate.toLocaleTimeString()}
                  </div>
                )}
              </div>
            ) : null}

            {gpsStatus === 'idle' || gpsStatus === 'no_signal' || gpsStatus === 'denied' ? (
              <button
                className="w-full py-4 rounded font-semibold text-sm"
                style={{ background: 'var(--status-available)', color: 'white' }}
                onClick={startGps}
                disabled={gpsStatus === 'denied'}
              >
                📍 Start Location Sharing
              </button>
            ) : (
              <button
                className="w-full py-3 rounded font-semibold text-sm border"
                style={{ borderColor: 'var(--color-hairline)', color: 'var(--color-slate)' }}
                onClick={stopGps}
              >
                ⏹ Stop Location Sharing
              </button>
            )}

            {gpsStatus === 'acquiring' && (
              <p className="text-xs text-center mt-2" style={{ color: 'var(--color-slate)' }}>
                Waiting for GPS signal…
              </p>
            )}
          </div>

          {/* ── 5. LIVE CARGO STATUS ────────────────────────────────────── */}
          <div className="card" style={{ border: '1px solid var(--color-hairline)' }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-lg">📦</span>
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>Live Cargo Status</p>
                  <p className="text-xs" style={{ color: 'var(--color-slate)' }}>Refreshes every 30 seconds</p>
                </div>
              </div>
              {telemetryData?.isIotConnected ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded"
                    style={{ background: '#DDEEE8', color: '#2E7D5B' }}>
                    {telemetryData.connectionNumber || truck.iot_connection_number}
                  </span>
                  <button onClick={handleDisconnectIot} disabled={connectingIot}
                    className="text-xs" style={{ color: 'var(--status-issue)' }}>
                    Disconnect
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { fetchAvailableIotDevices(); setShowPairModal(true); }}
                  className="btn-primary text-xs px-3 py-1.5"
                >
                  + Connect Sensor
                </button>
              )}
            </div>

            {telemetryLoading && !telemetryData && <SkeletonCard rows={4} />}

            {telemetryData?.isIotConnected && telemetryData.latest ? (
              <div className="space-y-4">
                {/* Temperature gauge */}
                <div className="p-4 rounded" style={{
                  background: telemetryData.latest.temperature > Number(truck.target_temp_c) + 3
                    ? '#FCE8E6' : telemetryData.latest.temperature > Number(truck.target_temp_c) + 1
                    ? '#FEF3D6' : '#E6F4EA'
                }}>
                  <p className="text-xs uppercase tracking-wide mb-2" style={{ color: 'var(--color-slate)' }}>Cargo Temperature</p>
                  <TempGauge
                    current={telemetryData.latest.temperature}
                    target={Number(truck.target_temp_c)}
                  />
                </div>

                {/* Humidity, Battery, Door */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded" style={{ background: 'var(--color-ivory)' }}>
                    <p className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--color-slate)' }}>Humidity</p>
                    <p className="text-xl font-bold tabular-nums">{telemetryData.latest.humidity}%</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--color-slate)' }}>Target: &lt;80%</p>
                  </div>

                  <div className="p-3 rounded" style={{ background: 'var(--color-ivory)' }}>
                    <p className="text-xs uppercase tracking-wide mb-2" style={{ color: 'var(--color-slate)' }}>Battery</p>
                    <BatteryBar level={telemetryData.latest.battery ?? 95} />
                  </div>

                  <div className="p-3 rounded" style={{ background: 'var(--color-ivory)' }}>
                    <p className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--color-slate)' }}>Cargo Door</p>
                    <span className={`text-xs font-bold px-2 py-1 rounded inline-block mt-1 ${
                      telemetryData.latest.door_open ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      {telemetryData.latest.door_open ? '🚨 OPEN' : '🔒 Closed'}
                    </span>
                  </div>

                  <div className="p-3 rounded" style={{ background: 'var(--color-ivory)' }}>
                    <p className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--color-slate)' }}>Spoilage Risk</p>
                    <span className={`text-xs font-bold px-2 py-1 rounded inline-block mt-1 ${
                      telemetryData.latest.spoilage_risk_level === 'CRITICAL' ? 'bg-red-600 text-white'
                      : telemetryData.latest.spoilage_risk_level === 'HIGH' ? 'bg-amber-500 text-white'
                      : 'bg-emerald-600 text-white'
                    }`}>
                      {telemetryData.latest.spoilage_risk_level || 'LOW'}
                    </span>
                  </div>
                </div>

                {/* AI Spoilage Engine */}
                <div className="p-3.5 rounded border" style={{
                  background: telemetryData.latest.spoilage_risk_level === 'CRITICAL' ? '#FEF2F2'
                    : telemetryData.latest.spoilage_risk_level === 'HIGH' ? '#FFFBEB' : '#F0FDF4',
                  borderColor: telemetryData.latest.spoilage_risk_level === 'CRITICAL' ? '#F87171'
                    : telemetryData.latest.spoilage_risk_level === 'HIGH' ? '#FBBF24' : '#86EFAC',
                }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                      <span>🤖</span> AI Spoilage &amp; Shelf-Life
                    </span>
                    <span className="text-xs tabular-nums" style={{ color: 'var(--color-slate)' }}>
                      Score: {telemetryData.latest.spoilage_risk ?? 0}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="p-2 rounded bg-white/70">
                      <span className="text-slate-500 block">Shelf Life</span>
                      <strong className="text-sm">{telemetryData.latest.shelf_life_remaining_hours ?? 72} hrs</strong>
                    </div>
                    <div className="p-2 rounded bg-white/70">
                      <span className="text-slate-500 block">Quality</span>
                      <strong className="text-sm">{telemetryData.latest.quality_retention_pct ?? 96}%</strong>
                    </div>
                    <div className="p-2 rounded bg-white/70">
                      <span className="text-slate-500 block">Logging</span>
                      <strong className="text-sm text-emerald-700">15 min</strong>
                    </div>
                  </div>
                  {telemetryData.latest.route_recommendation && (
                    <div className="text-xs p-2.5 rounded font-medium flex items-center justify-between gap-2 mt-2" style={{
                      background: telemetryData.latest.reroute_suggested ? '#FEE2E2' : '#DCFCE7',
                      color: telemetryData.latest.reroute_suggested ? '#991B1B' : '#166534',
                    }}>
                      <span>{telemetryData.latest.route_recommendation}</span>
                      {telemetryData.latest.reroute_suggested && (
                        <button
                          onClick={() => alert(`Rerouting accepted! Navigating to nearest safe cold hub: ${telemetryData.latest.nearest_safe_market || 'City Cold Depot'}`)}
                          className="px-2.5 py-1 rounded bg-red-700 text-white font-bold hover:bg-red-800 shrink-0"
                        >
                          Navigate ↗
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : !telemetryLoading ? (
              <div className="text-center py-8 px-4">
                <div className="text-3xl mb-3">📡</div>
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--color-ink)' }}>No IoT device connected</p>
                <p className="text-xs mb-4" style={{ color: 'var(--color-slate)' }}>
                  Pair with an active sensor in the IoT Simulator (:3001) using its Connection Number.
                </p>
                <button
                  onClick={() => { fetchAvailableIotDevices(); setShowPairModal(true); }}
                  className="btn-ghost text-xs px-4 py-2 border"
                  style={{ borderColor: 'var(--color-hairline)' }}
                >
                  🔌 Pair Connection Number
                </button>
              </div>
            ) : null}
          </div>

          {/* ── 6. FLAGGED ISSUES FEED ──────────────────────────────────── */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>Flagged Issues</h3>
              <span className="text-xs" style={{ color: 'var(--color-slate)' }}>{issuesList.length} reported</span>
            </div>
            {issuesList.length === 0 ? (
              <p className="text-xs py-2" style={{ color: 'var(--color-slate)' }}>No active issues flagged for this truck.</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {issuesList.map((iss) => (
                  <div key={iss.id} className="p-2.5 rounded border text-xs" style={{ borderColor: 'var(--color-hairline)' }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                        iss.status === 'open' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {iss.status}
                      </span>
                      <span className="text-[10px]" style={{ color: 'var(--color-slate)' }}>{formatDate(iss.created_at)}</span>
                    </div>
                    <p style={{ color: 'var(--color-ink)' }}>{iss.description}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── 7. EMERGENCY REPORT BUTTON ──────────────────────────────── */}
          <button
            className="w-full py-5 rounded font-bold text-base tracking-wide"
            style={{ background: 'var(--status-issue)', color: 'white', borderRadius: '4px' }}
            onClick={() => setShowIssue(true)}
          >
            🚨 EMERGENCY REPORT
          </button>
        </div>
      )}

      {/* ── MODALS ──────────────────────────────────────────────────────────── */}

      {/* Start Trip */}
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
              <label className="block text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--color-slate)' }}>Notes</label>
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
              <button type="submit" className="btn-primary flex-1 py-3" disabled={saving}>
                {saving ? 'Starting…' : '🚀 Start Trip'}
              </button>
              <button type="button" className="btn-ghost flex-1" onClick={() => setShowStartTrip(false)}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Set Temperature */}
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
                type="number" step="0.5" min="-30" max="25"
                value={tempInput}
                onChange={e => setTempInput(e.target.value)}
                required
                className="input-field text-xl font-semibold"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              {[-25, -18, -10, 2, 4, 8].map(t => (
                <button key={t} type="button" className="btn-ghost text-xs" onClick={() => setTempInput(String(t))}>
                  {t}°C
                </button>
              ))}
            </div>
            {error && <ErrorAlert message={error} />}
            <div className="flex gap-3">
              <button type="submit" className="btn-primary flex-1 py-3" disabled={saving}>
                {saving ? 'Setting…' : 'Set Temperature'}
              </button>
              <button type="button" className="btn-ghost flex-1" onClick={() => setShowTempForm(false)}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Report Issue */}
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
              <button type="submit" className="btn-primary flex-1 py-3" disabled={saving || !issueDesc.trim()}>
                {saving ? 'Reporting…' : '⚠️ Report Issue'}
              </button>
              <button type="button" className="btn-ghost flex-1" onClick={() => setShowIssue(false)}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Pair IoT Device */}
      {showPairModal && (
        <Modal title="Connect IoT Sensor Device" onClose={() => setShowPairModal(false)}>
          <div className="space-y-4">
            <p className="text-sm" style={{ color: 'var(--color-slate)' }}>
              Enter the unique <strong>Connection Number</strong> (e.g.{' '}
              <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">CONN-4821</code>
              ) generated by your ESP32 device in the IoT Simulator portal (:3001).
            </p>
            <form onSubmit={(e) => { e.preventDefault(); handleConnectIot(); }} className="space-y-3">
              <div>
                <label className="block text-xs font-medium uppercase tracking-wide mb-1" style={{ color: 'var(--color-slate)' }}>
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
              <button type="submit" disabled={connectingIot || !connInput.trim()} className="btn-primary w-full py-3">
                {connectingIot ? 'Connecting…' : 'Connect Device'}
              </button>
            </form>

            {activeIotDevices.length > 0 && (
              <div className="pt-3 border-t" style={{ borderColor: 'var(--color-hairline)' }}>
                <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--color-slate)' }}>
                  Active Broadcasting Devices (Click to Pair):
                </p>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {activeIotDevices.map((dev) => (
                    <div
                      key={dev.connection_number || dev.id}
                      onClick={() => handleConnectIot(dev.connection_number)}
                      className="p-2.5 rounded border cursor-pointer transition-all flex items-center justify-between text-xs hover:border-emerald-500 hover:bg-emerald-50"
                      style={{ borderColor: 'var(--color-hairline)' }}
                    >
                      <div>
                        <span className="font-mono font-bold mr-2" style={{ color: '#2E7D5B' }}>{dev.connection_number}</span>
                        <span style={{ color: 'var(--color-ink)' }}>{dev.device_name}</span>
                      </div>
                      <span className="tabular-nums font-semibold" style={{ color: 'var(--color-slate)' }}>
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
