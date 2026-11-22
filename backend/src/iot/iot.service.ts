import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
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
      }
    } catch (e: any) {
      this.logger.error(`Could not load persisted IoT bindings. Run database migrations before starting the API: ${e.message}`);
    }
  }

  // Ingest telemetry processed by AI/ML
  async ingest(payload: EnrichedIoTTelemetry) {
    if (!payload.connection_number) return { success: false, error: 'connection_number missing' };

    const conn = payload.connection_number.trim().toUpperCase();
    payload.connection_number = conn;

    // Check if this connection is bound to a truck
    const boundTruckId = this.connectionToTruck.get(conn) || payload.truck_id;
    if (boundTruckId) {
      payload.truck_id = boundTruckId;
      this.telemetryByTruckId.set(boundTruckId, payload);

      // Record snapshot to Neon Postgres every 15 minutes (or first time)
      const now = Date.now();
      const lastSaved = this.lastDbSnapshotTime.get(boundTruckId) || 0;
      if (now - lastSaved >= this.SNAPSHOT_INTERVAL_MS || lastSaved === 0) {
        this.lastDbSnapshotTime.set(boundTruckId, now);
        this.saveSnapshotToDb(boundTruckId, payload).catch((e) =>
          this.logger.warn(`Failed to save 15-min snapshot: ${e.message}`),
        );
      }
    }

    this.telemetryByConnection.set(conn, payload);
    return {
      success: true,
      connection_number: conn,
      truck_id: boundTruckId || null,
      spoilage_risk: payload.spoilage_risk,
      spoilage_risk_level: payload.spoilage_risk_level,
    };
  }

  private async saveSnapshotToDb(truckId: string, p: EnrichedIoTTelemetry) {
    const sql = this.neonService.getSql();
    if (!sql) return;

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
          ${p.door_open}, ${p.gps?.lat || 19.0760}, ${p.gps?.lng || 72.8777},
          ${p.gps?.speed_kmh || 45.0}, ${p.spoilage_risk}, ${p.spoilage_risk_level},
          ${p.shelf_life_remaining_hours}, ${p.quality_retention_pct}, ${p.route_recommendation}
        );
      `;
    } catch (e: any) {
      this.logger.warn(`Error persisting snapshot to Neon DB: ${e.message}`);
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

  // Get active online simulated IoT devices
  getActiveDevices() {
    const list: any[] = [];
    for (const [conn, tel] of this.telemetryByConnection.entries()) {
      const boundTruck = this.connectionToTruck.get(conn);
      list.push({
        ...tel,
        boundTruckId: boundTruck || null,
        isPaired: Boolean(boundTruck),
      });
    }
    return list;
  }

  // Connect a truck to an IoT connection number
  async connectDevice(truckId: string, rawConnectionNumber: string) {
    const conn = rawConnectionNumber.trim().toUpperCase();

    // Store in-memory
    this.truckToConnection.set(truckId, conn);
    this.connectionToTruck.set(conn, truckId);

    // If telemetry already exists for this connection, bind it immediately
    const existing = this.telemetryByConnection.get(conn);
    if (existing) {
      existing.truck_id = truckId;
      this.telemetryByTruckId.set(truckId, existing);
    }

    // Persist in DB
    try {
      const sql = this.neonService.getSql();
      if (sql) {
        await sql`UPDATE trucks SET iot_connection_number = ${conn} WHERE id = ${truckId}::uuid;`;
      }
    } catch (e: any) {
      this.logger.warn(`Could not persist iot_connection_number in DB: ${e.message}`);
    }

    return {
      success: true,
      message: `Truck successfully connected to IoT Device ${conn}`,
      truckId,
      connectionNumber: conn,
      latestTelemetry: existing || null,
    };
  }

  // Disconnect truck from IoT device
  async disconnectDevice(truckId: string) {
    const conn = this.truckToConnection.get(truckId);
    if (conn) {
      this.connectionToTruck.delete(conn);
    }
    this.truckToConnection.delete(truckId);
    this.telemetryByTruckId.delete(truckId);

    try {
      const sql = this.neonService.getSql();
      if (sql) {
        await sql`UPDATE trucks SET iot_connection_number = NULL WHERE id = ${truckId}::uuid;`;
      }
    } catch (e: any) {
      this.logger.warn(`Could not clear iot_connection_number in DB: ${e.message}`);
    }

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
