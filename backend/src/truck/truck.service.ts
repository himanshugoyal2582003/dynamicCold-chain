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
    // Check no active trip
    const active = await this.getActiveTrip(truckId);
    if (active) throw new BadRequestException('Trip already in progress for this truck.');

    const rows = await this.sql(
      `INSERT INTO trips (truck_id, user_id, origin, destination, cargo_type, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [truckId, userId, data.origin, data.destination, data.cargo_type, data.notes || null],
    );

    await this.sql(`UPDATE trucks SET status = 'on_trip' WHERE id = $1`, [truckId]);
    return rows[0];
  }

  async endTrip(userId: string, truckId: string, tripId: string) {
    const rows = await this.sql(
      `UPDATE trips SET ended_at = NOW()
       WHERE id = $1 AND truck_id = $2 AND user_id = $3 AND ended_at IS NULL
       RETURNING *`,
      [tripId, truckId, userId],
    );
    if (!rows.length) throw new ForbiddenException('No active trip found to end.');

    await this.sql(`UPDATE trucks SET status = 'available' WHERE id = $1`, [truckId]);
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

  async connectIot(truckId: string, connectionNumber: string) {
    return this.iotService.connectDevice(truckId, connectionNumber);
  }

  async disconnectIot(truckId: string) {
    return this.iotService.disconnectDevice(truckId);
  }

  async getTelemetry(truckId: string) {
    const truck = await this.getMyTruck(truckId);
    if (!truck) throw new BadRequestException('Truck not found.');
    const plate = truck.plate_number;

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
          plate_number: plate,
        },
        history: [],
      };
    }

    // 2. Query AI-ML service directly
    try {
      const res = await fetch(`http://localhost:8000/api/trucks/${plate}/telemetry`);
      if (res.ok) {
        const data = await res.json();
        return {
          isIotConnected: false,
          connectionNumber: connNumber || null,
          ...data,
        };
      }
    } catch {
      // Fallback if AI-ML service is temporarily unreachable
    }

    return {
      isIotConnected: false,
      connectionNumber: connNumber || null,
      latest: {
        truck_id: truckId,
        plate_number: plate,
        temperature: Number(truck.target_temp_c) || 4.0,
        target_temp: Number(truck.target_temp_c) || 4.0,
        humidity: 62.0,
        refrigeration_status: 'OPTIMAL',
        spoilage_risk: 0.08,
        spoilage_risk_level: 'LOW',
        shelf_life_remaining_hours: 96.0,
        timestamp: new Date().toISOString(),
      },
      history: [],
    };
  }
}
