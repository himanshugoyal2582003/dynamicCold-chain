'use client';

/**
 * FleetMapControls — floating overlay panel for the fleet map.
 *
 * Pure React — no Leaflet imports.
 * Position this absolutely over the map container at z-index 400.
 */

interface FleetMapControlsProps {
  onFitAll: () => void;
  truckCount: number;
  onTripCount: number;
  offlineCount: number;
}

export default function FleetMapControls({
  onFitAll,
  truckCount,
  onTripCount,
  offlineCount,
}: FleetMapControlsProps) {
  return (
    <div
      className="absolute top-3 left-3 flex flex-col gap-2"
      style={{ zIndex: 400 }}
    >
      {/* Fit All Fleet button */}
      <button
        onClick={onFitAll}
        className="px-3 py-1.5 rounded shadow-sm text-xs font-medium border transition-colors flex items-center gap-1.5"
        style={{
          background: '#FFFFFF',
          borderColor: '#E3E1DC',
          color: '#14171C',
          borderRadius: '4px',
        }}
        title="Fit all fleet vehicles in view"
      >
        <span>🎯</span> Fit All Fleet
      </button>

      {/* Stat pills */}
      <div className="flex flex-col gap-1.5">
        {/* Total fleet */}
        <div
          className="flex items-center gap-2 px-2.5 py-1 rounded text-[11px] font-medium border shadow-sm"
          style={{
            background: '#FFFFFF',
            borderColor: '#E3E1DC',
            color: '#14171C',
            borderRadius: '4px',
          }}
        >
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: '#B08D3C' }}
          />
          <span className="tabular-nums font-semibold">{truckCount}</span>
          <span style={{ color: '#5B6470' }}>Total Fleet</span>
        </div>

        {/* Active trips */}
        {onTripCount > 0 && (
          <div
            className="flex items-center gap-2 px-2.5 py-1 rounded text-[11px] font-medium border shadow-sm"
            style={{
              background: '#FFFFFF',
              borderColor: '#E3E1DC',
              color: '#14171C',
              borderRadius: '4px',
            }}
          >
            <span
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ background: '#2F5D8A' }}
            />
            <span className="tabular-nums font-semibold">{onTripCount}</span>
            <span style={{ color: '#5B6470' }}>Active Trips</span>
          </div>
        )}

        {/* GPS offline */}
        {offlineCount > 0 && (
          <div
            className="flex items-center gap-2 px-2.5 py-1 rounded text-[11px] font-medium border shadow-sm"
            style={{
              background: '#FFFFFF',
              borderColor: '#E3E1DC',
              color: '#14171C',
              borderRadius: '4px',
            }}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: '#5B6470' }}
            />
            <span className="tabular-nums font-semibold">{offlineCount}</span>
            <span style={{ color: '#5B6470' }}>GPS Offline</span>
          </div>
        )}
      </div>
    </div>
  );
}
