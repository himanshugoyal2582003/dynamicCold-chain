'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface MapTruck {
  truck_id: string;
  plate_number: string;
  type?: string;
  status: 'available' | 'on_trip' | 'maintenance' | string;
  target_temp_c?: number;
  current_temp?: number;
  gps_status?: 'live' | 'stale' | 'no_data' | string;
  iot_connection_number?: string | null;
  iot_status?: string;
  iot_last_seen?: string | null;
  iot_battery?: number | null;
  last_seen?: string | null;
  location?: {
    latitude: number;
    longitude: number;
    speed_kmh?: number;
    heading?: number;
  } | null;
  driver?: {
    name: string;
    email?: string;
  } | null;
  active_trip?: {
    id?: string;
    origin: string;
    destination: string;
    cargo_type: string;
    started_at?: string;
  } | null;
}

interface FleetMapProps {
  trucks: MapTruck[];
  selectedTruckId?: string | null;
  onSelectTruck?: (truck: MapTruck) => void;
  routeCoordinates?: [number, number][];
  remainingCoordinates?: [number, number][];
  originCoords?: [number, number] | null;
  destinationCoords?: [number, number] | null;
  originName?: string;
  destinationName?: string;
  className?: string;
  focusTruckId?: string | null;
  height?: string;
  showWarehousesByDefault?: boolean;
}

interface WarehousePoint {
  n: string;
  la: number;
  lo: number;
  s: string;
  d: string;
}

let cachedWarehouses: WarehousePoint[] | null = null;
let warehousesPromise: Promise<WarehousePoint[]> | null = null;

async function loadWarehouses(): Promise<WarehousePoint[]> {
  if (cachedWarehouses) return cachedWarehouses;
  if (!warehousesPromise) {
    warehousesPromise = fetch('/data/warehouses.json')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        cachedWarehouses = Array.isArray(data) ? data : [];
        return cachedWarehouses;
      })
      .catch(() => {
        warehousesPromise = null;
        return [];
      });
  }
  return warehousesPromise;
}

// ─────────────────────────────────────────────────────────────────────────────
// Status helpers
// ─────────────────────────────────────────────────────────────────────────────

function getStatusColor(status: string): string {
  switch (status) {
    case 'on_trip':     return '#2F5D8A';
    case 'maintenance': return '#C9962B';
    case 'available':   return '#2E7D5B';
    default:            return '#5B6470';
  }
}

function hasValidLocation(truck: MapTruck): boolean {
  const location = truck.location;
  return Boolean(location && Number.isFinite(location.latitude) && Number.isFinite(location.longitude)
    && location.latitude >= -90 && location.latitude <= 90
    && location.longitude >= -180 && location.longitude <= 180);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] as string);
}

function buildTruckPopupHtml(truck: MapTruck): string {
  const gps = truck.gps_status === 'live' ? 'GPS online' : truck.location ? 'GPS offline · last known location' : 'GPS unavailable';
  const device = truck.iot_connection_number
    ? `${escapeHtml(truck.iot_status || 'PAIRED')} · ${escapeHtml(truck.iot_connection_number)}`
    : 'NO DEVICE PAIRED';
  const lastSeen = truck.last_seen ? new Date(truck.last_seen).toLocaleString() : 'No telemetry received';
  return `<strong>${escapeHtml(truck.plate_number)}</strong><br/>Status: ${escapeHtml(truck.status)}<br/>${gps}<br/>IoT: ${device}<br/>Last telemetry: ${escapeHtml(lastSeen)}`;
}

