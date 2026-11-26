import { Injectable, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { NeonService } from '../neon/neon.service';

@Injectable()
export class OwnerService {
  private readonly logger = new Logger(OwnerService.name);
  constructor(private readonly neonService: NeonService) {}

  private get sql() {
    const s = this.neonService.getSql();
    if (!s) throw new Error('Database not available');
    return s;                                                                                                                                                                                       
    
  }

  async getMyTrucks(ownerId: string) {
    return this.sql(
      `SELECT t.*, 
        u.name AS driver_name, u.email AS driver_email,
        CASE
          WHEN t.insurance_expiry <= CURRENT_DATE + INTERVAL '7 days' THEN true ELSE false
        END AS insurance_expiring,
        CASE
          WHEN t.permit_expiry <= CURRENT_DATE + INTERVAL '7 days' THEN true ELSE false
        END AS permit_expiring,
        CASE
          WHEN t.fitness_expiry <= CURRENT_DATE + INTERVAL '7 days' THEN true ELSE false
        END AS fitness_expiring
       FROM trucks t
       LEFT JOIN users u ON u.truck_id = t.id AND u.active = true
       WHERE t.owner_id = $1 AND t.active = true
       ORDER BY t.created_at DESC`,
      [ownerId],
    );
  }

  async getTruckDetail(ownerId: string, truckId: string) {
    const rows = await this.sql(
      `SELECT t.*,
        u.name AS driver_name, u.email AS driver_email, u.id AS driver_id,
        CASE WHEN t.insurance_expiry <= CURRENT_DATE + INTERVAL '7 days' THEN true ELSE false END AS insurance_expiring,
        CASE WHEN t.permit_expiry <= CURRENT_DATE + INTERVAL '7 days' THEN true ELSE false END AS permit_expiring,
        CASE WHEN t.fitness_expiry <= CURRENT_DATE + INTERVAL '7 days' THEN true ELSE false END AS fitness_expiring
       FROM trucks t
       LEFT JOIN users u ON u.truck_id = t.id AND u.active = true
       WHERE t.id = $1 AND t.owner_id = $2 AND t.active = true`,
      [truckId, ownerId],
    );
    if (!rows || rows.length === 0) {
      // Check if truck belongs to another owner to prevent IDOR snooping
      const otherOwner = await this.sql(
        `SELECT id FROM trucks WHERE id = $1 AND active = true`,
        [truckId],
      );
      if (otherOwner && otherOwner.length > 0) {
        throw new ForbiddenException('Access denied: You do not have permission to view this truck.');
      }
      throw new ForbiddenException('Truck not found or access denied.');
    }
    return rows[0];
  }

  async getTruckTrips(ownerId: string, truckId: string) {
    // verify ownership
    const check = await this.sql(
      `SELECT id FROM trucks WHERE id = $1 AND owner_id = $2 AND active = true`,
      [truckId, ownerId],
    );
    if (!check.length) throw new ForbiddenException('Access denied');

    return this.sql(
      `SELECT tr.*, u.name AS driver_name
       FROM trips tr LEFT JOIN users u ON u.id = tr.user_id
       WHERE tr.truck_id = $1 ORDER BY tr.assigned_at DESC LIMIT 100`,
      [truckId],
    );
  }

  async updateTruckStatus(ownerId: string, truckId: string, status: string) {
    const allowed = ['available', 'maintenance'];
    if (!allowed.includes(status)) throw new ForbiddenException('Invalid status.');

    const check = await this.sql(
      `SELECT id FROM trucks WHERE id = $1 AND owner_id = $2 AND active = true`,
      [truckId, ownerId],
    );
    if (!check.length) throw new ForbiddenException('Access denied');

    const rows = await this.sql(
      `UPDATE trucks SET status = $1 WHERE id = $2 RETURNING *`,
      [status, truckId],
    );
    return rows[0];
  }

  async assignDriver(ownerId: string, truckId: string, driverId: string) {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(truckId) || !uuidPattern.test(driverId)) {
      throw new BadRequestException('A valid truck and driver must be selected.');
    }
    // Keep validation, release of the truck's previous driver, and assignment
    // in one transaction. Row locks serialize concurrent changes to this truck
    // and driver; the driver's truck_id is replaced on transfer.
    let results: any[][];
    try {
      results = await this.neonService.runTransaction([
        {
          text: `SELECT t.id, u.id AS driver_id
                 FROM trucks t INNER JOIN users u ON u.owner_id = t.owner_id
                 WHERE t.id = $1 AND t.owner_id = $2 AND t.active = true
                   AND u.id = $3 AND u.role = 'truckUser' AND u.active = true
                 FOR UPDATE`,
          values: [truckId, ownerId, driverId],
        },
        {
          text: `SELECT 1 / CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END AS valid
                 FROM trucks t INNER JOIN users u ON u.owner_id = t.owner_id
                 WHERE t.id = $1 AND t.owner_id = $2 AND t.active = true
                   AND u.id = $3 AND u.role = 'truckUser' AND u.active = true`,
          values: [truckId, ownerId, driverId],
        },
        { text: `UPDATE users SET truck_id = NULL WHERE truck_id = $1 AND id <> $2`, values: [truckId, driverId] },
        {
          text: `UPDATE users SET truck_id = $1
                 WHERE id = $2 AND owner_id = $3 AND role = 'truckUser' AND active = true
                 RETURNING id, name, email, truck_id`,
          values: [truckId, driverId, ownerId],
        },
      ]);
    } catch (error: any) {
      if (error?.code === '22012') throw new ForbiddenException('Truck or active fleet driver is invalid for this assignment.');
      throw error;
    }
    const assigned = results[3]?.[0];
    if (!assigned) throw new ForbiddenException('Truck or active fleet driver is invalid for this assignment.');
    return { success: true, driver: assigned };
  }

  async getAvailableDrivers(ownerId: string, truckId: string) {
    const truckRows = await this.sql(
      `SELECT id FROM trucks WHERE id = $1 AND owner_id = $2 AND active = true`,
      [truckId, ownerId],
    );
    if (!truckRows.length) throw new ForbiddenException('Truck not found or access denied.');

    // This reassignment flow explicitly supports transferring an active driver
    // between trucks in the same fleet; the UI labels their current assignment.
    return this.sql(
      `SELECT u.id, u.name, u.email, u.truck_id, u.active,
              t.plate_number AS truck_plate
       FROM users u
       LEFT JOIN trucks t ON t.id = u.truck_id
       WHERE u.owner_id = $1 AND u.role = 'truckUser' AND u.active = true
       ORDER BY u.name, u.email`,
      [ownerId],
    );
  }

  async getMyDrivers(ownerId: string) {
    return this.sql(
      `SELECT u.id, u.name, u.email, u.truck_id, u.active, t.plate_number AS truck_plate
       FROM users u
       LEFT JOIN trucks t ON t.id = u.truck_id
       WHERE u.owner_id = $1 AND u.role = 'truckUser'
       ORDER BY u.name`,
      [ownerId],
    );
  }

  async updateTargetTemp(ownerId: string, truckId: string, targetTempC: number) {
    const temp = Number(targetTempC);
    if (!Number.isFinite(temp) || temp < -30 || temp > 25) {
      throw new BadRequestException('Target temperature must be between -30°C and +25°C.');
    }
    const check = await this.sql(
      `SELECT id FROM trucks WHERE id = $1 AND owner_id = $2 AND active = true`,
      [truckId, ownerId],
    );
    if (!check.length) throw new ForbiddenException('Access denied');

    const rows = await this.sql(
      `UPDATE trucks SET target_temp_c = $1 WHERE id = $2 RETURNING *`,
      [temp, truckId],
    );
    return rows[0];
  }

  async createDriver(
    ownerId: string,
    data: { name: string; email: string; password?: string; truckId?: string },
  ) {
    if (!data.name?.trim() || !data.email?.trim()) {
      throw new BadRequestException('Driver name and email are required.');
    }
    const cleanEmail = data.email.toLowerCase().trim();
    const existing = await this.sql(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [cleanEmail]);
    if (existing.length > 0) {
      throw new BadRequestException('An account with this email address already exists.');
    }

    if (data.truckId) {
      const truckCheck = await this.sql(
        `SELECT id FROM trucks WHERE id = $1 AND owner_id = $2 AND active = true`,
        [data.truckId, ownerId],
      );
      if (!truckCheck.length) {
        throw new ForbiddenException('Selected truck not found or not under your ownership.');
      }
      await this.sql(`UPDATE users SET truck_id = NULL WHERE truck_id = $1`, [data.truckId]);
    }

    const bcrypt = await import('bcryptjs');
    const defaultPassword = data.password || 'password123';
    const hash = await bcrypt.hash(defaultPassword, 10);

    const rows = await this.sql(
      `INSERT INTO users (name, email, password_hash, role, owner_id, truck_id, active)
       VALUES ($1, $2, $3, 'truckUser', $4, $5, true)
       RETURNING id, name, email, role, truck_id, owner_id`,
      [data.name.trim(), cleanEmail, hash, ownerId, data.truckId || null],
    );
    return rows[0];
  }

  async deleteDriver(ownerId: string, driverId: string) {
    const rows = await this.sql(`
      UPDATE users SET active = false, truck_id = NULL
      WHERE id = $1 AND owner_id = $2 AND role = 'truckUser' AND active = true
      RETURNING id;
    `, [driverId, ownerId]);
    if (!rows.length) throw new ForbiddenException('Driver not found or access denied.');
    return { success: true };
  }

  async deleteTruck(ownerId: string, truckId: string) {
    const rows = await this.sql(`
      WITH target_truck AS (
        UPDATE trucks SET active = false, iot_connection_number = NULL
        WHERE id = $1 AND owner_id = $2 AND active = true
        RETURNING id
      ), unassigned_drivers AS (
        UPDATE users SET truck_id = NULL WHERE truck_id IN (SELECT id FROM target_truck)
        RETURNING id
      ), ended_trips AS (
        UPDATE trips SET ended_at = NOW()
        WHERE truck_id IN (SELECT id FROM target_truck) AND ended_at IS NULL
        RETURNING id
      )
      SELECT id FROM target_truck;
    `, [truckId, ownerId]);
    if (!rows.length) throw new ForbiddenException('Truck not found or access denied.');
    return { success: true };
  }

  async createTruck(
    ownerId: string,
    data: {
      plate_number: string;
      type: string;
      capacity_tons: number;
      target_temp_c?: number;
      iot_connection_number?: string;
    },
  ) {
    if (!data.plate_number?.trim()) {
      throw new BadRequestException('Plate number is required.');
    }
    const plate = data.plate_number.trim().toUpperCase();
    const existingPlate = await this.sql(
      `SELECT id FROM trucks WHERE UPPER(plate_number) = $1 LIMIT 1`,
      [plate],
    );
    if (existingPlate.length) {
      throw new BadRequestException('A truck with this plate number already exists.');
    }

    const connectionNumber = data.iot_connection_number?.trim().toUpperCase() || null;
    if (connectionNumber) {
      const existingConnection = await this.sql(
        `SELECT id FROM trucks WHERE UPPER(iot_connection_number) = $1 AND active = true LIMIT 1`,
        [connectionNumber],
      );
      if (existingConnection.length) {
        throw new BadRequestException('This IoT device is already paired with another truck.');
      }
    }

    const rows = await this.sql(
      `INSERT INTO trucks (owner_id, plate_number, type, capacity_tons, target_temp_c, iot_connection_number, status, active)
       VALUES ($1, $2, $3, $4, $5, $6, 'available', true)
       RETURNING *`,
      [
        ownerId,
        plate,
        data.type || 'Refrigerated Semi 10T',
        data.capacity_tons ?? 10.0,
        data.target_temp_c ?? 4.0,
        connectionNumber,
      ],
    );
    return rows[0];
  }

  async getLstmLogs(ownerId: string, limit = 200) {
    return this.sql(
      `SELECT h.*, t.plate_number, t.type AS truck_type,
              t.base_insurance_price AS truck_base_price,
              t.current_insurance_price AS truck_current_price
       FROM trip_telemetry_history h
       INNER JOIN trucks t ON t.id = h.truck_id
       WHERE t.owner_id = $1::uuid
       ORDER BY h.recorded_at DESC
       LIMIT $2`,
      [ownerId, limit],
    );
  }
}
