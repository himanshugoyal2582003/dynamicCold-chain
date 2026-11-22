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
      `SELECT * FROM trips WHERE truck_id = $1 AND status = 'IN_PROGRESS' ORDER BY started_at DESC LIMIT 1`,
      [truckId],
    );
    return rows[0] || null;
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

  async getTripHistory(driverId: string) {
    return this.sql(
      `SELECT tr.*, u.name AS driver_name, t.plate_number
       FROM trips tr LEFT JOIN users u ON u.id = tr.user_id
       JOIN trucks t ON t.id = tr.truck_id
       WHERE tr.user_id = $1 ORDER BY tr.assigned_at DESC, tr.id DESC`,
      [driverId],
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
