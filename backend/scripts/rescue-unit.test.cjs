const assert = require('node:assert/strict');
const { test } = require('node:test');
const { RescueLocationService } = require('../dist/rescue/rescue-location.service');
const { RescueTelemetryService } = require('../dist/rescue/rescue-telemetry.service');
const { RescueRankingService } = require('../dist/rescue/rescue-ranking.service');
const { RoutingService } = require('../dist/rescue/routing.service');
const { WarehouseService } = require('../dist/rescue/warehouse.service');

test('GPS validation', async t => {
    const now = Date.now();
    const started = new Date(now - 20000);
    const iso = offset => new Date(now + offset).toISOString();
    const valid = {
        latitude: '28.61', longitude: '77.21', accuracy_m: '15',
        recorded_at: iso(-1000), received_at: iso(0)
    };
    const getLocation = row => new RescueLocationService({
        getSql: () => async () => row ? [row] : []
    }).getValidatedLocation('truck', started);
    const cases = [
        ['no reading', null, 503],
        ['missing latitude', { latitude: null }, 400],
        ['invalid coordinates', { latitude: 0, longitude: 0 }, 400],
        ['out of range', { latitude: 91 }, 400],
        ['unknown GPS accuracy', { accuracy_m: null }, 400],
        ['inaccurate GPS', { accuracy_m: 101 }, 400],
        ['future timestamp', { recorded_at: iso(6000) }, 400],
        ['before trip', { recorded_at: iso(-21000) }, 400],
        ['stale', { recorded_at: iso(-61000) }, 503],
        ['unparseable timestamp', { recorded_at: 'invalid' }, 400]
    ];
    for (const [name, patch, status] of cases) {
        await t.test(name, async () => {
            await assert.rejects(getLocation(patch && { ...valid, ...patch }), error => error.getStatus() === status);
        });
    }
    const location = await getLocation(valid);
    assert.deepEqual([location.latitude, location.longitude, location.accuracyMeters], [28.61, 77.21, 15]);
});

test('live telemetry validation', async t => {
    const now = Date.now();
    const started = new Date(now - 20000);
    const iso = offset => new Date(now + offset).toISOString();
    const valid = {
        truck_id: 'truck', device_id: 'ABC-1', connection_number: ' configured ',
        source: 'sensor', model_type: 'PyTorch-SpoilageLSTM',
        timestamp: iso(-8000), received_at: iso(-7500), temperature: 8,
        target_temp: 4, device_target_temp: 4, spoilage_risk: 0.75, shelf_life_remaining_hours: 1
    };
    const validate = row => new RescueTelemetryService({
        getTelemetryForTruck: () => row
    }).getValidatedTelemetry('truck', started);
    const cases = [
        ['missing', null, 503],
        ['wrong truck', { truck_id: 'another' }, 400],
        ['fallback source', { source: 'fallback' }, 400],
        ['fallback model', { model_type: 'Kinetic-Fallback' }, 400],
        ['simulated device', { device_id: 'sim-example' }, 400],
        ['virtual IoT dashboard device', { device_id: 'DEV-ESP32-01' }, 400],
        ['missing pairing', { connection_number: '' }, 400],
        ['stale', { timestamp: iso(-31000) }, 503],
        ['future', { timestamp: iso(6000), received_at: iso(6000) }, 400],
        ['before trip', { timestamp: iso(-25000) }, 400],
        ['bad risk', { spoilage_risk: 1.5 }, 400],
        ['bad shelf life', { shelf_life_remaining_hours: -1 }, 400],
        ['mismatched setpoint', { device_target_temp: 3 }, 400]
    ];
    for (const [name, patch, status] of cases) {
        await t.test(name, () => {
            assert.throws(() => validate(patch && { ...valid, ...patch }), error => error.getStatus() === status);
        });
    }
    const telemetry = validate(valid);
    assert.equal(telemetry.connectionNumber, 'CONFIGURED');
    assert.equal(telemetry.severity, 'CRITICAL');
    assert.ok(telemetry.remainingShelfLifeHours < 1 && telemetry.remainingShelfLifeHours > 0.98);
    assert.equal(validate({ ...valid, spoilage_risk: 0.449 }).requiresRescue, false);
    assert.equal(validate({ ...valid, spoilage_risk: 0.45 }).severity, 'HIGH');
});

