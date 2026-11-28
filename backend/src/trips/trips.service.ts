import {
  BadRequestException, ConflictException, ForbiddenException, Injectable,
  NotFoundException, ServiceUnavailableException,
} from '@nestjs/common';
import { NeonService } from '../neon/neon.service';
import { TrackingGateway } from '../tracking/tracking.gateway';

const TRIP_STATUSES = ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

interface FleetApproval {
  ownerId: string;
  shipmentId: string;
  profileRevision: number;
  healthWindow: string;
  durationSeconds: number;
  expiresAt: string;
}

@Injectable()
export class TripsService {
  constructor(private readonly neon: NeonService, private readonly gateway: TrackingGateway) {}

  private get sql() {
    const sql = this.neon.getSql();
    if (!sql) throw new ServiceUnavailableException('Persistent database is unavailable.');
    return sql;
  }

  async getResources(role: string, userId: string) {
    if (!['admin', 'owner'].includes(role)) throw new ForbiddenException('Trip assignment is available to administrators and fleet owners.');
    const ownerFilter = role === 'owner' ? 'AND t.owner_id = $1::uuid' : '';
    const driverOwnerFilter = role === 'owner' ? 'AND d.owner_id = $1::uuid' : '';
    const params = role === 'owner' ? [userId] : [];
    const trucks = await this.sql(
      `SELECT t.id, t.owner_id, owner.name AS owner_name, t.plate_number, t.type,
              t.status, t.active, t.iot_connection_number,
              CASE WHEN t.status = 'available' AND NOT EXISTS (
                SELECT 1 FROM trips tr WHERE tr.truck_id = t.id AND tr.status IN ('ASSIGNED','IN_PROGRESS')
              ) THEN true ELSE false END AS eligible,
              CASE WHEN t.iot_connection_number IS NULL THEN 'NO DEVICE PAIRED'
                   WHEN d.reported_status ILIKE '%error%' OR d.reported_status = 'warning' THEN 'ERROR'
                   WHEN d.battery < 20 THEN 'LOW BATTERY'
                   WHEN d.last_seen >= NOW() - INTERVAL '2 minutes' AND d.power_on THEN 'ONLINE'
                   ELSE 'OFFLINE' END AS iot_status
       FROM trucks t LEFT JOIN users owner ON owner.id = t.owner_id
       LEFT JOIN iot_devices d ON d.connection_number = t.iot_connection_number
       WHERE t.active = true ${ownerFilter} ORDER BY t.plate_number`, params,
    );
    const drivers = await this.sql(
      `SELECT d.id, d.name, d.email, d.owner_id, d.truck_id, t.plate_number,
              CASE WHEN d.active = true AND t.active = true AND t.status = 'available'
                AND NOT EXISTS (SELECT 1 FROM trips tr WHERE tr.user_id = d.id AND tr.status IN ('ASSIGNED','IN_PROGRESS'))
                AND NOT EXISTS (SELECT 1 FROM trips tr WHERE tr.truck_id = t.id AND tr.status IN ('ASSIGNED','IN_PROGRESS'))
                THEN true ELSE false END AS eligible
       FROM users d LEFT JOIN trucks t ON t.id = d.truck_id
       WHERE d.role = 'truckUser' AND d.active = true AND d.truck_id IS NOT NULL ${driverOwnerFilter}
       ORDER BY d.name`, params,
    );
    return { trucks, drivers };
  }

