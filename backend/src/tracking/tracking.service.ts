import {
  Injectable,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { NeonService } from '../neon/neon.service';
import { TrackingGateway } from './tracking.gateway';
import { UpdateLocationDto } from './dto/update-location.dto';

// Known coordinates for common cities in India for route calculation & distance
const CITY_COORDS: Record<string, [number, number]> = {
  'mumbai': [18.9400, 72.8350],
  'delhi': [28.6139, 77.2090],
  'bangalore': [12.9716, 77.5946],
  'hyderabad': [17.3850, 78.4867],
  'pune': [18.5204, 73.8567],
  'chennai': [13.0827, 80.2707],
  'kolkata': [22.5726, 88.3639],
  'ahmedabad': [23.0225, 72.5714],
  'jaipur': [26.9124, 75.7873],
  'surat': [21.1702, 72.8311],
  'vadodara': [22.3072, 73.1812],
  'kurnool': [15.8281, 78.0373],
};

function findCityCoords(text: string): [number, number] | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [city, coords] of Object.entries(CITY_COORDS)) {
    if (lower.includes(city)) return coords;
  }
  return null;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

@Injectable()
export class TrackingService {
  constructor(
    private readonly neonService: NeonService,
    private readonly trackingGateway: TrackingGateway,
  ) { }

  private get sql() {
    const s = this.neonService.getSql();
    if (!s) throw new Error('Database not available');
    return s;
  }

