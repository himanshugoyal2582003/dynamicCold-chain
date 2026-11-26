import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { NeonService } from '../neon/neon.service';

export interface EnrichedIoTTelemetry {
  device_id: string;
  connection_number: string;
  source?: 'sensor' | 'fallback';
  received_at?: string;
  device_target_temp?: number;
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
  good_env_rsl_hours?: number | null;
  bad_env_rsl_hours?: number | null;
  environment_condition?: string | null;
  model_type?: string | null;
  timestamp: string;
}

@Injectable()
export class IotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IotService.name);

  // Connection Number -> Latest Enriched Telemetry
  private readonly telemetryByConnection = new Map<string, EnrichedIoTTelemetry>();

  // Truck ID -> Latest Enriched Telemetry
  private readonly telemetryByTruckId = new Map<string, EnrichedIoTTelemetry>();

  // Mappings
  private readonly truckToConnection = new Map<string, string>();
  private readonly connectionToTruck = new Map<string, string>();

  // Track last DB snapshot timestamp per truck (1-minute interval = 60,000 ms)
  private readonly lastDbSnapshotTime = new Map<string, number>();
  private readonly SNAPSHOT_INTERVAL_MS = 60 * 1000;
  private tripTelemetryTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly neonService: NeonService) {}

  async onModuleInit() {
    await this.ensureIotColumn();
    this.tripTelemetryTimer = setInterval(() => {
      void this.captureActiveTripTelemetry();
    }, 5000);
    void this.captureActiveTripTelemetry();
  }

  private async ensureIotColumn() {
    const sql = this.neonService.getSql();
    if (!sql) return;
    try {
      await sql`ALTER TABLE trucks ADD COLUMN IF NOT EXISTS iot_connection_number VARCHAR(50);`;
      await sql`ALTER TABLE trucks ADD COLUMN IF NOT EXISTS base_insurance_price NUMERIC(8,2) DEFAULT 450.00;`;
      await sql`ALTER TABLE trucks ADD COLUMN IF NOT EXISTS current_insurance_price NUMERIC(8,2) DEFAULT 450.00;`;
      await sql`ALTER TABLE trucks ADD COLUMN IF NOT EXISTS insurance_risk_score NUMERIC(5,2) DEFAULT 15.0;`;
      await sql`ALTER TABLE trucks ADD COLUMN IF NOT EXISTS insurance_status VARCHAR(20) DEFAULT 'discounted';`;
      await sql`ALTER TABLE trip_telemetry_history ADD COLUMN IF NOT EXISTS good_env_rsl_hours NUMERIC(6,2);`;
      await sql`ALTER TABLE trip_telemetry_history ADD COLUMN IF NOT EXISTS bad_env_rsl_hours NUMERIC(6,2);`;
      await sql`ALTER TABLE trip_telemetry_history ADD COLUMN IF NOT EXISTS environment_condition VARCHAR(30);`;
      await sql`ALTER TABLE trip_telemetry_history ADD COLUMN IF NOT EXISTS base_insurance_price NUMERIC(8,2);`;
      await sql`ALTER TABLE trip_telemetry_history ADD COLUMN IF NOT EXISTS predicted_insurance_price NUMERIC(8,2);`;
      await sql`ALTER TABLE trip_telemetry_history ADD COLUMN IF NOT EXISTS insurance_risk_score NUMERIC(5,2);`;
      await sql`ALTER TABLE trip_telemetry_history ADD COLUMN IF NOT EXISTS model_type VARCHAR(50);`;
    } catch (e: any) {
      this.logger.warn(`Could not ensure IoT/LSTM schema columns: ${e.message}`);
    }
  }

  onModuleDestroy() {
    if (this.tripTelemetryTimer) clearInterval(this.tripTelemetryTimer);
  }

  private async captureActiveTripTelemetry() {
    const sql = this.neonService.getSql();
    if (!sql) return;

    try {
      const activeTrucks = await sql`
        SELECT t.id, t.plate_number, t.type, t.target_temp_c, t.iot_connection_number,
          (SELECT tr.cargo_type FROM trips tr WHERE tr.truck_id = t.id AND tr.ended_at IS NULL ORDER BY tr.started_at DESC LIMIT 1) AS cargo_type
        FROM trucks t
        INNER JOIN trips tr ON tr.truck_id = t.id AND tr.ended_at IS NULL
        WHERE t.active = true;
      `;

      for (const truck of activeTrucks) {
        try {
          const configuredConnection = truck.iot_connection_number?.trim().toUpperCase();
          const physicalReading = configuredConnection
            ? this.telemetryByTruckId.get(truck.id)
            : null;
          const readingAge = physicalReading
            ? Date.now() - new Date(physicalReading.timestamp).getTime()
            : Number.POSITIVE_INFINITY;
          // Prefer a fresh physical sensor feed. Use the simulator only when
          // a paired sensor is not currently sending readings.
          if (
            physicalReading &&
            physicalReading.source === 'sensor' &&
            readingAge >= 0 &&
            readingAge < 30000
          ) continue;

          const baseUrl = process.env.AI_ML_API_URL || 'http://localhost:8000';
          const targetTemp = truck.target_temp_c == null ? 4 : Number(truck.target_temp_c);
          const params = new URLSearchParams({ target_temp: String(targetTemp) });
          const productType = truck.cargo_type || truck.type;
          if (productType) params.set('product_type', productType);
          const response = await fetch(
            `${baseUrl}/api/trucks/${encodeURIComponent(truck.plate_number)}/telemetry?${params.toString()}`,
            { signal: AbortSignal.timeout(4000) },
          );
          if (!response.ok) continue;

          const result = await response.json() as any;
          const sample = result?.latest;
          if (!sample) continue;

          const connectionNumber = truck.iot_connection_number || `SIM-${truck.id}`;
          await this.ingest({
            device_id: `SIM-${truck.id}`,
            connection_number: connectionNumber,
            source: 'fallback',
            truck_id: truck.id,
            plate_number: truck.plate_number,
            device_name: truck.iot_connection_number ? `Sensor ${connectionNumber}` : 'Trip telemetry simulator',
            product_type: productType || sample.product_type || 'Cold Cargo',
            temperature: Number(sample.temperature) || 0,
            target_temp: targetTemp,
            humidity: Number(sample.humidity) || 0,
            battery: 100,
            door_open: Boolean(sample.door_open),
            gps: {
              lat: Number(sample.gps_coordinates?.lat) || 19.076,
              lng: Number(sample.gps_coordinates?.lng) || 72.8777,
              speed_kmh: Number(sample.gps_coordinates?.speed_kmh) || 0,
            },
            status: 'online',
            spoilage_risk: Number(sample.anomaly_score) || 0.04,
            spoilage_risk_level: sample.spoilage_risk_level || 'LOW',
            shelf_life_remaining_hours: Number(sample.shelf_life_remaining_hours) || 0,
            quality_retention_pct: Number(sample.quality_retention_pct) || Math.max(0, Math.min(100, 100 * (1 - (Number(sample.anomaly_score) || 0.04)))),
            good_env_rsl_hours: sample.good_env_rsl_hours ?? null,
            bad_env_rsl_hours: sample.bad_env_rsl_hours ?? null,
            environment_condition: sample.environment_condition ?? null,
            model_type: sample.model_type || 'PyTorch-SpoilageLSTM',
            route_recommendation: sample.alert_message || 'Route optimal. Continue to destination.',
            reroute_suggested: (Number(sample.anomaly_score) || 0.04) >= 0.45,
            nearest_safe_market: null,
            alert_message: sample.alert_message || null,
            timestamp: sample.timestamp || new Date().toISOString(),
          }, 'fallback');
        } catch (error: any) {
          this.logger.debug(`Trip telemetry unavailable for ${truck.plate_number}: ${error.message}`);
        }
      }
    } catch (error: any) {
      this.logger.debug(`Could not capture active-trip telemetry: ${error.message}`);
    }
  }

  private async loadPersistedBindings() {
    try {
      const sql = this.neonService.getSql();
      if (sql) {
        await sql`ALTER TABLE trucks ADD COLUMN IF NOT EXISTS iot_connection_number VARCHAR(50);`;
        await sql`ALTER TABLE trucks ADD COLUMN IF NOT EXISTS base_insurance_price NUMERIC(8,2) DEFAULT 450.00;`;
        await sql`ALTER TABLE trucks ADD COLUMN IF NOT EXISTS current_insurance_price NUMERIC(8,2) DEFAULT 450.00;`;
        await sql`ALTER TABLE trucks ADD COLUMN IF NOT EXISTS insurance_risk_score NUMERIC(5,2) DEFAULT 15.0;`;
        await sql`ALTER TABLE trucks ADD COLUMN IF NOT EXISTS insurance_status VARCHAR(20) DEFAULT 'discounted';`;

        // Historical 15-minute telemetry database table on Neon
        await sql`
          CREATE TABLE IF NOT EXISTS trip_telemetry_history (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            trip_id UUID REFERENCES trips(id) ON DELETE SET NULL,
            truck_id UUID NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
            device_id VARCHAR(50),
            connection_number VARCHAR(50),
            temperature NUMERIC(5,2) NOT NULL,
            target_temp NUMERIC(5,2) NOT NULL,
            humidity NUMERIC(5,2) NOT NULL,
            battery NUMERIC(5,2) NOT NULL,
            door_open BOOLEAN DEFAULT false,
            gps_lat NUMERIC(9,6),
            gps_lng NUMERIC(9,6),
            speed_kmh NUMERIC(5,2),
            spoilage_risk NUMERIC(5,2),
            spoilage_risk_level VARCHAR(20),
            rsl_hours NUMERIC(6,2),
            quality_retention_pct NUMERIC(5,2),
            good_env_rsl_hours NUMERIC(6,2),
            bad_env_rsl_hours NUMERIC(6,2),
            environment_condition VARCHAR(30),
            base_insurance_price NUMERIC(8,2),
            predicted_insurance_price NUMERIC(8,2),
            insurance_risk_score NUMERIC(5,2),
            model_type VARCHAR(50),
            route_recommendation TEXT,
            recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `;
        await sql`ALTER TABLE trip_telemetry_history ADD COLUMN IF NOT EXISTS good_env_rsl_hours NUMERIC(6,2);`;
        await sql`ALTER TABLE trip_telemetry_history ADD COLUMN IF NOT EXISTS bad_env_rsl_hours NUMERIC(6,2);`;
        await sql`ALTER TABLE trip_telemetry_history ADD COLUMN IF NOT EXISTS environment_condition VARCHAR(30);`;
        await sql`ALTER TABLE trip_telemetry_history ADD COLUMN IF NOT EXISTS base_insurance_price NUMERIC(8,2);`;
        await sql`ALTER TABLE trip_telemetry_history ADD COLUMN IF NOT EXISTS predicted_insurance_price NUMERIC(8,2);`;
        await sql`ALTER TABLE trip_telemetry_history ADD COLUMN IF NOT EXISTS insurance_risk_score NUMERIC(5,2);`;
        await sql`ALTER TABLE trip_telemetry_history ADD COLUMN IF NOT EXISTS model_type VARCHAR(50);`;

        // Load initial bindings
        const rows = await sql`
          SELECT id, iot_connection_number, COUNT(*) OVER (PARTITION BY iot_connection_number) AS connection_count
          FROM trucks WHERE iot_connection_number IS NOT NULL AND active = true;
        `;
        for (const row of rows) {
          if (row.iot_connection_number && Number(row.connection_count) === 1) {
            const conn = String(row.iot_connection_number).trim().toUpperCase();
            this.truckToConnection.set(row.id, conn);
            this.connectionToTruck.set(conn, row.id);
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
  async ingest(payload: EnrichedIoTTelemetry, source: 'sensor' | 'fallback' = 'sensor') {
    if (!payload.connection_number) return { success: false, error: 'connection_number missing' };

    const conn = payload.connection_number.trim().toUpperCase();
    payload.connection_number = conn;

    const sql = this.neonService.getSql();
    let truck: any = null;
    if (sql && source === 'fallback' && payload.truck_id) {
      const rows = await sql`
        SELECT id, iot_connection_number, target_temp_c, type FROM trucks
        WHERE id = ${payload.truck_id}::uuid AND active = true LIMIT 1;
      `;
      truck = rows[0] || null;
      const configuredConnection = truck?.iot_connection_number?.trim().toUpperCase();
      const isConfiguredConnection = configuredConnection && configuredConnection === conn;
      const isUnpairedSyntheticConnection = !configuredConnection && conn === `SIM-${payload.truck_id}`;
      if (!truck || (!isConfiguredConnection && !isUnpairedSyntheticConnection)) {
        this.logger.warn(`Rejected fallback telemetry with mismatched truck/connection ${payload.truck_id}/${conn}`);
        return { success: false, error: 'Fallback telemetry truck/connection mismatch' };
      }
    } else if (sql && source === 'sensor') {
      const rows = await sql`
        SELECT id, iot_connection_number, target_temp_c, type FROM trucks
        WHERE UPPER(iot_connection_number) = ${conn} AND active = true;
      `;
      if (rows.length > 1) {
        this.logger.error(`Connection number ${conn} is assigned to multiple trucks; refusing telemetry association`);
        return { success: false, error: 'Connection number is assigned to multiple trucks' };
      }
      truck = rows[0] || null;
    }

    const boundTruckId = truck?.id || null;
    const now = new Date();
    const incomingTimestamp = Date.parse(payload.timestamp);
    const existingForTruck = boundTruckId ? this.telemetryByTruckId.get(boundTruckId) : null;
    const existingReceivedAt = existingForTruck?.received_at ? Date.parse(existingForTruck.received_at) : 0;

    if (
      source === 'fallback' && existingForTruck?.source === 'sensor' &&
      now.getTime() - existingReceivedAt < 30000
    ) {
      return { success: true, ignored: true, reason: 'Fresh paired sensor reading takes precedence', truck_id: boundTruckId };
    }
    if (
      existingForTruck && Number.isFinite(incomingTimestamp) &&
      incomingTimestamp < Date.parse(existingForTruck.timestamp)
    ) {
      return { success: true, ignored: true, reason: 'Out-of-order telemetry', truck_id: boundTruckId };
    }

    payload.source = source;
    payload.received_at = now.toISOString();
    if (truck?.target_temp_c !== undefined) {
      payload.device_target_temp = payload.target_temp;
      payload.target_temp = truck.target_temp_c == null ? Number(payload.target_temp) : Number(truck.target_temp_c);
      const deviation = Math.abs(Number(payload.temperature) - payload.target_temp);
      const targetMismatch = Math.abs(Number(payload.device_target_temp) - payload.target_temp) > 0.1;
      if (deviation > 1 || targetMismatch || payload.door_open) {
        const enforcedRisk = deviation > 3 ? 0.9 : deviation > 1.5 ? 0.6 : deviation > 1 ? 0.35 : payload.door_open ? 0.35 : 0.04;
        payload.spoilage_risk = targetMismatch
          ? Math.max(payload.door_open ? 0.35 : 0.04, enforcedRisk)
          : Math.max(Number(payload.spoilage_risk) || 0, enforcedRisk);
        const enforcedLevel = deviation > 3 ? 'CRITICAL' : deviation > 1.5 ? 'HIGH' : deviation > 1 || payload.door_open ? 'MODERATE' : 'LOW';
        const rank: Record<string, number> = { LOW: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 };
        const existingLevel = payload.spoilage_risk >= 0.75
          ? 'CRITICAL'
          : payload.spoilage_risk >= 0.45
            ? 'HIGH'
            : payload.spoilage_risk >= 0.25
              ? 'MODERATE'
              : payload.spoilage_risk_level;
        if (targetMismatch || (rank[enforcedLevel] ?? 0) > (rank[existingLevel] ?? 0)) {
          payload.spoilage_risk_level = enforcedLevel;
        }
        payload.reroute_suggested = deviation > 1.5 || payload.reroute_suggested;
        payload.alert_message = deviation > 1
          ? `Temperature ${Number(payload.temperature).toFixed(1)}°C is outside truck target ${payload.target_temp.toFixed(1)}°C by ${deviation.toFixed(1)}°C.`
          : targetMismatch
            ? `Sensor setpoint ${Number(payload.device_target_temp).toFixed(1)}°C differs from truck target ${payload.target_temp.toFixed(1)}°C; safety risk uses the truck target.`
            : 'Door-open event detected; monitoring cargo temperature.';
        if (targetMismatch && deviation <= 1 && !payload.door_open) payload.reroute_suggested = false;
        payload.route_recommendation = payload.alert_message;
      }
    }

    if (boundTruckId) {
      payload.truck_id = boundTruckId;
      this.telemetryByTruckId.set(boundTruckId, payload);
      if (source === 'sensor') {
        this.truckToConnection.set(boundTruckId, conn);
        this.connectionToTruck.set(conn, boundTruckId);
      }

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

      let insPrediction: any = null;
      try {
        insPrediction = await this.recalculateInsurance(truckId);
      } catch {
        // Fallback if insurance calculation fails during background snapshot
      }

      await sql`
        INSERT INTO trip_telemetry_history (
          trip_id, truck_id, device_id, connection_number, temperature, target_temp,
          humidity, battery, door_open, gps_lat, gps_lng, speed_kmh, spoilage_risk,
          spoilage_risk_level, rsl_hours, quality_retention_pct,
          good_env_rsl_hours, bad_env_rsl_hours, environment_condition,
          base_insurance_price, predicted_insurance_price, insurance_risk_score,
          model_type, route_recommendation
        ) VALUES (
          ${tripId}, ${truckId}::uuid, ${p.device_id}, ${p.connection_number},
          ${p.temperature}, ${p.target_temp}, ${p.humidity}, ${p.battery},
          ${p.door_open}, ${p.gps?.lat || 19.0760}, ${p.gps?.lng || 72.8777},
          ${p.gps?.speed_kmh || 45.0}, ${p.spoilage_risk}, ${p.spoilage_risk_level},
          ${p.shelf_life_remaining_hours}, ${p.quality_retention_pct},
          ${p.good_env_rsl_hours ?? null}, ${p.bad_env_rsl_hours ?? null},
          ${p.environment_condition ?? null},
          ${insPrediction?.base_price ?? null},
          ${insPrediction?.current_price ?? null},
          ${insPrediction?.risk_score ?? null},
          ${p.model_type ?? 'PyTorch-SpoilageLSTM'},
          ${p.route_recommendation}
        );
      `;
    } catch (e: any) {
      this.logger.warn(`[DB] Telemetry snapshot INSERT failed: ${e.message}`);
      throw e;
    }
  }

  // Retrieve 1-minute LSTM telemetry & insurance logs across all trucks (Admin)
  async getAllLstmLogs(limit: number = 200) {
    const sql = this.neonService.getSql();
    if (!sql) return [];
    try {
      return await sql`
        SELECT h.*, t.plate_number, t.type AS truck_type,
               t.base_insurance_price AS truck_base_price,
               t.current_insurance_price AS truck_current_price,
               u.name AS owner_name
        FROM trip_telemetry_history h
        INNER JOIN trucks t ON t.id = h.truck_id
        LEFT JOIN users u ON u.id = t.owner_id
        ORDER BY h.recorded_at DESC
        LIMIT ${limit};
      `;
    } catch (e: any) {
      this.logger.warn(`Failed to fetch all LSTM logs: ${e.message}`);
      return [];
    }
  }

  // Retrieve 1-minute LSTM telemetry & insurance logs for an Owner's fleet
  async getOwnerLstmLogs(ownerId: string, limit: number = 200) {
    const sql = this.neonService.getSql();
    if (!sql) return [];
    try {
      return await sql`
        SELECT h.*, t.plate_number, t.type AS truck_type,
               t.base_insurance_price AS truck_base_price,
               t.current_insurance_price AS truck_current_price
        FROM trip_telemetry_history h
        INNER JOIN trucks t ON t.id = h.truck_id
        WHERE t.owner_id = ${ownerId}::uuid
        ORDER BY h.recorded_at DESC
        LIMIT ${limit};
      `;
    } catch (e: any) {
      this.logger.warn(`Failed to fetch owner LSTM logs: ${e.message}`);
      return [];
    }
  }

  // Retrieve 15-minute time series history for a truck
  async getTelemetryHistory(truckId: string, limit: number = 30) {
    const sql = this.neonService.getSql();
    if (!sql) return [];
    try {
      return await sql`
        SELECT * FROM trip_telemetry_history
        WHERE truck_id = ${truckId}::uuid
        ORDER BY recorded_at DESC
        LIMIT ${limit};
      `;
    } catch (e: any) {
      this.logger.warn(`Failed to fetch history for truck ${truckId}: ${e.message}`);
      return [];
    }
  }

  // Dynamic AI Insurance Pricing model calculation
  async recalculateInsurance(truckId: string) {
    const sql = this.neonService.getSql();
    if (!sql) throw new Error('Database unavailable');

    const truckRows = await sql`SELECT * FROM trucks WHERE id = ${truckId}::uuid LIMIT 1;`;
    if (!truckRows || truckRows.length === 0) throw new Error('Truck not found');
    const truck = truckRows[0];

    // Compute metrics from telemetry history
    let hist: any = {};
    try {
      const historyRows = await sql`
        SELECT
          COUNT(*)::int as total_points,
          COUNT(CASE WHEN temperature > target_temp + 2.0 THEN 1 END)::int as excursions,
          COUNT(CASE WHEN door_open = true THEN 1 END)::int as door_opens,
          COALESCE(AVG(ABS(temperature - target_temp)), 0.3)::numeric(4,2) as avg_dev
        FROM trip_telemetry_history
        WHERE truck_id = ${truckId}::uuid;
      `;
      hist = historyRows[0] || {};
    } catch (e: any) {
      this.logger.warn(`Could not query telemetry history metrics: ${e.message}`);
    }

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
      const baseUrl = process.env.AI_ML_API_URL || 'http://localhost:8000';
      const aiServiceToken = process.env.AI_ML_SERVICE_TOKEN || '';
      const res = await fetch(`${baseUrl}/api/predict/insurance`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(aiServiceToken ? { 'x-service-token': aiServiceToken } : {}),
        },
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
      if (tel.source === 'fallback') continue;
      const boundTruck = this.connectionToTruck.get(conn);
      list.push({
        ...tel,
        boundTruckId: boundTruck || null,
        isPaired: Boolean(boundTruck),
      });
    }
    return list;
  }

  async syncDeviceRegistry(
    devices: Array<{ id: string; connectionNumber: string; name: string; productType?: string; battery?: number; powerOn?: boolean; status?: string }> = [],
    removedDeviceIds: string[] = [],
  ) {
    const normalized = (devices || [])
      .filter((d) => d?.id && d?.connectionNumber)
      .map((d) => ({
        id: String(d.id).trim(),
        connection: String(d.connectionNumber).trim().toUpperCase(),
        name: String(d.name || d.id).trim(),
        product: String(d.productType || 'Cold Cargo').trim(),
        battery: d.battery == null ? null : Number(d.battery),
        powerOn: d.powerOn !== false,
        status: String(d.status || (d.powerOn === false ? 'offline' : 'online')).trim(),
      }));

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

  // Connect a truck to an IoT connection number
  async connectDevice(truckId: string, rawConnectionNumber: string, _actorId?: string) {
    const conn = rawConnectionNumber.trim().toUpperCase();

    const sql = this.neonService.getSql();
    if (!sql) throw new BadRequestException('Database unavailable; cannot verify device pairing.');
    const conflicts = await sql`
      SELECT id FROM trucks WHERE UPPER(iot_connection_number) = ${conn} AND active = true AND id <> ${truckId}::uuid LIMIT 1;
    `;
    if (conflicts.length) throw new BadRequestException('This IoT device is already paired with another truck.');

    const truckRows = await sql`SELECT id FROM trucks WHERE id = ${truckId}::uuid AND active = true LIMIT 1;`;
    if (!truckRows.length) throw new BadRequestException('Truck not found or inactive.');

    // Remove any previous connection for this truck before replacing its pair.
    const previous = this.truckToConnection.get(truckId);
    if (previous && previous !== conn) {
      this.connectionToTruck.delete(previous);
      this.telemetryByTruckId.delete(truckId);
    }
    const previousOwner = this.connectionToTruck.get(conn);
    if (previousOwner && previousOwner !== truckId) {
      this.truckToConnection.delete(previousOwner);
      this.telemetryByTruckId.delete(previousOwner);
    }
    this.truckToConnection.set(truckId, conn);
    this.connectionToTruck.set(conn, truckId);

    // Persist in DB
    await sql`UPDATE trucks SET iot_connection_number = ${conn} WHERE id = ${truckId}::uuid AND active = true;`;

    // Re-ingest any prior unpaired sample so it gets verified and evaluated
    // against the truck's configured setpoint before appearing in its page.
    const priorTelemetry = this.telemetryByConnection.get(conn);
    if (priorTelemetry) await this.ingest({ ...priorTelemetry, truck_id: truckId }, priorTelemetry.source || 'sensor');
    const existing = this.telemetryByTruckId.get(truckId) || null;

    return {
      success: true,
      message: `Truck successfully connected to IoT Device ${conn}`,
      truckId,
      connectionNumber: conn,
      latestTelemetry: existing || null,
    };
  }

  // Disconnect truck from IoT device
  async disconnectDevice(truckId: string, _actorId?: string) {
    const sql = this.neonService.getSql();
    const conn = this.truckToConnection.get(truckId) || null;
    if (conn) {
      if (this.connectionToTruck.get(conn) === truckId) this.connectionToTruck.delete(conn);
    }
    this.truckToConnection.delete(truckId);
    this.telemetryByTruckId.delete(truckId);

    try {
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
