import { Injectable, Logger, OnModuleInit, NotFoundException, ServiceUnavailableException, ConflictException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { NeonService } from '../neon/neon.service';

export interface EnrichedIoTTelemetry {
  device_id: string;
  connection_number: string;
  truck_id?: string | null;
  plate_number?: string | null;
  device_name: string;
  product_type: string;
  temperature: number;
  target_temp: number;
  humidity: number;
  battery: number;
  door_open: boolean;
  gps: {
    lat: number;
    lng: number;
    speed_kmh: number;
  };
  status: string;
  spoilage_risk: number;
  spoilage_risk_level: string;
  shelf_life_remaining_hours: number;
  quality_retention_pct: number;
  route_recommendation: string;
  reroute_suggested: boolean;
  nearest_safe_market?: string | null;
  alert_message?: string | null;
  timestamp: string;
}

@Injectable()
export class IotService implements OnModuleInit {
  private readonly logger = new Logger(IotService.name);

  // Connection Number -> Latest Enriched Telemetry
  private readonly telemetryByConnection = new Map<string, EnrichedIoTTelemetry>();

  // Truck ID -> Latest Enriched Telemetry
  private readonly telemetryByTruckId = new Map<string, EnrichedIoTTelemetry>();

  // Mappings
  private readonly truckToConnection = new Map<string, string>();
  private readonly connectionToTruck = new Map<string, string>();

  // Track last DB snapshot timestamp per truck (15-minute interval = 900,000 ms)
  private readonly lastDbSnapshotTime = new Map<string, number>();
  private readonly SNAPSHOT_INTERVAL_MS = 15 * 60 * 1000;

  constructor(private readonly neonService: NeonService) {}

  async onModuleInit() {
    await this.loadPersistedBindings();
  }

  private async loadPersistedBindings() {
    try {
      const sql = this.neonService.getSql();
      if (sql) {
        const rows = await sql`SELECT id, iot_connection_number FROM trucks WHERE iot_connection_number IS NOT NULL;`;
        for (const row of rows) {
          if (row.iot_connection_number) {
            this.truckToConnection.set(row.id, row.iot_connection_number);
            this.connectionToTruck.set(row.iot_connection_number, row.id);
          }
        }
        this.logger.log(`[DB] Loaded ${rows.length} persisted device-to-truck pairings`);
      }
    } catch (e: any) {
      this.logger.error(`Could not load persisted IoT bindings. Apply the database migrations before starting the API: ${e.message}`);
      throw new Error('Could not initialize persistent device-to-truck bindings.');
    }
  }

  // Ingest telemetry processed by AI/ML
  async ingest(payload: EnrichedIoTTelemetry) {
    if (!payload.connection_number) return { success: false, error: 'connection_number missing' };

    const conn = payload.connection_number.trim().toUpperCase();
    payload.connection_number = conn;

    const sql = this.neonService.getSql();
    if (!sql) throw new ServiceUnavailableException('Persistent database is unavailable.');
    // The connection code and persisted truck pairing are authoritative. Never
    // accept payload.truck_id as an assignment or allow an unpaired device to
    // impersonate a truck.
    const binding = await sql`
      SELECT t.id AS truck_id FROM iot_devices d
      JOIN trucks t ON t.iot_connection_number = d.connection_number AND t.active = true
      WHERE d.connection_number = ${conn} AND d.active = true LIMIT 1;
    `;
    const boundTruckId = binding[0]?.truck_id as string | undefined;
    if (!boundTruckId) throw new ForbiddenException('Device is not registered and paired to an active truck.');
    payload.truck_id = boundTruckId;
    this.connectionToTruck.set(conn, boundTruckId);
    this.truckToConnection.set(boundTruckId, conn);
    this.telemetryByTruckId.set(boundTruckId, payload);
    await sql`
      UPDATE iot_devices SET last_seen = NOW(), battery = ${Number.isFinite(payload.battery) ? payload.battery : null},
        reported_status = ${String(payload.status || 'online').toLowerCase()}, updated_at = NOW()
      WHERE connection_number = ${conn};
    `;

    // Persist only real reported coordinates and speed. Missing telemetry stays
    // NULL instead of being replaced by a fabricated location or speed.
    const now = Date.now();
    const lastSaved = this.lastDbSnapshotTime.get(boundTruckId) || 0;
    if (now - lastSaved >= this.SNAPSHOT_INTERVAL_MS || lastSaved === 0) {
      this.lastDbSnapshotTime.set(boundTruckId, now);
      this.saveSnapshotToDb(boundTruckId, payload).catch((e) => {
        if (this.lastDbSnapshotTime.get(boundTruckId) === now) this.lastDbSnapshotTime.delete(boundTruckId);
        this.logger.warn(`[DB] Failed to persist telemetry snapshot; it will retry on a later ingest: ${e.message}`);
      });
    }

    this.telemetryByConnection.set(conn, payload);
    return {
      success: true,
      connection_number: conn,
      truck_id: boundTruckId,
      spoilage_risk: payload.spoilage_risk,
      spoilage_risk_level: payload.spoilage_risk_level,
    };
  }

  private async saveSnapshotToDb(truckId: string, p: EnrichedIoTTelemetry) {
    const sql = this.neonService.getSql();
    if (!sql) throw new ServiceUnavailableException('Persistent database is unavailable.');

    try {
      const activeTrip = await sql`
        SELECT id FROM trips WHERE truck_id = ${truckId}::uuid AND ended_at IS NULL LIMIT 1;
      `;
      const tripId = activeTrip.length > 0 ? activeTrip[0].id : null;

      await sql`
        INSERT INTO trip_telemetry_history (
          trip_id, truck_id, device_id, connection_number, temperature, target_temp,
          humidity, battery, door_open, gps_lat, gps_lng, speed_kmh, spoilage_risk,
          spoilage_risk_level, rsl_hours, quality_retention_pct, route_recommendation
        ) VALUES (
          ${tripId}, ${truckId}::uuid, ${p.device_id}, ${p.connection_number},
          ${p.temperature}, ${p.target_temp}, ${p.humidity}, ${p.battery},
          ${p.door_open}, ${Number.isFinite(p.gps?.lat) && p.gps.lat >= -90 && p.gps.lat <= 90 ? p.gps.lat : null},
          ${Number.isFinite(p.gps?.lng) && p.gps.lng >= -180 && p.gps.lng <= 180 ? p.gps.lng : null},
          ${Number.isFinite(p.gps?.speed_kmh) && p.gps.speed_kmh >= 0 ? p.gps.speed_kmh : null},
          ${p.spoilage_risk}, ${p.spoilage_risk_level},
          ${p.shelf_life_remaining_hours}, ${p.quality_retention_pct}, ${p.route_recommendation}
        );
      `;
    } catch (e: any) {
      this.logger.warn(`[DB] Telemetry snapshot INSERT failed: ${e.message}`);
      throw e;
    }
  }

  // Retrieve 15-minute time series history for a truck
  async getTelemetryHistory(truckId: string, limit: number = 30) {
    const sql = this.neonService.getSql();
    if (!sql) return [];
    return sql`
      SELECT * FROM trip_telemetry_history
      WHERE truck_id = ${truckId}::uuid
      ORDER BY recorded_at DESC
      LIMIT ${limit};
    `;
  }

  // Dynamic AI Insurance Pricing model calculation
  async recalculateInsurance(truckId: string) {
    const sql = this.neonService.getSql();
    if (!sql) throw new Error('Database unavailable');

    const truckRows = await sql`SELECT * FROM trucks WHERE id = ${truckId}::uuid LIMIT 1;`;
    if (!truckRows || truckRows.length === 0) throw new Error('Truck not found');
    const truck = truckRows[0];

    // Compute metrics from telemetry history
    const historyRows = await sql`
      SELECT
        COUNT(*)::int as total_points,
        COUNT(CASE WHEN temperature > target_temp + 2.0 THEN 1 END)::int as excursions,
        COUNT(CASE WHEN door_open = true THEN 1 END)::int as door_opens,
        COALESCE(AVG(ABS(temperature - target_temp)), 0.3)::numeric(4,2) as avg_dev
      FROM trip_telemetry_history
      WHERE truck_id = ${truckId}::uuid;
    `;
    const hist = historyRows[0] || {};

    const incidentRows = await sql`
      SELECT COUNT(*)::int as count FROM issues WHERE truck_id = ${truckId}::uuid;
    `;
    const incidentCount = incidentRows[0]?.count || 0;

    const tripsCountRows = await sql`
      SELECT COUNT(*)::int as count FROM trips WHERE truck_id = ${truckId}::uuid;
    `;
    const tripCount = tripsCountRows[0]?.count || 5;

    // Call AI/ML insurance pricing engine
    let aiResponse: any = null;
    try {
      const aiServiceUrl = process.env.AIML_API_URL || 'http://localhost:8000';
      const aiServiceToken = process.env.AIML_SERVICE_TOKEN;
      if (!aiServiceToken) throw new Error('AIML_SERVICE_TOKEN is not configured');
      const res = await fetch(`${aiServiceUrl}/api/predict/insurance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-service-token': aiServiceToken },
        body: JSON.stringify({
          truck_id: truckId,
          truck_type: truck.type,
          capacity_tons: Number(truck.capacity_tons) || 10.0,
          base_price: Number(truck.base_insurance_price) || 450.0,
          trip_count: tripCount,
          incident_count: incidentCount,
          temp_excursion_count: hist.excursions || 0,
          avg_temp_deviation: Number(hist.avg_dev) || 0.2,
          door_open_incidents: hist.door_opens || 0,
          months_in_service: 6,
        }),
      });
      if (res.ok) {
        aiResponse = await res.json();
      }
    } catch (e: any) {
      this.logger.warn(`AI Insurance service call failed: ${e.message}`);
    }

    if (!aiResponse) {
      // Fallback calculation
      const hasExcursions = (hist.excursions || 0) > 2;
      aiResponse = {
        base_price: 450.0,
        current_price: hasExcursions ? 495.0 : 405.0,
        price_change_pct: hasExcursions ? 10.0 : -10.0,
        risk_score: hasExcursions ? 65.0 : 18.0,
        risk_tier: hasExcursions ? 'HIGH_RISK (Surcharge)' : 'LOW_RISK (Discounted)',
        recommendation: hasExcursions ? 'Thermal excursions observed. Premium surcharged.' : 'Compliance discount applied.',
        pricing_factors: [],
      };
    }

    // Persist updated insurance pricing in Neon DB
    await sql`
      UPDATE trucks
      SET
        current_insurance_price = ${aiResponse.current_price},
        insurance_risk_score = ${aiResponse.risk_score},
        insurance_status = ${aiResponse.price_change_pct < 0 ? 'discounted' : aiResponse.price_change_pct > 0 ? 'surcharged' : 'standard'}
      WHERE id = ${truckId}::uuid;
    `;

    return aiResponse;
  }

  async syncDeviceRegistry(devices: Array<{
    id: string; connectionNumber: string; name: string; productType?: string;
    battery?: number; powerOn?: boolean; status?: string;
  }>, removedDeviceIds: string[] = []) {
    const sql = this.neonService.getSql();
    if (!sql) throw new ServiceUnavailableException('Persistent database is unavailable.');
    if (!Array.isArray(devices) || devices.length > 200) throw new BadRequestException('Invalid IoT device registry payload.');
    const normalized = devices.map((device) => {
      const deviceId = String(device?.id || '').trim();
      const connectionNumber = String(device?.connectionNumber || '').trim().toUpperCase();
      if (!deviceId || !connectionNumber || deviceId.length > 100 || connectionNumber.length > 50) {
        throw new BadRequestException('Every registered device requires a valid ID and connection code.');
      }
      const battery = device.battery == null ? null : Number(device.battery);
      if (battery != null && (!Number.isFinite(battery) || battery < 0 || battery > 100)) {
        throw new BadRequestException(`Invalid battery level for device ${deviceId}.`);
      }
      return {
        id: deviceId, connection: connectionNumber,
        name: String(device.name || deviceId).slice(0, 150),
        product: device.productType ? String(device.productType).slice(0, 150) : null,
        battery, powerOn: device.powerOn === true,
        status: String(device.status || 'offline').toLowerCase().slice(0, 30),
      };
    });
    if (new Set(normalized.map((d) => d.id)).size !== normalized.length
      || new Set(normalized.map((d) => d.connection)).size !== normalized.length) {
      throw new ConflictException('Device IDs and connection codes must be unique.');
    }
    const statements: Array<{ text: string; values: unknown[] }> = [
      ...(removedDeviceIds.length ? [{
        text: 'UPDATE iot_devices SET active = false, updated_at = NOW() WHERE device_id = ANY($1::varchar[])',
        values: [removedDeviceIds],
      }] : []),
      ...normalized.map((device) => ({
        text: `INSERT INTO iot_devices (device_id, connection_number, name, product_type, battery, power_on, reported_status, active, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW())
               ON CONFLICT (device_id) DO UPDATE SET connection_number = EXCLUDED.connection_number,
                 name = EXCLUDED.name, product_type = EXCLUDED.product_type,
                 battery = COALESCE(EXCLUDED.battery, iot_devices.battery), power_on = EXCLUDED.power_on,
                 reported_status = EXCLUDED.reported_status, active = true, updated_at = NOW()`,
        values: [device.id, device.connection, device.name, device.product, device.battery, device.powerOn, device.status],
      })),
    ];
    try {
      await this.neonService.runTransaction(statements);
    } catch (error: any) {
      if (error?.code === '23505') throw new ConflictException('An IoT connection code is already registered to another device.');
      throw error;
    }
    return { success: true, registered: normalized.length };
  }

  async getDevices(user: { sub: string; role: string; truckId?: string | null }) {
    const sql = this.neonService.getSql();
    if (!sql) throw new ServiceUnavailableException('Persistent database is unavailable.');
    let rows: any[];
    if (user.role === 'admin') {
      rows = await sql`SELECT d.*, t.id AS paired_truck_id, t.plate_number
        FROM iot_devices d LEFT JOIN trucks t ON t.iot_connection_number = d.connection_number
        WHERE d.active = true ORDER BY d.name;`;
    } else if (user.role === 'owner') {
      rows = await sql`SELECT d.*, t.id AS paired_truck_id, t.plate_number
        FROM iot_devices d LEFT JOIN trucks t ON t.iot_connection_number = d.connection_number
        WHERE d.active = true AND (t.owner_id = ${user.sub}::uuid OR t.id IS NULL) ORDER BY d.name;`;
    } else if (user.role === 'truckUser' && user.truckId) {
      rows = await sql`SELECT d.*, t.id AS paired_truck_id, t.plate_number
        FROM iot_devices d JOIN trucks t ON t.iot_connection_number = d.connection_number
        WHERE d.active = true AND t.id = ${user.truckId}::uuid ORDER BY d.name;`;
    } else {
      throw new ForbiddenException('No device access is available for this account.');
    }
    const onlineWindow = 2 * 60 * 1000;
    const now = Date.now();
    return rows.map((row) => {
      const lastSeen = row.last_seen ? new Date(row.last_seen) : null;
      const online = Boolean(lastSeen && now - lastSeen.getTime() <= onlineWindow && row.power_on);
      const battery = row.battery == null ? null : Number(row.battery);
      const reported = String(row.reported_status || '').toLowerCase();
      const deviceStatus = reported.includes('error') || reported === 'warning' ? 'ERROR'
        : battery !== null && battery < 20 ? 'LOW BATTERY'
        : online ? 'ONLINE' : 'OFFLINE';
      return {
        device_id: row.device_id,
        name: row.name,
        product_type: row.product_type,
        connection_number: row.connection_number,
        battery,
        last_seen: lastSeen?.toISOString() || null,
        status: deviceStatus,
        pairing_status: row.paired_truck_id ? 'PAIRED' : 'UNPAIRED',
        boundTruckId: row.paired_truck_id || null,
        plate_number: row.plate_number || null,
        isPaired: Boolean(row.paired_truck_id),
      };
    });
  }

  // Connect a registered device to one active truck; a unique truck column
  // enforces single assignment under concurrent requests.
  async connectDevice(truckId: string, rawConnectionNumber: string, actorId: string) {
    const conn = rawConnectionNumber.trim().toUpperCase();
    if (!conn) throw new BadRequestException('A device connection code is required.');
    if (!this.neonService.getSql()) throw new ServiceUnavailableException('Persistent database is unavailable.');
    let results: any[][];
    try {
      results = await this.neonService.runTransaction([
        {
          text: `SELECT id FROM trucks WHERE id = $1 AND active = true FOR UPDATE`,
          values: [truckId],
        },
        {
          text: `SELECT device_id FROM iot_devices WHERE connection_number = $1 AND active = true FOR UPDATE`,
          values: [conn],
        },
        {
          text: `SELECT id FROM trucks WHERE iot_connection_number = $1 AND id <> $2 FOR UPDATE`,
          values: [conn, truckId],
        },
        {
          text: `UPDATE trucks SET iot_connection_number = $1 WHERE id = $2 AND active = true
                 AND EXISTS (SELECT 1 FROM iot_devices WHERE connection_number = $1 AND active = true)
                 AND NOT EXISTS (SELECT 1 FROM trucks WHERE iot_connection_number = $1 AND id <> $2)
                 RETURNING id`,
          values: [conn, truckId],
        },
        {
          text: `INSERT INTO activity_log (actor_id, action, entity, entity_id, details)
                 SELECT $1::uuid, 'iot_device_paired', 'truck', id, $3::jsonb
                 FROM trucks WHERE id = $2::uuid AND iot_connection_number = $4`,
          values: [actorId, truckId, JSON.stringify({ connection_number: conn }), conn],
        },
      ]);
    } catch (error: any) {
      if (error?.code === '23505') throw new ConflictException('This device connection is already assigned.');
      throw error;
    }
    if (!results[0]?.length || !results[3]?.length) throw new NotFoundException('Active truck not found.');
    if (!results[1]?.length) throw new NotFoundException('Registered IoT device not found.');
    if (results[2]?.length) throw new ConflictException('This device is already assigned to another truck.');

    const previousConnection = this.truckToConnection.get(truckId);
    if (previousConnection && previousConnection !== conn) this.connectionToTruck.delete(previousConnection);
    this.truckToConnection.set(truckId, conn);
    this.connectionToTruck.set(conn, truckId);

    // If telemetry already exists for this connection, bind it immediately
    const existing = this.telemetryByConnection.get(conn);
    if (existing) {
      existing.truck_id = truckId;
      this.telemetryByTruckId.set(truckId, existing);
    }

    this.logger.log('[DB] Device-to-truck pairing UPDATE successful');
    return {
      success: true,
      message: `Truck successfully connected to IoT Device ${conn}`,
      truckId,
      connectionNumber: conn,
      latestTelemetry: existing || null,
    };
  }

  // Disconnect truck from IoT device
  async disconnectDevice(truckId: string, actorId: string) {
    const sql = this.neonService.getSql();
    if (!sql) throw new ServiceUnavailableException('Persistent database is unavailable.');
    const results = await this.neonService.runTransaction([{
      text: `WITH prior AS (
               SELECT id, iot_connection_number FROM trucks WHERE id = $1::uuid AND active = true FOR UPDATE
             ), updated AS (
               UPDATE trucks SET iot_connection_number = NULL FROM prior
               WHERE trucks.id = prior.id RETURNING trucks.id, prior.iot_connection_number AS old_connection
             ), logged AS (
               INSERT INTO activity_log (actor_id, action, entity, entity_id, details)
               SELECT $2::uuid, 'iot_device_unpaired', 'truck', id,
                 jsonb_build_object('connection_number', old_connection) FROM updated
             ) SELECT id FROM updated`,
      values: [truckId, actorId],
    }]);
    if (!results[0]?.length) throw new NotFoundException('Active truck not found.');
    const conn = this.truckToConnection.get(truckId);
    if (conn) {
      this.connectionToTruck.delete(conn);
    }
    this.truckToConnection.delete(truckId);
    this.telemetryByTruckId.delete(truckId);

    this.logger.log('[DB] Device-to-truck pairing DELETE successful');
    return { success: true, message: 'IoT device disconnected' };
  }

  // Get live telemetry for a truck
  getTelemetryForTruck(truckId: string): EnrichedIoTTelemetry | null {
    if (this.telemetryByTruckId.has(truckId)) {
      return this.telemetryByTruckId.get(truckId)!;
    }
    const conn = this.truckToConnection.get(truckId);
    if (conn && this.telemetryByConnection.has(conn)) {
      return this.telemetryByConnection.get(conn)!;
    }
    return null;
  }

  // Get connection number for truck
  getConnectionForTruck(truckId: string): string | null {
    return this.truckToConnection.get(truckId) || null;
  }

  // Strict tenant & IDOR verification
  async verifyTruckAccess(
    user: { sub: string; role: string; truckId?: string | null },
    truckId: string,
  ): Promise<boolean> {
    if (user.role === 'admin') return true;
    if (user.role === 'truckUser') {
      return user.truckId === truckId;
    }
    if (user.role === 'owner') {
      const sql = this.neonService.getSql();
      if (!sql) return false;
      const rows = await sql`
        SELECT id FROM trucks WHERE id = ${truckId}::uuid AND owner_id = ${user.sub}::uuid AND active = true LIMIT 1;
      `;
      return rows.length > 0;
    }
    return false;
  }
}
