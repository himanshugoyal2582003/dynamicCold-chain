import {
    BadRequestException, ConflictException, ForbiddenException, Injectable,
    NotFoundException, ServiceUnavailableException
} from '@nestjs/common';
import { NeonService } from '../neon/neon.service';
import type { RescueDecisionInput } from './rescue.controller';
import { RescueLocationService } from './rescue-location.service';
import { RescueRankingService } from './rescue-ranking.service';
import { RescueTelemetryService } from './rescue-telemetry.service';
import { WarehouseService } from './warehouse.service';

export interface RescueActor {
    sub: string;
    role: string;
    truckId?: string | null;
}

const ACTIVE = ['DETECTED', 'RECOMMENDED', 'PENDING_APPROVAL', 'APPROVED', 'REROUTING'];
const ACCESS = `EXISTS (
    SELECT 1 FROM users u WHERE u.id = $2 AND u.active AND u.role = $3
    AND (u.role = 'admin' OR (u.role = 'owner' AND t.owner_id = u.id)
        OR (u.role = 'truckUser' AND tr.user_id = u.id AND tr.truck_id = u.truck_id))
)`;
const TRANSITIONS = {
    APPROVED: { from: ['PENDING_APPROVAL'], to: 'APPROVED', roles: ['owner', 'admin'] },
    REJECTED: { from: ['PENDING_APPROVAL', 'APPROVED'], to: 'REJECTED', roles: ['owner', 'admin'] },
    STARTED: { from: ['APPROVED'], to: 'REROUTING', roles: ['truckUser'] },
    COMPLETED: { from: ['REROUTING'], to: 'RESOLVED', roles: ['truckUser', 'owner', 'admin'] },
    CANCELLED: { from: ['REROUTING'], to: 'CANCELLED', roles: ['owner', 'admin'] }
};

@Injectable()
export class RescueService {
    constructor(
        private readonly neon: NeonService,
        private readonly ranking: RescueRankingService,
        private readonly telemetry: RescueTelemetryService,
        private readonly location: RescueLocationService,
        private readonly warehouses: WarehouseService
    ) {}

    private get sql() {
        const sql = this.neon.getSql();
        if (!sql) throw new ServiceUnavailableException('Database unavailable');
        return sql;
    }

    private async getAuthorizedTrip(actor: RescueActor, tripId: string) {
        if (!actor?.sub || !['owner', 'admin', 'truckUser'].includes(actor.role)) {
            throw new ForbiddenException('Access denied');
        }
        const [trip] = await this.sql(
            `SELECT tr.*, t.active AS truck_active, t.iot_connection_number,
                tr.started_at AT TIME ZONE 'UTC' AS trip_started_at,
                tr.started_at::text AS trip_start_key
             FROM trips tr JOIN trucks t ON t.id = tr.truck_id
             WHERE tr.id = $1 AND ${ACCESS}`,
            [tripId, actor.sub, actor.role]
        );
        if (!trip) throw new NotFoundException('Trip not found');
        return trip;
    }

    async getHistory(actor: RescueActor, tripId: string) {
        await this.getAuthorizedTrip(actor, tripId);
        return this.sql(
            `SELECT e.*,
                COALESCE((
                    SELECT jsonb_agg(to_jsonb(c) || jsonb_build_object(
                        'warehouse_name', f.name, 'latitude', f.latitude, 'longitude', f.longitude,
                        'state', f.state, 'district', f.district
                    ) ORDER BY c.rank_position NULLS LAST, c.id)
                    FROM rescue_candidates c JOIN cold_storage_facilities f ON f.id = c.facility_id
                    WHERE c.rescue_event_id = e.id
                ), '[]'::jsonb) AS candidates,
                COALESCE((
                    SELECT jsonb_agg(to_jsonb(d) ORDER BY d.created_at, d.id)
                    FROM rescue_decisions d WHERE d.rescue_event_id = e.id
                ), '[]'::jsonb) AS decisions
            FROM rescue_events e JOIN trips tr ON tr.id = e.trip_id JOIN trucks t ON t.id = tr.truck_id
            WHERE tr.id = $1 AND ${ACCESS}
            ORDER BY e.created_at DESC, e.id DESC`,
            [tripId, actor.sub, actor.role]
        );
    }

    private async findActive(actor: RescueActor, tripId: string) {
        const [event] = await this.sql(
            `SELECT e.id FROM rescue_events e
            JOIN trips tr ON tr.id = e.trip_id JOIN trucks t ON t.id = tr.truck_id
            WHERE tr.id = $1 AND ${ACCESS} AND e.status = ANY($4::text[])`,
            [tripId, actor.sub, actor.role, ACTIVE]
        );
        return event;
    }