  async createTrip(actor: { sub: string; role: string; truckId?: string | null }, input: {
    truck_id: string; user_id: string; origin: string; destination: string; cargo_type: string; notes?: string;
  }, approval?: FleetApproval) {
    if (!['admin', 'owner', 'truckUser'].includes(actor.role)) throw new ForbiddenException('Only administrators, fleet owners, and assigned drivers can assign trips.');
    if (actor.role === 'truckUser' && (!actor.truckId || input.truck_id !== actor.truckId || input.user_id !== actor.sub)) {
      throw new ForbiddenException('Drivers can only assign trips to their own assigned truck.');
    }
    if (typeof input.origin !== 'string' || typeof input.destination !== 'string' || typeof input.cargo_type !== 'string') {
      throw new BadRequestException('Origin, destination, and cargo_type are required.');
    }
    if (input.notes !== undefined && input.notes !== null && typeof input.notes !== 'string') {
      throw new BadRequestException('Shipment notes must be text.');
    }
    const origin = input.origin.trim();
    const destination = input.destination.trim();
    const cargoType = input.cargo_type.trim();
    const notes = input.notes?.trim() || null;
    if (!origin || origin.length > 255 || !destination || destination.length > 255) throw new BadRequestException('Origin and destination are required and must be at most 255 characters.');
    if (!cargoType || cargoType.length > 100) throw new BadRequestException('Cargo type is required and must be at most 100 characters.');
    if (notes && notes.length > 4000) throw new BadRequestException('Shipment notes must be at most 4000 characters.');

    let results: any[][];
    try {
      results = await this.neon.runTransaction([
        ...(approval ? [
          {
            text: `SELECT id FROM fleet_shipments WHERE id=$1 AND owner_id=$2 FOR UPDATE`,
            values: [approval.shipmentId, approval.ownerId],
          },
          {
            text: 'SELECT truck_id FROM fleet_dispatch_profiles WHERE truck_id=$1 FOR UPDATE',
            values: [input.truck_id],
          },
        ] : []),
        {
          text: `SELECT id, owner_id, status FROM trucks WHERE id = $1::uuid AND active = true FOR UPDATE`,
          values: [input.truck_id],
        },
        {
          text: `SELECT id, owner_id, truck_id FROM users WHERE id = $1::uuid AND role = 'truckUser' AND active = true FOR UPDATE`,
          values: [input.user_id],
        },
        {
          text: `WITH created AS (
                   INSERT INTO trips (truck_id, user_id, origin, destination, cargo_type, notes, status, started_at)
                   SELECT t.id, d.id, $3::text, $4::text, $5::text, $6, 'ASSIGNED', NULL
                   FROM trucks t JOIN users d ON d.id = $2::uuid
                   WHERE t.id = $1::uuid AND t.active = true AND t.status = 'available'
                     AND d.role = 'truckUser' AND d.active = true AND d.owner_id = t.owner_id
                     AND d.truck_id = t.id
                     AND ($7::text <> 'owner' OR t.owner_id = $8::uuid)
                     AND NOT EXISTS (SELECT 1 FROM trips x WHERE (x.truck_id = t.id OR x.user_id = d.id)
                       AND x.status IN ('ASSIGNED','IN_PROGRESS'))
                     ${approval ? `AND t.owner_id=$11::uuid AND clock_timestamp() < $15::timestamptz
                       AND EXISTS (SELECT 1 FROM users u JOIN users fleet ON fleet.id=t.owner_id AND fleet.active AND fleet.role='owner'
                         WHERE u.id=$9::uuid AND u.active AND u.role=$7 AND u.role IN ('owner','admin'))
                       AND EXISTS (
                         SELECT 1 FROM fleet_shipments s JOIN fleet_dispatch_profiles p ON p.truck_id=t.id AND p.owner_id=t.owner_id
                         WHERE s.id=$10 AND s.owner_id=t.owner_id AND s.trip_id IS NULL AND NOT s.synthetic AND NOT p.synthetic
                           AND s.origin=$3::text AND s.destination=$4::text AND s.cargo_type=$5::text
                           AND p.revision=$12 AND s.weight_tons <= p.usable_tons AND p.usable_tons <= t.capacity_tons
                           AND p.target_c=t.target_temp_c
                           AND lower(s.cargo_type)=ANY(p.cargo_types) AND p.verified_at >= now()-interval '30 minutes'
                           AND clock_timestamp()+$14::integer*interval '1 second' <= s.deadline
                           AND clock_timestamp()+$14::integer*interval '1 second' < s.shelf_life_until
                       )
                       AND EXISTS (SELECT 1 FROM (
                         SELECT a.score,a.severity,a.last_observed_at,a.window_end FROM maintenance_assessments a
                         WHERE a.truck_id=t.id AND a.connection_number=upper(btrim(t.iot_connection_number))
                           AND a.target_c=t.target_temp_c ORDER BY a.window_end DESC LIMIT 1
                       ) health WHERE health.window_end=$13 AND health.score IS NOT NULL
                         AND health.severity IN ('normal','watch')
                         AND health.last_observed_at BETWEEN clock_timestamp()-interval '15 minutes' AND clock_timestamp()+interval '5 seconds')
                       AND NOT EXISTS (SELECT 1 FROM rescue_events e WHERE e.truck_id=t.id
                         AND e.status IN ('DETECTED','RECOMMENDED','PENDING_APPROVAL','APPROVED','REROUTING'))` : ''}
                   RETURNING *
                 )${approval ? `, linked AS (
                   UPDATE fleet_shipments s SET trip_id=created.id FROM created WHERE s.id=$10 RETURNING s.id
                 )` : ''}, audit AS (
                   INSERT INTO activity_log (actor_id, action, entity, entity_id, details)
                   SELECT $9::uuid, 'TRIP_ASSIGNED', 'TRIP', id,
                     jsonb_build_object('truck_id', truck_id, 'driver_id', user_id, 'origin', origin, 'destination', destination)
                   FROM created
                 ) SELECT * FROM created`,
          values: [input.truck_id, input.user_id, origin, destination, cargoType, notes, actor.role, actor.sub, actor.sub,
            ...(approval ? [approval.shipmentId,approval.ownerId,approval.profileRevision,approval.healthWindow,
              approval.durationSeconds,approval.expiresAt] : [])],
        },
      ]);
    } catch (error: any) {
      if (error?.code === '23505') throw new ConflictException('The truck or driver already has an assigned or in-progress trip.');
      if (error?.code === '22P02') throw new BadRequestException('Truck and driver IDs must be valid UUIDs.');
      throw error;
    }
    const truck = results[approval ? 2 : 0]?.[0];
    const driver = results[approval ? 3 : 1]?.[0];
    const created = results.at(-1)?.[0];
    if (approval && !created) throw new ConflictException('Fleet conditions changed or the quote expired. Re-run the plan.');
    if (!truck) throw new NotFoundException('Active truck not found.');
    if (actor.role === 'owner' && truck.owner_id !== actor.sub) throw new ForbiddenException('You cannot assign a trip outside your fleet.');
    if (!driver || driver.owner_id !== truck.owner_id || driver.truck_id !== truck.id) {
      throw new BadRequestException('Select an active driver assigned to this truck and fleet.');
    }
    if (truck.status !== 'available') throw new ConflictException('The selected truck is not available for a new trip.');
    if (!created) throw new ConflictException('The truck or driver is already committed to an active trip.');
    const trip = await this.getTripById(created.id, actor.role, actor.sub);
    this.gateway.broadcastTripUpdate(trip, 'trip:assigned');
    return { success: true, trip };
  }

