import { Injectable, Logger } from '@nestjs/common';
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
export class IotService {
  private readonly logger = new Logger(IotService.name);

  // Connection Number -> Latest Enriched Telemetry
  private readonly telemetryByConnection = new Map<string, EnrichedIoTTelemetry>();

  // Truck ID -> Latest Enriched Telemetry
  private readonly telemetryByTruckId = new Map<string, EnrichedIoTTelemetry>();

  // Mappings
  private readonly truckToConnection = new Map<string, string>();
  private readonly connectionToTruck = new Map<string, string>();

  constructor(private readonly neonService: NeonService) {
    this.ensureIotColumn();
  }

  private async ensureIotColumn() {
    try {
      const sql = this.neonService.getSql();
      if (sql) {
        await sql`ALTER TABLE trucks ADD COLUMN IF NOT EXISTS iot_connection_number VARCHAR(50);`;
        // Load initial bindings
        const rows = await sql`SELECT id, iot_connection_number FROM trucks WHERE iot_connection_number IS NOT NULL;`;
        for (const row of rows) {
          if (row.iot_connection_number) {
            this.truckToConnection.set(row.id, row.iot_connection_number);
            this.connectionToTruck.set(row.iot_connection_number, row.id);
          }
        }
      }
    } catch (e: any) {
      this.logger.warn(`Could not ensure iot_connection_number column: ${e.message}`);
    }
  }

  // Ingest telemetry processed by AI/ML
  ingest(payload: EnrichedIoTTelemetry) {
    if (!payload.connection_number) return { success: false, error: 'connection_number missing' };

    const conn = payload.connection_number.trim().toUpperCase();
    payload.connection_number = conn;

    // Check if this connection is bound to a truck
    const boundTruckId = this.connectionToTruck.get(conn) || payload.truck_id;
    if (boundTruckId) {
      payload.truck_id = boundTruckId;
      this.telemetryByTruckId.set(boundTruckId, payload);
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

