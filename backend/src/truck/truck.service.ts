import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import { NeonService } from '../neon/neon.service';
import { IotService } from '../iot/iot.service';

@Injectable()
export class TruckService {
  constructor(
    private readonly neonService: NeonService,
    private readonly iotService: IotService,
  ) {}

  private get sql() {
    const s = this.neonService.getSql();
    if (!s) throw new Error('Database not available');
    return s;
  }

  async getMyTruckForDriver(driverId: string) {
    const rows = await this.sql(
      `SELECT u.id AS assignment_driver_id, u.name AS assignment_driver_name,
              u.email AS assignment_driver_email, t.*,
              CASE WHEN t.insurance_expiry <= CURRENT_DATE + INTERVAL '7 days' THEN true ELSE false END AS insurance_expiring,
              CASE WHEN t.permit_expiry <= CURRENT_DATE + INTERVAL '7 days' THEN true ELSE false END AS permit_expiring,
              CASE WHEN t.fitness_expiry <= CURRENT_DATE + INTERVAL '7 days' THEN true ELSE false END AS fitness_expiring
       FROM users u
       LEFT JOIN trucks t ON t.id = u.truck_id AND t.owner_id = u.owner_id AND t.active = true
       WHERE u.id = $1 AND u.role = 'truckUser' AND u.active = true
       LIMIT 1`,
      [driverId],
    );
    if (!rows.length) return null;
    const row = rows[0];
    const driver = {
      id: row.assignment_driver_id,
      name: row.assignment_driver_name,
      email: row.assignment_driver_email,
    };
    const { assignment_driver_id, assignment_driver_name, assignment_driver_email, ...truckFields } = row;
    return { driver, truck: truckFields.id ? truckFields : null };
  }

  async getMyTruck(truckId: string) {
    const rows = await this.sql(
      `SELECT t.*,
        u.name AS driver_name,
        CASE WHEN t.insurance_expiry <= CURRENT_DATE + INTERVAL '7 days' THEN true ELSE false END AS insurance_expiring,
        CASE WHEN t.permit_expiry <= CURRENT_DATE + INTERVAL '7 days' THEN true ELSE false END AS permit_expiring,
        CASE WHEN t.fitness_expiry <= CURRENT_DATE + INTERVAL '7 days' THEN true ELSE false END AS fitness_expiring
       FROM trucks t
       LEFT JOIN users u ON u.truck_id = t.id AND u.active = true
       WHERE t.id = $1 AND t.active = true`,
      [truckId],
    );
    return rows[0] || null;
  }

  async getActiveTrip(truckId: string) {
    const rows = await this.sql(
      `SELECT * FROM trips WHERE truck_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
      [truckId],
    );
    return rows[0] || null;
  }

  async startTrip(
    userId: string,
    truckId: string,
    data: { origin: string; destination: string; cargo_type: string; notes?: string },
  ) {
    if (!data.origin?.trim() || !data.destination?.trim() || !data.cargo_type?.trim()) {
      throw new BadRequestException('Origin, destination, and cargo type are required.');
    }
    // Check no active trip
    const active = await this.getActiveTrip(truckId);
    if (active) throw new BadRequestException('Trip already in progress for this truck.');

    const rows = await this.sql(
      `WITH new_trip AS (
         INSERT INTO trips (truck_id, user_id, origin, destination, cargo_type, notes)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
       ), update_truck AS (
         UPDATE trucks SET status = 'on_trip' WHERE id = $1
       ) SELECT * FROM new_trip`,
      [truckId, userId, data.origin, data.destination, data.cargo_type, data.notes || null],
    );
    return rows[0];
  }

  async endTrip(userId: string, truckId: string, tripId: string) {
    const rows = await this.sql(
      `WITH ended_trip AS (
         UPDATE trips SET ended_at = NOW()
         WHERE id = $1 AND truck_id = $2 AND user_id = $3 AND ended_at IS NULL
         RETURNING *
       ), update_truck AS (
         UPDATE trucks SET status = 'available'
         WHERE id = $2 AND EXISTS (SELECT 1 FROM ended_trip)
       ) SELECT * FROM ended_trip`,
      [tripId, truckId, userId],
    );
    if (!rows.length) throw new ForbiddenException('No active trip found to end.');

    return rows[0];
  }

  async setTargetTemp(truckId: string, targetTempC: number) {
    if (targetTempC < -30 || targetTempC > 25) {
      throw new BadRequestException('Target temperature must be between -30°C and +25°C');
    }
    const rows = await this.sql(
      `UPDATE trucks SET target_temp_c = $1 WHERE id = $2 RETURNING target_temp_c`,
      [targetTempC, truckId],
    );
    return rows[0];
  }

  async reportIssue(userId: string, truckId: string, description: string) {
    if (!description?.trim()) throw new BadRequestException('Issue description is required.');
    const rows = await this.sql(
      `INSERT INTO issues (truck_id, reported_by, description) VALUES ($1, $2, $3) RETURNING *`,
      [truckId, userId, description.trim()],
    );
    return rows[0];
  }

  async getTripHistory(truckId: string) {
    return this.sql(
      `SELECT tr.*, u.name AS driver_name
       FROM trips tr LEFT JOIN users u ON u.id = tr.user_id
       WHERE tr.truck_id = $1 ORDER BY tr.started_at DESC LIMIT 20`,
      [truckId],
    );
  }

  async getMyIssues(truckId: string) {
    return this.sql(
      `SELECT * FROM issues WHERE truck_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [truckId],
    );
  }

  async getTelemetry(truckId: string) {
    const truck = await this.getMyTruck(truckId);
    if (!truck) throw new BadRequestException('Truck not found.');
    // 1. Check if an active IoT device is paired to this truck
    const iotData = this.iotService.getTelemetryForTruck(truckId);
    const connNumber = this.iotService.getConnectionForTruck(truckId) || truck.iot_connection_number;

    if (iotData) {
      return {
        isIotConnected: true,
        connectionNumber: connNumber,
        latest: {
          ...iotData,
          truck_id: truckId,
          plate_number: truck.plate_number,
        },
        history: [],
      };
    }

    // Return persisted telemetry only. Never synthesize cargo readings or
    // coordinates for a truck whose paired device has no live report.
    const history = await this.sql(
      `SELECT * FROM trip_telemetry_history WHERE truck_id = $1 ORDER BY recorded_at DESC LIMIT 30`,
      [truckId],
    );
    return {
      isIotConnected: false,
      connectionNumber: connNumber || null,
      latest: history[0] || null,
      history,
    };
  }
}
