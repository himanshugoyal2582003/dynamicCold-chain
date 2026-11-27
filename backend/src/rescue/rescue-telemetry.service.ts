import {
    Injectable,
    BadRequestException,
    ServiceUnavailableException
} from '@nestjs/common';

import { IotService } from '../iot/iot.service';

@Injectable()
export class RescueTelemetryService {
    private readonly MAX_AGE_MS = 30000;
    private readonly MAX_CLOCK_SKEW_MS = 5000;

    constructor(
        private readonly iotService: IotService
    ) {}

    getValidatedTelemetry(
        truckId: string,
        tripStartedAt: string | Date
    ) {
        const telemetry =
            this.iotService.getTelemetryForTruck(truckId);

        if (!telemetry) {
            throw new ServiceUnavailableException(
                'Live telemetry unavailable'
            );
        }

        if (telemetry.truck_id !== truckId) {
            throw new BadRequestException(
                'Telemetry truck mismatch'
            );
        }

        const deviceId = typeof telemetry.device_id === 'string' ? telemetry.device_id.trim() : '';
        const connection = typeof telemetry.connection_number === 'string' ? telemetry.connection_number.trim() : '';
        if (
            telemetry.source !== 'sensor' ||
            !deviceId ||
            !connection ||
            /^(SIM-|DEV-ESP32-)/i.test(deviceId) ||
            telemetry.model_type !== 'PyTorch-SpoilageLSTM'
        ) {
            throw new BadRequestException(
                'Live sensor telemetry with an LSTM prediction is required'
            );
        }

        const now = Date.now();

        const timestamp = Date.parse(telemetry.timestamp);

        const receivedAt = Date.parse(
            telemetry.received_at ?? ''
        );

        const tripStart = new Date(tripStartedAt).getTime();

        if (
            !Number.isFinite(timestamp) ||
            !Number.isFinite(receivedAt) ||
            !Number.isFinite(tripStart)
        ) {
            throw new BadRequestException(
                'Invalid telemetry or trip timestamp'
            );
        }

        if (
            timestamp > now + this.MAX_CLOCK_SKEW_MS ||
            receivedAt > now + this.MAX_CLOCK_SKEW_MS ||
            timestamp > receivedAt + this.MAX_CLOCK_SKEW_MS
        ) {
            throw new BadRequestException(
                'Invalid telemetry clock'
            );
        }

        if (
            now - timestamp > this.MAX_AGE_MS ||
            now - receivedAt > this.MAX_AGE_MS
        ) {
            throw new ServiceUnavailableException(
                'Telemetry is stale'
            );
        }

        if (timestamp < tripStart) {
            throw new BadRequestException(
                'Telemetry predates current trip'
            );
        }

        const risk = telemetry.spoilage_risk;
        const shelfLife = telemetry.shelf_life_remaining_hours;

        if (
            !Number.isFinite(risk) ||
            risk < 0 ||
            risk > 1
        ) {
            throw new BadRequestException(
                'Invalid spoilage risk'
            );
        }

        if (
            !Number.isFinite(shelfLife) ||
            shelfLife < 0
        ) {
            throw new BadRequestException(
                'Invalid remaining shelf life'
            );
        }

        if (
            !Number.isFinite(telemetry.temperature) ||
            !Number.isFinite(telemetry.target_temp) ||
            (telemetry.device_target_temp != null &&
                (!Number.isFinite(telemetry.device_target_temp) ||
                    Math.abs(telemetry.device_target_temp - telemetry.target_temp) > 0.1))
        ) {
            throw new BadRequestException(
                'Invalid temperature readings'
            );
        }

        const ageMs = Math.max(0, now - timestamp);

        const adjustedShelfLife = Math.max(
            0,
            shelfLife - ageMs / 3600000
        );

        return {
            truckId,
            deviceId,
            connectionNumber: connection.toUpperCase(),
            source: telemetry.source,
            productType: telemetry.product_type,
            temperature: telemetry.temperature,
            targetTemperature: telemetry.target_temp,
            spoilageRisk: risk,
            remainingShelfLifeHours: adjustedShelfLife,
            originalShelfLifeHours: shelfLife,
            telemetryAgeSeconds: ageMs / 1000,
            timestamp: telemetry.timestamp,
            receivedAt: telemetry.received_at,
            modelType: telemetry.model_type ?? null,
            requiresRescue: risk >= 0.45,
            severity:
                risk >= 0.75
                    ? 'CRITICAL'
                    : risk >= 0.45
                        ? 'HIGH'
                        : 'MONITOR'
        };
    }
}
