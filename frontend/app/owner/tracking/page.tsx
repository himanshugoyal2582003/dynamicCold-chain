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
  { href: '/owner', label: 'My Fleet', icon: '🚛' },
  { href: '/owner/trips', label: 'Trip Management', icon: '🛣️' },
  { href: '/owner/tracking', label: 'Live Tracking', icon: '📍' },
  { href: '/owner?tab=insurance', label: 'Insurance', icon: '🛡️' },
  { href: '/owner/drivers', label: 'Drivers', icon: '👤' },
];

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function OwnerTrackingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [trucks, setTrucks] = useState<MapTruck[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');

  // Filtering & search
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  // Selected truck for details & route
  const [selectedTruckId, setSelectedTruckId] = useState<string | null>(null);

  // Playback modal
  const [playbackTruckId, setPlaybackTruckId] = useState<string | null>(null);

  // Focus truck on map
  const [focusTruckId, setFocusTruckId] = useState<string | null>(null);

  // Socket.IO client ref
  const socketRef = useRef<Socket | null>(null);

  // 1. Auth guard
  useEffect(() => {
    if (!loading && (!user || user.role !== 'owner')) {
      router.replace('/login');
    }
  }, [user, loading, router]);

  // 2. Fetch live locations
  const fetchLiveFleet = useCallback(async () => {
    try {
      const data = await apiFetch('/api/tracking/live');
      if (Array.isArray(data)) {
        setTrucks(data);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to fetch live fleet locations.');
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    if (user?.role === 'owner') {
      fetchLiveFleet();
      const interval = setInterval(fetchLiveFleet, 15000);
      return () => clearInterval(interval);
    }
  }, [user, fetchLiveFleet]);

  // 3. Socket.IO Real-time updates
  useEffect(() => {
    if (!user || user.role !== 'owner') return;

    const socket = io(`${API_URL}/tracking`, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });

    socketRef.current = socket;

    socket.on('location:update', (payload: any) => {
      setTrucks((prev) =>
        prev.map((t) => {
          if (t.truck_id === payload.truckId) {
            return {
              ...t,
              status: payload.status || t.status,
              location: {
                latitude: payload.latitude,
                longitude: payload.longitude,
                speed_kmh: payload.speed_kmh,
                heading: payload.heading,
              },
              gps_status: 'live',
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

  // Filter trucks list
  const filteredTrucks = trucks.filter((t) => {
    const matchesSearch =
      t.plate_number.toLowerCase().includes(search.toLowerCase()) ||
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

  if (loading || !user) return null;

  return (
    <DashboardLayout navItems={NAV} title="Live Fleet Tracking & GPS Navigation" roleLabel="Fleet Owner">
      <div className="space-y-4">
        {error && <ErrorAlert message={error} />}

        {/* Top Summary Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3.5 rounded border" style={{ background: 'var(--color-paper)', borderColor: 'var(--color-hairline)' }}>
            <span className="text-xs uppercase text-slate-500 font-medium">Fleet Size</span>
            <p className="text-2xl font-bold tabular-nums" style={{ color: 'var(--color-ink)' }}>{trucks.length}</p>
          </div>
          <div className="p-3.5 rounded border" style={{ background: 'var(--color-paper)', borderColor: 'var(--color-hairline)' }}>
            <span className="text-xs uppercase text-slate-500 font-medium">Active Shipments</span>
            <p className="text-2xl font-bold tabular-nums" style={{ color: '#2F5D8A' }}>
              {trucks.filter((t) => t.status === 'on_trip').length}
            </p>
          </div>
          <div className="p-3.5 rounded border" style={{ background: 'var(--color-paper)', borderColor: 'var(--color-hairline)' }}>
            <span className="text-xs uppercase text-slate-500 font-medium">Live GPS Signals</span>
            <p className="text-2xl font-bold tabular-nums" style={{ color: '#2E7D5B' }}>
              {trucks.filter((t) => t.gps_status === 'live').length}
            </p>
          </div>
          <div className="p-3.5 rounded border" style={{ background: 'var(--color-paper)', borderColor: 'var(--color-hairline)' }}>
            <span className="text-xs uppercase text-slate-500 font-medium">Available Standby</span>
            <p className="text-2xl font-bold tabular-nums" style={{ color: 'var(--color-gold)' }}>
              {trucks.filter((t) => t.status === 'available').length}
            </p>
          </div>
        </div>

        {/* Main Split-Screen Tracking Workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4" style={{ minHeight: '620px' }}>
          {/* Left Column: Truck List & Filter (4 cols) */}
          <div
            className="lg:col-span-4 flex flex-col rounded border overflow-hidden"
            style={{ background: 'var(--color-paper)', borderColor: 'var(--color-hairline)', maxHeight: '720px' }}
          >
            {/* Search and Filters */}
            <div className="p-3 border-b space-y-2.5" style={{ borderColor: 'var(--color-hairline)' }}>
              <input
                type="text"
                placeholder="Search plate, driver, destination…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded border outline-none focus:ring-1 focus:ring-[#B08D3C]"
                style={{ borderColor: 'var(--color-hairline)', background: 'var(--color-ivory)' }}
              />

              {/* Status filter pills */}
              <div className="flex gap-1.5 overflow-x-auto pb-1 text-[11px]">
                {[
                  { id: 'all', label: 'All' },
                  { id: 'on_trip', label: 'On Trip' },
                  { id: 'available', label: 'Available' },
                  { id: 'maintenance', label: 'Maintenance' },
                  { id: 'gps_offline', label: 'GPS Offline' },
                  { id: 'gps_live', label: 'GPS Live' },
                  { id: 'temperature_alert', label: 'Temp Alert' },
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFilterStatus(f.id)}
                    className={`px-2.5 py-1 rounded whitespace-nowrap transition-colors font-medium ${
                      filterStatus === f.id
                        ? 'bg-[#14171C] text-white'
                        : 'bg-neutral-100 text-slate-600 hover:bg-neutral-200'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Scrollable Truck List */}
            <div className="flex-1 overflow-y-auto divide-y" style={{ borderColor: 'var(--color-hairline)' }}>
              {fetching ? (
                <div className="py-16 text-center">
                  <Spinner />
                  <p className="text-xs text-slate-400 mt-2">Loading live fleet…</p>
                </div>
              ) : filteredTrucks.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  No vehicles match the selected filter.
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
                      className={`p-3.5 cursor-pointer transition-colors ${
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
                          <p className="text-xs text-slate-500 mt-0.5">
                            {t.driver?.name ? `Driver: ${t.driver.name}` : 'Unassigned'}
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
                          {t.location?.speed_kmh !== undefined && (
                            <p className="text-xs font-semibold tabular-nums text-slate-700 mt-1">
                              {t.location.speed_kmh.toFixed(0)} km/h
                            </p>
                          )}
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

          {/* Right Column: Interactive Map (8 cols or 5 cols if panel open) */}
          <div className={`${selectedTruck ? 'lg:col-span-5' : 'lg:col-span-8'} h-[620px] transition-all`}>
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

          {/* Details Drawer (3 cols when a truck is selected) */}
          {selectedTruck && (
            <div className="lg:col-span-3 h-[620px]">
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

      {/* Route Playback Modal */}
      {playbackTruckId && (
        <RoutePlayback
          truckId={playbackTruckId}
          onClose={() => setPlaybackTruckId(null)}
        />
      )}
    </DashboardLayout>
  );
}
