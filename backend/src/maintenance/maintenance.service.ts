import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException,
  OnModuleDestroy, OnModuleInit, ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { NeonService } from '../neon/neon.service';
import { assessThermalHealth, extractThermalFeatures, MAX_SAMPLE_AGE_MS, MODEL_VERSION, ThermalSample, WINDOW_MS } from './thermal-health';

type Actor = { sub: string; role: string };
export interface ReportedSensor {
  observed_at: string;
  temperature_c: number;
  humidity_pct: number;
  door_open: boolean | null;
}

const INTERVAL_MS = 5 * 60_000;
const BASELINE_MS = 24 * 60 * 60_000;
const PAGE_SIZE = 50;
const ACCESS = `EXISTS (
  SELECT 1 FROM users u WHERE u.id = $1 AND u.active AND u.role = $2
    AND (u.role = 'admin' OR (u.role = 'owner' AND t.owner_id = u.id))
)`;

@Injectable()
export class MaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceService.name);
  private readonly sensors = (process.env.IOT_INGEST_SECRET?.trim() ? process.env.MAINTENANCE_SENSOR_IDS ?? '' : '').split(',').map(s => s.trim())
    .filter(s => s && !/^(SIM-|DEV-ESP32-)/i.test(s));
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private lastCaptureError = 0;

  constructor(private readonly neon: NeonService) {}

  onModuleInit() {
    if (!this.sensors.length) return;
    this.timer = setInterval(() => {
      void this.runAssessmentCycle().catch(() => this.logger.warn('Maintenance assessment cycle failed'));
    }, 60_000);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  private get sql() {
    const sql = this.neon.getSql();
    if (!sql) throw new ServiceUnavailableException('Database unavailable');
    return sql;
  }

  async recordSensor(truckId: string, deviceId: string, connection: string, sample?: ReportedSensor) {
    if (!sample || !this.sensors.includes(deviceId) || deviceId.length > 100 || connection.length > 50 ||
        /^(SIM-|DEV-ESP32-)/i.test(connection)) return;
    const observed = typeof sample.observed_at === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(sample.observed_at)
      ? Date.parse(sample.observed_at) : NaN;
    const now = Date.now();
    if (!Number.isFinite(observed) || observed > now + 5000 || now - observed > MAX_SAMPLE_AGE_MS ||
        !Number.isFinite(sample.temperature_c) || sample.temperature_c < -80 || sample.temperature_c > 85 ||
        !Number.isFinite(sample.humidity_pct) || sample.humidity_pct < 0 || sample.humidity_pct > 100 ||
        (sample.door_open !== null && typeof sample.door_open !== 'boolean')) return;

    try {
      await this.sql(
        `INSERT INTO maintenance_sensor_samples (
            truck_id, device_id, connection_number, sample_minute, observed_at,
            temperature_c, target_c, humidity_pct, door_open
         )
         SELECT id, $2, $3::text, date_trunc('minute', $4::timestamptz), $4, $5, target_temp_c, $6, $7
         FROM trucks WHERE id = $1 AND active AND upper(btrim(iot_connection_number)) = $3::text
         ON CONFLICT (truck_id, sample_minute) DO NOTHING`,
        [truckId, deviceId, connection, new Date(observed).toISOString(), sample.temperature_c, sample.humidity_pct, sample.door_open],
      );
    } catch {
      if (now - this.lastCaptureError >= 60_000) {
        this.lastCaptureError = now;
        this.logger.warn('Maintenance telemetry could not be saved. Check database availability and migration 007.');
      }
    }
  }

  async runAssessmentCycle(now = Date.now()) {
    if (this.running || !this.sensors.length) return;
    this.running = true;
    try {
      const end = Math.floor(now / INTERVAL_MS) * INTERVAL_MS;
      const eligible = await this.sql(
        `SELECT t.id, sample.device_id, sample.connection_number
         FROM trucks t
         JOIN LATERAL (
           SELECT device_id, connection_number, target_c FROM maintenance_sensor_samples s
           WHERE s.truck_id = t.id AND s.device_id = ANY($3::text[])
             AND s.connection_number = upper(btrim(t.iot_connection_number))
             AND s.sample_minute >= $2 AND s.sample_minute < $1
             AND s.observed_at >= $2 AND s.observed_at < $1
           ORDER BY s.sample_minute DESC LIMIT 1
         ) sample ON sample.target_c = t.target_temp_c
         LEFT JOIN LATERAL (
           SELECT a.window_end FROM maintenance_assessments a
           WHERE a.truck_id = t.id
           ORDER BY a.window_end DESC LIMIT 1
         ) previous ON true
         WHERE t.active AND (previous.window_end IS NULL OR previous.window_end < $1)
         ORDER BY previous.window_end NULLS FIRST, t.id LIMIT 50`,
        [new Date(end).toISOString(), new Date(end - MAX_SAMPLE_AGE_MS).toISOString(), this.sensors],
      );
      for (const truck of eligible) {
        try {
          await this.assess(truck.id, truck.device_id, truck.connection_number, end);
        } catch {
          this.logger.warn(`Could not assess maintenance for truck ${truck.id}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async assess(truckId: string, deviceId: string, connection: string, end: number) {
    const rows = await this.sql(
      `SELECT (extract(epoch from observed_at) * 1000)::float8 AS time, temperature_c, target_c,
              humidity_pct, door_open
       FROM maintenance_sensor_samples
       WHERE truck_id = $1 AND device_id = $2 AND connection_number = $3
         AND sample_minute >= $4 AND sample_minute < $5
       ORDER BY sample_minute`,
      [truckId, deviceId, connection, new Date(end - BASELINE_MS - WINDOW_MS).toISOString(), new Date(end).toISOString()],
    );
    const samples: ThermalSample[] = rows.map(row => ({
      time: Number(row.time), temperature: Number(row.temperature_c), target: Number(row.target_c),
      humidity: Number(row.humidity_pct), doorOpen: row.door_open,
    }));
    const last = samples.at(-1);
    if (!last || end - last.time > MAX_SAMPLE_AGE_MS) return;
    const start = end - WINDOW_MS;
    const baselineBuckets = new Map<number, ThermalSample[]>();
    for (const sample of samples) {
      if (sample.time >= start) break;
      const bucket = Math.floor((sample.time - start) / WINDOW_MS);
      const window = baselineBuckets.get(bucket) ?? [];
      window.push(sample);
      baselineBuckets.set(bucket, window);
    }
    const history = [...baselineBuckets.values()].flatMap(window => {
      const features = window.at(-1)?.target === last.target ? extractThermalFeatures(window) : null;
      return features ? [features] : [];
    });
    const features = extractThermalFeatures(samples.filter(sample => sample.time >= start));
    const assessment = assessThermalHealth(features, history);
    await this.sql(
      `INSERT INTO maintenance_assessments (truck_id, window_end, last_observed_at, device_id,
          connection_number, model_version, score, severity, features, factors, baseline_windows, target_c)
       SELECT t.id, $2, $3, $4, $5::text, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12::numeric
       FROM trucks t WHERE t.id = $1 AND t.active AND upper(btrim(t.iot_connection_number)) = $5::text
          AND t.target_temp_c = $12
       ON CONFLICT (truck_id, window_end) DO NOTHING`,
      [truckId, new Date(end).toISOString(), new Date(last.time).toISOString(), deviceId, connection,
        MODEL_VERSION, assessment.score, assessment.severity, JSON.stringify(features), JSON.stringify(assessment.factors),
        assessment.baselineWindows, last.target],
    );
  }

  private authorize(actor?: Actor): Actor {
    if (!actor) throw new UnauthorizedException();
    if (!['admin', 'owner'].includes(actor.role)) throw new ForbiddenException();
    return actor;
  }

  private async read(sql: string, values: unknown[]) {
    try {
      return await this.sql(sql, values);
    } catch (error) {
      if ((error as { code?: string }).code === '42P01') {
        throw new ServiceUnavailableException('Maintenance database schema is unavailable');
      }
      throw error;
    }
  }

  async getFleet(actor: Actor | undefined, page: number) {
    const { sub, role } = this.authorize(actor);
    if (page < 1 || page > 10000) throw new BadRequestException('Page must be between 1 and 10000');
    const rows = await this.read(
      `SELECT t.id, t.plate_number, a.window_end, a.last_observed_at, a.score, a.severity, a.factors,
           a.baseline_windows, a.features, a.model_version, a.target_c::float8 AS target_c,
           CASE WHEN a.window_end IS NULL THEN 'no_data'
                WHEN a.last_observed_at < now() - interval '15 minutes' THEN 'stale'
                ELSE 'current' END AS data_status
       FROM trucks t LEFT JOIN LATERAL (
         SELECT * FROM maintenance_assessments m WHERE m.truck_id = t.id
           AND m.connection_number = upper(btrim(t.iot_connection_number)) AND m.target_c = t.target_temp_c
         ORDER BY m.window_end DESC LIMIT 1
       ) a ON true
       WHERE t.active AND ${ACCESS}
       ORDER BY t.plate_number, t.id LIMIT $3 OFFSET $4`,
      [sub, role, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE],
    );
    return { trucks: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE, collectionEnabled: !!this.sensors.length };
  }

  async getHistory(actor: Actor | undefined, truckId: string) {
    const { sub, role } = this.authorize(actor);
    const [truck] = await this.read(
      `SELECT t.id, t.plate_number,
        COALESCE((
          SELECT jsonb_agg(to_jsonb(a) ORDER BY a.window_end DESC) FROM (
            SELECT window_end, last_observed_at, score, severity, features, factors, baseline_windows,
              model_version, target_c
            FROM maintenance_assessments WHERE truck_id = t.id
              AND window_end >= now() - interval '30 days'
            ORDER BY window_end DESC LIMIT 96
          ) a
        ), '[]'::jsonb) AS assessments,
        COALESCE((
          SELECT jsonb_agg(to_jsonb(d) ORDER BY d.day DESC) FROM (
            SELECT (window_end AT TIME ZONE 'UTC')::date AS day, round(avg(score), 1) AS average_score,
                count(score) AS scored, count(*) FILTER (WHERE severity IN ('warning', 'critical')) AS warnings
            FROM maintenance_assessments WHERE truck_id = t.id AND window_end >= now() - interval '30 days'
            GROUP BY 1
          ) d
        ), '[]'::jsonb) AS daily
       FROM trucks t WHERE t.id = $3 AND ${ACCESS}`,
      [sub, role, truckId],
    );
    if (!truck) throw new NotFoundException('Truck not found');
    return truck;
  }
}
