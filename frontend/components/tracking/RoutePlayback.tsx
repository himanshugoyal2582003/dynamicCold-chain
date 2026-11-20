'use client';

import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '@/lib/auth';
import { Modal, Spinner, formatDateTime } from '@/components/ui/shared';
import FleetMap from './FleetMapLoader';

interface RoutePlaybackProps {
  truckId: string | null;
  onClose: () => void;
}

export default function RoutePlayback({ truckId, onClose }: RoutePlaybackProps) {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!truckId) return;

    let isMounted = true;
    setLoading(true);
    setError('');

    apiFetch(`/api/tracking/trucks/${truckId}/history?limit=250`)
      .then((data) => {
        if (!isMounted) return;
        // API returns DESC, reverse for playback timeline ASC
        const points = Array.isArray(data) ? [...data].reverse() : [];
        setHistory(points);
        setCurrentIndex(points.length > 0 ? points.length - 1 : 0);
      })
      .catch((e) => {
        if (isMounted) setError(e.message || 'Failed to load route history');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [truckId]);

  // Handle Playback Interval
  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        setCurrentIndex((prev) => {
          if (prev >= history.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, Math.max(200, 1000 / playbackSpeed));
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, history.length, playbackSpeed]);

  if (!truckId) return null;

  const currentPoint = history[currentIndex];
  const routeCoords: [number, number][] = history.map((h) => [h.latitude, h.longitude]);

  // Single dynamic truck object reflecting current playhead position
  const playbackTruck = currentPoint
    ? [
        {
          truck_id: truckId,
          plate_number: `Playback · Point #${currentIndex + 1}`,
          status: 'on_trip',
          gps_status: 'live',
          location: {
            latitude: currentPoint.latitude,
            longitude: currentPoint.longitude,
            speed_kmh: currentPoint.speed_kmh,
            heading: currentPoint.heading,
          },
        },
      ]
    : [];

  return (
    <Modal onClose={onClose} title="Historical Route Playback">
      <div className="space-y-4">
        {loading ? (
          <div className="py-20 text-center">
            <Spinner />
            <p className="text-xs text-neutral-500 mt-2">Loading GPS breadcrumb trail…</p>
          </div>
        ) : error ? (
          <div className="p-4 rounded bg-red-50 text-red-700 text-sm">{error}</div>
        ) : history.length === 0 ? (
          <div className="p-8 text-center text-neutral-500 text-sm">
            No historical location points found for this vehicle.
          </div>
        ) : (
          <>
            {/* Map Preview */}
            <div className="rounded overflow-hidden border border-neutral-200">
              <FleetMap
                trucks={playbackTruck}
                routeCoordinates={routeCoords}
                height="320px"
              />
            </div>

            {/* Playhead metrics card */}
            {currentPoint && (
              <div className="grid grid-cols-3 gap-2 p-3 rounded bg-neutral-50 text-xs">
                <div>
                  <span className="text-[10px] uppercase text-neutral-400">Timestamp</span>
                  <p className="font-semibold">{formatDateTime(currentPoint.recorded_at)}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase text-neutral-400">Recorded Speed</span>
                  <p className="font-semibold tabular-nums">
                    {currentPoint.speed_kmh ? `${currentPoint.speed_kmh.toFixed(1)} km/h` : '0.0 km/h'}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] uppercase text-neutral-400">Coordinates</span>
                  <p className="font-mono text-[11px] truncate">
                    {currentPoint.latitude.toFixed(4)}°, {currentPoint.longitude.toFixed(4)}°
                  </p>
                </div>
              </div>
            )}

            {/* Scrubber slider */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-neutral-500">
                <span>Start</span>
                <span>
                  Point {currentIndex + 1} of {history.length}
                </span>
                <span>End</span>
              </div>
              <input
                type="range"
                min="0"
                max={history.length - 1}
                value={currentIndex}
                onChange={(e) => {
                  setCurrentIndex(Number(e.target.value));
                  setIsPlaying(false);
                }}
                className="w-full accent-[#B08D3C] cursor-pointer"
              />
            </div>

            {/* Controls bar */}
            <div className="flex items-center justify-between pt-2 border-t border-neutral-100">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsPlaying(!isPlaying)}
                  className="px-4 py-2 rounded text-xs font-semibold bg-[#14171C] text-white hover:bg-neutral-800 transition"
                >
                  {isPlaying ? '⏸ Pause' : '▶ Play'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsPlaying(false);
                    setCurrentIndex(0);
                  }}
                  className="px-3 py-2 rounded text-xs border border-neutral-200 hover:bg-neutral-50 transition"
                >
                  ⏮ Reset
                </button>
              </div>

              {/* Speed controls */}
              <div className="flex items-center gap-1">
                {[1, 2, 5].map((speed) => (
                  <button
                    key={speed}
                    type="button"
                    onClick={() => setPlaybackSpeed(speed)}
                    className={`px-2.5 py-1 rounded text-xs font-semibold transition ${
                      playbackSpeed === speed
                        ? 'bg-[#B08D3C] text-white'
                        : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                    }`}
                  >
                    {speed}x
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
