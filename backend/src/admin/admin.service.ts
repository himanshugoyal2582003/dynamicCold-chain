import { Injectable, Logger, ForbiddenException, BadRequestException, ConflictException } from '@nestjs/common';
import { NeonService } from '../neon/neon.service';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  constructor(private readonly neonService: NeonService) {}

  private get sql() {
    const s = this.neonService.getSql();
    if (!s) throw new Error('Database not available');
    return s;
  }

  // ─── METRICS ───────────────────────────────────────────────────────────────
  async getMetrics() {
    const rows = await this.sql(`
      SELECT
        (SELECT COUNT(*)::int FROM users WHERE role = 'owner' AND active = true) AS total_owners,
        (SELECT COUNT(*)::int FROM trucks WHERE active = true) AS total_trucks,
        (SELECT COUNT(*)::int FROM users WHERE role = 'truckUser' AND active = true) AS active_drivers,
        (SELECT COUNT(*)::int FROM trips WHERE status = 'IN_PROGRESS') AS trucks_on_trip
    `);
    return rows[0];
  }

  // ─── OWNERS ────────────────────────────────────────────────────────────────
  async listOwners(activeOnly = false) {
    const activeFilter = activeOnly ? 'AND u.active = true' : '';
    const owners = await this.sql(`
      SELECT u.id, u.name, u.email, u.active, u.created_at
      FROM users u
      WHERE u.role = 'owner' ${activeFilter}
      ORDER BY u.created_at DESC
    `);
    const counts = await this.sql(`
      SELECT owner_id, COUNT(*)::int AS truck_count
      FROM trucks WHERE active = true GROUP BY owner_id
    `);
    const countsByOwner = new Map(counts.map((row: any) => [row.owner_id, Number(row.truck_count)]));
    return owners.map((owner: any) => ({ ...owner, truck_count: countsByOwner.get(owner.id) || 0 }));
  }

  async createOwner(name: string, email: string, password: string) {
    const normalizedName = typeof name === 'string' ? name.trim() : '';
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!normalizedName || normalizedName.length > 100) {
      throw new BadRequestException('Owner name is required and must be at most 100 characters.');
    }
    if (normalizedEmail.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new BadRequestException('A valid owner email address is required.');
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
      throw new BadRequestException('Password must be between 8 and 72 characters.');
    }
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash(password, 10);
    try {
      const rows = await this.sql(
        `INSERT INTO users (name, email, password_hash, role, active)
         VALUES ($1, $2, $3, 'owner', true)
         RETURNING id, name, email, role, active, created_at`,
        [normalizedName, normalizedEmail, hash],
      );
      if (!rows[0]) throw new Error('Owner insert completed without returning the saved record.');
      this.logger.log('[DB] Owner INSERT successful');
      return rows[0];
    } catch (error: any) {
      if (error?.code === '23505') throw new ConflictException('A user with this email address is already registered.');
      throw error;
    }
  }

  async deactivateOwner(id: string) {
    await this.sql(`UPDATE users SET active = false WHERE id = $1 AND role = 'owner'`, [id]);
    return { success: true };
  }

  // ─── TRUCKS ────────────────────────────────────────────────────────────────
  async listTrucks() {
    const development = process.env.NODE_ENV !== 'production';
    try {
      const sql = this.sql;
      const trucksQuery = `
        SELECT t.*, owner.name AS owner_name
        FROM trucks t
        LEFT JOIN users owner ON owner.id = t.owner_id
        ORDER BY t.created_at DESC
      `;
      const driversQuery = `
        SELECT id, name, email, truck_id
        FROM users
        WHERE truck_id IS NOT NULL AND role = 'truckUser' AND active = true
        ORDER BY name, id
      `;

      if (development) {
        this.logger.log('[TRUCK DEBUG] Database connection: query client configured');
        this.logger.log(`[TRUCK DEBUG] SQL query: ${trucksQuery.trim().replace(/\s+/g, ' ')}`);
      }
      const trucks = await sql(trucksQuery);
      if (development) this.logger.log('[TRUCK DEBUG] Database connection: query succeeded');
      const drivers = await sql(driversQuery);
      const driverByTruck = new Map<string, any>();
      for (const driver of drivers) {
        if (driver.truck_id && !driverByTruck.has(driver.truck_id)) driverByTruck.set(driver.truck_id, driver);
      }

      const result = trucks.map((truck: any) => {
        const driver = driverByTruck.get(truck.id);
        return {
          ...truck,
          owner_name: truck.owner_name ?? null,
          driver_id: driver?.id ?? null,
          driver_name: driver?.name ?? null,
          driver_email: driver?.email ?? null,
        };
      });
      if (development) this.logger.log(`[TRUCK DEBUG] Query result count: ${result.length}`);
      return result;
    } catch (error: any) {
      if (development) {
        this.logger.error(`[TRUCK DEBUG] Error details: ${error?.message || error}`, error?.stack);
      }
      throw error;
    }
  }

  async getAvailableDrivers(truckId: string) {
    const trucks = await this.sql(
      `SELECT owner_id FROM trucks WHERE id = $1 AND active = true`,
      [truckId],
    );
    if (!trucks.length) throw new ForbiddenException('Truck not found or inactive.');
    return this.sql(
      `SELECT u.id, u.name, u.email, u.truck_id, u.active,
              t.plate_number AS truck_plate
       FROM users u
       LEFT JOIN trucks t ON t.id = u.truck_id
       WHERE u.owner_id = $1 AND u.role = 'truckUser' AND u.active = true
       ORDER BY u.name, u.email`,
      [trucks[0].owner_id],
    );
  }

  async assignDriver(truckId: string, driverId: string) {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(truckId) || !uuidPattern.test(driverId)) {
      throw new BadRequestException('A valid truck and driver must be selected.');
    }
    let results: any[][];
    try {
      results = await this.neonService.runTransaction([
        {
          text: `SELECT t.id, u.id AS driver_id
                 FROM trucks t INNER JOIN users u ON u.owner_id = t.owner_id
                 WHERE t.id = $1 AND t.active = true
                   AND u.id = $2 AND u.role = 'truckUser' AND u.active = true
                 FOR UPDATE`,
          values: [truckId, driverId],
        },
        {
          text: `SELECT 1 / CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END AS valid
                 FROM trucks t INNER JOIN users u ON u.owner_id = t.owner_id
                 WHERE t.id = $1 AND t.active = true
                   AND u.id = $2 AND u.role = 'truckUser' AND u.active = true`,
          values: [truckId, driverId],
        },
        { text: `UPDATE users SET truck_id = NULL WHERE truck_id = $1 AND id <> $2`, values: [truckId, driverId] },
        {
          text: `UPDATE users SET truck_id = $1
                 WHERE id = $2 AND role = 'truckUser' AND active = true
                 RETURNING id, name, email, truck_id`,
          values: [truckId, driverId],
        },
      ]);
    } catch (error: any) {
      if (error?.code === '22012') throw new ForbiddenException('Truck or active driver is invalid for this assignment.');
      throw error;
    }
    const assigned = results[3]?.[0];
    if (!assigned) throw new ForbiddenException('Truck or active driver is invalid for this assignment.');
    return { success: true, driver: assigned };
  }

  async createTruck(data: {
    owner_id: string; plate_number: string; type: string;
    capacity_tons: number; target_temp_c?: number;
    insurance_expiry?: string; permit_expiry?: string; fitness_expiry?: string;
  }) {
    const ownerId = typeof data?.owner_id === 'string' ? data.owner_id.trim() : '';
    const plateNumber = typeof data?.plate_number === 'string' ? data.plate_number.trim().toUpperCase() : '';
    const type = typeof data?.type === 'string' ? data.type.trim() : '';
    const capacity = Number(data?.capacity_tons);
    const targetTemp = data?.target_temp_c === undefined ? 4 : Number(data.target_temp_c);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId)) {
      throw new BadRequestException('Select a valid owner.');
    }
    if (!plateNumber || plateNumber.length > 50) throw new BadRequestException('A valid truck registration number is required (up to 50 characters).');
    if (!type || type.length > 50) throw new BadRequestException('A valid truck type is required (up to 50 characters).');
    if (!Number.isFinite(capacity) || capacity <= 0 || capacity > 999.99) throw new BadRequestException('Capacity must be a number greater than 0 and no more than 999.99 tons.');
    if (!Number.isFinite(targetTemp) || targetTemp < -30 || targetTemp > 25) throw new BadRequestException('Target temperature must be between -30°C and 25°C.');

    const validDate = (value?: string) => {
      if (!value) return true;
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    };
    for (const [field, value] of [
      ['Insurance expiry', data.insurance_expiry],
      ['Permit expiry', data.permit_expiry],
      ['Fitness expiry', data.fitness_expiry],
    ] as const) {
      if (!validDate(value)) throw new BadRequestException(`${field} must be a valid date.`);
    }

    try {
      // INSERT ... SELECT makes active-owner validation and truck creation atomic.
      const rows = await this.sql(
        `INSERT INTO trucks (owner_id, plate_number, type, capacity_tons, target_temp_c, insurance_expiry, permit_expiry, fitness_expiry, status, active)
         SELECT owner.id, $2, $3, CAST($4 AS NUMERIC), CAST($5 AS NUMERIC),
                CAST($6 AS DATE), CAST($7 AS DATE), CAST($8 AS DATE), 'available', true
         FROM users owner
         WHERE owner.id = $1 AND owner.role = 'owner' AND owner.active = true
         RETURNING *`,
        [ownerId, plateNumber, type, capacity, targetTemp, data.insurance_expiry || null, data.permit_expiry || null, data.fitness_expiry || null],
      );
      if (!rows.length) throw new BadRequestException('Selected owner does not exist or is inactive.');
      this.logger.log('[DB] Truck INSERT successful');
      return rows[0];
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      if (error?.code === '23505') throw new ConflictException('A truck with this registration number already exists.');
      throw error;
    }
  }

  async updateTruck(id: string, data: Partial<{
    plate_number: string; type: string; capacity_tons: number;
    status: string; target_temp_c: number; insurance_expiry: string;
    permit_expiry: string; fitness_expiry: string;
  }>) {
    const allowedFields = [
      'plate_number', 'type', 'capacity_tons', 'status', 'target_temp_c',
      'insurance_expiry', 'permit_expiry', 'fitness_expiry',
    ] as const;
    const entries = allowedFields
      .filter((field) => data[field] !== undefined)
      .map((field) => [field, data[field]] as const);
    const fields = entries.map(([field], index) => `${field} = $${index + 2}`).join(', ');
    const values = entries.map(([, value]) => value);
    if (!fields) return null;
    const rows = await this.sql(`UPDATE trucks SET ${fields} WHERE id = $1 RETURNING *`, [id, ...values]);
    return rows[0];
  }

  async deactivateTruck(id: string) {
    await this.sql(`UPDATE trucks SET active = false WHERE id = $1`, [id]);
    return { success: true };
  }

  // ─── USERS (TRUCK USERS) ───────────────────────────────────────────────────
  async listTruckUsers() {
    return this.sql(`
      SELECT u.id, u.name, u.email, u.active, u.owner_id, u.truck_id, u.created_at,
        o.name AS owner_name,
        t.plate_number AS truck_plate
      FROM users u
      LEFT JOIN users o ON o.id = u.owner_id
      LEFT JOIN trucks t ON t.id = u.truck_id
      WHERE u.role = 'truckUser'
      ORDER BY u.created_at DESC
    `);
  }

  async createTruckUser(name: string, email: string, password: string, owner_id: string) {
    const normalizedName = typeof name === 'string' ? name.trim() : '';
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const normalizedOwnerId = typeof owner_id === 'string' ? owner_id.trim() : '';
    if (!normalizedName || normalizedName.length > 100) {
      throw new BadRequestException('Full name is required and must be at most 100 characters.');
    }
    if (normalizedEmail.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new BadRequestException('A valid email address is required.');
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
      throw new BadRequestException('Password must be between 8 and 72 characters.');
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalizedOwnerId)) {
      throw new BadRequestException('A valid owner ID must be selected.');
    }

    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash(password, 10);
    try {
      const rows = await this.sql(
        `INSERT INTO users (name, email, password_hash, role, owner_id, active)
         SELECT $1, $2, $3, 'truckUser', owner.id, true
         FROM users owner
         WHERE owner.id = $4 AND owner.role = 'owner' AND owner.active = true
         RETURNING id, name, email, role, owner_id, truck_id, active, created_at`,
        [normalizedName, normalizedEmail, hash, normalizedOwnerId],
      );
      if (!rows.length) throw new BadRequestException('Selected owner does not exist or is inactive.');
      this.logger.log('[DB] Driver INSERT successful');
      return rows[0];
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      if (error?.code === '23505') throw new ConflictException('A user with this email address is already registered.');
      throw error;
    }
  }

  async deactivateUser(id: string) {
    await this.sql(`UPDATE users SET active = false WHERE id = $1`, [id]);
    return { success: true };
  }

  // ─── ACTIVITY LOG ─────────────────────────────────────────────────────────
  async getActivityLog(limit = 50) {
    return this.sql(
      `SELECT al.*, u.name AS actor_name, u.role AS actor_role
       FROM activity_log al
       LEFT JOIN users u ON u.id = al.actor_id
       ORDER BY al.created_at DESC LIMIT $1`,
      [limit],
    );
  }

  async logActivity(actorId: string, action: string, entity: string, entityId: string | null, details = {}) {
    await this.sql(
      `INSERT INTO activity_log (actor_id, action, entity, entity_id, details) VALUES ($1, $2, $3, $4, $5)`,
      [actorId, action, entity, entityId, JSON.stringify(details)],
    );
  }
}