function buildTruckIconHtml(truck: MapTruck, isSelected: boolean): string {
  const color = truck.gps_status !== 'live'
    ? '#7C8798'
    : getStatusColor(truck.status);
    const isGpsActive = truck.gps_status === 'live';
  const pulseHtml =
    truck.status === 'on_trip' && isGpsActive
      ? `<div class="absolute -inset-1.5 rounded-full animate-ping opacity-30" style="background:${color}"></div>`
      : '';

  const ringClass = isSelected
    ? 'scale-125 ring-2 ring-offset-2 ring-[#B08D3C]'
    : 'group-hover:scale-110';

  return `
    <div class="relative flex flex-col items-center cursor-pointer group" style="transform:translate(-50%,-50%);">
      ${pulseHtml}
      <div class="w-8 h-8 rounded-full flex items-center justify-center shadow-md transition-transform duration-200 ${ringClass}"
           style="background:${color};border:2px solid #FFFFFF;">
        <span style="font-size:14px;">🚛</span>
      </div>
      <div class="mt-1 px-1.5 py-0.5 rounded shadow-sm text-[10px] font-mono font-bold whitespace-nowrap"
           style="background:#14171C;color:#FFFFFF;border:1px solid #E3E1DC;">
        ${escapeHtml(truck.plate_number)}
      </div>
      ${truck.iot_connection_number ? '' : '<div style="font:700 8px sans-serif;color:#9A3412;background:#FFF7ED;padding:1px 4px;border-radius:4px;white-space:nowrap">NO IoT</div>'}
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function FleetMap({
  trucks,
  selectedTruckId,
  onSelectTruck,
  routeCoordinates,
  remainingCoordinates,
  originCoords,
  destinationCoords,
  originName,
  destinationName,
  className = '',
  focusTruckId,
  height = '500px',
  showWarehousesByDefault = true,
}: FleetMapProps) {
  const mapContainerRef   = useRef<HTMLDivElement>(null);
  const mapRef            = useRef<any>(null);
  const mapReadyRef       = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [showWarehouses, setShowWarehouses] = useState(showWarehousesByDefault);
  const [warehouseCount, setWarehouseCount] = useState<number>(0);
  const warehouseLayerRef = useRef<any>(null);
  const markersRef        = useRef<Map<string, any>>(new Map());
  const trucksRef = useRef(trucks);
  const lastFitSignatureRef = useRef('');
  const polylineRef       = useRef<any>(null);
  const casingRef         = useRef<any>(null);
  const remainingPolylineRef = useRef<any>(null);
  const endpointMarkersRef= useRef<any[]>([]);

  // Keep latest callback in a ref so effects don't re-subscribe on every render
  const onSelectTruckRef = useRef(onSelectTruck);
  useEffect(() => { onSelectTruckRef.current = onSelectTruck; }, [onSelectTruck]);
  useEffect(() => { trucksRef.current = trucks; }, [trucks]);

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Initialize Leaflet map (once, client-side only)
  // ───────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let isMounted = true;

    async function initMap() {
      if (!mapContainerRef.current || mapReadyRef.current) return;

      const L = (await import('leaflet')).default;

      if (!isMounted || !mapContainerRef.current) return;

      // Fix default broken icon paths in Next.js
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
        iconUrl:       'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
        shadowUrl:     'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
      });

      const tileUrl = process.env.NEXT_PUBLIC_MAP_TILE_URL ||
        'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
      const attribution = process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ||
        "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors";

      const map = L.map(mapContainerRef.current, {
        center: [21.5, 78.5],
        zoom: 5,
        zoomControl: false,
        attributionControl: false,
      });

      // Custom AttributionControl with prefix: false to remove "Leaflet" branding
      L.control.attribution({
        prefix: false,
        position: 'bottomright',
      }).addTo(map);

      const tileOptions: any = {
        attribution,
        maxZoom: 19,
      };
      if (tileUrl.includes('{s}')) {
        tileOptions.subdomains = ['a', 'b', 'c'];
      }

      L.tileLayer(tileUrl, tileOptions).addTo(map);

      L.control.zoom({ position: 'topright' }).addTo(map);

      mapRef.current = map;
      mapReadyRef.current = true;
      setMapReady(true);

      // Invalidate size once DOM layout settles so tiles render completely without blank gaps
      setTimeout(() => {
        if (mapRef.current) {
          mapRef.current.invalidateSize();
        }
      }, 200);
    }

    initMap().catch(console.error);

    return () => {
      isMounted = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        mapReadyRef.current = false;
      }
    };
  }, []);

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Sync truck markers
  // ───────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const syncMarkers = async () => {
      const map = mapRef.current;
      if (!map) return;

      const L = (await import('leaflet')).default;
      const locatedTrucks = trucks.filter(
        (t) =>
        hasValidLocation(t)
      );

      const seenIds = new Set<string>();
      const fitSignature = locatedTrucks.map((t) => t.truck_id).sort().join('|');

      locatedTrucks.forEach((t) => {
        const id = t.truck_id;
        seenIds.add(id);
        const lat = t.location!.latitude;
        const lng = t.location!.longitude;
        const isSelected = selectedTruckId === id;

        const iconHtml = buildTruckIconHtml(t, isSelected);
        const icon = L.divIcon({
          html: iconHtml,
          className: 'custom-truck-icon',
          iconSize: [32, 48],
          iconAnchor: [16, 24],
        });

        if (markersRef.current.has(id)) {
          const marker = markersRef.current.get(id);
          marker.setLatLng([lat, lng]);
          marker.setIcon(icon);
          marker.unbindPopup();
          marker.bindPopup(buildTruckPopupHtml(t));
        } else {
          const marker = L.marker([lat, lng], { icon });
          marker.bindPopup(buildTruckPopupHtml(t));
          marker.on('click', () => {
            const currentTruck = trucksRef.current.find((item) => item.truck_id === id) || t;
            if (onSelectTruckRef.current) onSelectTruckRef.current(currentTruck);
          });
          marker.addTo(map);
          markersRef.current.set(id, marker);
        }
      });

      // Remove markers for trucks no longer in the list
      markersRef.current.forEach((marker: any, id: string) => {
        if (!seenIds.has(id)) {
          marker.remove();
          markersRef.current.delete(id);
        }
      });
      if (fitSignature !== lastFitSignatureRef.current && locatedTrucks.length) {
        lastFitSignatureRef.current = fitSignature;
        map.fitBounds(locatedTrucks.map((t) => [t.location!.latitude, t.location!.longitude]), {
          padding: [55, 55], maxZoom: 12,
        });
      }
    };

    syncMarkers().catch(console.error);
  }, [trucks, selectedTruckId, mapReady]);

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Focus truck (flyTo)
  // ───────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!focusTruckId || !mapRef.current) return;
    const truck = trucks.find((t) => t.truck_id === focusTruckId);
    if (!truck?.location) return;
    const { latitude, longitude } = truck.location;
    mapRef.current.flyTo([latitude, longitude], 13, { duration: 1.2 });
  }, [focusTruckId, trucks]);

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Route polyline + endpoint markers
  // ───────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const syncRoute = async () => {
      const map = mapRef.current;
      if (!map) return;

      const L = (await import('leaflet')).default;

      // The planned route is stable for the shipment. Update its layer only
      // when the shipment changes; GPS updates only touch the remaining leg.
      if (polylineRef.current) {
        polylineRef.current.remove();
        polylineRef.current = null;
      }
      if (casingRef.current) {
        casingRef.current.remove();
        casingRef.current = null;
      }

      // Clear previous endpoint markers
      endpointMarkersRef.current.forEach((m) => m.remove());
      endpointMarkersRef.current = [];

      // Draw route beneath markers with a subtle casing and bright blue line.
      if (routeCoordinates && routeCoordinates.length > 1) {
        casingRef.current = L.polyline(routeCoordinates, {
          color: '#FFFFFF', weight: 10, opacity: 0.9,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(map);
        const polyline = L.polyline(routeCoordinates, {
          color: '#2563EB', weight: 6, opacity: 0.9,
          lineCap: 'round', lineJoin: 'round',
        }).addTo(map);
        polylineRef.current = polyline;
        map.fitBounds(polyline.getBounds(), { padding: [50, 50] });
      }

      // Origin marker (A)
      if (originCoords) {
        const originHtml = `
          <div style="display:flex;align-items:center;gap:5px;white-space:nowrap;transform:translate(-50%,-50%);">
            <span style="display:flex;align-items:center;justify-content:center;width:25px;height:25px;border-radius:50%;background:#2E7D5B;border:2px solid #fff;color:#fff;font-weight:700;box-shadow:0 2px 7px #0004">A</span>
            <span style="padding:3px 6px;border-radius:4px;background:#fff;color:#2E7D5B;border:1px solid #2E7D5B;font:bold 10px sans-serif">SOURCE</span>
          </div>
        `;
        const originIcon = L.divIcon({ html: originHtml, className: 'endpoint-icon', iconSize: [100, 30], iconAnchor: [12, 12] });
        const mOrigin = L.marker(originCoords, { icon: originIcon }).addTo(map);
        if (originName) mOrigin.bindPopup(`<b>Source:</b> ${escapeHtml(originName)}`);
        endpointMarkersRef.current.push(mOrigin);
      }

      // Destination marker (B)
      if (destinationCoords) {
        const destHtml = `
          <div style="display:flex;align-items:center;gap:5px;white-space:nowrap;transform:translate(-50%,-50%);">
            <span style="display:flex;align-items:center;justify-content:center;width:25px;height:25px;border-radius:50%;background:#A3262A;border:2px solid #fff;color:#fff;font-weight:700;box-shadow:0 2px 7px #0004">B</span>
            <span style="padding:3px 6px;border-radius:4px;background:#fff;color:#A3262A;border:1px solid #A3262A;font:bold 10px sans-serif">DESTINATION</span>
          </div>
        `;
        const destIcon = L.divIcon({ html: destHtml, className: 'endpoint-icon', iconSize: [135, 30], iconAnchor: [12, 12] });
        const mDest = L.marker(destinationCoords, { icon: destIcon }).addTo(map);
        if (destinationName) mDest.bindPopup(`<b>Destination:</b> ${escapeHtml(destinationName)}`);
        endpointMarkersRef.current.push(mDest);
      }
    };

    syncRoute().catch(console.error);
  }, [mapReady, routeCoordinates, originCoords, destinationCoords, originName, destinationName]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const map = mapRef.current;
      if (!map) return;
      const L = (await import('leaflet')).default;
      if (cancelled) return;
      if (remainingPolylineRef.current) {
        remainingPolylineRef.current.remove();
        remainingPolylineRef.current = null;
      }
      if (remainingCoordinates && remainingCoordinates.length > 1) {
        remainingPolylineRef.current = L.polyline(remainingCoordinates, {
          color: '#7C8798', weight: 3, opacity: 0.8, dashArray: '5, 7',
          lineCap: 'round', lineJoin: 'round',
        }).addTo(map);
      }
    })();
    return () => { cancelled = true; };
  }, [mapReady, remainingCoordinates]);

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Cold-storage warehouses layer (Canvas-rendered for smooth 4,900+ points)
  // ───────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const map = mapRef.current;
      if (!map || !mapReady) return;

      if (!showWarehouses) {
        if (warehouseLayerRef.current) {
          warehouseLayerRef.current.remove();
        }
        return;
      }

      const L = (await import('leaflet')).default;
      const warehouses = await loadWarehouses();
      if (cancelled || !mapRef.current) return;

      setWarehouseCount(warehouses.length);

      if (!warehouseLayerRef.current) {
        const renderer = L.canvas({ padding: 0.5 });
        const group = L.layerGroup();
        for (const w of warehouses) {
          const marker = L.circleMarker([w.la, w.lo], {
            renderer,
            radius: 4,
            color: '#0369A1',
            fillColor: '#38BDF8',
            fillOpacity: 0.85,
            weight: 1,
          });
          marker.bindPopup(
            `<strong>❄️ ${escapeHtml(w.n)}</strong><br/>${escapeHtml(w.d)}${w.d && w.s ? ', ' : ''}${escapeHtml(w.s)}<br/><span style="font-size:11px;color:#5B6470">${w.la.toFixed(4)}, ${w.lo.toFixed(4)}</span>`,
          );
          marker.addTo(group);
        }
        warehouseLayerRef.current = group;
      }

      if (!map.hasLayer(warehouseLayerRef.current)) {
        warehouseLayerRef.current.addTo(map);
      }
    })().catch(console.error);

    return () => {
      cancelled = true;
    };
  }, [mapReady, showWarehouses]);

  // ───────────────────────────────────────────────────────────────────────────
  // Fit all fleet trucks in view
  // ───────────────────────────────────────────────────────────────────────────
  const fitAllTrucks = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const locatedTrucks = trucks.filter(hasValidLocation);
    if (locatedTrucks.length === 0) return;
    const bounds = locatedTrucks.map((t) => [t.location!.latitude, t.location!.longitude] as [number, number]);
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 });
  }, [trucks]);

  // ───────────────────────────────────────────────────────────────────────────
  // Render
  // ───────────────────────────────────────────────────────────────────────────
  const tileProvider = 'OpenStreetMap';

  return (
    <div
      className={`relative w-full rounded overflow-hidden border ${className}`}
      style={{ height, borderColor: 'var(--color-hairline)' }}
    >
      {/* Leaflet map canvas */}
      <div ref={mapContainerRef} className="w-full h-full" style={{ background: '#F7F6F3' }} />

      {/* Floating controls — top-left */}
      <div className="absolute top-3 left-3 z-[400] flex flex-wrap gap-2">
        <button
          onClick={fitAllTrucks}
          className="px-3 py-1.5 rounded shadow-sm text-xs font-medium border transition-colors flex items-center gap-1.5"
          style={{
            background: 'var(--color-paper)',
            borderColor: 'var(--color-hairline)',
            color: 'var(--color-ink)',
          }}
          title="Fit all fleet vehicles in view"
        >
          <span>🎯</span> Fit All Fleet
        </button>
        <button
          onClick={() => setShowWarehouses((prev) => !prev)}
          className="px-3 py-1.5 rounded shadow-sm text-xs font-medium border transition-colors flex items-center gap-1.5"
          style={{
            background: showWarehouses ? '#E0F2FE' : 'var(--color-paper)',
            borderColor: showWarehouses ? '#0284C7' : 'var(--color-hairline)',
            color: showWarehouses ? '#0369A1' : 'var(--color-ink)',
          }}
          title="Toggle India cold-storage warehouses layer"
        >
          <span>❄️</span> Warehouses{warehouseCount ? ` (${warehouseCount.toLocaleString()})` : ''}
        </button>
      </div>

      {/* Legend — bottom-left */}
      <div
        className="absolute bottom-3 left-3 z-[400] px-3 py-2 rounded shadow-sm text-[11px] border backdrop-blur-sm flex items-center gap-3"
        style={{
          background: 'rgba(255,255,255,0.94)',
          borderColor: 'var(--color-hairline)',
          color: 'var(--color-slate)',
        }}
      >
        <span className="font-semibold text-xs flex items-center gap-1.5" style={{ color: 'var(--color-ink)' }}>
          🗺️ {tileProvider}
        </span>
        <span className="h-3 w-px bg-neutral-300" />
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#2E7D5B' }} /> Available
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#2F5D8A' }} /> On Trip
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#C9962B' }} /> Maintenance
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full border border-[#0369A1]" style={{ background: '#38BDF8' }} /> Warehouse
        </span>
      </div>
    </div>
  );
}
