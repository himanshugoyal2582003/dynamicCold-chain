import { Injectable, BadRequestException } from '@nestjs/common';
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
    if (!name?.trim() || !email?.trim() || !password) {
      throw new BadRequestException('Name, email, and password are required.');
    }
    const cleanEmail = email.toLowerCase().trim();
    const existing = await this.sql(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [cleanEmail]);
    if (existing.length > 0) {
      throw new BadRequestException('An account with this email address already exists.');
    }
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash(password, 10);
    const rows = await this.sql(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'owner') RETURNING id, name, email, role, created_at`,
      [name.trim(), cleanEmail, hash],
    );
    return rows[0];
  }

  async deactivateOwner(id: string) {
    await this.deleteOwner(id);
    return { success: true };
  }

  async deleteOwner(id: string) {
    await this.sql(`
      WITH target_owner AS (
        UPDATE users SET active = false
        WHERE id = $1 AND role = 'owner' AND active = true
        RETURNING id
      ), disabled_drivers AS (
        UPDATE users SET active = false, truck_id = NULL
        WHERE owner_id IN (SELECT id FROM target_owner) AND role = 'truckUser'
        RETURNING id
      ), disabled_trucks AS (
        UPDATE trucks SET active = false, iot_connection_number = NULL
        WHERE owner_id IN (SELECT id FROM target_owner)
        RETURNING id
      ), ended_trips AS (
        UPDATE trips SET ended_at = NOW()
        WHERE truck_id IN (SELECT id FROM disabled_trucks) AND ended_at IS NULL
        RETURNING id
      )
      SELECT id FROM target_owner;
    `, [id]);
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
    capacity_tons: number; target_temp_c?: number; base_insurance_price?: number;
    insurance_expiry?: string; permit_expiry?: string; fitness_expiry?: string;
  }) {
    if (!data.owner_id || !data.plate_number?.trim()) {
      throw new BadRequestException('Owner and plate number are required.');
    }
    const plate = data.plate_number.trim().toUpperCase();
    const existing = await this.sql(`SELECT id FROM trucks WHERE UPPER(plate_number) = $1 LIMIT 1`, [plate]);
    if (existing.length > 0) {
      throw new BadRequestException('A truck with this plate number already exists.');
    }
    const basePrice = data.base_insurance_price ?? 450.0;
    const rows = await this.sql(
      `INSERT INTO trucks (owner_id, plate_number, type, capacity_tons, target_temp_c, base_insurance_price, current_insurance_price, insurance_expiry, permit_expiry, fitness_expiry)
       VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9) RETURNING *`,
      [
        data.owner_id, plate, data.type || 'Refrigerated Semi 10T', data.capacity_tons ?? 10.0,
        data.target_temp_c ?? 4.0, basePrice, data.insurance_expiry || null,
        data.permit_expiry || null, data.fitness_expiry || null,
      ],
    );
    return rows[0];
  }

  async updateTruck(id: string, data: Partial<{
    plate_number: string; type: string; capacity_tons: number;
    status: string; target_temp_c: number; base_insurance_price: number;
    insurance_expiry: string; permit_expiry: string; fitness_expiry: string;
    iot_connection_number: string | null;
  }>) {
    const allowedFields = new Set([
      'plate_number', 'type', 'capacity_tons', 'status',
      'target_temp_c', 'base_insurance_price',
      'insurance_expiry', 'permit_expiry', 'fitness_expiry', 'iot_connection_number',
    ]);
    const entries = Object.entries(data).filter(([k, v]) => allowedFields.has(k) && v !== undefined);
    if (!entries.length) return null;
    const fields = entries.map(([k], i) => `${k} = $${i + 2}`).join(', ');
    const values = entries.map(([, v]) => v);
    const rows = await this.sql(`UPDATE trucks SET ${fields} WHERE id = $1 RETURNING *`, [id, ...values]);
    return rows[0];
  }

  async deactivateTruck(id: string) {
    await this.deleteTruck(id);
    return { success: true };
  }

  async deleteTruck(id: string) {
    await this.sql(`
      WITH target_truck AS (
        UPDATE trucks SET active = false, iot_connection_number = NULL
        WHERE id = $1 AND active = true
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
    `, [id]);
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
    if (!name?.trim() || !email?.trim() || !password || !owner_id) {
      throw new BadRequestException('Name, email, password, and owner_id are required.');
    }
    const cleanEmail = email.toLowerCase().trim();
    const existing = await this.sql(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [cleanEmail]);
    if (existing.length > 0) {
      throw new BadRequestException('An account with this email address already exists.');
    }
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash(password, 10);
    const rows = await this.sql(
      `INSERT INTO users (name, email, password_hash, role, owner_id) VALUES ($1, $2, $3, 'truckUser', $4) RETURNING id, name, email, role, owner_id, created_at`,
      [name.trim(), cleanEmail, hash, owner_id],
    );
    return rows[0];
  }

  async deactivateUser(id: string) {
    await this.deleteTruckUser(id);
    return { success: true };
  }

  async deleteTruckUser(id: string) {
    await this.sql(`
      UPDATE users SET active = false, truck_id = NULL
      WHERE id = $1 AND role = 'truckUser';
    `, [id]);
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

  async getLstmLogs(limit = 200) {
    return this.sql(
      `SELECT h.*, t.plate_number, t.type AS truck_type,
              t.base_insurance_price AS truck_base_price,
              t.current_insurance_price AS truck_current_price,
              u.name AS owner_name
       FROM trip_telemetry_history h
       INNER JOIN trucks t ON t.id = h.truck_id
       LEFT JOIN users u ON u.id = t.owner_id
       ORDER BY h.recorded_at DESC
       LIMIT $1`,
      [limit],
    );
  }
}