  async listTrips(role: string, userId: string, filters: { ownerId?: string; truckId?: string; driverId?: string; status?: string }) {
    if (!['admin', 'owner'].includes(role)) throw new ForbiddenException('Use the authenticated driver trip history endpoint.');
    if (filters.status && !TRIP_STATUSES.includes(filters.status.toUpperCase())) throw new BadRequestException('Invalid trip status filter.');
    const clauses = ['1=1'];
    const values: unknown[] = [];
    if (role === 'owner') { values.push(userId); clauses.push(`t.owner_id = $${values.length}::uuid`); }
    else if (filters.ownerId) { values.push(filters.ownerId); clauses.push(`t.owner_id = $${values.length}::uuid`); }
    if (filters.truckId) { values.push(filters.truckId); clauses.push(`tr.truck_id = $${values.length}::uuid`); }
    if (filters.driverId) { values.push(filters.driverId); clauses.push(`tr.user_id = $${values.length}::uuid`); }
    if (filters.status) { values.push(filters.status.toUpperCase()); clauses.push(`tr.status = $${values.length}`); }
    const trips = await this.sql(
      `SELECT tr.*, t.plate_number, t.owner_id, owner.name AS owner_name,
              d.name AS driver_name, d.email AS driver_email
       FROM trips tr JOIN trucks t ON t.id = tr.truck_id
       LEFT JOIN users owner ON owner.id = t.owner_id
       LEFT JOIN users d ON d.id = tr.user_id
       WHERE ${clauses.join(' AND ')} ORDER BY tr.assigned_at DESC, tr.id DESC`,
      values,
    );
    return { success: true, trips };
  }

  async getTripById(id: string, role: string, userId: string) {
    const rows = await this.sql(
      `SELECT tr.*, t.plate_number, t.owner_id, owner.name AS owner_name,
              d.name AS driver_name, d.email AS driver_email
       FROM trips tr JOIN trucks t ON t.id = tr.truck_id
       LEFT JOIN users owner ON owner.id = t.owner_id
       LEFT JOIN users d ON d.id = tr.user_id
       WHERE tr.id = $1::uuid
         AND ($2::text = 'admin' OR ($2::text = 'owner' AND t.owner_id = $3::uuid) OR ($2::text = 'truckUser' AND tr.user_id = $3::uuid))`,
      [id, role, userId],
    );
    if (!rows.length) throw new NotFoundException('Trip not found or access denied.');
    return rows[0];
  }

  async getDriverTrip(userId: string, truckId?: string | null, inProgressOnly = false) {
    if (!truckId) return null;
    const rows = await this.sql(
      `SELECT tr.*, t.plate_number, t.owner_id
       FROM trips tr JOIN trucks t ON t.id = tr.truck_id
       WHERE tr.user_id = $1::uuid AND tr.truck_id = $2::uuid
         AND tr.status IN (${inProgressOnly ? "'IN_PROGRESS'" : "'ASSIGNED','IN_PROGRESS'"})
       ORDER BY tr.started_at DESC NULLS LAST LIMIT 1`,
      [userId, truckId],
    );
    return rows[0] || null;
  }

