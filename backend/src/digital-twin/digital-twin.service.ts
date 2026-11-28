import {
  ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { IotService } from '../iot/iot.service';
import { NeonService } from '../neon/neon.service';
import { RESCUE_SAFETY_BUFFER_MINUTES } from '../rescue/rescue-ranking.service';
import { forecast, MODEL_VERSION, SimulationInput } from './simulation';

type Actor = { sub: string; role: string } | undefined;

const SCOPE = `t.active AND EXISTS (
  SELECT 1 FROM users u WHERE u.id = $1 AND u.active AND u.role = $2
    AND (u.role = 'admin' OR (u.role = 'owner' AND t.owner_id = u.id))
)`;

@Injectable()
export class DigitalTwinService {
  constructor(private readonly neon: NeonService, private readonly iot: IotService) {}

  private authorize(actor: Actor) {
    if (!actor) throw new UnauthorizedException();
    if (actor.role !== 'admin' && actor.role !== 'owner') throw new ForbiddenException();
    return [actor.sub, actor.role];
  }

  private get sql() {
    const sql = this.neon.getSql();
    if (!sql) throw new ServiceUnavailableException('Database unavailable');
    return sql;
  }

  async list(actor: Actor, page: number) {
    const access = this.authorize(actor);
    const trucks = await this.sql(
      `SELECT t.id, t.plate_number FROM trucks t WHERE ${SCOPE}
       ORDER BY t.plate_number, t.id LIMIT 51 OFFSET $3`,
      [...access, (page - 1) * 50],
    );
    return { trucks: trucks.slice(0, 50), hasMore: trucks.length > 50 };
  }

  async simulate(actor: Actor, truckId: string, input: SimulationInput) {
    const access = this.authorize(actor);
    const [truck] = await this.sql(
      `SELECT t.plate_number, t.target_temp_c::float8 AS target_c, upper(btrim(t.iot_connection_number)) AS pairing,
              tr.id AS trip_id, tr.cargo_type, extract(epoch from tr.started_at AT TIME ZONE 'UTC') * 1000 AS trip_start_ms
       FROM trucks t LEFT JOIN trips tr ON tr.truck_id = t.id AND tr.status = 'IN_PROGRESS'
       WHERE ${SCOPE} AND t.id = $3`,
      [...access, truckId],
    );
    if (!truck) throw new NotFoundException('Truck not found');
    const reading = this.iot.getTelemetryForTruck(truckId);
    const now = Date.now();
    const observed = typeof reading?.timestamp === 'string' ? Date.parse(reading.timestamp) : NaN;
    const received = typeof reading?.received_at === 'string' ? Date.parse(reading.received_at) : NaN;
    const live = [observed, received].every(time => time >= now - 120_000 && time <= now + 5_000);
    const deviceId = typeof reading?.device_id === 'string' ? reading.device_id.trim() : '';
    const pairing = typeof reading?.connection_number === 'string' ? reading.connection_number.trim().toUpperCase() : '';
    if (!reading || reading.truck_id !== truckId || reading.source !== 'sensor' || !truck.pairing ||
        pairing !== truck.pairing || !deviceId || [deviceId, pairing].some(id => /^(SIM-|DEV-ESP32-)/i.test(id)) ||
        !live || observed > received + 5_000 || (truck.trip_id && observed < Number(truck.trip_start_ms)) ||
        !Number.isFinite(reading.temperature) || reading.temperature < -80 || reading.temperature > 85 ||
        !Number.isFinite(truck.target_c) || truck.target_c < -30 || truck.target_c > 25 ||
        !Number.isFinite(reading.target_temp) || Math.abs(reading.target_temp - truck.target_c) > 0.1 ||
        (reading.device_target_temp != null &&
          (!Number.isFinite(reading.device_target_temp) || Math.abs(reading.device_target_temp - truck.target_c) > 0.1))) {
      throw new ConflictException('A recent sensor reading from the current truck pairing and setpoint is required');
    }
    const seed = { airC: reading.temperature, targetC: truck.target_c };
    const baseline = forecast(seed, input, false);
    const emergency = forecast(seed, input, true);
    try {
      const [maintenance, rescue] = await Promise.all([
        this.readOptional(
          `SELECT severity, score, last_observed_at FROM maintenance_assessments
           WHERE truck_id = $1 AND connection_number = $2 AND device_id = $3 AND target_c = $4
           ORDER BY window_end DESC LIMIT 1`,
          [truckId, truck.pairing, reading.device_id, seed.targetC],
        ),
        truck.trip_id ? this.readOptional(
          `SELECT f.name, e.status, c.estimated_duration_seconds AS seconds
           FROM rescue_events e JOIN rescue_candidates c ON c.rescue_event_id = e.id
           JOIN cold_storage_facilities f ON f.id = c.facility_id
           WHERE e.trip_id = $1 AND e.truck_id = $2 AND e.valid_until > now()
             AND e.status IN ('DETECTED','RECOMMENDED','PENDING_APPROVAL','APPROVED','REROUTING')
             AND c.rank_position IS NOT NULL AND c.estimated_duration_seconds > 0
           ORDER BY e.created_at DESC, e.id DESC, c.rank_position LIMIT 1`,
          [truck.trip_id, truckId],
        ) : Promise.resolve(null),
      ]);
      const routeMinute = rescue ? Math.ceil(Number(rescue.seconds) / 60) : null;
      const rescueArrival = routeMinute === null ? null : emergency.series[routeMinute] ?? null;
      const bufferedArrival = routeMinute === null ? null : emergency.series[routeMinute + RESCUE_SAFETY_BUFFER_MINUTES] ?? null;
      return {
        hypothetical: true,
        modelVersion: MODEL_VERSION,
        truck: { id: truckId, plate: truck.plate_number, cargoType: truck.cargo_type ?? reading.product_type ?? null },
        seed: { ...seed, observedAt: reading.timestamp, source: 'paired_sensor' },
        input,
        baseline,
        emergency,
        incrementalLoss: Math.round((emergency.modeledLoss - baseline.modeledLoss) * 100) / 100,
        maintenance: maintenance ? {
          severity: maintenance.severity,
          score: maintenance.score,
          observedAt: maintenance.last_observed_at,
          stale: now - new Date(maintenance.last_observed_at).getTime() > 15 * 60_000,
        } : null,
        rescue: rescue ? {
          facility: rescue.name,
          status: rescue.status,
          routeMinute,
          bufferMinutes: RESCUE_SAFETY_BUFFER_MINUTES,
          remainingHoursAtEta: rescueArrival?.remainingHours ?? null,
          reserveAfterBuffer: bufferedArrival?.remainingHours ?? null,
        } : null,
      };
    } catch {
      throw new ServiceUnavailableException('Simulation context unavailable');
    }
  }

  private async readOptional(statement: string, params: unknown[]) {
    try {
      const [row] = await this.sql(statement, params);
      return row ?? null;
    } catch (error) {
      if ((error as { code?: string }).code === '42P01') return null;
      throw error;
    }
  }
}
