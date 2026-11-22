'use client';

import { useEffect, useRef, useState } from 'react';
import { geocodeAddress, GeocodedLocation } from '@/lib/geocoding';
import { getRoute, RoutingError } from '@/lib/routing';
import type { MapTruck } from '@/components/tracking/FleetMap';

const configuredMinSpeed = Number(process.env.NEXT_PUBLIC_ETA_MIN_SPEED_KMH || 5);
const MIN_ETA_SPEED_KMH = Number.isFinite(configuredMinSpeed) && configuredMinSpeed >= 0 ? configuredMinSpeed : 5;
const MIN_REROUTE_MOVEMENT_METERS = 300;
const MAX_REROUTE_INTERVAL_MS = 20_000;

export interface ShipmentRouteState {
  coordinates: [number, number][];
  remainingCoordinates: [number, number][];
  originCoords: [number, number] | null;
  destinationCoords: [number, number] | null;
  originResolvedName: string | null;
  destinationResolvedName: string | null;
  approximateEndpoints: boolean;
  remainingDistanceKm: number | null;
  etaText: string;
  status: string;
}

const EMPTY: ShipmentRouteState = {
  coordinates: [], remainingCoordinates: [], originCoords: null, destinationCoords: null,
  originResolvedName: null, destinationResolvedName: null, approximateEndpoints: false,
  remainingDistanceKm: null, etaText: 'Route unavailable', status: 'Route unavailable',
};

function validPoint(point: [number, number] | null): point is [number, number] {
  return !!point && Number.isFinite(point[0]) && Number.isFinite(point[1]) &&
    point[0] >= -90 && point[0] <= 90 && point[1] >= -180 && point[1] <= 180;
}

function haversineMeters(a: [number, number], b: [number, number]): number {
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(b[0] - a[0]);
  const dLng = radians(b[1] - a[1]);
  const term = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a[0])) * Math.cos(radians(b[0])) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(term), Math.sqrt(1 - term));
}

