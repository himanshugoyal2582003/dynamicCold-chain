'use client';

import { useEffect, useRef } from 'react';

/**
 * useRouteLayer — Leaflet imperative hook that draws a route polyline
 * plus origin/destination markers onto a Leaflet map instance.
 *
 * Usage:
 *   useRouteLayer({ mapInstance, routeCoordinates, originCoords, destinationCoords, originName, destinationName })
 *
 * Cleans up its own layers on unmount or when props change.
 */

interface UseRouteLayerProps {
  mapInstance: any; // Leaflet Map instance (any to avoid SSR import)
  routeCoordinates?: [number, number][];
  originCoords?: [number, number] | null;
  destinationCoords?: [number, number] | null;
  originName?: string;
  destinationName?: string;
}

export function useRouteLayer({
  mapInstance,
  routeCoordinates,
  originCoords,
  destinationCoords,
  originName,
  destinationName,
}: UseRouteLayerProps): void {
  const polylineRef = useRef<any>(null);
  const endpointsRef = useRef<any[]>([]);

  useEffect(() => {
    if (!mapInstance) return;

    let cancelled = false;

    async function draw() {
      const L = (await import('leaflet')).default;
      if (cancelled || !mapInstance) return;

      // ── Teardown previous layers ──
      if (polylineRef.current) {
        polylineRef.current.remove();
        polylineRef.current = null;
      }
      endpointsRef.current.forEach((m) => m.remove());
      endpointsRef.current = [];

      // ── Route polyline ──
      if (routeCoordinates && routeCoordinates.length > 1) {
        const polyline = L.polyline(routeCoordinates, {
          color: '#2F5D8A',
          weight: 4,
          opacity: 0.85,
          dashArray: '8, 6',
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(mapInstance);
        polylineRef.current = polyline;
        mapInstance.fitBounds(polyline.getBounds(), { padding: [50, 50] });
      }

      // ── Origin marker (A) ──
      if (originCoords) {
        const html = `
          <div class="flex items-center justify-center w-6 h-6 rounded-full shadow-md text-xs font-bold text-white"
               style="background:#2E7D5B;border:2px solid #FFFFFF;">A</div>
        `;
        const icon = L.divIcon({ html, className: 'endpoint-icon', iconSize: [24, 24], iconAnchor: [12, 12] });
        const m = L.marker(originCoords, { icon }).addTo(mapInstance);
        if (originName) m.bindPopup(`<b>Origin:</b> ${originName}`);
        endpointsRef.current.push(m);
      }

      // ── Destination marker (B) ──
      if (destinationCoords) {
        const html = `
          <div class="flex items-center justify-center w-6 h-6 rounded-full shadow-md text-xs font-bold text-white"
               style="background:#A3262A;border:2px solid #FFFFFF;">B</div>
        `;
        const icon = L.divIcon({ html, className: 'endpoint-icon', iconSize: [24, 24], iconAnchor: [12, 12] });
        const m = L.marker(destinationCoords, { icon }).addTo(mapInstance);
        if (destinationName) m.bindPopup(`<b>Destination:</b> ${destinationName}`);
        endpointsRef.current.push(m);
      }
    }

    draw().catch(console.error);

    return () => {
      cancelled = true;
      if (polylineRef.current) {
        polylineRef.current.remove();
        polylineRef.current = null;
      }
      endpointsRef.current.forEach((m) => m.remove());
      endpointsRef.current = [];
    };
  }, [mapInstance, routeCoordinates, originCoords, destinationCoords, originName, destinationName]);
}

/**
 * TripRoute — React component wrapper around useRouteLayer.
 * Renders nothing — all effects are imperative Leaflet calls.
 */
interface TripRouteProps extends UseRouteLayerProps {}

export default function TripRoute(props: TripRouteProps) {
  useRouteLayer(props);
  return null;
}