test('dataset is loaded from the build and ranked without inferring facility data', async () => {
    const warehouses = new WarehouseService();
    assert.equal(warehouses.getTotalWarehouses(), 4928);
    const origin = { latitude: 28.61, longitude: 77.21 };
    const nearby = warehouses.findNearest(origin.latitude, origin.longitude, 3);
    assert.equal(nearby.length, 3);
    assert.ok(nearby.every(warehouse => !warehouse.isVerified && warehouse.availabilityStatus === 'UNKNOWN'));
    assert.ok(nearby[0].distanceKm <= nearby[1].distanceKm);
    const route = (distanceKm, durationSeconds) => ({ distanceKm, durationSeconds });
    const ranking = new RescueRankingService(warehouses, {
        compareRoutes: async () => [
            { success: false, route: null, error: 'Road route unavailable' },
            { success: true, route: route(35, 4600) },
            { success: true, route: route(14, 1500) }
        ]
    });
    const result = await ranking.rankCandidates({ ...origin, spoilageRisk: 0.6, remainingShelfLifeHours: 1, candidateLimit: 3 });
    assert.equal(result.bestCandidate.warehouse.sourceKey, nearby[2].sourceKey);
    assert.equal(result.bestCandidate.rank, 1);
    assert.ok(result.bestCandidate.estimatedShelfLifeAtArrivalMinutes <= 35);
    assert.equal(result.candidates[1].isTimeFeasible, false);
    assert.equal(result.candidates[2].rescueScore, null);
    await assert.rejects(ranking.rankCandidates({ ...origin, spoilageRisk: -1, remainingShelfLifeHours: 1 }), /risk/);
});

test('routing coalesces duplicates, caches successes, and isolates provider errors', async t => {
    const priorUrl = process.env.OSRM_BASE_URL;
    const priorFetch = global.fetch;
    t.after(() => {
        global.fetch = priorFetch;
        if (priorUrl === undefined) delete process.env.OSRM_BASE_URL;
        else process.env.OSRM_BASE_URL = priorUrl;
    });

    const origin = { latitude: 28.61, longitude: 77.21 };
    const destination = { latitude: 28.7, longitude: 77.23 };
    const unavailable = { latitude: 29, longitude: 77 };
    delete process.env.OSRM_BASE_URL;
    await assert.rejects(new RoutingService().getRoute(origin, destination), /not configured/);

    process.env.OSRM_BASE_URL = 'https://routing.test.invalid';
    let requests = 0;
    let succeeds = false;
    global.fetch = async (url, options) => {
        requests++;
        assert.equal(options.redirect, 'error');
        if (url.includes(';77,29') && !succeeds) return new Response(null, { status: 503 });
        return Response.json({
            code: 'Ok',
            routes: [{
                distance: 14015, duration: 700.3,
                geometry: { type: 'LineString', coordinates: [[77.21, 28.61], [77.23, 28.7]] }
            }]
        });
    };
    const routing = new RoutingService();
    const [first, same, failed] = await routing.compareRoutes(origin, [destination, destination, unavailable]);
    assert.equal(requests, 2);
    assert.equal(first.route, same.route);
    assert.deepEqual(first.route.coordinates, [[28.61, 77.21], [28.7, 77.23]]);
    assert.equal(first.route.durationSeconds, 701);
    assert.equal(first.route.distanceKm, 14.015);
    assert.equal(failed.route, null);
    await routing.getRoute(origin, destination);
    assert.equal(requests, 2);
    succeeds = true;
    await routing.getRoute(origin, unavailable);
    assert.equal(requests, 3);
});
