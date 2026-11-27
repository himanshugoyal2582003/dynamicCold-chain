const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const { Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

const { AppModule } = require('../dist/app.module');
const { AuthService } = require('../dist/auth/auth.service');
const { IotService } = require('../dist/iot/iot.service');
const { NeonService } = require('../dist/neon/neon.service');
const { RescueController } = require('../dist/rescue/rescue.controller');
const { RescueService } = require('../dist/rescue/rescue.service');
const { RescueLocationService } = require('../dist/rescue/rescue-location.service');
const { RescueTelemetryService } = require('../dist/rescue/rescue-telemetry.service');
const { RescueRankingService } = require('../dist/rescue/rescue-ranking.service');
const { RoutingService } = require('../dist/rescue/routing.service');
const { WarehouseService } = require('../dist/rescue/warehouse.service');

test('rescue HTTP workflow against isolated PostgreSQL', async t => {
    const db = new PGlite();
    t.after(() => db.close());
    const query = async (sql, params = []) => (await db.query(sql, params)).rows;
    const directory = resolve(__dirname, '../db/migrations');
    for (const name of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) {
        // This PostgreSQL build exposes gen_random_uuid() in core without loading pgcrypto.
        await db.exec(readFileSync(resolve(directory, name), 'utf8')
            .replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', ''));
    }

    const newUser = async role => {
        const id = randomUUID();
        await query(
            'INSERT INTO users (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $2)',
            [id, role, id + '@test.invalid', 'unused']
        );
        return { sub: id, role };
    };
    const owner = await newUser('owner');
    const stranger = await newUser('owner');
    const admin = await newUser('admin');
    const driver = await newUser('truckUser');
    const otherDriver = await newUser('truckUser');
    const truck = randomUUID();
    const trip = randomUUID();
    const started = new Date(Date.now() - 120000).toISOString();
    await query(`INSERT INTO trucks (id, owner_id, plate_number, type, capacity_tons, iot_connection_number)
                  VALUES ($1, $2, 'TEST', 'Refrigerated', 10, 'PAIR')`, [truck, owner.sub]);
    await query('UPDATE users SET truck_id=$1, owner_id=$2 WHERE id IN ($3, $4)',
        [truck, owner.sub, driver.sub, otherDriver.sub]);
    await query(`INSERT INTO trips (id, truck_id, user_id, origin, destination, cargo_type, status, started_at)
                  VALUES ($1, $2, $3, 'Delhi', 'Agra', 'Dairy', 'IN_PROGRESS', $4)`, [trip, truck, driver.sub, started]);
    const near = [28.61, 77.21];
    const putGps = async ([latitude, longitude] = near) => {
        const now = new Date().toISOString();
        await query(`INSERT INTO truck_locations (truck_id, latitude, longitude, accuracy_m, recorded_at, received_at)
                     VALUES ($1, $2, $3, 15, $4, $4)
                     ON CONFLICT (truck_id) DO UPDATE SET latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude,
                     recorded_at=EXCLUDED.recorded_at, received_at=EXCLUDED.received_at`, [truck, latitude, longitude, now]);
    };
    let telemetry;
    const putTelemetry = (patch = {}) => {
        const time = new Date().toISOString();
        telemetry = {
            truck_id: truck, device_id: 'SENSOR-1', connection_number: 'PAIR', source: 'sensor',
            model_type: 'PyTorch-SpoilageLSTM', timestamp: time, received_at: time, temperature: 10,
            target_temp: 4, spoilage_risk: 0.8, shelf_life_remaining_hours: 4, ...patch
        };
    };
    await putGps();
    putTelemetry();
    const originalSecret = process.env.JWT_SECRET;
    const originalRouting = process.env.OSRM_BASE_URL;
    const originalFetch = global.fetch;
    process.env.JWT_SECRET = 'local-only-rescue-test-fixture-secret';
    process.env.OSRM_BASE_URL = 'https://routing.test.invalid';
    global.fetch = async (url, options) => {
        if (!String(url).startsWith(process.env.OSRM_BASE_URL)) return originalFetch(url, options);
        const pair = String(url).split('/').at(-1).split('?')[0];
        const coordinates = pair.split(';').map(point => point.split(',').map(Number));
        return Response.json({
            code: 'Ok', routes: [{ distance: 14000, duration: 1400, geometry: { type: 'LineString', coordinates } }]
        });
    };
    t.after(() => {
        global.fetch = originalFetch;
        if (originalSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = originalSecret;
        if (originalRouting === undefined) delete process.env.OSRM_BASE_URL;
        else process.env.OSRM_BASE_URL = originalRouting;
    });

    class TestModule {
        configure(consumer) {
            AppModule.prototype.configure(consumer);
        }
    }
    Module({
        controllers: [RescueController],
        providers: [
            AuthService, RescueService, RescueLocationService, RescueTelemetryService,
            RescueRankingService, RoutingService, WarehouseService,
            { provide: NeonService, useValue: { getSql: () => query } },
            { provide: IotService, useValue: { getTelemetryForTruck: () => telemetry } }
        ]
    })(TestModule);
    const app = await NestFactory.create(TestModule, { logger: false });
    t.after(() => app.close());
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1');
    const endpoint = (await app.getUrl()) + '/api/trips/' + trip + '/rescue';

    async function request(actor, path = '', payload, options = {}) {
        const headers = {};
        if (actor) {
            const token = jwt.sign(actor, process.env.JWT_SECRET, { expiresIn: '1m' });
            if (options.bearer) headers.Authorization = 'Bearer ' + token;
            else headers.Cookie = 'coldchain_token=' + token + '; coldchain_csrf=fixture';
            if (!options.noCsrf) headers['X-CSRF-Token'] = 'fixture';
        }
        if (payload !== undefined) headers['Content-Type'] = 'application/json';
        const response = await fetch(endpoint + path, {
            method: payload === undefined ? 'GET' : 'POST',
            headers, body: payload === undefined ? undefined : JSON.stringify(payload)
        });
        return { status: response.status, body: await response.json() };
    }

    await t.test('cookie-only auth, CSRF, tenant isolation and live role checks', async () => {
        assert.equal((await request(null)).status, 401);
        assert.equal((await request(owner, '', undefined, { bearer: true })).status, 401);
        assert.equal((await request(owner, '', {}, { noCsrf: true })).status, 403);
        assert.equal((await request(stranger)).status, 404);
        assert.equal((await request(otherDriver)).status, 404);
        assert.equal((await request({ ...owner, role: 'admin' })).status, 404);
        await query('UPDATE users SET active=false WHERE id=$1', [owner.sub]);
        assert.equal((await request(owner)).status, 404);
        await query('UPDATE users SET active=true WHERE id=$1', [owner.sub]);
        assert.deepEqual(await request(admin), { status: 200, body: [] });
    });

    await t.test('below-threshold, stale GPS, and mismatched pairing do not create a rescue', async () => {
        putTelemetry({ spoilage_risk: 0.2 });
        assert.deepEqual(await request(driver, '', {}), { status: 201, body: { requiresRescue: false } });
        putTelemetry({ connection_number: 'OLD-PAIR' });
        assert.equal((await request(driver, '', {})).status, 409);
        putTelemetry();
        await query("UPDATE truck_locations SET recorded_at = now() - interval '90 seconds'");
        assert.equal((await request(driver, '', {})).status, 503);
        await putGps();
        assert.deepEqual((await request(owner)).body, []);
    });

    await t.test('request and approval, driver start and handoff persist route and append the audit', async () => {
        putTelemetry();
        const requests = await Promise.all([request(driver, '', {}), request(admin, '', {})]);
        requests.forEach(result => assert.equal(result.status, 201, JSON.stringify(result.body)));
        const eventId = requests[0].body.eventId;
        assert.equal(requests[1].body.eventId, eventId);
        const [event] = (await request(owner)).body;
        assert.equal(event.status, 'PENDING_APPROVAL');
        assert.equal(event.original_destination, 'Agra');
        assert.equal(event.emergency_candidate_id, null);
        assert.equal(event.decisions.length, 1);
        assert.ok(event.candidates.length > 1);
        const [candidate] = event.candidates;
        assert.equal(candidate.road_distance_km, 14);
        assert.equal(candidate.estimated_duration_seconds, 1400);
        assert.ok(candidate.is_time_feasible && candidate.route_coordinates.length >= 2);
        const path = '/' + eventId + '/decisions';
        const approval = {
            action: 'APPROVED', candidateId: candidate.id, reason: 'Confirmed with dispatch',
            facilityConfirmation: 'Facility manager confirmed cargo acceptance, space and temperature',
            facilityVerified: true
        };
        assert.equal((await request(driver, path, approval)).status, 403);
        assert.equal((await request(owner, path, { ...approval, facilityVerified: false })).status, 400);
        assert.equal((await request(owner, path, { ...approval, extra: 'ignored?' })).status, 400);
        assert.equal((await request(owner, path, { ...approval, candidateId: randomUUID() })).status, 409);
        assert.equal((await request(driver, path, { action: 'STARTED', reason: 'Ready' })).status, 409);

        const decisions = await Promise.all([request(owner, path, approval), request(admin, path, approval)]);
        assert.deepEqual(decisions.map(result => result.status).sort(), [201, 409], JSON.stringify(decisions));
        assert.equal((await request(admin, path, { action: 'STARTED', reason: 'Ready' })).status, 403);
        await putGps([28.7, 77.2]);
        assert.equal((await request(driver, path, { action: 'STARTED', reason: 'Ready' })).status, 409);
        await putGps();
        putTelemetry({ shelf_life_remaining_hours: 0.2 });
        assert.equal((await request(driver, path, { action: 'STARTED', reason: 'Ready' })).status, 409);
        putTelemetry();
        assert.equal((await request(driver, path, { action: 'STARTED', reason: 'Ready' })).status, 201);
        assert.equal((await request(owner, path, { action: 'REJECTED', reason: 'Too late' })).status, 409);
        assert.equal((await request(driver, path, { action: 'COMPLETED', reason: 'Cargo handed over' })).status, 201);

        const [resolved] = (await request(driver)).body;
        assert.equal(resolved.status, 'RESOLVED');
        assert.equal(resolved.emergency_candidate_id, candidate.id);
        assert.equal(resolved.decisions[1].facility_confirmation, approval.facilityConfirmation);
        assert.deepEqual(resolved.decisions.map(decision => decision.decision), ['REQUESTED', 'APPROVED', 'STARTED', 'COMPLETED']);
        assert.deepEqual(await query('SELECT destination FROM trips WHERE id=$1', [trip]), [{ destination: 'Agra' }]);
        assert.ok((await query('SELECT is_verified FROM cold_storage_facilities')).every(row => !row.is_verified));
    });

    await t.test('rollback, rejection, expiration, and inactive-trip protections', async () => {
        await db.exec("ALTER TABLE rescue_decisions ADD CONSTRAINT simulate_write_failure CHECK (decision <> 'REQUESTED') NOT VALID");
        putTelemetry();
        assert.equal((await request(owner, '', {})).status, 500);
        assert.equal((await request(owner)).body.length, 1);
        await db.exec('ALTER TABLE rescue_decisions DROP CONSTRAINT simulate_write_failure');
        const requestResult = await request(owner, '', {});
        assert.equal(requestResult.status, 201, JSON.stringify(requestResult.body));
        const path = '/' + requestResult.body.eventId + '/decisions';
        const events = (await request(owner)).body;
        const [candidate] = events[0].candidates;
        assert.equal((await request(owner, path, {
            action: 'APPROVED', candidateId: events[1].candidates[0].id, reason: 'Cross-event candidate',
            facilityConfirmation: 'Confirmed', facilityVerified: true
        })).status, 409);
        await query("UPDATE rescue_events SET valid_until=now() - interval '1 minute' WHERE id=$1", [requestResult.body.eventId]);
        assert.equal((await request(owner, path, {
            action: 'APPROVED', candidateId: candidate.id, reason: 'Expired route',
            facilityConfirmation: 'Confirmed', facilityVerified: true
        })).status, 409);
        assert.equal((await request(driver, path, { action: 'REJECTED', reason: 'Driver rejection' })).status, 403);
        assert.equal((await request(owner, path, { action: 'REJECTED', reason: 'Route estimate expired' })).status, 201);
        const [rejected] = (await request(owner)).body;
        assert.equal(rejected.status, 'REJECTED');
        assert.deepEqual(rejected.decisions.map(decision => decision.decision), ['REQUESTED', 'REJECTED']);
    });

    await t.test('failed diversion is audited and closed without recording a handoff', async () => {
        putTelemetry();
        await putGps();
        const { body } = await request(admin, '', {});
        const path = '/' + body.eventId + '/decisions';
        const [pending] = (await request(owner)).body;
        assert.equal((await request(owner, path, {
            action: 'APPROVED', candidateId: pending.candidates[0].id, reason: 'Confirmed',
            facilityConfirmation: 'Facility accepted shipment', facilityVerified: true
        })).status, 201);
        assert.equal((await request(driver, path, { action: 'STARTED', reason: 'En route' })).status, 201);
        assert.equal((await request(driver, path, { action: 'CANCELLED', reason: 'Facility lost power' })).status, 403);
        assert.equal((await request(admin, path, { action: 'CANCELLED', reason: 'Facility lost power' })).status, 201);
        const [cancelled] = (await request(owner)).body;
        assert.equal(cancelled.status, 'CANCELLED');
        assert.deepEqual(cancelled.decisions.map(decision => decision.decision), ['REQUESTED', 'APPROVED', 'STARTED', 'CANCELLED']);
        await query("UPDATE trips SET status='COMPLETED', ended_at=now() WHERE id=$1", [trip]);
        assert.equal((await request(driver, '', {})).status, 400);
    });
});