  /**
   * POST /api/tracking/location — driver only
   * truckId is sourced exclusively from req.user.truckId (never from body)
   */
  async updateLocation(truckId: string, userId: string, dto: UpdateLocationDto) {
    const recordedAt = new Date(dto.timestamp);
    const now = new Date();
    const diffMs = now.getTime() - recordedAt.getTime();
    const fiveMinutes = 5 * 60 * 1000;
    if (diffMs > fiveMinutes) {
      throw new BadRequestException('Timestamp is more than 5 minutes in the past.');
    }
    if (diffMs < -30000) {
      throw new BadRequestException('Timestamp is in the future.');
    }

    // Verify truck is active and driver is assigned
    const truckRows = await this.sql(
      `SELECT t.id, t.owner_id, t.plate_number, t.active, t.status
       FROM trucks t
       INNER JOIN users u ON u.truck_id = t.id AND u.id = $2 AND u.active = true
       WHERE t.id = $1 AND t.active = true`,
      [truckId, userId],
    );
    if (!truckRows.length) {
      throw new ForbiddenException('Truck not found, inactive, or you are not assigned to it.');
    }
    const truck = truckRows[0];

    const speedKmh = dto.speed_kmh ?? 0;
    const heading = dto.heading ?? 0;
    const accuracyM = dto.accuracy_m ?? null;

    // Persist the latest fix and breadcrumb together so the current position
    // cannot advance without its corresponding history record.
    await this.neonService.runTransaction([
      {
        text: `INSERT INTO truck_locations (truck_id, latitude, longitude, speed_kmh, heading, accuracy_m, recorded_at, received_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
               ON CONFLICT (truck_id) DO UPDATE SET
                 latitude = EXCLUDED.latitude,
                 longitude = EXCLUDED.longitude,
                 speed_kmh = EXCLUDED.speed_kmh,
                 heading = EXCLUDED.heading,
                 accuracy_m = EXCLUDED.accuracy_m,
                 recorded_at = EXCLUDED.recorded_at,
                 received_at = CURRENT_TIMESTAMP`,
        values: [truckId, dto.latitude, dto.longitude, speedKmh, heading, accuracyM, recordedAt.toISOString()],
      },
      {
        text: `INSERT INTO truck_location_history (truck_id, latitude, longitude, speed_kmh, heading, accuracy_m, recorded_at, received_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
        values: [truckId, dto.latitude, dto.longitude, speedKmh, heading, accuracyM, recordedAt.toISOString()],
      },
    ]);

    // Real-time WebSocket broadcast to admin:fleet, owner:{ownerId}, and truck:{truckId}
    this.trackingGateway.broadcastLocationUpdate(truckId, truck.owner_id, {
      truckId,
      ownerId: truck.owner_id,
      plateNumber: truck.plate_number,
      latitude: dto.latitude,
      longitude: dto.longitude,
      speed_kmh: speedKmh,
      heading,
      accuracy_m: accuracyM,
      recorded_at: recordedAt.toISOString(),
      received_at: now.toISOString(),
      status: truck.status,
    });

    // Overspeed alert check (> 95 km/h for heavy commercial reefer)
    if (speedKmh > 95) {
      this.trackingGateway.broadcastAlert('overspeed', truckId, truck.owner_id, {
        truckId,
        ownerId: truck.owner_id,
        type: 'overspeed',
        message: `Truck ${truck.plate_number} exceeded commercial speed threshold: ${speedKmh.toFixed(1)} km/h`,
        severity: 'warning',
        timestamp: now.toISOString(),
      });
    }

    return {
      success: true,
      truck_id: truckId,
      timestamp: recordedAt.toISOString(),
    };
  }

  /**
   * GET /api/tracking/live
   * admin → all trucks with locations & active trips
   * owner → their trucks only
   * driver → their single truck
   */
  async getLiveLocations(role: string, userId: string, truckId?: string | null) {
    let whereClause = 'WHERE t.active = true';
    const params: any[] = [];

    if (role === 'owner') {
      params.push(userId);
      whereClause += ` AND t.owner_id = $${params.length}`;
    } else if (role === 'truckUser') {
      if (!truckId) throw new ForbiddenException('No truck assigned to your account.');
      params.push(truckId);
      whereClause += ` AND t.id = $${params.length}`;
    }

    const query = `
      SELECT 
        t.id AS truck_id,
        t.owner_id,
        u_owner.name AS owner_name,
        t.plate_number,
        t.type,
        t.capacity_tons,
        t.status,
        t.target_temp_c,
        t.iot_connection_number,
        d.last_seen AS iot_last_seen,
        d.battery AS iot_battery,
        d.power_on AS iot_power_on,
        d.reported_status AS iot_reported_status,
        u_driver.id AS driver_id,
        u_driver.name AS driver_name,
        u_driver.email AS driver_email,
        tr.id AS active_trip_id,
        tr.origin,
        tr.destination,
        tr.cargo_type,
        tr.status AS trip_status,
        tr.assigned_at,
        tr.started_at AS trip_started_at,
        tl.latitude,
        tl.longitude,
        tl.speed_kmh,
        tl.heading,
        tl.accuracy_m,
        tl.recorded_at,
        tl.received_at
      FROM trucks t
      LEFT JOIN users u_owner ON u_owner.id = t.owner_id
      LEFT JOIN iot_devices d ON d.connection_number = t.iot_connection_number AND d.active = true
      LEFT JOIN users u_driver ON u_driver.truck_id = t.id AND u_driver.active = true AND u_driver.role = 'truckUser'
      LEFT JOIN trips tr ON tr.truck_id = t.id AND tr.ended_at IS NULL
      LEFT JOIN truck_locations tl ON tl.truck_id = t.id
      ${whereClause}
      ORDER BY t.plate_number
    `;

    const rows = await this.sql(query, params);
    const now = new Date();

    return rows.map((row: any) => {
      const lastSeen = row.received_at ? new Date(row.received_at) : null;
      const staleSecs = lastSeen ? Math.floor((now.getTime() - lastSeen.getTime()) / 1000) : null;

      let gpsStatus: 'live' | 'stale' | 'no_data';
      if (!lastSeen || row.latitude === null || row.latitude === undefined) {
        gpsStatus = 'no_data';
      } else if (staleSecs !== null && staleSecs <= 300) {
        gpsStatus = 'live';
      } else {
        gpsStatus = 'stale';
      }

      return {
        truck_id: row.truck_id,
        owner_id: row.owner_id,
        owner_name: row.owner_name,
        plate_number: row.plate_number,
        type: row.type,
        capacity_tons: Number(row.capacity_tons),
        status: row.status,
        target_temp_c: Number(row.target_temp_c),
        iot_connection_number: row.iot_connection_number,
        iot_status: !row.iot_connection_number ? 'NO DEVICE PAIRED'
          : String(row.iot_reported_status || '').toLowerCase().includes('error') ? 'ERROR'
          : String(row.iot_reported_status || '').toLowerCase() === 'warning' ? 'ERROR'
          : row.iot_battery != null && Number(row.iot_battery) < 20 ? 'LOW BATTERY'
          : row.iot_last_seen && now.getTime() - new Date(row.iot_last_seen).getTime() <= 120000 && row.iot_power_on ? 'ONLINE' : 'OFFLINE',
        iot_last_seen: row.iot_last_seen ? new Date(row.iot_last_seen).toISOString() : null,
        iot_battery: row.iot_battery == null ? null : Number(row.iot_battery),
        driver: row.driver_id
          ? { id: row.driver_id, name: row.driver_name, email: row.driver_email }
          : null,
        active_trip: row.active_trip_id
          ? {
            id: row.active_trip_id,
            origin: row.origin,
            destination: row.destination,
            cargo_type: row.cargo_type,
            status: row.trip_status,
            assigned_at: row.assigned_at,
            started_at: row.trip_started_at,
          }
          : null,
        location:
          row.latitude !== null && row.latitude !== undefined
            ? {
              latitude: Number(row.latitude),
              longitude: Number(row.longitude),
              speed_kmh: Number(row.speed_kmh || 0),
              heading: Number(row.heading || 0),
              accuracy_m: row.accuracy_m ? Number(row.accuracy_m) : null,
              recorded_at: row.recorded_at,
              received_at: row.received_at,
            }
            : null,
        gps_status: gpsStatus,
        last_seen: lastSeen ? lastSeen.toISOString() : null,
        stale_seconds: staleSecs,
      };
    });
  }

  /**
   * GET /api/tracking/trucks/:truckId
   */
  async getTruckLocation(
    targetTruckId: string,
    role: string,
    userId: string,
    myTruckId?: string | null,
  ) {
    await this.assertTruckAccess(targetTruckId, role, userId, myTruckId);

    const rows = await this.sql(
      `SELECT t.id AS truck_id, t.plate_number, t.type, t.status, t.target_temp_c,
              tl.latitude, tl.longitude, tl.speed_kmh, tl.heading, tl.accuracy_m,
              tl.recorded_at, tl.received_at
       FROM trucks t
       LEFT JOIN truck_locations tl ON tl.truck_id = t.id
       WHERE t.id = $1 AND t.active = true`,
      [targetTruckId],
    );

    if (!rows.length) throw new NotFoundException('Truck not found.');
    const row = rows[0];
    const now = new Date();
    const lastSeen = row.received_at ? new Date(row.received_at) : null;
    const staleSecs = lastSeen ? Math.floor((now.getTime() - lastSeen.getTime()) / 1000) : null;

    return {
      truck_id: row.truck_id,
      plate_number: row.plate_number,
      type: row.type,
      status: row.status,
      target_temp_c: Number(row.target_temp_c),
      location:
        row.latitude !== null && row.latitude !== undefined
          ? {
            latitude: Number(row.latitude),
            longitude: Number(row.longitude),
            speed_kmh: Number(row.speed_kmh || 0),
            heading: Number(row.heading || 0),
            accuracy_m: row.accuracy_m ? Number(row.accuracy_m) : null,
            recorded_at: row.recorded_at,
            received_at: row.received_at,
          }
          : null,
      gps_status: !lastSeen ? 'no_data' : (staleSecs ?? 999) <= 300 ? 'live' : 'stale',
      last_seen: lastSeen ? lastSeen.toISOString() : null,
      stale_seconds: staleSecs,
    };
  }

  /**
   * GET /api/tracking/trucks/:truckId/history
   */
  async getTruckLocationHistory(
    targetTruckId: string,
    role: string,
    userId: string,
    myTruckId: string | null | undefined,
    limit: number,
    offset: number,
  ) {
    await this.assertTruckAccess(targetTruckId, role, userId, myTruckId);

    const rows = await this.sql(
      `SELECT id, truck_id, latitude, longitude, speed_kmh, heading, accuracy_m, recorded_at, received_at
       FROM truck_location_history
       WHERE truck_id = $1
       ORDER BY recorded_at DESC
       LIMIT $2 OFFSET $3`,
      [targetTruckId, limit, offset],
    );

    return rows.map((r: any) => ({
      id: r.id,
      truck_id: r.truck_id,
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      speed_kmh: Number(r.speed_kmh || 0),
      heading: Number(r.heading || 0),
      accuracy_m: r.accuracy_m ? Number(r.accuracy_m) : null,
      recorded_at: r.recorded_at,
      received_at: r.received_at,
    }));
  }

  /**
   * GET /api/tracking/trucks/:truckId/route
   * Returns active trip, destination, route waypoints, remaining distance, and ETA
   */
  async getTruckRoute(
    targetTruckId: string,
    role: string,
    userId: string,
    myTruckId?: string | null,
  ) {
    await this.assertTruckAccess(targetTruckId, role, userId, myTruckId);

    // 1. Truck info
    const truckRows = await this.sql(
      `SELECT id, plate_number, type, status, target_temp_c, iot_connection_number FROM trucks WHERE id = $1 AND active = true`,
      [targetTruckId],
    );
    if (!truckRows.length) throw new NotFoundException('Truck not found.');
    const truck = truckRows[0];

    // 2. Active trip
    const tripRows = await this.sql(
      `SELECT id, origin, destination, cargo_type, notes, started_at
       FROM trips
       WHERE truck_id = $1 AND ended_at IS NULL
       ORDER BY started_at DESC LIMIT 1`,
      [targetTruckId],
    );
    const activeTrip = tripRows.length ? tripRows[0] : null;

    // 3. Current location
    const locRows = await this.sql(
      `SELECT latitude, longitude, speed_kmh, heading, accuracy_m, recorded_at, received_at
       FROM truck_locations WHERE truck_id = $1`,
      [targetTruckId],
    );
    const currentLoc = locRows.length
      ? {
        latitude: Number(locRows[0].latitude),
        longitude: Number(locRows[0].longitude),
        speed_kmh: Number(locRows[0].speed_kmh || 0),
        heading: Number(locRows[0].heading || 0),
        accuracy_m: locRows[0].accuracy_m ? Number(locRows[0].accuracy_m) : null,
        recorded_at: locRows[0].recorded_at,
        received_at: locRows[0].received_at,
      }
      : null;

    // 4. Historical breadcrumb points for route playback
    const historyRows = await this.sql(
      `SELECT latitude, longitude, speed_kmh, recorded_at
       FROM truck_location_history
       WHERE truck_id = $1
       ORDER BY recorded_at ASC
       LIMIT 200`,
      [targetTruckId],
    );

    const breadcrumbs = historyRows.map((h: any) => ({
      latitude: Number(h.latitude),
      longitude: Number(h.longitude),
      speed_kmh: Number(h.speed_kmh || 0),
      recorded_at: h.recorded_at,
    }));

    // 5. Geofence status. Road distance and ETA are calculated in the tracking
    // map from the OSRM route and live telemetry; do not substitute straight-
    // line distance or a fallback speed here.
    const distanceRemainingKm: number | null = null;
    const etaMinutes: number | null = null;
    let geofenceStatus: 'at_origin' | 'in_transit' | 'approaching_destination' | 'arrived' =
      'in_transit';

    if (activeTrip && currentLoc) {
      const destCoords = findCityCoords(activeTrip.destination);
      const origCoords = findCityCoords(activeTrip.origin);

      if (destCoords) {
        const distanceToDestinationKm = haversineKm(
          currentLoc.latitude, currentLoc.longitude, destCoords[0], destCoords[1],
        );

        if (distanceToDestinationKm <= 2) {
          geofenceStatus = 'arrived';
        } else if (distanceToDestinationKm <= 25) {
          geofenceStatus = 'approaching_destination';
        } else if (
          origCoords &&
          haversineKm(currentLoc.latitude, currentLoc.longitude, origCoords[0], origCoords[1]) <= 5
        ) {
          geofenceStatus = 'at_origin';
        } else {
          geofenceStatus = 'in_transit';
        }
      }
    }

    return {
      truck: {
        id: truck.id,
        plate_number: truck.plate_number,
        type: truck.type,
        status: truck.status,
        target_temp_c: Number(truck.target_temp_c),
      },
      active_trip: activeTrip,
      current_location: currentLoc,
      breadcrumbs,
      distance_remaining_km: distanceRemainingKm,
      eta_minutes: etaMinutes,
      geofence_status: geofenceStatus,
    };
  }

  /**
   * GET /api/tracking/status
   */
  async getGpsStatus(role: string, userId: string, myTruckId?: string | null) {
    const live = await this.getLiveLocations(role, userId, myTruckId);
    return live.map((t: any) => ({
      truck_id: t.truck_id,
      plate_number: t.plate_number,
      truck_status: t.status,
      gps_status: t.gps_status,
      last_seen: t.last_seen,
      stale_seconds: t.stale_seconds,
      has_location: Boolean(t.location),
    }));
  }

  /**
   * Fleet tracking overview & intelligence metrics
   */
  async getFleetSummary(role: string, userId: string) {
    const trucks = await this.getLiveLocations(role, userId);
    const total = trucks.length;
    const onTrip = trucks.filter((t: any) => t.active_trip?.status === 'IN_PROGRESS').length;
    const available = trucks.filter((t: any) => t.status === 'available' && !t.active_trip).length;
    const maintenance = trucks.filter((t: any) => t.status === 'maintenance').length;
    const gpsLive = trucks.filter((t: any) => t.gps_status === 'live').length;
    const gpsStale = trucks.filter((t: any) => t.gps_status === 'stale').length;
    const gpsNoData = trucks.filter((t: any) => t.gps_status === 'no_data').length;

    return {
      total_trucks: total,
      on_trip_count: onTrip,
      available_count: available,
      maintenance_count: maintenance,
      gps_live_count: gpsLive,
      gps_stale_count: gpsStale,
      gps_offline_count: gpsNoData,
      iot_paired_count: trucks.filter((t: any) => Boolean(t.iot_connection_number)).length,
      iot_unpaired_count: trucks.filter((t: any) => !t.iot_connection_number).length,
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private async assertTruckAccess(
    targetTruckId: string,
    role: string,
    userId: string,
    myTruckId?: string | null,
  ) {
    if (role === 'admin') return;

    if (role === 'owner') {
      const rows = await this.sql(
        `SELECT id FROM trucks WHERE id = $1 AND owner_id = $2 AND active = true`,
        [targetTruckId, userId],
      );
      if (!rows.length) throw new ForbiddenException('You do not own this truck.');
      return;
    }

    // truckUser
    if (!myTruckId || myTruckId !== targetTruckId) {
      throw new ForbiddenException('You are not assigned to this truck.');
    }
  }
}
