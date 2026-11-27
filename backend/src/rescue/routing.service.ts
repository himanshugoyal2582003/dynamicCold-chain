import { Injectable } from '@nestjs/common';

export interface Coordinates {
    latitude: number;
    longitude: number;
}

export interface RoadRoute {
    distanceKm: number;
    durationSeconds: number;
    durationMinutes: number;
    coordinates: [number, number][];
}

@Injectable()
export class RoutingService {
    private readonly baseUrl = (
        process.env.OSRM_BASE_URL?.trim() || ''
    ).replace(/\/+$/, '');

    private readonly cache = new Map<string, {
        route: RoadRoute;
        expiresAt: number;
    }>();

    private readonly cacheTTL = 60000;
    private readonly maxCacheSize = 200;
    private readonly inFlight = new Map<string, Promise<RoadRoute>>();
    private readonly maxConcurrentRequests = 12;

    private validate(point: Coordinates): void {
        if (
            !Number.isFinite(point.latitude) ||
            !Number.isFinite(point.longitude) ||
            point.latitude < -90 ||
            point.latitude > 90 ||
            point.longitude < -180 ||
            point.longitude > 180
        ) {
            throw new Error('Invalid routing coordinates');
        }
    }

    private cacheKey(
        origin: Coordinates,
        destination: Coordinates
    ): string {
        return [
            origin.latitude.toFixed(5),
            origin.longitude.toFixed(5),
            destination.latitude.toFixed(5),
            destination.longitude.toFixed(5)
        ].join(':');
    }

    async getRoute(
        origin: Coordinates,
        destination: Coordinates
    ): Promise<RoadRoute> {
        this.validate(origin);
        this.validate(destination);

        const key = this.cacheKey(origin, destination);
        const cached = this.cache.get(key);

        if (cached && cached.expiresAt > Date.now()) {
            return cached.route;
        }
        if (cached) this.cache.delete(key);
        const pending = this.inFlight.get(key);
        if (pending) return pending;
        if (!this.baseUrl) throw new Error('Road routing provider is not configured');
        if (this.inFlight.size >= this.maxConcurrentRequests) throw new Error('Road routing provider is busy');

        const request = this.fetchRoute(origin, destination, key);
        this.inFlight.set(key, request);
        try {
            return await request;
        } finally {
            this.inFlight.delete(key);
        }
    }

    private async fetchRoute(origin: Coordinates, destination: Coordinates, key: string) {
        const points =
            `${origin.longitude},${origin.latitude};` +
            `${destination.longitude},${destination.latitude}`;

        const url =
            `${this.baseUrl}/route/v1/driving/${points}` +
            '?overview=full&geometries=geojson&alternatives=false&radiuses=100;250';

        const controller = new AbortController();

        const timeout = setTimeout(
            () => controller.abort(),
            5000
        );

        try {
            const response = await fetch(url, {
                signal: controller.signal,
                redirect: 'error'
            });

            if (!response.ok) {
                throw new Error(
                    `OSRM HTTP error: ${response.status}`
                );
            }

            const data = await response.json();

            if (
                data.code !== 'Ok' ||
                !Array.isArray(data.routes) ||
                data.routes.length === 0
            ) {
                throw new Error('No road route available');
            }

            const route = data.routes[0];

            if (
                !Number.isFinite(route.distance) ||
                !Number.isFinite(route.duration) ||
                route.distance < 0 ||
                route.duration < 0 ||
                route.geometry?.type !== 'LineString' ||
                !Array.isArray(route.geometry.coordinates) ||
                route.geometry.coordinates.length < 2
            ) {
                throw new Error('Invalid OSRM response');
            }

            const coordinates: [number, number][] =
                route.geometry.coordinates.map(
                    (point: number[]) => {
                        if (!Array.isArray(point) || point.length < 2) {
                            throw new Error('Invalid route geometry');
                        }

                        this.validate({
                            latitude: point[1],
                            longitude: point[0]
                        });

                        return [point[1], point[0]];
                    }
                );

            const result: RoadRoute = {
                distanceKm: Number(
                    (route.distance / 1000).toFixed(3)
                ),
                durationSeconds: Math.ceil(route.duration),
                durationMinutes: Number(
                    (route.duration / 60).toFixed(2)
                ),
                coordinates
            };

            if (this.cache.size >= this.maxCacheSize) {
                const oldest = this.cache.keys().next().value;

                if (oldest !== undefined) {
                    this.cache.delete(oldest);
                }
            }

            this.cache.set(key, {
                route: result,
                expiresAt: Date.now() + this.cacheTTL
            });

            return result;
        } catch {
            throw new Error(controller.signal.aborted ? 'Road routing timed out' : 'No road route available');
        } finally {
            clearTimeout(timeout);
        }
    }

    async compareRoutes(
        origin: Coordinates,
        destinations: Coordinates[]
    ) {
        this.validate(origin);

        if (destinations.length > 10) {
            throw new Error('Maximum 10 destinations allowed');
        }

        return Promise.all(destinations.map(async destination => {
            try {
                const route = await this.getRoute(
                    origin,
                    destination
                );

                return {
                    destination,
                    success: true,
                    route,
                    error: null
                };
            } catch (error) {
                return {
                    destination,
                    success: false,
                    route: null,
                    error: error instanceof Error
                        ? error.message
                        : 'Routing failed'
                };
            }
        }));
    }

    clearCache(): void {
        this.cache.clear();
    }
}
