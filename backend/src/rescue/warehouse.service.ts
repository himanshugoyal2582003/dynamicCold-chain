import { Injectable } from '@nestjs/common';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';

export interface Warehouse {
    sourceKey: string;
    name: string;
    latitude: number;
    longitude: number;
    state: string;
    district: string;
    isVerified: boolean;
    availabilityStatus: 'UNKNOWN';
}

export interface NearbyWarehouse extends Warehouse {
    distanceKm: number;
}

@Injectable()
export class WarehouseService {
    private warehouses: Warehouse[] = [];

    constructor() {
        this.loadDataset();
    }

    private validCoordinates(lat: number, lng: number): boolean {
        return Number.isFinite(lat) &&
            Number.isFinite(lng) &&
            lat >= -90 &&
            lat <= 90 &&
            lng >= -180 &&
            lng <= 180;
    }

    private loadDataset(): void {
        const filePath = process.env.WAREHOUSE_DATA_PATH ||
            resolve(__dirname, 'data/warehouses.json');

        const raw = readFileSync(filePath, 'utf8');
        const records = JSON.parse(raw.replace(/^\uFEFF/, ''));

        if (!Array.isArray(records)) {
            throw new Error('Invalid warehouse dataset');
        }

        const unique = new Map<string, Warehouse>();

        for (const record of records) {
            if (!record || typeof record.n !== 'string') {
                continue;
            }

            const name = record.n.trim();
            const latitude = record.la;
            const longitude = record.lo;

            if (!name || !this.validCoordinates(latitude, longitude)) {
                continue;
            }

            const state = String(record.s ?? '').trim();
            const district = String(record.d ?? '').trim();

            const identity = [
                name.toLowerCase(),
                latitude.toFixed(6),
                longitude.toFixed(6),
                state.toLowerCase(),
                district.toLowerCase()
            ].join('|');

            const sourceKey = createHash('sha256')
                .update(identity)
                .digest('hex');

            if (unique.has(sourceKey)) {
                continue;
            }

            unique.set(sourceKey, {
                sourceKey,
                name,
                latitude,
                longitude,
                state,
                district,
                isVerified: false,
                availabilityStatus: 'UNKNOWN'
            });
        }

        this.warehouses = Array.from(unique.values());

        if (this.warehouses.length === 0) {
            throw new Error('No valid warehouse records found');
        }
    }

    private toRadians(degrees: number): number {
        return degrees * Math.PI / 180;
    }

    haversineDistance(
        lat1: number,
        lng1: number,
        lat2: number,
        lng2: number
    ): number {
        if (!this.validCoordinates(lat1, lng1) ||
            !this.validCoordinates(lat2, lng2)) {
            throw new Error('Invalid coordinates');
        }

        const earthRadius = 6371;

        const dLat = this.toRadians(lat2 - lat1);
        const dLng = this.toRadians(lng2 - lng1);

        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(this.toRadians(lat1)) *
            Math.cos(this.toRadians(lat2)) *
            Math.sin(dLng / 2) ** 2;

        const safeA = Math.min(1, Math.max(0, a));

        const c = 2 * Math.atan2(
            Math.sqrt(safeA),
            Math.sqrt(1 - safeA)
        );

        return earthRadius * c;
    }

    findNearest(
        latitude: number,
        longitude: number,
        limit = 10,
        radiusKm = 200
    ): NearbyWarehouse[] {
        if (!this.validCoordinates(latitude, longitude)) {
            throw new Error('Invalid truck coordinates');
        }

        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
            throw new Error('Limit must be between 1 and 100');
        }

        if (!Number.isFinite(radiusKm) || radiusKm <= 0) {
            throw new Error('Invalid search radius');
        }

        return this.warehouses
            .map(warehouse => ({
                ...warehouse,
                distanceKm: this.haversineDistance(
                    latitude,
                    longitude,
                    warehouse.latitude,
                    warehouse.longitude
                )
            }))
            .filter(warehouse => warehouse.distanceKm <= radiusKm)
            .sort((a, b) =>
                a.distanceKm - b.distanceKm ||
                a.sourceKey.localeCompare(b.sourceKey)
            )
            .slice(0, limit)
            .map(warehouse => ({
                ...warehouse,
                distanceKm: Number(warehouse.distanceKm.toFixed(3))
            }));
    }

    findByRegion(state: string, district?: string): Warehouse[] {
        return this.warehouses
            .filter(warehouse =>
                warehouse.state.toLowerCase() === state.trim().toLowerCase() &&
                (!district ||
                    warehouse.district.toLowerCase() ===
                    district.trim().toLowerCase())
            )
            .map(warehouse => ({ ...warehouse }));
    }

    getTotalWarehouses(): number {
        return this.warehouses.length;
    }

    getAllWarehouses(): Warehouse[] {
        return this.warehouses.map(warehouse => ({ ...warehouse }));
    }
}
