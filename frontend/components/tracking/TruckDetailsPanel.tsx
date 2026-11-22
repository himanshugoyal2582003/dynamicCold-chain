'use client';

import { StatusBadge, formatDateTime } from '@/components/ui/shared';
import { MapTruck } from './FleetMap';

interface TruckDetailsPanelProps {
  truck: MapTruck | null;
  onClose: () => void;
  onReplayHistory?: (truckId: string) => void;
  routeStatus?: string;
  etaText?: string;
  remainingDistanceKm?: number | null;
  approximateEndpoints?: boolean;
}

export default function TruckDetailsPanel({
  truck,
  onClose,
  onReplayHistory,
  routeStatus = 'Route unavailable',
  etaText = 'Route unavailable',
  remainingDistanceKm = null,
  approximateEndpoints = false,
}: TruckDetailsPanelProps) {
  if (!truck) return null;

  const loc = truck.location;
  const trip = truck.active_trip;

  return (
    <div
      className="card flex flex-col h-full overflow-y-auto space-y-4"
      style={{
        background: 'var(--color-paper)',
        borderColor: 'var(--color-hairline)',
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between pb-3 border-b" style={{ borderColor: 'var(--color-hairline)' }}>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl font-mono font-bold" style={{ color: 'var(--color-ink)' }}>
              {truck.plate_number}
            </span>
            <StatusBadge status={truck.status} />
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-slate)' }}>
            {truck.type || 'Commercial Reefer'} · Target: {truck.target_temp_c ?? 4.0}°C
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-neutral-100 text-sm"
          style={{ color: 'var(--color-slate)' }}
          title="Close details"
        >
          ✕
        </button>
      </div>

      {/* Driver info */}
      <div className="p-3 rounded flex items-center justify-between" style={{ background: 'var(--color-ivory)' }}>
        <div className="flex items-center gap-2">
          <span className="text-base">👤</span>
          <div>
            <p className="text-xs uppercase tracking-wider font-semibold" style={{ color: 'var(--color-slate)' }}>Assigned Driver</p>
            <p className="text-sm font-medium" style={{ color: 'var(--color-ink)' }}>
              {truck.driver?.name || 'Unassigned'}
            </p>
          </div>
        </div>
        {truck.driver?.email && (
          <span className="text-xs truncate max-w-[140px]" style={{ color: 'var(--color-slate)' }}>
            {truck.driver.email}
          </span>
        )}
      </div>

      {/* Real-time GPS Telemetry */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--color-ink)' }}>
            <span>📡</span> Live Telemetry
          </span>
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded uppercase"
            style={{
              background: truck.gps_status === 'live' ? '#DDEEE8' : '#F7F6F3',
              color: truck.gps_status === 'live' ? '#2E7D5B' : '#5B6470',
            }}
          >
            {truck.gps_status === 'live' ? '● GPS Live' : '○ GPS Inactive'}
          </span>
        </div>

        {loc ? (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 rounded" style={{ background: 'var(--color-ivory)' }}>
              <span className="text-[10px] uppercase font-medium" style={{ color: 'var(--color-slate)' }}>Speed</span>
              <p className="text-base font-bold tabular-nums" style={{ color: 'var(--color-ink)' }}>
                {loc.speed_kmh?.toFixed(1) ?? '0.0'} <span className="text-[10px] font-normal">km/h</span>
              </p>
            </div>
            <div className="p-2.5 rounded" style={{ background: 'var(--color-ivory)' }}>
              <span className="text-[10px] uppercase font-medium" style={{ color: 'var(--color-slate)' }}>Heading</span>
              <p className="text-base font-bold tabular-nums" style={{ color: 'var(--color-ink)' }}>
                {loc.heading ? `${Math.round(loc.heading)}°` : 'North'}
              </p>
            </div>
            <div className="p-2.5 rounded col-span-2 flex justify-between items-center" style={{ background: 'var(--color-ivory)' }}>
              <span className="text-[10px] uppercase font-medium" style={{ color: 'var(--color-slate)' }}>Coordinates</span>
              <span className="font-mono text-xs font-semibold tabular-nums">
                {loc.latitude.toFixed(4)}°, {loc.longitude.toFixed(4)}°
              </span>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded text-center text-xs" style={{ background: 'var(--color-ivory)', color: 'var(--color-slate)' }}>
            No GPS fix received yet. Waiting for vehicle telemetry…
          </div>
        )}
      </div>

      {/* Active Trip Info */}
      {trip ? (
        <div className="p-3.5 rounded space-y-3" style={{ background: '#D8E5F215', border: '1px solid #D8E5F2' }}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: '#2F5D8A' }}>
              <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#2F5D8A' }}></span> Active Shipment
            </span>
            <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-white text-[#2F5D8A]">
              {trip.cargo_type}
            </span>
          </div>

          <div className="space-y-1.5 text-xs">
            <div className="flex items-start gap-2">
              <span className="font-bold text-[#2E7D5B]">A</span>
              <div className="flex-1 min-w-0">
                <span className="text-[10px] uppercase" style={{ color: 'var(--color-slate)' }}>Origin</span>
                <p className="font-medium truncate text-xs">{trip.origin}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <span className="font-bold text-[#A3262A]">B</span>
              <div className="flex-1 min-w-0">
                <span className="text-[10px] uppercase" style={{ color: 'var(--color-slate)' }}>Destination</span>
                <p className="font-medium truncate text-xs">{trip.destination}</p>
              </div>
            </div>
          </div>

          {trip.started_at && (
            <p className="text-[10px]" style={{ color: 'var(--color-slate)' }}>
              Dispatched: {formatDateTime(trip.started_at)}
            </p>
          )}
          <div className="p-3 rounded border space-y-2" style={{ background: 'var(--color-paper)', borderColor: 'var(--color-hairline)' }}>
            <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--color-slate)' }}>Estimated Arrival</p>
            <p className="text-2xl font-bold tabular-nums" style={{ color: 'var(--color-ink)' }}>{etaText}</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><span style={{ color: 'var(--color-slate)' }}>Remaining Distance</span><p className="font-semibold">{remainingDistanceKm === null ? '—' : `${remainingDistanceKm.toFixed(1)} km`}</p></div>
              <div><span style={{ color: 'var(--color-slate)' }}>Current Speed</span><p className="font-semibold">{loc && truck.gps_status === 'live' ? `${(loc.speed_kmh ?? 0).toFixed(1)} km/h` : '—'}</p></div>
              <div className="col-span-2"><span style={{ color: 'var(--color-slate)' }}>Route Status</span><p className="font-semibold">{routeStatus}</p></div>
              {approximateEndpoints && <div className="col-span-2 text-[10px]" style={{ color: '#8A6B2E' }}>Endpoint names are not mapped as exact facilities; route endpoints use the closest matching mapped areas.</div>}
            </div>
          </div>
        </div>
      ) : (
        <div className="p-3 rounded text-center text-xs" style={{ background: 'var(--color-ivory)', color: 'var(--color-slate)' }}>
          Vehicle is currently not assigned to an active trip.
        </div>
      )}

      {/* Action Buttons */}
      <div className="pt-2 space-y-2 border-t mt-auto" style={{ borderColor: 'var(--color-hairline)' }}>
        {onReplayHistory && (
          <button
            onClick={() => onReplayHistory(truck.truck_id)}
            className="w-full py-2.5 rounded font-medium text-xs flex items-center justify-center gap-2 border transition-colors"
            style={{
              background: 'var(--color-paper)',
              borderColor: 'var(--color-hairline)',
              color: 'var(--color-ink)',
            }}
          >
            <span>⏪</span> Replay Trip History
          </button>
        )}
      </div>
    </div>
  );
}