    async generateRecommendations(actor: RescueActor, tripId: string) {
        const trip = await this.getAuthorizedTrip(actor, tripId);
        if (trip.status !== 'IN_PROGRESS' || !trip.started_at || trip.ended_at || !trip.truck_active) {
            throw new BadRequestException('Rescue requires an active trip');
        }
        const existing = await this.findActive(actor, tripId);
        if (existing) return { requiresRescue: true, eventId: existing.id };

        const location = await this.location.getValidatedLocation(trip.truck_id, trip.trip_started_at);
        const telemetry = this.telemetry.getValidatedTelemetry(trip.truck_id, trip.trip_started_at);
        if (telemetry.connectionNumber !== trip.iot_connection_number?.trim().toUpperCase()) {
            throw new ConflictException('Sensor pairing changed. Wait for telemetry from the current sensor.');
        }
        if (!telemetry.requiresRescue) return { requiresRescue: false };

        const ranking = await this.ranking.rankCandidates({
            latitude: location.latitude,
            longitude: location.longitude,
            spoilageRisk: telemetry.spoilageRisk,
            remainingShelfLifeHours: telemetry.remainingShelfLifeHours
        });
        const candidates = ranking.candidates.map(candidate => ({
            ...candidate.warehouse,
            road_distance: candidate.route?.distanceKm,
            duration: candidate.route?.durationSeconds,
            arrival_minutes: candidate.estimatedShelfLifeAtArrivalMinutes,
            score: candidate.rescueScore,
            rank: candidate.rank,
            feasible: candidate.isTimeFeasible,
            coordinates: candidate.route?.coordinates,
            explanation: candidate.explanation
        }));

        // A single statement atomically writes the event, candidates, and first audit entry.
        const [created] = await this.sql(
            `WITH trip AS (
                SELECT tr.* FROM trips tr JOIN trucks t ON t.id = tr.truck_id
                WHERE tr.id = $1 AND ${ACCESS} AND tr.truck_id = $4 AND tr.started_at::text = $5
                    AND tr.status = 'IN_PROGRESS' AND tr.ended_at IS NULL AND t.active
                    AND upper(btrim(t.iot_connection_number)) = $15
                    AND $6::timestamptz >= clock_timestamp() - interval '30 seconds'
                    AND $7::timestamptz >= clock_timestamp() - interval '60 seconds'
                FOR UPDATE OF tr, t
            ), event AS (
                INSERT INTO rescue_events (
                    trip_id, truck_id, original_destination, cargo_type, trigger_reason,
                    spoilage_risk, remaining_shelf_life_hours, latitude, longitude,
                    severity, status, gps_recorded_at, telemetry_recorded_at, valid_until, shelf_life_until
                )
                SELECT id, truck_id, destination, cargo_type, 'LSTM spoilage risk threshold reached',
                    $8, $9, $10, $11, $12, 'PENDING_APPROVAL', $7, $6, $7::timestamptz + interval '5 minutes',
                    LEAST($6::timestamptz, clock_timestamp()) + $13::double precision * interval '1 hour'
                FROM trip ON CONFLICT DO NOTHING RETURNING id
            ), inputs AS (
                SELECT * FROM jsonb_to_recordset($14::jsonb) AS c(
                    "sourceKey" text, name text, latitude numeric, longitude numeric,
                    state text, district text, "distanceKm" numeric, road_distance numeric,
                    duration integer, arrival_minutes numeric, score numeric, rank integer,
                    feasible boolean, coordinates jsonb, explanation jsonb
                )
            ), facilities AS (
                INSERT INTO cold_storage_facilities (source_key, name, latitude, longitude, state, district)
                SELECT "sourceKey", name, latitude, longitude, state, district
                FROM inputs CROSS JOIN event ORDER BY "sourceKey"
                ON CONFLICT (source_key) DO UPDATE SET source_key = EXCLUDED.source_key
                RETURNING id, source_key
            ), candidates AS (
                INSERT INTO rescue_candidates (
                    rescue_event_id, facility_id, aerial_distance_km, road_distance_km,
                    estimated_duration_seconds, estimated_shelf_life_at_arrival, rescue_score,
                    rank_position, is_time_feasible, route_coordinates, explanation
                )
                SELECT event.id, facilities.id, "distanceKm", road_distance, duration,
                    arrival_minutes, score, rank, feasible, coordinates, explanation
                FROM inputs JOIN facilities ON inputs."sourceKey" = facilities.source_key CROSS JOIN event
            ), audit AS (
                INSERT INTO rescue_decisions (rescue_event_id, actor_id, decision, reason)
                SELECT id, $2, 'REQUESTED', 'Evaluated live sensor telemetry and GPS' FROM event
            )
            SELECT id FROM event`,
            [tripId, actor.sub, actor.role, trip.truck_id, trip.trip_start_key, telemetry.timestamp,
                location.recordedAt, telemetry.spoilageRisk, telemetry.remainingShelfLifeHours,
                location.latitude, location.longitude, ranking.severity,
                telemetry.originalShelfLifeHours, JSON.stringify(candidates), telemetry.connectionNumber]
        );

        const event = created ?? await this.findActive(actor, tripId);
        if (!event) throw new ConflictException('Trip or rescue inputs changed. Refresh and retry.');
        return { requiresRescue: true, eventId: event.id };
    }

