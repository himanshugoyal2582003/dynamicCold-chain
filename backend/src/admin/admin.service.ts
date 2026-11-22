import { Injectable } from '@nestjs/common';
import { NeonService } from '../neon/neon.service';

@Injectable()
export class AdminService {
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
        (SELECT COUNT(*)::int FROM trucks WHERE status = 'on_trip' AND active = true) AS trucks_on_trip
    `);
    return rows[0];
  }

  // ─── OWNERS ────────────────────────────────────────────────────────────────
  async listOwners() {
    return this.sql(`
      SELECT u.id, u.name, u.email, u.active, u.created_at,
        COUNT(t.id)::int AS truck_count
      FROM users u
      LEFT JOIN trucks t ON t.owner_id = u.id AND t.active = true
      WHERE u.role = 'owner'
      GROUP BY u.id ORDER BY u.created_at DESC
    `);
  }

  async createOwner(name: string, email: string, password: string) {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash(password, 10);
    const rows = await this.sql(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'owner') RETURNING id, name, email, role, created_at`,
      [name, email.toLowerCase().trim(), hash],
    );
    return rows[0];
  }

  async deactivateOwner(id: string) {
    await this.sql(`UPDATE users SET active = false WHERE id = $1 AND role = 'owner'`, [id]);
    return { success: true };
  }

  // ─── TRUCKS ────────────────────────────────────────────────────────────────
  async listTrucks() {
    return this.sql(`
      SELECT t.*, u.name AS owner_name
      FROM trucks t
      LEFT JOIN users u ON u.id = t.owner_id
      ORDER BY t.created_at DESC
    `);
  }

  async createTruck(data: {
    owner_id: string; plate_number: string; type: string;
    capacity_tons: number; target_temp_c?: number;
    insurance_expiry?: string; permit_expiry?: string; fitness_expiry?: string;
  }) {
    const rows = await this.sql(
      `INSERT INTO trucks (owner_id, plate_number, type, capacity_tons, target_temp_c, insurance_expiry, permit_expiry, fitness_expiry)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        data.owner_id, data.plate_number, data.type, data.capacity_tons,
        data.target_temp_c ?? 4.0, data.insurance_expiry || null,
        data.permit_expiry || null, data.fitness_expiry || null,
      ],
    );
    return rows[0];
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
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash(password, 10);
    const rows = await this.sql(
      `INSERT INTO users (name, email, password_hash, role, owner_id) VALUES ($1, $2, $3, 'truckUser', $4) RETURNING id, name, email, role, owner_id, created_at`,
      [name, email.toLowerCase().trim(), hash, owner_id],
    );
    return rows[0];
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
