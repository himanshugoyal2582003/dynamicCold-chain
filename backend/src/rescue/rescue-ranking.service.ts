import { Injectable } from '@nestjs/common';
import { WarehouseService, NearbyWarehouse } from './warehouse.service';
import { RoutingService, RoadRoute } from './routing.service';

export const RESCUE_SAFETY_BUFFER_MINUTES = 15;

export interface RescueInput {
    latitude: number;
    longitude: number;
    spoilageRisk: number;
    remainingShelfLifeHours: number;
    safetyBufferMinutes?: number;
    searchRadiusKm?: number;
    candidateLimit?: number;
}

export interface RescueCandidate {
    warehouse: NearbyWarehouse;
    route: RoadRoute | null;
    estimatedShelfLifeAtArrivalMinutes: number | null;
    timeMarginMinutes: number | null;
    isTimeFeasible: boolean | null;
    rescueScore: number | null;
    rank: number | null;
    recommendation: string;
    explanation: string[];
}

@Injectable()
export class RescueRankingService {
    constructor(
        private readonly warehouseService: WarehouseService,
        private readonly routingService: RoutingService
    ) {}

    async rankCandidates(input: RescueInput) {
        if (
            !Number.isFinite(input.spoilageRisk) ||
            input.spoilageRisk < 0 ||
            input.spoilageRisk > 1
        ) {
            throw new Error('Invalid spoilage risk');
        }

        if (
            !Number.isFinite(input.remainingShelfLifeHours) ||
            input.remainingShelfLifeHours < 0
        ) {
            throw new Error('Invalid remaining shelf life');
        }

        const safetyBuffer = input.safetyBufferMinutes ?? RESCUE_SAFETY_BUFFER_MINUTES;
        const radius = input.searchRadiusKm ?? 200;
        const limit = input.candidateLimit ?? 5;

        if (!Number.isFinite(safetyBuffer) || safetyBuffer < 0) {
            throw new Error('Invalid safety buffer');
        }

        if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
            throw new Error('Candidate limit must be between 1 and 10');
        }

        const remainingMinutes =
            input.remainingShelfLifeHours * 60;

        const startedAt = Date.now();

        const warehouses = this.warehouseService.findNearest(
            input.latitude,
            input.longitude,
            limit,
            radius
        );

        const origin = {
            latitude: input.latitude,
            longitude: input.longitude
        };

        const routes = await this.routingService.compareRoutes(
            origin,
            warehouses
        );

        const elapsedMinutes =
            (Date.now() - startedAt) / 60000;

        const candidates: RescueCandidate[] = [];

        for (let i = 0; i < warehouses.length; i++) {
            const warehouse = warehouses[i];
            const result = routes[i];

            if (!result.success || !result.route) {
                candidates.push({
                    warehouse,
                    route: null,
                    estimatedShelfLifeAtArrivalMinutes: null,
                    timeMarginMinutes: null,
                    isTimeFeasible: null,
                    rescueScore: null,
                    rank: null,
                    recommendation: 'ROUTE_UNAVAILABLE',
                    explanation: [
                        result.error || 'Road route unavailable',
                        'Warehouse availability is unverified'
                    ]
                });

                continue;
            }

            const route = result.route;
            const travelMinutes = route.durationSeconds / 60;

            const arrivalShelfLife =
                remainingMinutes -
                elapsedMinutes -
                travelMinutes;

            const timeMargin =
                arrivalShelfLife - safetyBuffer;

            const feasible = timeMargin > 0;

            const shelfLifeScore = Math.max(
                0,
                Math.min(
                    1,
                    timeMargin / Math.max(remainingMinutes, 1)
                )
            );

            const travelScore =
                1 / (1 + travelMinutes / 60);

            const distanceScore =
                1 / (1 + route.distanceKm / 50);

            const score = feasible
                ? (
                    shelfLifeScore * 0.60 +
                    travelScore * 0.25 +
                    distanceScore * 0.15
                ) * 100
                : 0;

            candidates.push({
                warehouse,
                route,
                estimatedShelfLifeAtArrivalMinutes:
                    Number(arrivalShelfLife.toFixed(2)),
                timeMarginMinutes:
                    Number(timeMargin.toFixed(2)),
                isTimeFeasible: feasible,
                rescueScore: Number(score.toFixed(4)),
                rank: null,
                recommendation: feasible
                    ? 'VERIFY_BEFORE_DIVERSION'
                    : 'INSUFFICIENT_TIME_MARGIN',
                explanation: [
                    `Estimated travel time: ${travelMinutes.toFixed(2)} minutes`,
                    `Safety buffer: ${safetyBuffer} minutes`,
                    `Estimated time margin: ${timeMargin.toFixed(2)} minutes`,
                    'Warehouse availability is unverified',
                    'Cargo compatibility must be confirmed',
                    'Human approval required before diversion'
                ]
            });
        }

        candidates.sort((a, b) => {
            const priority = (c: RescueCandidate) =>
                c.isTimeFeasible === true ? 2 :
                c.isTimeFeasible === false ? 1 : 0;

            return priority(b) - priority(a) ||
                (b.rescueScore ?? -1) - (a.rescueScore ?? -1) ||
                (b.timeMarginMinutes ?? -Infinity) -
                (a.timeMarginMinutes ?? -Infinity) ||
                a.warehouse.sourceKey.localeCompare(
                    b.warehouse.sourceKey
                );
        });

        let rank = 1;

        for (const candidate of candidates) {
            if (candidate.route) {
                candidate.rank = rank++;
            }
        }

        const bestCandidate = candidates.find(
            candidate => candidate.isTimeFeasible === true
        ) ?? null;

        return {
            spoilageRisk: input.spoilageRisk,
            severity: input.spoilageRisk >= 0.75
                ? 'CRITICAL'
                : input.spoilageRisk >= 0.45
                    ? 'HIGH'
                    : 'MONITOR',
            remainingShelfLifeMinutes: remainingMinutes,
            safetyBufferMinutes: safetyBuffer,
            totalCandidates: candidates.length,
            feasibleCandidates: candidates.filter(
                candidate => candidate.isTimeFeasible === true
            ).length,
            bestCandidate,
            candidates,
            requiresHumanApproval: true,
            generatedAt: new Date().toISOString()
        };
    }
}
