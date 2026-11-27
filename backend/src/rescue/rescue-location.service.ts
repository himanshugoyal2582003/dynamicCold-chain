import {
    Injectable,
    BadRequestException,
    ServiceUnavailableException
} from '@nestjs/common';

import { NeonService } from '../neon/neon.service';

@Injectable()
export class RescueLocationService {
    private readonly MAX_GPS_AGE_MS = 60000;
    private readonly MAX_ACCURACY_METERS = 100;
    private readonly MAX_CLOCK_SKEW_MS = 5000;

    constructor(
        private readonly neonService: NeonService
    ) {}

    async getValidatedLocation(
        truckId: string,
        tripStartedAt: string | Date
    ) {
        const sql = this.neonService.getSql();

        if (!sql) {
            throw new ServiceUnavailableException(
                'Database unavailable'
            );
        }

        const rows = await sql(
            `SELECT
                truck_id,
                latitude,
                longitude,
                speed_kmh,
                accuracy_m,
                recorded_at AT TIME ZONE 'UTC' AS recorded_at,
                received_at AT TIME ZONE 'UTC' AS received_at
            FROM truck_locations
            WHERE truck_id = $1`,
            [truckId]
        );

        const location = rows[0];

        if (!location) {
            throw new ServiceUnavailableException(
                'Truck GPS location unavailable'
            );
        }

        if (
            location.latitude == null ||
            location.longitude == null ||
            location.latitude === '' ||
            location.longitude === ''
        ) {
            throw new BadRequestException(
                'Missing GPS coordinates'
            );
        }

        const latitude = Number(location.latitude);
        const longitude = Number(location.longitude);

        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            latitude < -90 ||
            latitude > 90 ||
            longitude < -180 ||
            longitude > 180 ||
            (latitude === 0 && longitude === 0)
        ) {
            throw new BadRequestException(
                'Invalid GPS coordinates'
            );
        }

        if (
            location.accuracy_m == null ||
            location.accuracy_m === ''
        ) {
            throw new BadRequestException(
                'GPS accuracy unavailable'
            );
        }

        const accuracy = Number(location.accuracy_m);

        if (
            !Number.isFinite(accuracy) ||
            accuracy < 0 ||
            accuracy > this.MAX_ACCURACY_METERS
        ) {
            throw new BadRequestException(
                'GPS accuracy insufficient'
            );
        }

        if (
            !location.recorded_at ||
            !location.received_at ||
            !tripStartedAt
        ) {
            throw new BadRequestException(
                'Missing GPS timestamps'
            );
        }

        const now = Date.now();

        const recordedAt =
            new Date(location.recorded_at).getTime();

        const receivedAt =
            new Date(location.received_at).getTime();

        const tripStart =
            new Date(tripStartedAt).getTime();

        if (
            !Number.isFinite(recordedAt) ||
            !Number.isFinite(receivedAt) ||
            !Number.isFinite(tripStart)
        ) {
            throw new BadRequestException(
                'Invalid GPS timestamps'
            );
        }

        if (
            recordedAt > now + this.MAX_CLOCK_SKEW_MS ||
            receivedAt > now + this.MAX_CLOCK_SKEW_MS ||
            recordedAt > receivedAt + this.MAX_CLOCK_SKEW_MS
        ) {
            throw new BadRequestException(
                'Invalid GPS clock'
            );
        }

        if (
            now - recordedAt > this.MAX_GPS_AGE_MS ||
            now - receivedAt > this.MAX_GPS_AGE_MS
        ) {
            throw new ServiceUnavailableException(
                'GPS location is stale'
            );
        }

        if (recordedAt < tripStart) {
            throw new BadRequestException(
                'GPS location predates current trip'
            );
        }

        const speed = location.speed_kmh == null
            ? null
            : Number(location.speed_kmh);

        return {
            truckId,
            latitude,
            longitude,
            speedKmh:
                speed !== null &&
                Number.isFinite(speed) &&
                speed >= 0
                    ? speed
                    : null,
            accuracyMeters: accuracy,
            recordedAt: new Date(recordedAt).toISOString(),
            receivedAt: new Date(receivedAt).toISOString(),
            ageSeconds:
                Math.max(0, now - recordedAt) / 1000,
            source: 'truck_locations'
        };
    }
}
