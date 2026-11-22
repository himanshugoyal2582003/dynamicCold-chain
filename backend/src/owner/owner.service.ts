import { Injectable, ForbiddenException, Query } from '@nestjs/common';
import { NeonService } from '../neon/neon.service';

@Injectable()
export class OwnerService {
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
       WHERE tr.truck_id = $1 ORDER BY tr.started_at DESC LIMIT 20`,
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
    // Verify truck belongs to owner
    const truckCheck = await this.sql(
      `SELECT id FROM trucks WHERE id = $1 AND owner_id = $2 AND active = true`,
      [truckId, ownerId],
    );
    if (!truckCheck.length) throw new ForbiddenException('Access denied');

    // Verify driver belongs to owner
    const driverCheck = await this.sql(
      `SELECT id FROM users WHERE id = $1 AND owner_id = $2 AND role = 'truckUser' AND active = true`,
      [driverId, ownerId],
    );
    if (!driverCheck.length) throw new ForbiddenException('Driver not under your ownership');

    // Unassign driver from any previous truck
    await this.sql(`UPDATE users SET truck_id = NULL WHERE truck_id = $1`, [truckId]);
    // Assign to new truck
    await this.sql(`UPDATE users SET truck_id = $1 WHERE id = $2`, [truckId, driverId]);
    return { success: true };
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
    if (!Number.isFinite(targetTempC) || targetTempC < -30 || targetTempC > 25) {
      throw new ForbiddenException('Target temperature must be between -30°C and +25°C.');
    }
    const check = await this.sql(
      `SELECT id FROM trucks WHERE id = $1 AND owner_id = $2 AND active = true`,
      [truckId, ownerId],
    );
    if (!check.length) throw new ForbiddenException('Access denied');

    const rows = await this.sql(
      `UPDATE trucks SET target_temp_c = $1 WHERE id = $2 RETURNING *`,
      [targetTempC, truckId],
    );
    return rows[0];
  }

  async createDriver(
    ownerId: string,
    data: { name: string; email: string; password?: string; truckId?: string },
  ) {
    const bcrypt = await import('bcryptjs');
    const defaultPassword = data.password || 'password123';
    const hash = await bcrypt.hash(defaultPassword, 10);

    const rows = await this.sql(
      `INSERT INTO users (name, email, password_hash, role, owner_id, truck_id, active)
       VALUES ($1, $2, $3, 'truckUser', $4, $5, true)
       RETURNING id, name, email, role, truck_id, owner_id`,
      [data.name.trim(), data.email.toLowerCase().trim(), hash, ownerId, data.truckId || null],
    );
    return rows[0];
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
    const rows = await this.sql(
      `INSERT INTO trucks (owner_id, plate_number, type, capacity_tons, target_temp_c, iot_connection_number, status, active)
       VALUES ($1, $2, $3, $4, $5, $6, 'available', true)
       RETURNING *`,
      [
        ownerId,
        data.plate_number.trim().toUpperCase(),
        data.type || 'Refrigerated Semi 10T',
        data.capacity_tons || 10.0,
        data.target_temp_c || 4.0,
        data.iot_connection_number ? data.iot_connection_number.trim().toUpperCase() : null,
      ],
    );
    return rows[0];
  }
}
