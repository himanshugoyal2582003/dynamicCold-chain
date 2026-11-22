import { Injectable, Logger, ForbiddenException, BadRequestException, ConflictException } from '@nestjs/common';
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
    const name = typeof data?.name === 'string' ? data.name.trim() : '';
    const email = typeof data?.email === 'string' ? data.email.trim().toLowerCase() : '';
    const password = data?.password || 'password123';
    const truckId = data?.truckId?.trim() || null;
    if (!name || name.length > 100) throw new BadRequestException('Driver name is required and must be at most 100 characters.');
    if (email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('A valid driver email address is required.');
    if (typeof password !== 'string' || password.length < 8 || password.length > 72) throw new BadRequestException('Password must be between 8 and 72 characters.');
    if (truckId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(truckId)) {
      throw new BadRequestException('A valid truck must be selected.');
    }
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash(password, 10);
    try {
      const rows = await this.sql(
        `INSERT INTO users (name, email, password_hash, role, owner_id, truck_id, active)
         SELECT $1, $2, $3, 'truckUser', owner.id, truck.id, true
         FROM users owner
         LEFT JOIN trucks truck ON truck.id = $5 AND truck.owner_id = owner.id AND truck.active = true
         WHERE owner.id = $4 AND owner.role = 'owner' AND owner.active = true
           AND ($5 IS NULL OR truck.id IS NOT NULL)
         RETURNING id, name, email, role, truck_id, owner_id, active, created_at`,
        [name, email, hash, ownerId, truckId],
      );
      if (!rows[0]) throw new BadRequestException('Owner is inactive or the selected truck does not belong to this owner.');
      this.logger.log('[DB] Driver INSERT successful');
      return rows[0];
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      if (error?.code === '23505') throw new ConflictException('A user with this email address is already registered.');
      throw error;
    }
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
    const plate = typeof data?.plate_number === 'string' ? data.plate_number.trim().toUpperCase() : '';
    const type = typeof data?.type === 'string' ? data.type.trim() : 'Refrigerated Semi 10T';
    const capacity = Number(data?.capacity_tons);
    const targetTemp = data?.target_temp_c === undefined ? 4 : Number(data.target_temp_c);
    if (!plate || plate.length > 50) throw new BadRequestException('A valid truck registration number is required.');
    if (!type || type.length > 50) throw new BadRequestException('Truck type must be between 1 and 50 characters.');
    if (!Number.isFinite(capacity) || capacity <= 0 || capacity > 999.99) throw new BadRequestException('Truck capacity must be greater than 0 and no more than 999.99 tons.');
    if (!Number.isFinite(targetTemp) || targetTemp < -30 || targetTemp > 25) throw new BadRequestException('Target temperature must be between -30°C and 25°C.');
    try {
      const rows = await this.sql(
        `INSERT INTO trucks (owner_id, plate_number, type, capacity_tons, target_temp_c, iot_connection_number, status, active)
         SELECT owner.id, $2, $3, CAST($4 AS NUMERIC), CAST($5 AS NUMERIC), $6, 'available', true
         FROM users owner
         WHERE owner.id = $1 AND owner.role = 'owner' AND owner.active = true
         RETURNING *`,
        [
          ownerId,
          plate,
          type,
          capacity,
          targetTemp,
          data.iot_connection_number ? data.iot_connection_number.trim().toUpperCase() : null,
        ],
      );
      if (!rows[0]) throw new ForbiddenException('Owner is inactive or unavailable.');
      this.logger.log('[DB] Truck INSERT successful');
      return rows[0];
    } catch (error: any) {
      if (error instanceof ForbiddenException || error instanceof BadRequestException) throw error;
      if (error?.code === '23505') throw new ConflictException('A truck with this registration number already exists.');
      throw error;
    }
  }
}