  async getDriverHistory(userId: string) {
    return this.sql(
      `SELECT tr.*, t.plate_number FROM trips tr JOIN trucks t ON t.id = tr.truck_id
       WHERE tr.user_id = $1::uuid ORDER BY tr.assigned_at DESC, tr.id DESC`,
      [userId],
    );
  }

  async startTrip(userId: string, truckId?: string | null) {
    if (!truckId) throw new ConflictException('No truck is assigned to your account.');
    const results = await this.neon.runTransaction([{
      text: `WITH started AS (
               UPDATE trips SET status = 'IN_PROGRESS', started_at = NOW()
               WHERE user_id = $1::uuid AND truck_id = $2::uuid AND status = 'ASSIGNED'
               RETURNING *
             ), updated_truck AS (
               UPDATE trucks SET status = 'on_trip' WHERE id = $2::uuid AND EXISTS (SELECT 1 FROM started)
             ), audit AS (
               INSERT INTO activity_log (actor_id, action, entity, entity_id, details)
               SELECT $1::uuid, 'TRIP_STARTED', 'TRIP', id, jsonb_build_object('truck_id', truck_id) FROM started
             ) SELECT * FROM started`,
      values: [userId, truckId],
    }]);
    const row = results[0]?.[0];
    if (!row) throw new ConflictException('No assigned trip is available to start.');
    const trip = await this.getTripById(row.id, 'truckUser', userId);
    this.gateway.broadcastTripUpdate(trip, 'trip:started');
    return { success: true, trip };
  }

  async completeTrip(userId: string, truckId: string | null | undefined, tripId: string) {
    if (!truckId) throw new ForbiddenException('No truck is assigned to your account.');
    const results = await this.neon.runTransaction([{
      text: `WITH completed AS (
               UPDATE trips SET status = 'COMPLETED', ended_at = NOW()
               WHERE id = $1::uuid AND user_id = $2::uuid AND truck_id = $3::uuid AND status = 'IN_PROGRESS'
               RETURNING *
             ), updated_truck AS (
               UPDATE trucks SET status = 'available' WHERE id = $3::uuid
                 AND EXISTS (SELECT 1 FROM completed)
                 AND NOT EXISTS (SELECT 1 FROM trips active WHERE active.truck_id = $3::uuid
                   AND active.id <> $1::uuid AND active.status IN ('ASSIGNED','IN_PROGRESS'))
             ), audit AS (
               INSERT INTO activity_log (actor_id, action, entity, entity_id, details)
               SELECT $2::uuid, 'TRIP_COMPLETED', 'TRIP', id,
                 jsonb_build_object('truck_id', truck_id, 'completed_at', ended_at) FROM completed
             ) SELECT * FROM completed`,
      values: [tripId, userId, truckId],
    }]);
    const row = results[0]?.[0];
    if (!row) throw new ConflictException('Only your in-progress trip can be completed.');
    const trip = await this.getTripById(row.id, 'truckUser', userId);
    this.gateway.broadcastTripUpdate(trip, 'trip:completed');
    return { success: true, trip };
  }

  async reopenCompletedTrip(adminId: string, tripId: string, reason: string) {
    const results = await this.neon.runTransaction([{
      text: `WITH reopened AS (
               UPDATE trips tr SET status = 'IN_PROGRESS', ended_at = NULL
               WHERE tr.id = $1::uuid AND tr.status = 'COMPLETED'
                 AND NOT EXISTS (
                   SELECT 1 FROM trips other WHERE other.id <> tr.id
                     AND (other.truck_id = tr.truck_id OR other.user_id = tr.user_id)
                     AND other.status IN ('ASSIGNED', 'IN_PROGRESS')
                 )
               RETURNING tr.*
             ), truck AS (
               UPDATE trucks t SET status = 'on_trip'
               FROM reopened r WHERE t.id = r.truck_id
             ), audit AS (
               INSERT INTO activity_log (actor_id, action, entity, entity_id, details)
               SELECT $2::uuid, 'TRIP_REOPENED_BY_ADMIN', 'TRIP', id,
                 jsonb_build_object('reason', $3::text, 'previous_status', 'COMPLETED', 'new_status', 'IN_PROGRESS')
               FROM reopened
             ) SELECT * FROM reopened`,
      values: [tripId, adminId, reason],
    }]);
    const reopened = results[0]?.[0];
    if (!reopened) throw new ConflictException('Only a completed trip without another committed trip can be reopened.');
    const trip = await this.getTripById(tripId, 'admin', adminId);
    this.gateway.broadcastTripUpdate(trip, 'trip:reopened');
    return { success: true, trip };
  }
}
