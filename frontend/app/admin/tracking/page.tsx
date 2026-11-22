'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth, apiFetch } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { StatusBadge, Spinner, ErrorAlert } from '@/components/ui/shared';
import dynamic from 'next/dynamic';
import type { MapTruck } from '@/components/tracking/FleetMap';
import TruckDetailsPanel from '@/components/tracking/TruckDetailsPanel';
import RoutePlayback from '@/components/tracking/RoutePlayback';
import { io, Socket } from 'socket.io-client';
import { useShipmentRoute } from '@/lib/useShipmentRoute';

const FleetMap = dynamic(() => import('@/components/tracking/FleetMap'), { ssr: false });

const NAV = [
  { href: '/admin', label: 'Overview', icon: '◈' },
  { href: '/admin/tracking', label: 'Global Map', icon: '📍' },
  { href: '/admin/owners', label: 'Owners', icon: '🏢' },
  { href: '/admin/trucks', label: 'Trucks', icon: '🚛' },
  { href: '/admin/users', label: 'Drivers', icon: '👤' },
  { href: '/admin/activity', label: 'Activity Log', icon: '📋' },
];

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function AdminGlobalTrackingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [trucks, setTrucks] = useState<any[]>([]);
  const [owners, setOwners] = useState<any[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');

  // Filtering
  const [search, setSearch] = useState('');
  const [selectedOwnerId, setSelectedOwnerId] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  // Selected truck & route
  const [selectedTruckId, setSelectedTruckId] = useState<string | null>(null);
  const [focusTruckId, setFocusTruckId] = useState<string | null>(null);

  // Playback modal
  const [playbackTruckId, setPlaybackTruckId] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);

  // 1. Auth guard
  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) {
      router.replace('/login');
    }
  }, [user, loading, router]);

  // 2. Fetch fleet & owners
  const fetchData = useCallback(async (showLoading = false) => {
    if (showLoading) setFetching(true);
    setError('');
    try {
      const [fleetData, ownersData] = await Promise.all([
        apiFetch('/api/tracking/live'),
        apiFetch('/api/admin/owners'),
      ]);
      if (!Array.isArray(fleetData)) throw new Error('GET /api/tracking/live returned an invalid fleet response.');
      if (!Array.isArray(ownersData)) throw new Error('GET /api/admin/owners returned an invalid owner response.');
      setTrucks(fleetData);
      setOwners(ownersData);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch global fleet.');
    } finally {
      if (showLoading) setFetching(false);
    }
  }, []);

  useEffect(() => {
    if (user?.role === 'admin') {
      fetchData(true);
      const interval = setInterval(fetchData, 15000);
      return () => clearInterval(interval);
    }
  }, [user, fetchData]);

  // 3. Socket.IO admin room
  useEffect(() => {
    if (!user || user.role !== 'admin') return;

    const socket = io(`${API_URL}/tracking`, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });

    socketRef.current = socket;

    socket.on('location:update', (payload: any) => {
      const latitude = Number(payload.latitude);
      const longitude = Number(payload.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
        || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return;
      setTrucks((prev) =>
        prev.map((t) => {
          if (t.truck_id === payload.truckId) {
            return {
              ...t,
              status: payload.status || t.status,
              location: {
                latitude,
                longitude,
                speed_kmh: payload.speed_kmh,
                heading: payload.heading,
                recorded_at: payload.recorded_at || new Date().toISOString(),
                received_at: new Date().toISOString(),
              },
              gps_status: 'live',
              last_seen: new Date().toISOString(),
            };
          }
          return t;
        })
      );
    });

    return () => {
      socket.disconnect();
    };
  }, [user]);

  // Select an active shipment automatically when the fleet first loads.
  useEffect(() => {
    if (!selectedTruckId) {
      const active = trucks.find((truck) => truck.active_trip);
      if (active) setSelectedTruckId(active.truck_id);
    }
  }, [trucks, selectedTruckId]);

  // Filter trucks
  const filteredTrucks = trucks.filter((t) => {
    if (selectedOwnerId !== 'all' && t.owner_id !== selectedOwnerId) return false;

    const matchesSearch =
      t.plate_number.toLowerCase().includes(search.toLowerCase()) ||
      t.owner_name?.toLowerCase().includes(search.toLowerCase()) ||
      t.driver?.name?.toLowerCase().includes(search.toLowerCase()) ||
      t.active_trip?.destination?.toLowerCase().includes(search.toLowerCase());

    if (!matchesSearch) return false;

    if (filterStatus === 'all') return true;
    if (filterStatus === 'on_trip') return t.status === 'on_trip';
    if (filterStatus === 'available') return t.status === 'available';
    if (filterStatus === 'maintenance') return t.status === 'maintenance';
    if (filterStatus === 'gps_offline') return t.gps_status !== 'live';
    if (filterStatus === 'gps_live') return t.gps_status === 'live';
    if (filterStatus === 'temperature_alert')
      return t.current_temp !== undefined &&
        t.target_temp_c !== undefined &&
        Math.abs(t.current_temp - t.target_temp_c) > 2;
    return true;
  });

  const selectedTruck = trucks.find((t) => t.truck_id === selectedTruckId) || null;
  const routeData = useShipmentRoute(selectedTruck);
  const unlocatedTrucks = filteredTrucks.filter((truck) => {
    const location = truck.location;
    return !location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)
      || location.latitude < -90 || location.latitude > 90
      || location.longitude < -180 || location.longitude > 180;
  });

  if (loading || !user) return null;

  return (
    <DashboardLayout navItems={NAV} title="Global Fleet Intelligence & GIS Tracking" roleLabel="Administrator">
      <div className="space-y-4">
        {error && <ErrorAlert message={error} />}
        {error && <button className="btn-ghost" onClick={() => fetchData(true)} disabled={fetching}>Retry</button>}

        {/* Global Intelligence Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <div className="p-3.5 rounded border" style={{ background: 'var(--color-paper)', borderColor: 'var(--color-hairline)' }}>
            <span className="text-xs uppercase text-slate-500 font-medium">Total Monitored Fleet</span>
            <p className="text-2xl font-bold tabular-nums" style={{ color: 'var(--color-ink)' }}>{trucks.length}</p>
          </div>
          <div className="p-3.5 rounded border" style={{ background: 'var(--color-paper)', borderColor: 'var(--color-hairline)' }}>
            <span className="text-xs uppercase text-slate-500 font-medium">Active En-Route</span>
            <p className="text-2xl font-bold tabular-nums" style={{ color: '#2F5D8A' }}>
              {trucks.filter((t) => Boolean(t.active_trip)).length}
            </p>
          </div>
          <div className="p-3.5 rounded border" style={{ background: 'var(--color-paper)', borderColor: 'var(--color-hairline)' }}>
            <span className="text-xs uppercase text-slate-500 font-medium">Live Telemetry Fixes</span>
            <p className="text-2xl font-bold tabular-nums" style={{ color: '#2E7D5B' }}>
              {trucks.filter((t) => t.gps_status === 'live').length}
            </p>
          </div>
          <div className="p-3.5 rounded border" style={{ background: 'var(--color-paper)', borderColor: 'var(--color-hairline)' }}>
            <span className="text-xs uppercase text-slate-500 font-medium">Available Standby</span>
            <p className="text-2xl font-bold tabular-nums" style={{ color: 'var(--color-gold)' }}>
              {trucks.filter((t) => t.status === 'available' && !t.active_trip).length}
            </p>
          </div>
          <div className="p-3.5 rounded border" style={{ background: 'var(--color-paper)', borderColor: 'var(--color-hairline)' }}>
            <span className="text-xs uppercase text-slate-500 font-medium">IoT Paired</span>
            <p className="text-2xl font-bold tabular-nums" style={{ color: 'var(--color-ink)' }}>
              {trucks.filter((t) => Boolean(t.iot_connection_number)).length}
            </p>
          </div>
          <div className="p-3.5 rounded border" style={{ background: 'var(--color-paper)', borderColor: 'var(--color-hairline)' }}>
            <span className="text-xs uppercase text-slate-500 font-medium">IoT Unpaired</span>
            <p className="text-2xl font-bold tabular-nums" style={{ color: '#9A3412' }}>
              {trucks.filter((t) => !t.iot_connection_number).length}
            </p>
          </div>
        </div>

        {unlocatedTrucks.length > 0 && (
          <section className="card p-4" aria-label="Unlocated trucks">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-semibold">Unlocated Trucks</h2>
                <p className="text-xs text-slate-500">No valid GPS location is available. These trucks are included in the fleet list but are not placed on the map.</p>
              </div>
              <span className="text-xs font-semibold tabular-nums">{unlocatedTrucks.length}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
              {unlocatedTrucks.map((truck) => (
                <button
                  key={truck.truck_id}
                  type="button"
                  onClick={() => setSelectedTruckId(truck.truck_id)}
                  className="flex items-center justify-between gap-3 rounded border p-3 text-left hover:bg-neutral-50"
                  style={{ borderColor: 'var(--color-hairline)' }}
                >
                  <span>
                    <span className="block font-mono text-sm font-semibold">{truck.plate_number}</span>
                    <span className="block text-xs text-slate-500">{truck.status} · {truck.iot_connection_number ? `IoT ${truck.iot_connection_number}` : 'NO DEVICE PAIRED'}</span>
                  </span>
                  <span className="text-[10px] uppercase text-slate-500">GPS unavailable</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4" style={{ minHeight: '640px' }}>
          {/* Left Column: List & Filters (4 cols) */}
          <div
            className="lg:col-span-4 flex flex-col rounded border overflow-hidden"
            style={{ background: 'var(--color-paper)', borderColor: 'var(--color-hairline)', maxHeight: '740px' }}
          >
            {/* Owner dropdown & search */}
            <div className="p-3 border-b space-y-2.5" style={{ borderColor: 'var(--color-hairline)' }}>
              <div className="flex gap-2">
                <select
                  value={selectedOwnerId}
                  onChange={(e) => setSelectedOwnerId(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs rounded border outline-none font-medium"
                  style={{ borderColor: 'var(--color-hairline)', background: 'var(--color-ivory)' }}
                >
                  <option value="all">All Fleet Owners</option>
                  {owners.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>

              <input
                type="text"
                placeholder="Search truck, owner, driver…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded border outline-none"
                style={{ borderColor: 'var(--color-hairline)', background: 'var(--color-ivory)' }}
              />

              <div className="flex gap-1.5 overflow-x-auto text-[11px]">
                {[
                  { id: 'all', label: 'All' },
                  { id: 'on_trip', label: 'On Trip' },
                  { id: 'available', label: 'Available' },
                  { id: 'maintenance', label: 'Maintenance' },
                  { id: 'gps_offline', label: 'GPS Offline' },
                  { id: 'gps_live', label: 'Live GPS' },
                  { id: 'temperature_alert', label: 'Temp Alert' },
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFilterStatus(f.id)}
                    className={`px-2 py-0.5 rounded whitespace-nowrap text-xs transition ${
                      filterStatus === f.id
                        ? 'bg-[#14171C] text-white font-semibold'
                        : 'bg-neutral-100 text-slate-600 hover:bg-neutral-200'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto divide-y" style={{ borderColor: 'var(--color-hairline)' }}>
              {fetching ? (
                <div className="py-16 text-center">
                  <Spinner />
                  <p className="text-xs text-slate-400 mt-2">Loading fleet…</p>
                </div>
              ) : filteredTrucks.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  No vehicles found.
                </div>
              ) : (
                filteredTrucks.map((t) => {
                  const isSelected = selectedTruckId === t.truck_id;
                  return (
                    <div
                      key={t.truck_id}
                      onClick={() => {
                        setSelectedTruckId(t.truck_id);
                        setFocusTruckId(t.truck_id);
                      }}
                      className={`p-3.5 cursor-pointer transition ${
                        isSelected ? 'bg-amber-50/60 border-l-4 border-l-[#B08D3C]' : 'hover:bg-neutral-50'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-sm" style={{ color: 'var(--color-ink)' }}>
                              {t.plate_number}
                            </span>
                            <StatusBadge status={t.status} />
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            Owner: <span className="font-medium text-slate-700">{t.owner_name}</span>
                          </p>
                        </div>

                        <div className="text-right">
                          <span
                            className="text-[10px] font-bold px-2 py-0.5 rounded uppercase"
                            style={{
                              background: t.gps_status === 'live' ? '#DDEEE8' : '#F7F6F3',
                              color: t.gps_status === 'live' ? '#2E7D5B' : '#5B6470',
                            }}
                          >
                            {t.gps_status === 'live' ? 'Live' : 'Offline'}
                          </span>
                        </div>
                      </div>

                      {t.active_trip && (
                        <div className="mt-2 text-[11px] p-2 rounded bg-neutral-100/70 text-slate-600 flex items-center justify-between">
                          <span className="truncate max-w-[200px]">
                            {t.active_trip.origin} → {t.active_trip.destination}
                          </span>
                          <span className="text-[10px] text-blue-700 font-semibold uppercase">
                            {t.active_trip.cargo_type}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: Map */}
          <div className={`${selectedTruck ? 'lg:col-span-5' : 'lg:col-span-8'} h-[640px] transition-all`}>
            <FleetMap
              trucks={filteredTrucks}
              selectedTruckId={selectedTruckId}
              onSelectTruck={(t) => {
                setSelectedTruckId(t.truck_id);
                setFocusTruckId(t.truck_id);
              }}
              routeCoordinates={routeData.coordinates}
              remainingCoordinates={routeData.remainingCoordinates}
              originCoords={routeData.originCoords}
              destinationCoords={routeData.destinationCoords}
              originName={routeData.originResolvedName || selectedTruck?.active_trip?.origin}
              destinationName={routeData.destinationResolvedName || selectedTruck?.active_trip?.destination}
              focusTruckId={focusTruckId}
              height="100%"
            />
          </div>

          {/* Side Drawer */}
          {selectedTruck && (
            <div className="lg:col-span-3 h-[640px]">
              <TruckDetailsPanel
                truck={selectedTruck}
                onClose={() => {
                  setSelectedTruckId(null);
                }}
                routeStatus={routeData.status}
                etaText={routeData.etaText}
                remainingDistanceKm={routeData.remainingDistanceKm}
                approximateEndpoints={routeData.approximateEndpoints}
                onReplayHistory={(id) => setPlaybackTruckId(id)}
              />
            </div>
          )}
        </div>
      </div>

      {/* History Playback Modal */}
      {playbackTruckId && (
        <RoutePlayback
          truckId={playbackTruckId}
          onClose={() => setPlaybackTruckId(null)}
        />
      )}
    </DashboardLayout>
  );
}