    async decide(actor: RescueActor, tripId: string, eventId: string, input: RescueDecisionInput) {
        const trip = await this.getAuthorizedTrip(actor, tripId);
        const transition = TRANSITIONS[input.action];
        if (!transition?.roles?.includes(actor.role)) throw new ForbiddenException('Action not permitted');

        const reason = input.reason.trim();
        const confirmation = input.facilityConfirmation?.trim();
        const approving = input.action === 'APPROVED';
        const starting = input.action === 'STARTED';
        if (!reason || (approving && (!input.candidateId || !confirmation || input.facilityVerified !== true))) {
            throw new BadRequestException('Enter a reason and, for approval, a facility confirmation and candidate');
        }
        if (!approving && (input.candidateId || confirmation || input.facilityVerified !== undefined)) {
            throw new BadRequestException('Facility confirmation and candidate are only accepted on approval');
        }
        let latestTelemetry: ReturnType<RescueTelemetryService['getValidatedTelemetry']> | null = null;
        let gpsRecordedAt: string | null = null;
        if (starting) {
            const [event] = await this.sql(
                'SELECT latitude, longitude FROM rescue_events WHERE id = $1 AND trip_id = $2 AND status = $3',
                [eventId, tripId, 'APPROVED']
            );
            if (!event) throw new ConflictException('An approved rescue is required');
            const location = await this.location.getValidatedLocation(trip.truck_id, trip.trip_started_at);
            gpsRecordedAt = location.recordedAt;
            latestTelemetry = this.telemetry.getValidatedTelemetry(trip.truck_id, trip.trip_started_at);
            const distance = this.warehouses.haversineDistance(
                Number(event.latitude), Number(event.longitude), location.latitude, location.longitude
            );
            if (distance > 2) {
                throw new ConflictException('Truck has moved away from the evaluated route origin. Request a new evaluation.');
            }
        }

        const [event] = await this.sql(
            `WITH trip AS (
                SELECT tr.* FROM trips tr JOIN trucks t ON t.id = tr.truck_id
                WHERE tr.id = $1 AND ${ACCESS}
                    AND (NOT $10::boolean OR (tr.status = 'IN_PROGRESS' AND tr.ended_at IS NULL AND t.active))
                    AND (NOT $12::boolean OR (
                        upper(btrim(t.iot_connection_number)) = $13
                        AND $14::timestamptz >= clock_timestamp() - interval '30 seconds'
                        AND $15::timestamptz >= clock_timestamp() - interval '60 seconds'
                    ))
                FOR UPDATE OF tr, t
            ), updated AS (
                UPDATE rescue_events e SET status = $5::text,
                    emergency_candidate_id = COALESCE($8::uuid, e.emergency_candidate_id),
                    updated_at = clock_timestamp(),
                    resolved_at = CASE WHEN $5 IN ('RESOLVED', 'REJECTED', 'CANCELLED') THEN clock_timestamp() END
                FROM trip
                WHERE e.id = $4 AND e.trip_id = trip.id AND e.status = ANY($6::text[])
                    AND (NOT $10 OR (
                        e.valid_until > clock_timestamp()
                        AND EXISTS (
                            SELECT 1 FROM rescue_candidates c
                            WHERE c.rescue_event_id = e.id AND c.id = COALESCE($8, e.emergency_candidate_id)
                                AND c.is_time_feasible AND c.route_coordinates IS NOT NULL
                                AND LEAST(e.shelf_life_until, COALESCE(
                                    LEAST($14::timestamptz, clock_timestamp())
                                        + $16::double precision * interval '1 hour', e.shelf_life_until
                                )) > clock_timestamp()
                                    + (c.estimated_duration_seconds + 900) * interval '1 second'
                        )
                    ))
                RETURNING e.id, e.status, e.emergency_candidate_id, e.updated_at
            ), audit AS (
                INSERT INTO rescue_decisions (
                    rescue_event_id, candidate_id, actor_id, decision, reason, facility_confirmation, created_at
                )
                SELECT id, emergency_candidate_id, $2, $7, $9, $11, updated_at FROM updated
            )
            SELECT * FROM updated`,
            [tripId, actor.sub, actor.role, eventId, transition.to, transition.from, input.action,
                input.candidateId ?? null, reason, approving || starting, confirmation ?? null,
                starting, latestTelemetry?.connectionNumber ?? null, latestTelemetry?.timestamp ?? null,
                gpsRecordedAt, latestTelemetry?.originalShelfLifeHours ?? null]
        );
        if (!event) throw new ConflictException('Decision is unavailable. Refresh and check the trip, route and shelf-life estimates.');
        return event;
    }
}