function formatEta(minutes: number): string {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${mins}m` : `${mins}m`;
}

function pointFrom(location: GeocodedLocation): [number, number] {
  return [Number(location.latitude), Number(location.longitude)];
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Unexpected tracking route error';
}

export function useShipmentRoute(truck: MapTruck | null): ShipmentRouteState {
  const tripId = truck?.active_trip?.id || '';
  const origin = truck?.active_trip?.origin?.trim() || '';
  const destination = truck?.active_trip?.destination?.trim() || '';
  const latitude = truck?.location?.latitude;
  const longitude = truck?.location?.longitude;
  const speed = truck?.location?.speed_kmh;
  const gpsStatus = truck?.gps_status;
  const [route, setRoute] = useState<ShipmentRouteState>(EMPTY);
  const [resolvedTripId, setResolvedTripId] = useState('');
  const remainingRequestId = useRef(0);
  const lastRemainingRequest = useRef<{ tripId: string; point: [number, number]; at: number } | null>(null);

  useEffect(() => {
    setResolvedTripId(tripId);
    setRoute(EMPTY);
    remainingRequestId.current += 1;
    lastRemainingRequest.current = null;
    if (!tripId || !origin || !destination) return;

    let cancelled = false;
    (async () => {
      try {
        const sourceGeo = await geocodeAddress(origin);
        const destinationGeo = await geocodeAddress(destination);
        const source = pointFrom(sourceGeo);
        const target = pointFrom(destinationGeo);
        if (!validPoint(source) || !validPoint(target)) throw new Error('Geocoder returned invalid endpoint coordinates');
        if (process.env.NODE_ENV === 'development') {
          console.info('[tracking:route] shipment endpoints', {
            tripId, origin, originCoordinates: source, originResolvedName: sourceGeo.displayName,
            destination, destinationCoordinates: target, destinationResolvedName: destinationGeo.displayName,
          });
        }
        const planned = await getRoute(source, target);
        if (cancelled) return;
        setRoute({
          coordinates: planned.coordinates,
          remainingCoordinates: [],
          originCoords: source,
          destinationCoords: target,
          originResolvedName: sourceGeo.displayName,
          destinationResolvedName: destinationGeo.displayName,
          approximateEndpoints: sourceGeo.approximate || destinationGeo.approximate,
          // Wait for the live truck-to-destination route before exposing a
          // remaining distance or calculating ETA; full trip distance is not
          // a valid substitute once the shipment is in motion.
          remainingDistanceKm: null,
          etaText: 'Waiting for movement',
          status: 'In Transit',
        });
      } catch (error) {
        if (cancelled) return;
        const status = error instanceof RoutingError || error instanceof Error ? error.message : 'Route calculation failed';
        if (process.env.NODE_ENV === 'development') console.error('[tracking:route] complete route failed', { tripId, origin, destination, error });
        setRoute({ ...EMPTY, status, etaText: status });
      }
    })();
    return () => { cancelled = true; };
  }, [tripId, origin, destination]);

  useEffect(() => {
    if (!route.destinationCoords || !route.coordinates.length) return;
    if (gpsStatus !== 'live') {
      setRoute((previous) => ({ ...previous, status: 'Location unavailable', etaText: 'Location unavailable' }));
      return;
    }
    const current: [number, number] = [Number(latitude), Number(longitude)];
    if (!validPoint(current)) {
      setRoute((previous) => ({ ...previous, status: 'Invalid truck GPS coordinates', etaText: 'Invalid truck GPS coordinates' }));
      return;
    }

    const previousRequest = lastRemainingRequest.current;
    const now = Date.now();
    if (previousRequest?.tripId === tripId &&
        route.status === 'In Transit' &&
        haversineMeters(previousRequest.point, current) < MIN_REROUTE_MOVEMENT_METERS &&
        now - previousRequest.at < MAX_REROUTE_INTERVAL_MS) return;

    const target = route.destinationCoords;
    const requestId = ++remainingRequestId.current;
    const timeout = setTimeout(async () => {
      lastRemainingRequest.current = { tripId, point: current, at: Date.now() };
      try {
        const remaining = await getRoute(current, target);
        if (requestId !== remainingRequestId.current) return;
        if (process.env.NODE_ENV === 'development') {
          const etaHours = Number(speed) > 0 ? remaining.distanceKm / Number(speed) : null;
          console.info('[tracking:eta] remaining route', {
            truckId: truck?.truck_id, truckCoordinates: current,
            destinationCoordinates: target, remainingDistanceKm: remaining.distanceKm,
            speedKmh: speed, etaHours,
          });
        }
        setRoute((previous) => ({
          ...previous, remainingCoordinates: remaining.coordinates,
          remainingDistanceKm: remaining.distanceKm, status: 'In Transit',
        }));
      } catch (error) {
        if (requestId !== remainingRequestId.current) return;
        const status = errorMessage(error);
        if (process.env.NODE_ENV === 'development') console.error('[tracking:route] remaining route failed', {
          truckId: truck?.truck_id, truckCoordinates: current, destinationCoordinates: target, error,
        });
        setRoute((previous) => ({ ...previous, status, etaText: status }));
      }
    }, 700);
    return () => clearTimeout(timeout);
  }, [tripId, latitude, longitude, gpsStatus, route.destinationCoords, route.coordinates.length]);

  const currentRoute = resolvedTripId === tripId ? route : EMPTY;
  const currentSpeed = Number(speed);
  let etaText = currentRoute.etaText;
  if (!tripId || !origin || !destination) etaText = 'Shipment endpoints unavailable';
  else if (gpsStatus !== 'live') etaText = 'Location unavailable';
  else if (currentRoute.status === 'In Transit' && currentRoute.remainingDistanceKm !== null) {
    etaText = !Number.isFinite(currentSpeed) || currentSpeed <= 0
      ? 'Waiting for movement'
      : currentSpeed < MIN_ETA_SPEED_KMH
        ? 'Waiting for movement'
        : formatEta(Math.round((currentRoute.remainingDistanceKm / currentSpeed) * 60));
  }

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development' || !currentRoute.remainingDistanceKm || !Number.isFinite(currentSpeed)) return;
    console.info('[tracking:eta] calculation', {
      truckId: truck?.truck_id,
      remainingRoadDistanceKm: currentRoute.remainingDistanceKm,
      currentSpeedKmh: currentSpeed,
      etaText,
      formulaHours: currentSpeed > 0 ? currentRoute.remainingDistanceKm / currentSpeed : null,
    });
  }, [truck?.truck_id, currentRoute.remainingDistanceKm, currentSpeed, etaText]);

  return { ...currentRoute, etaText };
}
